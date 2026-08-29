import assert from "node:assert/strict";
import test from "node:test";
import type { ResearchSourceRef } from "./research-missions.ts";
import {
  deriveResearchFindingsIntegrity,
  scanBracketedSourceIds,
} from "./research-findings-integrity.ts";
import { parseFindingsDoc } from "./research-findings-doc.ts";

function source(id: string, status: ResearchSourceRef["status"]): ResearchSourceRef {
  return { id, title: `${id} title`, sourceType: "web", status };
}

test("explicit bracketed groups return ids in first-seen order", () => {
  assert.deepEqual(scanBracketedSourceIds("Claim [S1]. Then [S4, S5] and [R2]."), ["S1", "S4", "S5", "R2"]);
});

test("scanner keeps first-seen order and skips bracketed conflict or unknown ids", () => {
  assert.deepEqual(scanBracketedSourceIds("Claim [S2, C1, S1, X2, S2, R2]."), ["S2", "S1", "R2"]);
});

test("scanner ignores markdown syntax that only looks like evidence", () => {
  assert.deepEqual(
    scanBracketedSourceIds(
      [
        "Claim [S1].",
        "[paper](https://x.test/evidence_(C1))",
        "```md",
        "[S2] C2",
        "```still-code",
        "[S9] C2",
        "```   ",
        "Inline `[S3] C3` stays code.",
        "![nested [S4]](https://x.test/assets/report_(v2).png)",
        "Bare URL https://x.test/conflicts/(C4) is not a conflict.",
      ].join("\n"),
    ),
    ["S1"],
  );
});

test("scanner ignores bare source-like prose", () => {
  assert.deepEqual(scanBracketedSourceIds("The model S1 runs in S3 bucket land."), []);
});

test("scanner remains stable across repeated calls", () => {
  const markdown = "First [S1, S2] then [R2].";
  assert.deepEqual(scanBracketedSourceIds(markdown), ["S1", "S2", "R2"]);
  assert.deepEqual(scanBracketedSourceIds(markdown), ["S1", "S2", "R2"]);
});

test("empty ledger with citations reports unavailable and keeps conflicts separate", () => {
  const integrity = deriveResearchFindingsIntegrity("Critical: [S1]. Conflict C2.", []);
  assert.deepEqual(integrity, {
    ledger: "empty",
    referencedIds: ["S1"],
    unresolvedIds: ["S1"],
    conflictIds: ["C2"],
    counts: { candidate: 0, used: 0, conflicting: 0, rejected: 0 },
    summary: {
      kind: "unavailable",
      label: "Sources unavailable — references can't be verified",
    },
  });
});

test("markdown syntax does not create false source or conflict states", () => {
  const integrity = deriveResearchFindingsIntegrity(
    [
      "Claim [S1].",
      "[paper](https://x.test/evidence_(C1))",
      "```md",
      "[S2] C2",
      "```still-code",
      "[S9] C2",
      "```   ",
      "Inline `S3 C3` stays code.",
      "![nested [S4]](https://x.test/assets/report_(v2).png)",
      "Bare URL https://x.test/conflicts/(C4) is not a conflict.",
    ].join("\n"),
    [source("S1", "used")],
  );
  assert.deepEqual(integrity.referencedIds, ["S1"]);
  assert.deepEqual(integrity.unresolvedIds, []);
  assert.deepEqual(integrity.conflictIds, []);
  assert.equal(integrity.summary.kind, "verified");
});

test("partially populated ledger reports unresolved ids before conflicts", () => {
  const integrity = deriveResearchFindingsIntegrity("[S1] [S9] C1.", [source("S1", "candidate")]);
  assert.deepEqual(integrity.unresolvedIds, ["S9"]);
  assert.deepEqual(integrity.conflictIds, ["C1"]);
  assert.equal(integrity.summary.kind, "unresolved");
  assert.equal(integrity.summary.label, "1 reference is unresolved");
});

test("parser and integrity share missing-ref recognition for empty and partial ledgers", () => {
  for (const sources of [[], [source("S1", "used")]]) {
    const markdown = "Known S1, missing [S99], rejected-shaped [R88], and bare S98.";
    const doc = parseFindingsDoc(markdown, sources);
    const integrity = deriveResearchFindingsIntegrity(markdown, sources);

    assert.deepEqual(
      doc.refIds.filter((id) => /^(?:S|R)\d+$/.test(id)),
      integrity.referencedIds,
    );
    assert.deepEqual(integrity.unresolvedIds, ["S99", "R88"]);
  }
});

test("used and candidate sources count together but summarize as candidate", () => {
  const integrity = deriveResearchFindingsIntegrity("[S1] [S2]", [
    source("S1", "used"),
    source("S2", "candidate"),
  ]);
  assert.deepEqual(integrity.counts, { candidate: 1, used: 1, conflicting: 0, rejected: 0 });
  assert.equal(integrity.summary.kind, "candidate");
  assert.equal(integrity.summary.label, "1 source awaits review");
});

test("parser-recognized arbitrary source ids count as citations without creating conflicts", () => {
  const integrity = deriveResearchFindingsIntegrity("Manual note cites manual-C1 for follow-up.", [
    source("manual-C1", "candidate"),
  ]);
  assert.deepEqual(integrity.referencedIds, ["manual-C1"]);
  assert.deepEqual(integrity.unresolvedIds, []);
  assert.deepEqual(integrity.conflictIds, []);
  assert.equal(integrity.summary.kind, "candidate");
  assert.equal(integrity.summary.label, "1 source awaits review");
});

test("parser boundary grammar excludes punctuation-delimited source ids from integrity", () => {
  const integrity = deriveResearchFindingsIntegrity("Footnote [^1] and marker -foo- stay prose.", [
    source("^1", "used"),
    source("-foo-", "used"),
  ]);

  assert.deepEqual(integrity.referencedIds, []);
  assert.deepEqual(integrity.unresolvedIds, []);
  assert.deepEqual(integrity.conflictIds, []);
  assert.equal(integrity.summary.kind, "none");
});

test("missing and actual references preserve document order", () => {
  const integrity = deriveResearchFindingsIntegrity(
    "Missing [S9] before manual-1, then actual S1.",
    [source("manual-1", "candidate"), source("S1", "used")],
  );

  assert.deepEqual(integrity.referencedIds, ["S9", "manual-1", "S1"]);
  assert.deepEqual(integrity.unresolvedIds, ["S9"]);
});

test("inline code removal inserts a space so arbitrary ids are not fabricated", () => {
  const integrity = deriveResearchFindingsIntegrity("manual`x`-1 stays prose.", [
    source("manual-1", "candidate"),
  ]);
  assert.deepEqual(integrity.referencedIds, []);
  assert.deepEqual(integrity.unresolvedIds, []);
  assert.equal(integrity.summary.kind, "none");
});

test("balanced link stripping preserves visible labels while removing destinations", () => {
  const integrity = deriveResearchFindingsIntegrity("Use [manual-1](https://x.test/docs_(v2)) as evidence.", [
    source("manual-1", "candidate"),
  ]);
  assert.deepEqual(integrity.referencedIds, ["manual-1"]);
  assert.deepEqual(integrity.unresolvedIds, []);
  assert.equal(integrity.summary.kind, "candidate");
});

test("inline-link labels remain detectable when their ledger row is missing", () => {
  const integrity = deriveResearchFindingsIntegrity("[S9](https://x.test/doc)", []);
  assert.deepEqual(integrity.referencedIds, ["S9"]);
  assert.deepEqual(integrity.unresolvedIds, ["S9"]);
  assert.equal(integrity.summary.kind, "unavailable");
});

test("exact and mixed inline-link labels count refs while destination ids stay opaque", () => {
  const integrity = deriveResearchFindingsIntegrity(
    "[S1](../sources/S99) and [evidence S14](https://x.test/S88) plus [paper](https://x.test/S6).",
    [source("S1", "used"), source("S14", "candidate"), source("S6", "used")],
  );
  assert.deepEqual(integrity.referencedIds, ["S1", "S14"]);
  assert.deepEqual(integrity.unresolvedIds, []);
  assert.deepEqual(integrity.conflictIds, []);
  assert.equal(integrity.summary.kind, "candidate");
});

test("mixed inline-link labels keep arbitrary persisted source ids aligned with the parser", () => {
  const markdown = "[context manual-1](https://x.test/C9)";
  const sources = [source("manual-1", "used")];
  assert.deepEqual(parseFindingsDoc(markdown, sources).refIds, ["manual-1"]);
  assert.deepEqual(
    deriveResearchFindingsIntegrity(markdown, sources).referencedIds,
    ["manual-1"],
  );
});

test("escaped inline-link markers still use the findings parser grammar", () => {
  const markdown = "\\[paper](manual-1)";
  const sources = [source("manual-1", "used")];
  assert.deepEqual(parseFindingsDoc(markdown, sources).refIds, []);

  const integrity = deriveResearchFindingsIntegrity(markdown, sources);
  assert.deepEqual(integrity.referencedIds, []);
  assert.deepEqual(integrity.conflictIds, []);
  assert.equal(integrity.summary.kind, "none");
});

test("malformed links preserve citations rendered as ordinary prose", () => {
  const integrity = deriveResearchFindingsIntegrity("See [paper](bad [S1])", [
    source("S1", "used"),
  ]);
  assert.deepEqual(integrity.referencedIds, ["S1"]);
  assert.deepEqual(integrity.unresolvedIds, []);
  assert.equal(integrity.summary.kind, "verified");
});

test("bare URL stripping preserves parser boundaries before URL schemes", () => {
  const markdown =
    "S1https://example.test/report C1https://example.test/conflict";
  const sources = [source("S1", "used")];
  const doc = parseFindingsDoc(markdown, sources);
  const integrity = deriveResearchFindingsIntegrity(markdown, sources);

  assert.deepEqual(doc.refIds, []);
  assert.deepEqual(integrity.referencedIds, []);
  assert.deepEqual(integrity.unresolvedIds, []);
  assert.deepEqual(integrity.conflictIds, []);
  assert.equal(integrity.summary.kind, "none");
});

test("bare URL stripping stops before adjacent citations and leaves later conflicts visible", () => {
  const markdown = "See https://x.test/report.[S1] C2.";
  const sources = [source("S1", "used")];
  const doc = parseFindingsDoc(markdown, sources);
  const integrity = deriveResearchFindingsIntegrity(markdown, sources);

  assert.deepEqual(doc.refIds, ["S1", "C2"]);
  assert.deepEqual(integrity.referencedIds, ["S1"]);
  assert.deepEqual(integrity.unresolvedIds, []);
  assert.deepEqual(integrity.conflictIds, ["C2"]);
  assert.equal(integrity.summary.kind, "conflicting");
});

test("bare source ids appended to URLs stay aligned with parser URL opacity", () => {
  const sources = [source("S1", "used")];
  for (const markdown of [
    "https://x.test/reportS1",
    "https://x.test/report/S1",
    "https://x.test/report.C1",
  ]) {
    const doc = parseFindingsDoc(markdown, sources);
    const integrity = deriveResearchFindingsIntegrity(markdown, sources);

    assert.deepEqual(doc.refIds, [], markdown);
    assert.deepEqual(integrity.referencedIds, [], markdown);
    assert.deepEqual(integrity.unresolvedIds, [], markdown);
    assert.deepEqual(integrity.conflictIds, [], markdown);
  }
});

test("bare URL schemes are stripped case-insensitively", () => {
  const integrity = deriveResearchFindingsIntegrity("HTTPS://x.test/S1/C2", [
    source("S1", "used"),
  ]);
  assert.deepEqual(integrity.referencedIds, []);
  assert.deepEqual(integrity.unresolvedIds, []);
  assert.deepEqual(integrity.conflictIds, []);
  assert.equal(integrity.summary.kind, "none");
});

test("bare IPv6 URLs remain opaque without swallowing adjacent citations", () => {
  const integrity = deriveResearchFindingsIntegrity(
    "See http://[::1]/S1, http://user@[::1]/S1/C2, and http://[::1][S2].",
    [source("S1", "used"), source("S2", "candidate")],
  );
  assert.deepEqual(integrity.referencedIds, ["S2"]);
  assert.deepEqual(integrity.unresolvedIds, []);
  assert.deepEqual(integrity.conflictIds, []);
  assert.equal(integrity.summary.kind, "candidate");
});

test("bracketed URL path and query components remain opaque", () => {
  const integrity = deriveResearchFindingsIntegrity(
    "See https://x.test/[S1] and https://x.test/?q=[S2].",
    [source("S1", "used"), source("S2", "candidate")],
  );
  assert.deepEqual(integrity.referencedIds, []);
  assert.deepEqual(integrity.unresolvedIds, []);
  assert.deepEqual(integrity.conflictIds, []);
  assert.equal(integrity.summary.kind, "none");
});

test("linked images do not create referenced ids or summaries", () => {
  const integrity = deriveResearchFindingsIntegrity("[![S9](image.png)](target)", [source("S9", "candidate")]);
  assert.deepEqual(integrity.referencedIds, []);
  assert.deepEqual(integrity.unresolvedIds, []);
  assert.equal(integrity.summary.kind, "none");
  assert.equal(integrity.summary.label, "This report does not cite sources");
});

test("parser and integrity ignore image fields while keeping adjacent linked citations", () => {
  const markdown =
    "![S1](https://x.test/assets/S6.png) [![S14](image-S6.png)](https://x.test/S1) [evidence S14](../sources/S99)";
  const sources = [
    source("S1", "used"),
    source("S6", "used"),
    source("S14", "candidate"),
  ];
  const doc = parseFindingsDoc(markdown, sources);
  const integrity = deriveResearchFindingsIntegrity(markdown, sources);

  assert.deepEqual(doc.refIds, ["S14"]);
  assert.deepEqual(integrity.referencedIds, ["S14"]);
  assert.deepEqual(integrity.unresolvedIds, []);
  assert.deepEqual(integrity.conflictIds, []);
  assert.equal(integrity.summary.kind, "candidate");
});

test("parser and integrity align across reference-style and linked-image variants", () => {
  const markdown =
    "![S1][img], ![S6][], [![S14](image-S6.png)][target], [![S1][thumb]](https://x.test/S6), and [![alt](image.png)][S1] then [S14].";
  const sources = [
    source("S1", "used"),
    source("S6", "used"),
    source("S14", "candidate"),
  ];

  const doc = parseFindingsDoc(markdown, sources);
  const integrity = deriveResearchFindingsIntegrity(markdown, sources);

  assert.deepEqual(doc.refIds, ["S14"]);
  assert.deepEqual(integrity.referencedIds, ["S14"]);
  assert.deepEqual(integrity.unresolvedIds, []);
  assert.deepEqual(integrity.conflictIds, []);
  assert.equal(integrity.summary.kind, "candidate");
});

test("bare image-like source tokens remain visible with an available ledger", () => {
  const markdown = "Critical![S1]";
  const sources = [source("S1", "used")];

  const doc = parseFindingsDoc(markdown, sources);
  const integrity = deriveResearchFindingsIntegrity(markdown, sources);

  assert.deepEqual(doc.refIds, ["S1"]);
  assert.deepEqual(integrity.referencedIds, ["S1"]);
  assert.deepEqual(integrity.unresolvedIds, []);
  assert.equal(integrity.summary.kind, "verified");
});

test("bare image-like source tokens remain visible with a missing ledger", () => {
  const markdown = "Critical![S1]";

  const doc = parseFindingsDoc(markdown, []);
  const integrity = deriveResearchFindingsIntegrity(markdown, []);

  assert.deepEqual(doc.refIds, ["S1"]);
  assert.deepEqual(integrity.referencedIds, ["S1"]);
  assert.deepEqual(integrity.unresolvedIds, ["S1"]);
  assert.equal(integrity.summary.kind, "unavailable");
});

test("undefined reference-style links preserve visible source suffixes", () => {
  const integrity = deriveResearchFindingsIntegrity("[paper][S1]", []);
  assert.deepEqual(integrity.referencedIds, ["S1"]);
  assert.deepEqual(integrity.unresolvedIds, ["S1"]);
  assert.equal(integrity.summary.kind, "unavailable");
});

test("reference definitions remain scan-visible when the parser renders them as prose", () => {
  const markdown = "[paper]: /docs/manual-1/C2";
  const sources = [source("manual-1", "candidate")];
  assert.deepEqual(parseFindingsDoc(markdown, sources).refIds, ["manual-1", "C2"]);

  const integrity = deriveResearchFindingsIntegrity(markdown, sources);
  assert.deepEqual(integrity.referencedIds, ["manual-1"]);
  assert.deepEqual(integrity.unresolvedIds, []);
  assert.deepEqual(integrity.conflictIds, ["C2"]);
  assert.equal(integrity.summary.kind, "conflicting");
});

test("citation prose beginning with a source label is not hidden as a definition", () => {
  const integrity = deriveResearchFindingsIntegrity(
    "[S1]: This source supports the claim.",
    [source("S1", "used")],
  );
  assert.deepEqual(integrity.referencedIds, ["S1"]);
  assert.deepEqual(integrity.unresolvedIds, []);
  assert.equal(integrity.summary.kind, "verified");
});

test("nested brackets do not form a hidden reference definition", () => {
  const integrity = deriveResearchFindingsIntegrity("[[S1]]: /url", [source("S1", "used")]);
  assert.deepEqual(integrity.referencedIds, ["S1"]);
  assert.deepEqual(integrity.unresolvedIds, []);
  assert.equal(integrity.summary.kind, "verified");
});

test("nested visible citations remain unresolved without ledger rows", () => {
  const integrity = deriveResearchFindingsIntegrity("[[S1]]: /url", []);
  assert.deepEqual(integrity.referencedIds, ["S1"]);
  assert.deepEqual(integrity.unresolvedIds, ["S1"]);
  assert.equal(integrity.summary.kind, "unavailable");
});

test("unsupported container fences remain visible like parser prose", () => {
  const markdown =
    "> ~~~\n> [S1] C2\n> ~~~\n    >  ```\n    > [S9]\n    >  ```";
  const sources = [source("S1", "used")];
  assert.deepEqual(parseFindingsDoc(markdown, sources).refIds, ["S1", "C2"]);

  const integrity = deriveResearchFindingsIntegrity(markdown, sources);
  assert.deepEqual(integrity.referencedIds, ["S1", "S9"]);
  assert.deepEqual(integrity.unresolvedIds, ["S9"]);
  assert.deepEqual(integrity.conflictIds, ["C2"]);
  assert.equal(integrity.summary.kind, "unresolved");
});

test("deeply indented backtick lines do not form inline code across prose", () => {
  const markdown = "    ```\n[S1]\n    ```";
  const sources = [source("S1", "used")];
  assert.deepEqual(parseFindingsDoc(markdown, sources).refIds, ["S1"]);

  const integrity = deriveResearchFindingsIntegrity(markdown, sources);
  assert.deepEqual(integrity.referencedIds, ["S1"]);
  assert.equal(integrity.summary.kind, "verified");
});

test("indented continuation runs can close an existing inline code span", () => {
  const integrity = deriveResearchFindingsIntegrity(
    "Before ```hidden [S9]\n    ``` after",
    [],
  );
  assert.deepEqual(integrity.referencedIds, []);
  assert.deepEqual(integrity.unresolvedIds, []);
  assert.equal(integrity.summary.kind, "none");
});

test("document titles do not create evidence integrity references", () => {
  const integrity = deriveResearchFindingsIntegrity(
    "# Report manual-1 [S9] C2",
    [source("manual-1", "candidate")],
  );
  assert.deepEqual(integrity.referencedIds, []);
  assert.deepEqual(integrity.unresolvedIds, []);
  assert.deepEqual(integrity.conflictIds, []);
  assert.equal(integrity.summary.kind, "none");
});

test("section headings do not create evidence integrity references but body citations do", () => {
  const integrity = deriveResearchFindingsIntegrity(
    "# Report\n\n## Result from manual-1 [S9] C2\n\nBody evidence [S1].\n\nhttps://x.test/manual-1",
    [source("manual-1", "candidate"), source("S1", "used")],
  );
  assert.deepEqual(integrity.referencedIds, ["S1"]);
  assert.deepEqual(integrity.unresolvedIds, []);
  assert.deepEqual(integrity.conflictIds, []);
  assert.equal(integrity.summary.kind, "verified");
});

test("heading-like lines inside fenced code and comments keep their existing opaque semantics", () => {
  const integrity = deriveResearchFindingsIntegrity(
    "```md\n# Hidden [S9] C2\n```\n<!-- ## Hidden [S8] C3 -->\nBody [S1].",
    [source("S1", "used")],
  );
  assert.deepEqual(integrity.referencedIds, ["S1"]);
  assert.deepEqual(integrity.unresolvedIds, []);
  assert.deepEqual(integrity.conflictIds, []);
  assert.equal(integrity.summary.kind, "verified");
});

test("html comments do not create source or conflict markers", () => {
  const integrity = deriveResearchFindingsIntegrity("Visible [S1]. <!-- [S9] C2 -->", [
    source("S1", "used"),
    source("S9", "candidate"),
  ]);
  assert.deepEqual(integrity.referencedIds, ["S1"]);
  assert.deepEqual(integrity.unresolvedIds, []);
  assert.deepEqual(integrity.conflictIds, []);
  assert.equal(integrity.summary.kind, "verified");
});

test("HTML comments take the same precedence as the findings parser", () => {
  const markdown = "`<!--` [S1] `-->`";
  const sources = [source("S1", "used")];
  assert.deepEqual(parseFindingsDoc(markdown, sources).refIds, []);

  const integrity = deriveResearchFindingsIntegrity(markdown, sources);
  assert.deepEqual(integrity.referencedIds, []);
  assert.equal(integrity.summary.kind, "none");
});

test("comment removal repeats until stable like the findings parser", () => {
  const markdown = "<!<!-- hidden -->-- [S1] C2 -->";
  const sources = [source("S1", "used")];
  assert.deepEqual(parseFindingsDoc(markdown, sources).refIds, []);

  const integrity = deriveResearchFindingsIntegrity(markdown, sources);
  assert.deepEqual(integrity.referencedIds, []);
  assert.deepEqual(integrity.conflictIds, []);
  assert.equal(integrity.summary.kind, "none");
});

test("parser-recognized ids survive bracket prose alternatives", () => {
  const integrity = deriveResearchFindingsIntegrity("[S1; S2]", [
    source("S1", "used"),
    source("S2", "used"),
  ]);
  assert.deepEqual(integrity.referencedIds, ["S1", "S2"]);
  assert.deepEqual(integrity.unresolvedIds, []);
  assert.equal(integrity.summary.kind, "verified");
});

test("parser-recognized arbitrary ids survive bracket prose", () => {
  const integrity = deriveResearchFindingsIntegrity("[see manual-1]", [
    source("manual-1", "candidate"),
  ]);
  assert.deepEqual(integrity.referencedIds, ["manual-1"]);
  assert.deepEqual(integrity.unresolvedIds, []);
  assert.equal(integrity.summary.kind, "candidate");
});

test("a longer backtick run does not close a shorter inline opener", () => {
  const integrity = deriveResearchFindingsIntegrity("`draft [S1]``", [source("S1", "used")]);
  assert.deepEqual(integrity.referencedIds, ["S1"]);
  assert.deepEqual(integrity.unresolvedIds, []);
  assert.equal(integrity.summary.kind, "verified");
});

test("tab-indented fences use the findings parser grammar", () => {
  const integrity = deriveResearchFindingsIntegrity("\t```\n[S1]", [source("S1", "used")]);
  assert.deepEqual(integrity.referencedIds, []);
  assert.deepEqual(integrity.unresolvedIds, []);
  assert.equal(integrity.summary.kind, "none");
});

test("escaped backticks remain literal around visible references", () => {
  const integrity = deriveResearchFindingsIntegrity("\\`[S1]\\`", [source("S1", "used")]);
  assert.deepEqual(integrity.referencedIds, ["S1"]);
  assert.deepEqual(integrity.unresolvedIds, []);
  assert.equal(integrity.summary.kind, "verified");
});

test("backslashes do not escape closing delimiters inside inline code", () => {
  const integrity = deriveResearchFindingsIntegrity("`[S1]\\` trailing", [source("S1", "used")]);
  assert.deepEqual(integrity.referencedIds, []);
  assert.deepEqual(integrity.unresolvedIds, []);
  assert.equal(integrity.summary.kind, "none");
});

test("plural unresolved summaries use the exact plural label", () => {
  const integrity = deriveResearchFindingsIntegrity("[S1] [S2] [S3]", [source("S1", "candidate")]);
  assert.deepEqual(integrity.unresolvedIds, ["S2", "S3"]);
  assert.equal(integrity.summary.kind, "unresolved");
  assert.equal(integrity.summary.label, "2 references are unresolved");
});

test("bracketed conflict markers stay out of source references", () => {
  const integrity = deriveResearchFindingsIntegrity("Claim [S1] [C1] [X2].", [source("S1", "candidate")]);
  assert.deepEqual(integrity.referencedIds, ["S1"]);
  assert.deepEqual(integrity.unresolvedIds, []);
  assert.deepEqual(integrity.conflictIds, ["C1"]);
  assert.equal(integrity.summary.kind, "conflicting");
  assert.equal(integrity.summary.label, "1 conflict remains");
});

test("plural conflicting summaries use the exact plural label", () => {
  const integrity = deriveResearchFindingsIntegrity("[S1] [C1] C2.", [
    source("S1", "used"),
    source("C1", "conflicting"),
    source("C2", "conflicting"),
  ]);
  assert.deepEqual(integrity.conflictIds, ["C1", "C2"]);
  assert.equal(integrity.summary.kind, "conflicting");
  assert.equal(integrity.summary.label, "2 conflicts remain");
});

test("plural candidate summaries use the exact plural label", () => {
  const integrity = deriveResearchFindingsIntegrity("[S1] [S2]", [
    source("S1", "candidate"),
    source("S2", "candidate"),
  ]);
  assert.equal(integrity.summary.kind, "candidate");
  assert.equal(integrity.summary.label, "2 sources await review");
});

test("used-only sources summarize as verified even when punctuation touches a bare label", () => {
  const integrity = deriveResearchFindingsIntegrity("Critical:[S1]", [source("S1", "used")]);
  assert.deepEqual(integrity.counts, { candidate: 0, used: 1, conflicting: 0, rejected: 0 });
  assert.deepEqual(integrity.referencedIds, ["S1"]);
  assert.deepEqual(integrity.conflictIds, []);
  assert.equal(integrity.summary.kind, "verified");
  assert.equal(integrity.summary.label, "1 source verified");
});

test("plural verified summaries use the exact plural label", () => {
  const integrity = deriveResearchFindingsIntegrity("[S1] [S2]", [
    source("S1", "used"),
    source("S2", "used"),
  ]);
  assert.deepEqual(integrity.counts, { candidate: 0, used: 2, conflicting: 0, rejected: 0 });
  assert.equal(integrity.summary.kind, "verified");
  assert.equal(integrity.summary.label, "2 sources verified");
});

test("conflicts deduplicate a marker and conflicting row with the same id", () => {
  const integrity = deriveResearchFindingsIntegrity("C1 and again C1.", [source("C1", "conflicting")]);
  assert.deepEqual(integrity.conflictIds, ["C1"]);
  assert.deepEqual(integrity.counts, { candidate: 0, used: 0, conflicting: 1, rejected: 0 });
  assert.equal(integrity.summary.kind, "conflicting");
  assert.equal(integrity.summary.label, "1 conflict remains");
});

test("no citations returns none only when no source or conflict ids are detected", () => {
  const integrity = deriveResearchFindingsIntegrity("Plain prose only.", [source("S1", "candidate")]);
  assert.deepEqual(integrity.referencedIds, []);
  assert.deepEqual(integrity.conflictIds, []);
  assert.equal(integrity.summary.kind, "none");
  assert.equal(integrity.summary.label, "This report does not cite sources");
});

test("rejected-only citations summarize as rejected rather than none", () => {
  const integrity = deriveResearchFindingsIntegrity("[R1] [R2]", [source("R1", "rejected"), source("R2", "rejected")]);
  assert.deepEqual(integrity.counts, { candidate: 0, used: 0, conflicting: 0, rejected: 2 });
  assert.deepEqual(integrity.referencedIds, ["R1", "R2"]);
  assert.equal(integrity.summary.kind, "rejected");
  assert.equal(integrity.summary.label, "2 rejected sources cited");
});

test("failed ledger reports unavailable even without detected citations", () => {
  const integrity = deriveResearchFindingsIntegrity("Plain prose only.", [], { ledger: "failed" });
  assert.equal(integrity.ledger, "failed");
  assert.deepEqual(integrity.referencedIds, []);
  assert.deepEqual(integrity.unresolvedIds, []);
  assert.deepEqual(integrity.conflictIds, []);
  assert.deepEqual(integrity.summary, {
    kind: "unavailable",
    label: "Sources unavailable — references can't be verified",
  });
});
