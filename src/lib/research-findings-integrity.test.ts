import assert from "node:assert/strict";
import test from "node:test";
import type { ResearchSourceRef } from "./research-missions.ts";
import {
  deriveResearchFindingsIntegrity,
  scanBracketedSourceIds,
} from "./research-findings-integrity.ts";

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
  const integrity = deriveResearchFindingsIntegrity("Claim [S1]. Conflict C2.", []);
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

test("used and candidate sources count together but summarize as candidate", () => {
  const integrity = deriveResearchFindingsIntegrity("[S1] [S2]", [
    source("S1", "used"),
    source("S2", "candidate"),
  ]);
  assert.deepEqual(integrity.counts, { candidate: 1, used: 1, conflicting: 0, rejected: 0 });
  assert.equal(integrity.summary.kind, "candidate");
  assert.equal(integrity.summary.label, "1 source awaits review");
});

test("parser-recognized arbitrary source ids count as citations", () => {
  const integrity = deriveResearchFindingsIntegrity("Manual note cites manual-1 for follow-up.", [
    source("manual-1", "candidate"),
  ]);
  assert.deepEqual(integrity.referencedIds, ["manual-1"]);
  assert.deepEqual(integrity.unresolvedIds, []);
  assert.equal(integrity.summary.kind, "candidate");
  assert.equal(integrity.summary.label, "1 source awaits review");
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

test("used-only sources summarize as verified", () => {
  const integrity = deriveResearchFindingsIntegrity("[S1]", [source("S1", "used")]);
  assert.deepEqual(integrity.counts, { candidate: 0, used: 1, conflicting: 0, rejected: 0 });
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
