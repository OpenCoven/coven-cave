import assert from "node:assert/strict";
import test from "node:test";
import type { ResearchSourceRef } from "./research-missions.ts";
import {
  parseFindingsDoc,
  parseInline,
  refToneForStatus,
  sectionsSupportingRef,
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

test("conflict tokens resolve to warn even without a source row", () => {
  const spans = parseInline("open item C1 remains", SOURCES);
  const ref = spans.find((s) => s.kind === "ref") as Extract<FindingsSpan, { kind: "ref" }>;
  assert.deepEqual({ id: ref.id, tone: ref.tone }, { id: "C1", tone: "warn" });
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

test("bold, italic and links parse into styled spans", () => {
  const spans = parseInline("**values** move but *slowly*, see [paper](https://x.test/a)", SOURCES);
  const bold = spans.find((s) => s.kind === "text" && s.bold);
  const italic = spans.find((s) => s.kind === "text" && s.italic);
  const link = spans.find((s) => s.kind === "link") as Extract<FindingsSpan, { kind: "link" }>;
  assert.equal((bold as { text: string }).text, "values");
  assert.equal((italic as { text: string }).text, "slowly");
  assert.deepEqual({ text: link.text, href: link.href }, { text: "paper", href: "https://x.test/a" });
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
  assert.deepEqual(refIds(table.rows[0][1]), ["S14"]);
});

test("lists parse into a single ul block", () => {
  const doc = parseFindingsDoc(FINDINGS, SOURCES);
  const open = doc.sections.find((s) => s.heading === "Open questions");
  const list = open?.blocks.find((b) => b.kind === "ul");
  assert.ok(list && list.kind === "ul");
  assert.equal(list.items.length, 2);
});

test("section and document ref ids are collected in order", () => {
  const doc = parseFindingsDoc(FINDINGS, SOURCES);
  assert.deepEqual(doc.refIds, ["S14", "S6", "C1"]);
  const keyResults = doc.sections.find((s) => s.heading === "Key results");
  assert.deepEqual(keyResults?.refIds, ["S14", "S6"]);
});

test("supports links resolve to the sections that cite a source", () => {
  const doc = parseFindingsDoc(FINDINGS, SOURCES);
  const supportsS14 = sectionsSupportingRef(doc, "S14").map((s) => s.heading);
  assert.deepEqual(supportsS14, ["Current understanding", "Key results"]);
  assert.deepEqual(sectionsSupportingRef(doc, "C1").map((s) => s.heading), ["Open questions"]);
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
