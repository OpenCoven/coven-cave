import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanDocTitle,
  firstH1,
  formatReadingMeta,
  groupMissionStitches,
  isMachineTag,
  journalEntryQuery,
  journalRowFamiliar,
  missionArtifactLabel,
  missionIdOf,
  missionTitle,
  missionTitleIndex,
  readingMeta,
  stitchDisplayTitle,
  stitchTagView,
} from "./grimoire-library.ts";

test("cleanDocTitle strips flattened markdown headings and emphasis", () => {
  assert.equal(
    cleanDocTitle("# The Reflective Familiar ### Grounded self-awareness, verifiable recursive s…"),
    "The Reflective Familiar — Grounded self-awareness, verifiable recursive s…",
  );
  assert.equal(
    cleanDocTitle("Research and compare: # Verifiable Agent Identity and Instruction Authenticat…"),
    "Research and compare: Verifiable Agent Identity and Instruction Authenticat…",
  );
  assert.equal(
    cleanDocTitle("# Deep Research Prompt: Designing Aura as OpenCoven's Familiar-Native Alterna…"),
    "Deep Research Prompt: Designing Aura as OpenCoven's Familiar-Native Alterna…",
  );
  assert.equal(
    cleanDocTitle("### Research topic **Can Intuitionistic Mathematics Provide Better Foundation…"),
    "Research topic Can Intuitionistic Mathematics Provide Better Foundation…",
  );
  assert.equal(cleanDocTitle("Inferring preferences for `USER.md`"), "Inferring preferences for USER.md");
  assert.equal(cleanDocTitle("See [the spec](https://x.test) and [[Grimoire|the vault]]"), "See the spec and the vault");
  assert.equal(cleanDocTitle("  plain   title  "), "plain title");
  assert.equal(cleanDocTitle("snake_case_name stays"), "snake_case_name stays");
  assert.equal(cleanDocTitle("C# notes"), "C# notes", "a hash inside a word is not a heading marker");
  assert.equal(cleanDocTitle(""), "");
  assert.equal(cleanDocTitle(null), "");
});

test("firstH1 skips provenance comments and fenced code", () => {
  const body = [
    "<!-- research-provenance",
    "mission: research-1",
    "-->",
    "",
    "```md",
    "# Not a title",
    "```",
    "# Findings — Identity **Preservation**",
    "## Summary",
  ].join("\n");
  assert.equal(firstH1(body), "Findings — Identity Preservation");
  assert.equal(firstH1("## Only h2"), null);
  assert.equal(firstH1(undefined), null);
});

test("machine tags are hidden and a mission becomes a Research hint", () => {
  assert.equal(isMachineTag("mission:research-006e6c92-3757-4b5a-bcef-c64e5109251a"), true);
  assert.equal(isMachineTag("006e6c92-3757"), true);
  assert.equal(isMachineTag("a1b2c3d4e5f6a7b8"), true);
  assert.equal(isMachineTag("coven-cave"), false);
  assert.equal(isMachineTag("findings"), false);
  assert.equal(missionIdOf(["research", "mission:abc-123"]), "abc-123");
  assert.equal(missionIdOf(["research"]), null);

  assert.deepEqual(
    stitchTagView(["research", "mission:research-006e6c92-3757-4b5a-bcef-c64e5109251a", "autoresearch", "findings"]),
    { tags: [], overflow: 0, research: true },
    "mission bookkeeping collapses into the Research hint",
  );
  assert.deepEqual(
    stitchTagView(["research", "mission:abc", "sweep", "report", "identity"]),
    { tags: ["identity"], overflow: 0, research: true },
    "tags a person added to a research artifact stay visible",
  );
  assert.deepEqual(stitchTagView(["coven", "coven-code", "coven-cave", "extra", "more"]), {
    tags: ["coven", "coven-code", "coven-cave"],
    overflow: 2,
    research: false,
  });
  assert.deepEqual(
    stitchTagView(["research"]),
    { tags: ["research"], overflow: 0, research: false },
    "a hand-filed research tag without a mission stays visible",
  );
});

const M = "research-006e6c92-3757-4b5a-bcef-c64e5109251a";
const mission = (suffix: string, title: string, kind: string, body = "", modified?: string) => ({
  id: `research-${M}-${suffix}`.slice(0, 64),
  title,
  tags: ["research", `mission:${M}`, "autoresearch", kind],
  body,
  ...(modified ? { modified } : {}),
});

test("mission artifacts get short labels in report-first order", () => {
  const findings = mission("findings", "Findings", "findings", "# Findings — Identity Preservation for Agents\n\nBody");
  const primary = mission(
    "primary",
    "Research and compare: Identity Preservation for Agents during Self-Evolution.…",
    "findings",
    "<!-- research-provenance -->\n# Identity Preservation — Research & Comparison",
  );
  const log = mission("research-log", "Research log", "research-log");
  const ledger = mission("source-ledger", "Source ledger", "source-ledger");
  assert.equal(missionArtifactLabel(primary), "Report");
  assert.equal(missionArtifactLabel(findings), "Findings");
  assert.equal(missionArtifactLabel(log), "Research log");
  assert.equal(missionArtifactLabel(ledger), "Source ledger");
  assert.equal(missionArtifactLabel({ ...primary, tags: [...primary.tags, "brief"] }), "Brief");

  const items = groupMissionStitches([
    { id: "opencoven", title: "OpenCoven", tags: ["coven"] },
    findings,
    { ...primary, modified: "2026-07-26T08:55:40.375Z" },
    { ...log, modified: "2026-07-26T08:55:40.390Z" },
    ledger,
    { id: "lonely", title: "Findings", tags: ["research", "mission:other"] },
  ]);
  assert.equal(items.length, 3);
  assert.equal(items[0].kind, "entry");
  assert.equal(items[2].kind, "entry", "a single-artifact mission stays a plain row");
  const group = items[1];
  assert.equal(group.kind, "mission");
  if (group.kind !== "mission") return;
  assert.equal(group.missionId, M);
  assert.equal(group.title, "Identity Preservation for Agents");
  assert.deepEqual(
    group.entries.map((child) => child.label),
    ["Report", "Findings", "Research log", "Source ledger"],
  );
  assert.equal(group.modified, "2026-07-26T08:55:40.390Z", "the group carries its newest member's mtime");
});

test("mission titles fall back from findings H1 to report H1 to the prompt title", () => {
  const primary = mission(
    "primary",
    "## Research Prompt: Identity-First Agent Infrastructure and Psyche Research a…",
    "findings",
    "# Identity-First Agent Infrastructure and Psyche: An Evidence-Based Assessment",
  );
  assert.equal(
    missionTitle([mission("findings", "Findings", "findings", "# Findings\n\nNo subtitle."), primary]),
    "Identity-First Agent Infrastructure and Psyche: An Evidence-Based Assessment",
  );
  assert.equal(
    missionTitle([{ ...primary, body: "" }]),
    "Identity-First Agent Infrastructure and Psyche Research a…",
    "prompt boilerplate prefixes are dropped from the vault title",
  );
  assert.equal(
    missionTitle([mission("findings", "Findings", "findings", "# Findings: The Reflective Familiar")]),
    "The Reflective Familiar",
  );
  assert.equal(missionTitle([]), "Research mission");

  const index = missionTitleIndex([primary, { id: "x", title: "X", tags: [] }]);
  assert.equal(index.size, 1);
  assert.equal(
    stitchDisplayTitle(mission("findings", "Findings", "findings"), index),
    "Findings · Identity-First Agent Infrastructure and Psyche: An Evidence-Based Assessment",
  );
  assert.equal(stitchDisplayTitle(primary, index), "Identity-First Agent Infrastructure and Psyche: An Evidence-Based Assessment");
  assert.equal(stitchDisplayTitle({ id: "a", title: "# Plain stitch", tags: [] }), "Plain stitch");
  assert.equal(stitchDisplayTitle({ id: "fallback-id", title: "", tags: [] }), "fallback-id");
});

test("readingMeta estimates whole minutes at 220 words per minute", () => {
  const body = Array.from({ length: 2350 }, (_, i) => `w${i}`).join(" ");
  const meta = readingMeta(body);
  assert.deepEqual(meta, { words: 2350, minutes: 11 });
  assert.match(formatReadingMeta(meta), /^~11 min read · 2[,.\s ]?350 words$/);
  assert.deepEqual(readingMeta(""), { words: 0, minutes: 1 });
  assert.equal(formatReadingMeta({ words: 1, minutes: 1 }), "~1 min read · 1 word");
});

test("journal entry queries carry the owning familiar", () => {
  assert.equal(journalEntryQuery("2026-09-22"), "date=2026-09-22");
  assert.equal(journalEntryQuery("2026-09-22", "nova"), "date=2026-09-22&familiar=nova");
  assert.equal(journalEntryQuery("2026-09-22", null), "date=2026-09-22");
  assert.equal(journalRowFamiliar({ reflectedBy: "nova", source: "familiar" }), "nova");
  assert.equal(journalRowFamiliar({ reflectedBy: "nova", source: "legacy" }), undefined, "a legacy file is attributed, not owned");
  assert.equal(journalRowFamiliar({ reflectedBy: null, source: "familiar" }), undefined);
});
