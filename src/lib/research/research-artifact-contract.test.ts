import assert from "node:assert/strict";
import test from "node:test";
import type { ResearchArtifactRef, ResearchMission } from "./research-missions.ts";
import {
  MAX_RESEARCH_ARTIFACT_BYTES,
  normalizeResearchArtifact,
  normalizeResearchSource,
  parseResearchControl,
  renderSourceLedgerMarkdown,
  researchKnowledgeEntry,
  researchProvenanceHeader,
  validateResearchArtifactContent,
} from "./research-artifact-contract.ts";

const PROVENANCE = {
  missionId: "cave-research-1",
  iteration: 2,
  flowRunId: "run-1",
  sessionId: "session-1",
  generatedAt: "2026-07-12T12:00:00.000Z",
};

test("valid exact control output parses", () => {
  const transcript = [
    "noise",
    "@@research-control",
    '{"decision":"complete","reason":"Enough evidence","confidence":0.9}',
    "@@research-artifacts-written",
  ].join("\n");
  assert.deepEqual(parseResearchControl(transcript), {
    decision: "complete",
    reason: "Enough evidence",
    confidence: 0.9,
  });
});

test("malformed, embedded, or incomplete control output pauses", () => {
  const fallback = {
    decision: "checkpoint",
    reason: "Missing or malformed research control output",
    confidence: null,
  };
  assert.deepEqual(parseResearchControl("@@research-control\nnot-json"), fallback);
  assert.deepEqual(
    parseResearchControl(
      "prefix @@research-control\n" +
        '{"decision":"continue","reason":"more","confidence":0.5}\n' +
        "@@research-artifacts-written",
    ),
    fallback,
  );
  assert.deepEqual(
    parseResearchControl(
      "@@research-control\n" +
        '{"decision":"continue","reason":"more","confidence":0.5}',
    ),
    fallback,
  );
});

test("sources require a safe web URL or absolute local path", () => {
  assert.equal(normalizeResearchSource({ id: "s1", title: "Paper" }).ok, false);
  assert.equal(
    normalizeResearchSource({ id: "s1", title: "Paper", url: "https://example.com" }).ok,
    true,
  );
  assert.equal(
    normalizeResearchSource({ id: "s1", title: "Paper", url: "file:///etc/passwd" }).ok,
    false,
  );
  assert.equal(
    normalizeResearchSource({ id: "s1", title: "Local notes", localPath: "/tmp/notes.md" }).ok,
    true,
  );
  assert.equal(
    normalizeResearchSource({ id: "s1", title: "Relative", localPath: "../notes.md" }).ok,
    false,
  );
});

test("presentation artifacts accept Markdown or self-contained HTML only", () => {
  assert.equal(
    normalizeResearchArtifact({ kind: "presentation", path: "artifacts/slides.md" }).ok,
    true,
  );
  assert.equal(
    normalizeResearchArtifact({ kind: "presentation", path: "artifacts/slides.html" }).ok,
    true,
  );
  assert.equal(
    normalizeResearchArtifact({ kind: "presentation", path: "artifacts/slides.js" }).ok,
    false,
  );
  assert.equal(
    normalizeResearchArtifact({ kind: "brief", path: "../outside.md" }).ok,
    false,
  );
});

test("artifact bodies are bounded by UTF-8 bytes", () => {
  assert.equal(validateResearchArtifactContent("brief", "# Brief\n").ok, true);
  assert.equal(
    validateResearchArtifactContent("brief", "é".repeat(MAX_RESEARCH_ARTIFACT_BYTES)).ok,
    false,
  );
});

test("provenance names mission, iteration, run, and session", () => {
  const header = researchProvenanceHeader(PROVENANCE);
  assert.match(header, /mission: cave-research-1/);
  assert.match(header, /iteration: 2/);
  assert.match(header, /flow_run: run-1/);
  assert.match(header, /session: session-1/);
});

test("Knowledge payload keeps provenance and familiar scope", () => {
  const mission = {
    id: "cave-research-1",
    familiarId: "sage",
    mode: "brief",
  } as ResearchMission;
  const artifact = {
    key: "primary",
    kind: "brief",
    title: "Primary brief",
  } as ResearchArtifactRef;
  const entry = researchKnowledgeEntry({
    mission,
    artifact,
    provenance: PROVENANCE,
    markdown: "# Answer",
  });
  assert.equal(entry.id, "research-cave-research-1-primary");
  assert.deepEqual(entry.scope, ["sage"]);
  assert.deepEqual(entry.tags, [
    "research",
    "mission:cave-research-1",
    "brief",
    "brief",
  ]);
  assert.match(entry.body, /mission: cave-research-1/);
  assert.match(entry.body, /# Answer\n$/);
});

test("renderSourceLedgerMarkdown renders an empty ledger honestly", () => {
  const markdown = renderSourceLedgerMarkdown([]);
  assert.match(markdown, /^# Source ledger\n/);
  assert.match(markdown, /No sources were recorded for this mission\./);
});

test("renderSourceLedgerMarkdown keeps sub-bullets attached beyond nine sources", () => {
  const sources = Array.from({ length: 10 }, (_, index) => ({
    id: `s${index + 1}`,
    title: `Source ${index + 1}`,
    localPath: `/notes/source-${index + 1}.md`,
    publishedAt: "2025-02-02",
    sourceType: "file",
    status: "used" as const,
  }));
  const markdown = renderSourceLedgerMarkdown(sources);
  assert.match(markdown, /\n9\. \*\*Source 9\*\*[^\n]*\n {3}- Local path: \/notes\/source-9\.md/);
  assert.match(markdown, /\n10\. \*\*Source 10\*\*[^\n]*\n {4}- Local path: \/notes\/source-10\.md/);
  assert.match(markdown, / {4}- Published: 2025-02-02/);
});

test("renderSourceLedgerMarkdown renders every source with status and evidence fields", () => {
  const markdown = renderSourceLedgerMarkdown([
    {
      id: "s1",
      title: "SQLite WAL docs",
      url: "https://sqlite.org/wal.html",
      publisher: "SQLite",
      publishedAt: "2025-01-01",
      sourceType: "web",
      claim: "WAL allows concurrent readers",
      note: "verified locally",
      confidence: 0.9,
      status: "used",
    },
    { id: "s2", title: "Old blog post", sourceType: "web", status: "rejected" },
  ]);
  assert.match(markdown, /2 sources recorded for this mission\./);
  assert.match(markdown, /1\. \*\*SQLite WAL docs\*\* — used · web/);
  assert.match(markdown, /- URL: https:\/\/sqlite\.org\/wal\.html/);
  assert.match(markdown, /- Publisher: SQLite \(2025-01-01\)/);
  assert.match(markdown, /- Claim: WAL allows concurrent readers/);
  assert.match(markdown, /- Note: verified locally/);
  assert.match(markdown, /- Confidence: 0\.9/);
  assert.match(markdown, /2\. \*\*Old blog post\*\* — rejected · web/);
  assert.ok(markdown.endsWith("\n"));
});
