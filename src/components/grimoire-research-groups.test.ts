import assert from "node:assert/strict";
import { test } from "node:test";
import * as helpers from "./grimoire-helpers.ts";
import type { GrimoireKnowledgeEntry } from "./grimoire-helpers.ts";

function entry(id: string, title: string, mission?: string, body = ""): GrimoireKnowledgeEntry {
  return {
    id, title, body,
    tags: mission ? ["research", `mission:${mission}`, "autoresearch", "findings"] : [],
    scope: "global",
    enabled: true,
  };
}

const findings = entry("alpha-findings", "Findings", "research-alpha");
const report = entry("alpha-primary", "Research and compare: # Research Prompt: Reliable orchestration", "research-alpha");
const log = entry("alpha-log", "Research log", "research-alpha");
const sources = entry("alpha-sources", "Source ledger", "research-alpha");
const other = entry("beta-findings", "Findings", "research-beta", "# Model evaluation\n\nEvidence.");
const plain = entry("guide", "OpenCoven");
const corpus = [plain, findings, other, report, log, sources];

test("research grouping is available to the Memories navigator", () => {
  assert.equal(typeof helpers.groupResearchStitches, "function");
});

test("interleaved artifacts group by mission, not generic title, without changing documents", () => {
  const before = structuredClone(corpus);
  const groups = helpers.groupResearchStitches(corpus);
  assert.deepEqual(groups.map((group) => group.kind), ["entry", "research", "research"]);
  assert.deepEqual(groups[0].entries, [plain]);
  assert.equal(groups[1].label, "Reliable orchestration");
  assert.equal(groups[2].label, "Model evaluation");
  assert.deepEqual(groups[1].entries, [findings, report, log, sources]);
  assert.equal(groups[1].entries[0], findings);
  assert.deepEqual(corpus, before);
});

test("a topic search includes every artifact; an artifact search retains its topic heading", () => {
  const topic = helpers.groupResearchStitches(corpus, "  RELIABLE ORCHESTRATION ");
  assert.equal(topic.length, 1);
  assert.deepEqual(topic[0].entries, [findings, report, log, sources]);
  const artifacts = helpers.groupResearchStitches(corpus, "source ledger");
  assert.equal(artifacts[0].label, "Reliable orchestration");
  assert.deepEqual(artifacts[0].entries, [sources]);
  assert.equal(helpers.groupResearchStitches(corpus, "unmatched").length, 0);
  assert.deepEqual(helpers.groupResearchStitches(corpus, "OpenCoven")[0].entries, [plain]);
});

test("identical topics and collection copies retain independent mission identities", () => {
  const secondRun = entry("beta-primary", report.title, "research-beta");
  const collected = { ...report, collection: "archive" };
  const groups = helpers.groupResearchStitches([report, secondRun, collected]);
  assert.equal(groups.length, 3);
  assert.equal(new Set(groups.map((group) => group.key)).size, 3);
  assert.deepEqual(groups.map((group) => group.entries.length), [1, 1, 1]);
  assert.deepEqual(helpers.groupResearchStitches([report, collected], "archive")[0].entries, [collected]);
});

test("generic-only runs use a named mission fallback, never a neighboring topic", () => {
  const groups = helpers.groupResearchStitches([findings, log, sources]);
  assert.equal(groups[0].label, "Research run research-alpha");
  assert.deepEqual(groups[0].entries, [findings, log, sources]);
});

test("provenance comments are hidden when recovering a topic from the first document heading", () => {
  const doc = entry("alpha-findings", "Findings", "research-alpha",
    "<!-- research-provenance\nmission: research-alpha\niteration: 2\n-->\n\n# **Entrusted work**\n\n## Findings");
  assert.equal(helpers.groupResearchStitches([doc])[0].label, "Entrusted work");
});

test("a research tag alone or an unrelated mission tag never invents a research group", () => {
  const unlinked = { ...plain, tags: ["research", "mission:"] };
  const unrelated = { ...plain, tags: ["mission:research-alpha"] };
  assert.deepEqual(
    helpers.groupResearchStitches([unlinked, unrelated]).map((group) => group.kind),
    ["entry", "entry"],
  );
});
