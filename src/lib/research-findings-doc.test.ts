import assert from "node:assert/strict";
import test from "node:test";
import type { ResearchSourceRef } from "./research-missions.ts";
import {
  findRecognizedFindingsRefs,
  parseFindingsDoc,
  parseInline,
  refToneForStatus,
  targetsSupportingRef,
  type FindingsSpan,
} from "./research-findings-doc.ts";

function source(id: string, status: ResearchSourceRef["status"], extra: Partial<ResearchSourceRef> = {}): ResearchSourceRef {
  return { id, title: `${id} title`, sourceType: "web", status, ...extra };
}

const SOURCES: ResearchSourceRef[] = [
  source("S1", "used"),
  source("S6", "conflicting"),
  source("S14", "used"),
  source("R1", "rejected"),
];

function refIds(spans: FindingsSpan[]): string[] {
  return spans.filter((s): s is Extract<FindingsSpan, { kind: "ref" }> => s.kind === "ref").map((s) => s.id);
}

function assertUniqueTargetIds(markdown: string): ReturnType<typeof parseFindingsDoc> {
  const doc = parseFindingsDoc(markdown, SOURCES);
  const targetIds: string[] = [];

  if (doc.ledeId) targetIds.push(doc.ledeId);
  for (const section of doc.sections) {
    targetIds.push(section.id);
    for (const block of section.blocks) {
      targetIds.push(block.id);
      if (block.kind === "ul" || block.kind === "ol") {
        targetIds.push(...block.items.map((item) => item.id));
      } else if (block.kind === "table") {
        targetIds.push(...block.rows.map((row) => row.id));
      }
    }
  }

  assert.equal(new Set(targetIds).size, targetIds.length, "document render target ids must be unique");

  const supportIds = targetsSupportingRef(doc, "S1").map((target) => target.id);
  assert.equal(new Set(supportIds).size, supportIds.length, "support target ids must be unique");
  assert.ok(
    supportIds.every((id) => targetIds.includes(id)),
    "every support target must resolve to a unique document render target",
  );

  return doc;
}

test("ref tone follows the source status", () => {
  assert.equal(refToneForStatus("used"), "accent");
  assert.equal(refToneForStatus("candidate"), "accent");
  assert.equal(refToneForStatus("conflicting"), "warn");
  assert.equal(refToneForStatus("rejected"), "muted");
});

test("longer ids win over their prefixes and brackets are consumed", () => {
  const spans = parseInline("scale helps [S14] but S1 wavers", SOURCES);
  assert.deepEqual(refIds(spans), ["S14", "S1"]);
  // The bracket wrapper is not emitted as text.
  const text = spans.filter((s) => s.kind === "text").map((s) => (s as { text: string }).text).join("");
  assert.ok(!text.includes("["), "brackets around a ref must be consumed");
});

test("whitespace immediately before refs becomes a responsive reference gap", () => {
  const spans = parseInline(
    "Identity drifts independently [S1] [S14]. Evidence [S1] supports continuity.",
    SOURCES,
  );

  assert.deepEqual(spans, [
    { kind: "text", text: "Identity drifts independently" },
    { kind: "ref-gap", text: " " },
    { kind: "ref", id: "S1", tone: "accent" },
    { kind: "ref-gap", text: " " },
    { kind: "ref", id: "S14", tone: "accent" },
    { kind: "text", text: ". Evidence" },
    { kind: "ref-gap", text: " " },
    { kind: "ref", id: "S1", tone: "accent" },
    { kind: "text", text: " supports continuity." },
  ]);
});

test("conflict tokens resolve to warn even without a source row", () => {
  const spans = parseInline("open item C1 remains", SOURCES);
  const ref = spans.find((s) => s.kind === "ref") as Extract<FindingsSpan, { kind: "ref" }>;
  assert.deepEqual({ id: ref.id, tone: ref.tone }, { id: "C1", tone: "warn" });
});

test("strict bracketed missing source ids resolve while bare unknown ids stay prose", () => {
  const spans = parseInline(
    "Missing [S99] and [R88], but bare S98 and escaped \\[S97] stay prose.",
    [],
  );
  const refs = spans.filter(
    (span): span is Extract<FindingsSpan, { kind: "ref" }> =>
      span.kind === "ref",
  );

  assert.deepEqual(
    refs.map(({ id, tone }) => ({ id, tone })),
    [
      { id: "S99", tone: "unresolved" },
      { id: "R88", tone: "unresolved" },
    ],
  );
  assert.match(
    spans
      .filter((span) => span.kind === "text")
      .map((span) => span.text)
      .join(""),
    /bare S98 and escaped \\?\[S97\] stay prose/,
  );
});

test("missing source refs keep markdown code, image, link destination, and URL exclusions", () => {
  const doc = parseFindingsDoc(`# Findings

Visible [S99], inline \`[S98]\`, image ![S97](image.png), link [paper](https://x.test/[S96]),
and URL https://x.test/[S95] stay distinct.

<!-- hidden [S94] -->

\`\`\`md
[S93]
\`\`\`
`, []);

  assert.deepEqual(doc.refIds, ["S99"]);
});

test("conflicting/rejected source refs carry warn/muted tones", () => {
  const spans = parseInline("see S6 and R1 and S14", SOURCES);
  const byId = new Map(
    spans
      .filter((s) => s.kind === "ref")
      .map((s) => [(s as { id: string }).id, (s as { tone: string }).tone]),
  );
  assert.equal(byId.get("S6"), "warn");
  assert.equal(byId.get("R1"), "muted");
  assert.equal(byId.get("S14"), "accent");
});

test("arbitrary capitalised words are not mistaken for refs", () => {
  const spans = parseInline("The System Self-model is Stable", SOURCES);
  assert.deepEqual(refIds(spans), []);
});

test("matcher and inline parser reject source ids outside the parser boundary grammar", () => {
  const sources = [source("^1", "used"), source("-foo-", "used")];
  const input = "Footnote [^1] and marker -foo- stay prose.";

  assert.deepEqual(findRecognizedFindingsRefs(input, sources), []);
  assert.deepEqual(refIds(parseInline(input, sources)), []);
});

test("matcher reports heading refs in order without splitting longer source ids", () => {
  const input = "# Result from manual-1 compared with manual-C1 and manual-1";
  const firstManualIndex = input.indexOf("manual-1");
  const matches = findRecognizedFindingsRefs(input, [
    source("manual-1", "candidate"),
    source("manual-C1", "conflicting"),
  ]);

  assert.deepEqual(matches, [
    { id: "manual-1", index: firstManualIndex, tone: "accent" },
    { id: "manual-C1", index: input.indexOf("manual-C1"), tone: "warn" },
    { id: "manual-1", index: input.indexOf("manual-1", firstManualIndex + 1), tone: "accent" },
  ]);
});

test("bold, italic and links parse into styled spans", () => {
  const spans = parseInline("**values** move but *slowly*, see [paper](https://x.test/a)", SOURCES);
  const bold = spans.find((s) => s.kind === "text" && s.bold);
  const italic = spans.find((s) => s.kind === "text" && s.italic);
  const link = spans.find((s) => s.kind === "link") as Extract<FindingsSpan, { kind: "link" }>;
  assert.equal((bold as { text: string }).text, "values");
  assert.equal((italic as { text: string }).text, "slowly");
  assert.deepEqual({ text: link.text, href: link.href }, { text: "paper", href: "https://x.test/a" });
});

test("inline-link labels tokenize exact and mixed evidence refs without linking the refs", () => {
  const spans = parseInline(
    "[S1](../sources.json), [evidence S14](https://x.test/report), and [paper](https://x.test/plain).",
    SOURCES,
  );

  assert.deepEqual(refIds(spans), ["S1", "S14"]);
  assert.deepEqual(
    spans.filter(
      (span): span is Extract<FindingsSpan, { kind: "link" }> =>
        span.kind === "link",
    ),
    [
      { kind: "link", text: "evidence ", href: "https://x.test/report" },
      { kind: "link", text: "paper", href: "https://x.test/plain" },
    ],
  );
  assert.equal(
    spans.some((span) => span.kind === "link" && /S1|S14/.test(span.text)),
    false,
  );
});

test("inline images consume their whole construct without citing alt text or destinations", () => {
  const spans = parseInline(
    "Before ![nested [S1]](https://x.test/assets/S6_(v2).png) after [S14](../sources/S99).",
    SOURCES,
  );

  assert.deepEqual(refIds(spans), ["S14"]);
  assert.deepEqual(
    spans.filter(
      (span): span is Extract<FindingsSpan, { kind: "link" }> =>
        span.kind === "link",
    ),
    [
      {
        kind: "link",
        text: "nested [S1]",
        href: "https://x.test/assets/S6_(v2).png",
      },
    ],
  );
  assert.deepEqual(spans, [
    { kind: "text", text: "Before " },
    {
      kind: "link",
      text: "nested [S1]",
      href: "https://x.test/assets/S6_(v2).png",
    },
    { kind: "text", text: " after " },
    { kind: "ref", id: "S14", tone: "accent" },
    { kind: "text", text: "." },
  ]);
});

test("linked images consume both destinations before adjacent real citations", () => {
  const spans = parseInline(
    "[![S1](image-S6.png)](https://x.test/S14) then [evidence S14](../sources/S99).",
    SOURCES,
  );

  assert.deepEqual(refIds(spans), ["S14"]);
  assert.deepEqual(spans, [
    {
      kind: "link",
      text: "S1",
      href: "https://x.test/S14",
    },
    { kind: "text", text: " then " },
    { kind: "link", text: "evidence ", href: "../sources/S99" },
    { kind: "ref", id: "S14", tone: "accent" },
    { kind: "text", text: "." },
  ]);
});

test("reference-style image variants degrade without exposing image fields as citations", () => {
  const spans = parseInline(
    "![S1][img], ![S6][], [![S14](image-S6.png)][target], and [![S1][thumb]](https://x.test/S6) then [S14].",
    SOURCES,
  );

  assert.deepEqual(refIds(spans), ["S14"]);
  assert.deepEqual(spans, [
    { kind: "text", text: "S1" },
    { kind: "text", text: ", " },
    { kind: "text", text: "S6" },
    { kind: "text", text: ", " },
    { kind: "link", text: "S14", href: "image-S6.png" },
    { kind: "text", text: ", and " },
    { kind: "link", text: "S1", href: "https://x.test/S6" },
    { kind: "text", text: " then" },
    { kind: "ref-gap", text: " " },
    { kind: "ref", id: "S14", tone: "accent" },
    { kind: "text", text: "." },
  ]);
});

test("ordinary reference-style prose links remain scan-visible prose", () => {
  const spans = parseInline("[paper][S1] then [S14].", SOURCES);

  assert.deepEqual(refIds(spans), ["S1", "S14"]);
  assert.equal(spans.some((span) => span.kind === "link"), false);
  assert.deepEqual(spans, [
    { kind: "text", text: "[paper]" },
    { kind: "ref", id: "S1", tone: "accent" },
    { kind: "text", text: " then" },
    { kind: "ref-gap", text: " " },
    { kind: "ref", id: "S14", tone: "accent" },
    { kind: "text", text: "." },
  ]);
});

test("linked evidence refs populate claim support targets while destinations stay opaque", () => {
  const doc = parseFindingsDoc(`# Findings

## Linked evidence

[S1](../sources/S99) and [evidence manual-1](https://x.test/S88) support this claim.
`, [...SOURCES, source("manual-1", "candidate")]);
  const block = doc.sections[0]?.blocks[0];
  assert.ok(block?.kind === "p");
  assert.deepEqual(block.refIds, ["S1", "manual-1"]);
  assert.deepEqual(doc.refIds, ["S1", "manual-1"]);
  assert.deepEqual(
    targetsSupportingRef(doc, "S1").map((target) => target.id),
    [block.id],
  );
  assert.deepEqual(
    targetsSupportingRef(doc, "manual-1").map((target) => target.id),
    [block.id],
  );
});

const FINDINGS = `<!-- research-provenance
mission: cave-1
generated_at: 2026-07-24
-->

# Identity Preservation for Agents

> Can an agent that rewrites itself stay recognisably itself?

## Current understanding

Identity has **three** components and can drift independently S14.

## Key results

| Finding | Source | Confidence |
| --- | --- | --- |
| Scale raises coherence | S14 | High |
| Checkpoints cut drift | S6 | Medium |

## Open questions

- Does coherence cause drift? C1
- No evidence yet on tool-level modification.
`;

test("parses title, lede and collapsible sections", () => {
  const doc = parseFindingsDoc(FINDINGS, SOURCES);
  assert.equal(doc.title, "Identity Preservation for Agents");
  assert.ok(doc.lede, "a leading blockquote becomes the lede");
  assert.deepEqual(
    doc.sections.map((s) => s.heading),
    ["Current understanding", "Key results", "Open questions"],
  );
  // Section ids are stable slugs for the contents rail.
  assert.equal(doc.sections[0].id, "s-current-understanding");
});

test("repeated headings receive unique section and inherited target ids", () => {
  const doc = assertUniqueTargetIds(`# Findings

## Results

First claim [S1].

## Results

- Second claim [S1]

## Results

| Finding | Source |
| --- | --- |
| Third claim | [S1] |
`);

  assert.deepEqual(doc.sections.map((section) => section.id), [
    "s-results",
    "s-results-2",
    "s-results-3",
  ]);
  assert.deepEqual(doc.sections.map((section) => section.blocks[0].id), [
    "s-results-block-1",
    "s-results-2-block-1",
    "s-results-3-block-1",
  ]);
});

test("headings sharing a truncated slug receive unique target ids", () => {
  const sharedPrefix = "A".repeat(40);
  const doc = assertUniqueTargetIds(`# Findings

## ${sharedPrefix} first

First claim [S1].

## ${sharedPrefix} second

Second claim [S1].
`);

  const baseId = `s-${sharedPrefix.toLowerCase()}`;
  assert.deepEqual(doc.sections.map((section) => section.id), [baseId, `${baseId}-2`]);
});

test("preamble and an Overview heading cannot share reserved target ids", () => {
  const doc = assertUniqueTargetIds(`# Findings

> Research question [S1]

Preamble claim [S1].

## Overview

Overview claim [S1].
`);

  assert.equal(doc.ledeId, "research-question");
  assert.deepEqual(doc.sections.map((section) => section.id), ["s-overview", "s-overview-2"]);
  assert.deepEqual(doc.sections.map((section) => section.blocks[0].id), [
    "s-overview-block-2",
    "s-overview-2-block-1",
  ]);
});

test("later section ids disambiguate against earlier generated block ids", () => {
  const doc = assertUniqueTargetIds(`# Findings

## Results

First claim [S1].

## Results block 1

Second claim [S1].
`);

  assert.deepEqual(doc.sections.map((section) => section.id), [
    "s-results",
    "s-results-block-1-2",
  ]);
  assert.deepEqual(doc.sections.map((section) => section.blocks[0].id), [
    "s-results-block-1",
    "s-results-block-1-2-block-1",
  ]);
});

test("later section ids disambiguate against earlier preamble block ids", () => {
  const doc = assertUniqueTargetIds(`# Findings

Preamble claim [S1].

## Overview block 1

Section claim [S1].
`);

  assert.deepEqual(doc.sections.map((section) => section.id), [
    "s-overview",
    "s-overview-block-1-2",
  ]);
  assert.deepEqual(doc.sections.map((section) => section.blocks[0].id), [
    "s-overview-block-1",
    "s-overview-block-1-2-block-1",
  ]);
});

test("generated child ids disambiguate against earlier cross-level section ids", () => {
  const doc = assertUniqueTargetIds(`# Findings

## Results block 1 item 1

Earlier item-shaped section [S1].

## Results block 2 row 1

Earlier row-shaped section [S1].

## Results

- List claim [S1]

| Finding | Source |
| --- | --- |
| Table claim | [S1] |
`);

  const results = doc.sections.at(-1);
  assert.ok(results);
  const list = results.blocks[0];
  const table = results.blocks[1];
  assert.ok(list.kind === "ul");
  assert.ok(table.kind === "table");
  assert.equal(list.items[0].id, "s-results-block-1-item-1-2");
  assert.equal(table.rows[0].id, "s-results-block-2-row-1-2");
});

test("provenance comment never becomes prose", () => {
  const doc = parseFindingsDoc(FINDINGS, SOURCES);
  const firstSpan = doc.lede?.[0] as { text?: string } | undefined;
  assert.ok(!(firstSpan?.text ?? "").includes("research-provenance"));
});

test("markdown pipe tables become table blocks with ref chips in cells", () => {
  const doc = parseFindingsDoc(FINDINGS, SOURCES);
  const keyResults = doc.sections.find((s) => s.heading === "Key results");
  const table = keyResults?.blocks.find((b) => b.kind === "table");
  assert.ok(table && table.kind === "table");
  assert.equal(table.header.length, 3);
  assert.equal(table.rows.length, 2);
  // The Source cell of row 1 carries the S14 chip.
  assert.deepEqual(refIds(table.rows[0].cells[1]), ["S14"]);
});

test("marks only recognized table columns whose body cells are entirely references", () => {
  const doc = parseFindingsDoc(`# Findings

## Redundant

| Finding | Source | Confidence |
| --- | --- | --- |
| First result | [S1] [S14] | High |
| Second result | S6 | Medium |

## Mixed

| Finding | Reference | Evidence |
| --- | --- | --- |
| First result | Primary source [S1] | [S14] |
| Second result | [S6] | Supporting note |

## Unrecognized

| Finding | Owner |
| --- | --- |
| First result | [S1] |
`, SOURCES);
  const tables = doc.sections.map((section) => section.blocks[0]);

  assert.ok(tables.every((block) => block.kind === "table"));
  assert.deepEqual(tables.map((block) => block.redundantRefColumnIndexes), [
    [1],
    [],
    [],
  ]);
});

test("table headers expose unique reference ids separately from row evidence", () => {
  const doc = parseFindingsDoc(`# Findings

## Key results

| Finding S14 | Source S14 | Confidence S6 |
| --- | --- | --- |
| Scale raises value coherence | S1 | High |
`, SOURCES);
  const table = doc.sections[0]?.blocks[0];
  assert.ok(table?.kind === "table");
  assert.deepEqual(table.headerRefIds, ["S14", "S6"]);
  assert.deepEqual(table.rows[0].refIds, ["S1"]);
  assert.deepEqual(table.refIds, ["S14", "S6", "S1"]);
});

test("lists parse into a single ul block", () => {
  const doc = parseFindingsDoc(FINDINGS, SOURCES);
  const open = doc.sections.find((s) => s.heading === "Open questions");
  const list = open?.blocks.find((b) => b.kind === "ul");
  assert.ok(list && list.kind === "ul");
  assert.equal(list.items.length, 2);
});

test("fenced Mermaid survives as a code block instead of flattened prose", () => {
  const doc = parseFindingsDoc(`# Findings

## Architecture

\`\`\`mermaid
flowchart TD
  UI[Research Desk] --> D[Daemon]
\`\`\`

## Runtime

Ready.
`, SOURCES);
  const architecture = doc.sections.find((s) => s.heading === "Architecture");
  assert.ok(architecture);
  assert.equal(architecture.blocks.length, 1);
  assert.deepEqual(architecture.blocks[0], {
    id: "s-architecture-block-1",
    kind: "code",
    language: "mermaid",
    code: "flowchart TD\n  UI[Research Desk] --> D[Daemon]",
    refIds: [],
  });
  assert.deepEqual(doc.sections.map((section) => section.heading), ["Architecture", "Runtime"]);
});

test("headings inside fenced code do not split the document", () => {
  const doc = parseFindingsDoc(`# Findings

\`\`\`markdown
# This is code, not a section
\`\`\`

## Real section

Body.
`, SOURCES);
  assert.deepEqual(doc.sections.map((section) => section.heading), ["", "Real section"]);
  const overview = doc.sections.find((section) => section.id === "s-overview");
  assert.deepEqual(overview?.blocks[0], {
    id: "s-overview-block-1",
    kind: "code",
    language: "markdown",
    code: "# This is code, not a section",
    refIds: [],
  });
});

test("section and document ref ids are collected in order", () => {
  const doc = parseFindingsDoc(FINDINGS, SOURCES);
  assert.deepEqual(doc.refIds, ["S14", "S6", "C1"]);
  const keyResults = doc.sections.find((s) => s.heading === "Key results");
  assert.deepEqual(keyResults?.refIds, ["S14", "S6"]);
});

test("support targets resolve to the claims that cite a source", () => {
  const doc = parseFindingsDoc(FINDINGS, SOURCES);
  const supportsS14 = targetsSupportingRef(doc, "S14").map((target) => target.label);
  assert.deepEqual(supportsS14, ["Current understanding", "Key results · row 1"]);
  assert.deepEqual(
    targetsSupportingRef(doc, "C1").map((target) => target.label),
    ["Open questions · item 1"],
  );
});

test("support targets disambiguate duplicate claims only within the same section", () => {
  const doc = parseFindingsDoc(`# Findings

## Current understanding

First claim [S1].

Second claim [S1].

## Implications

Unique claim [S1].
`, SOURCES);

  assert.deepEqual(
    targetsSupportingRef(doc, "S1").map((target) => target.label),
    [
      "Current understanding · claim 1/2",
      "Current understanding · claim 2/2",
      "Implications",
    ],
  );
});

test("ordered lists and quotations retain stable block identity and reference ids", () => {
  const doc = parseFindingsDoc(`# Findings

## Evidence

1. First claim [S1]
2. Second claim S14

> Signed does not mean verified [S6].
> It remains disputed S14.
`, SOURCES);
  const evidence = doc.sections[0];
  const ordered = evidence.blocks[0];
  const quote = evidence.blocks[1];

  assert.ok(ordered.kind === "ol");
  assert.ok(quote.kind === "quote");
  assert.equal(ordered.id, "s-evidence-block-1");
  assert.equal(quote.id, "s-evidence-block-2");
  assert.deepEqual(ordered.refIds, ["S1", "S14"]);
  assert.deepEqual(quote.refIds, ["S6", "S14"]);
  assert.equal(
    quote.spans.map((span) => (span.kind === "ref" ? span.id : span.text)).join(""),
    "Signed does not mean verified S6. It remains disputed S14.",
  );
});

test("list items and table rows expose stable ids and their own reference ids", () => {
  const doc = parseFindingsDoc(FINDINGS, SOURCES);
  const questions = doc.sections.find((section) => section.heading === "Open questions");
  const list = questions?.blocks.find((block) => block.kind === "ul");
  assert.ok(list?.kind === "ul");
  assert.equal(list.items[0].id, "s-open-questions-block-1-item-1");
  assert.deepEqual(list.items[0].refIds, ["C1"]);
  assert.equal(list.items[1].id, "s-open-questions-block-1-item-2");
  assert.deepEqual(list.items[1].refIds, []);

  const results = doc.sections.find((section) => section.heading === "Key results");
  const table = results?.blocks.find((block) => block.kind === "table");
  assert.ok(table?.kind === "table");
  assert.equal(table.rows[0].id, "s-key-results-block-1-row-1");
  assert.deepEqual(table.rows[0].refIds, ["S14"]);
  assert.equal(table.rows[1].id, "s-key-results-block-1-row-2");
  assert.deepEqual(table.rows[1].refIds, ["S6"]);
});

test("missing refs flow through block, item, row, section, and document provenance", () => {
  const doc = parseFindingsDoc(`# Findings

## Evidence

Paragraph [S99].

- List claim [R88]

| Finding | Source |
| --- | --- |
| Missing ledger row | [S77] |
`, [source("S1", "used")]);
  const evidence = doc.sections[0];
  const paragraph = evidence.blocks[0];
  const list = evidence.blocks[1];
  const table = evidence.blocks[2];

  assert.ok(paragraph.kind === "p");
  assert.ok(list.kind === "ul");
  assert.ok(table.kind === "table");
  assert.deepEqual(paragraph.refIds, ["S99"]);
  assert.deepEqual(list.items[0].refIds, ["R88"]);
  assert.deepEqual(table.rows[0].refIds, ["S77"]);
  assert.deepEqual(evidence.refIds, ["S99", "R88", "S77"]);
  assert.deepEqual(doc.refIds, ["S99", "R88", "S77"]);
  assert.deepEqual(
    targetsSupportingRef(doc, "S99").map((target) => target.id),
    [paragraph.id],
  );
});

test("support targets include lede, overview, list items, and table rows", () => {
  const doc = parseFindingsDoc(`# Findings

> Question [S1]

Overview [S1].

## Results

- Claim [S1]

| Finding | Source |
| --- | --- |
| Result | [S1] |
`, SOURCES);

  assert.equal(doc.ledeId, "research-question");
  assert.deepEqual(targetsSupportingRef(doc, "S1"), [
    { id: "research-question", label: "Research question", sectionId: null },
    { id: "s-overview-block-2", label: "Overview", sectionId: "s-overview" },
    {
      id: "s-results-block-1-item-1",
      label: "Results · item 1",
      sectionId: "s-results",
    },
    {
      id: "s-results-block-2-row-1",
      label: "Results · row 1",
      sectionId: "s-results",
    },
  ]);
});

test("headingless findings still yield a single renderable section", () => {
  const doc = parseFindingsDoc("Just a paragraph with S1 evidence.", SOURCES);
  assert.equal(doc.title, null);
  assert.equal(doc.sections.length, 1);
  assert.equal(doc.sections[0].heading, "");
  assert.deepEqual(doc.sections[0].refIds, ["S1"]);
});

test("empty findings degrade to an empty document", () => {
  const doc = parseFindingsDoc("", SOURCES);
  assert.deepEqual({ title: doc.title, lede: doc.lede, sections: doc.sections }, {
    title: null,
    lede: null,
    sections: [],
  });
});

test("with no sources, no chips are produced but prose survives", () => {
  const doc = parseFindingsDoc("# T\n\nPlain S14 text.", []);
  const section = doc.sections[0];
  const paragraph = section.blocks[0];
  assert.ok(paragraph.kind === "p");
  assert.deepEqual(refIds(paragraph.spans), []);
  assert.equal(paragraph.spans.map((s) => (s as { text?: string }).text ?? "").join(""), "Plain S14 text.");
});
