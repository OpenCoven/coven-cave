// Behavioral contract for the Sage autoresearch ledger projection (cave-19a34).
// results.tsv remains authoritative: malformed rows are skipped, event records
// can only enrich rows that already exist, and historical score/verdict shapes
// stay honest instead of being coerced into the v0.1 contract.

import assert from "node:assert/strict";
import test from "node:test";

let autoloop: typeof import("./research-autoloop.ts") | null = null;
try {
  autoloop = await import("./research-autoloop.ts");
} catch {
  // The first TDD run deliberately reaches this branch: the implementation
  // module does not exist yet, and the assertion below fails with a focused
  // missing-contract message rather than an import-loader error.
}

test("autoresearch ledger parser contract exists", () => {
  assert.ok(autoloop, "research-autoloop.ts must expose the typed ledger projection");
  assert.equal(typeof autoloop.parseAutoresearchLedger, "function");
  assert.equal(typeof autoloop.parseAutoresearchEvents, "function");
  assert.equal(typeof autoloop.mergeAutoresearchRows, "function");
  assert.equal(typeof autoloop.isAutoresearchSnapshot, "function");
});

test("ledger parsing is fail-safe, newest-first, and preserves legacy score truth", () => {
  assert.ok(autoloop);
  const rows = autoloop.parseAutoresearchLedger([
    "2026-07-01T10:00:00Z\tsynthesis\t80\tfirst-pass\t0\tc:7/a:8/v:9\t+24\tREVISE\tmain\tNeeds another pass",
    "not\ta\tvalid\trow",
    "2026-07-02T10:00:00Z\tsynthesis\t81\tsecond-pass: appended legacy abstract\t0\t27/30\t+3\tpromote\tmain\tReady to stage",
    "2026-07-03T10:00:00Z\tsynthesis\t82\tword-count-era\t0\t2484\t+2484\tACCEPT\tmain\tThis was a word count, not a quality score",
    "",
  ].join("\n"));

  assert.deepEqual(
    rows.map(({ iter, slug, score, verdict }) => ({ iter, slug, score, verdict })),
    [
      { iter: 82, slug: "word-count-era", score: null, verdict: "ACCEPT" },
      { iter: 81, slug: "second-pass", score: 27, verdict: "PROMOTE" },
      { iter: 80, slug: "first-pass", score: 24, verdict: "REVISE" },
    ],
  );
});

test("completion events enrich matching ledger rows but never create derived iterations", () => {
  assert.ok(autoloop);
  const ledger = autoloop.parseAutoresearchLedger(
    "2026-07-02T10:00:00Z\tsynthesis\t81\tsecond-pass\t0\t27\t+3\tPROMOTE\tmain\tReady",
  );
  const events = autoloop.parseAutoresearchEvents([
    '{"ts":"2026-07-02T10:01:00Z","iter":81,"slug":"second-pass","score":27,"verdict":"PROMOTE","synthesis":"synthesis/second-pass.md","staged_skill":"skills/second-pass/SKILL.md"}',
    '{"ts":"2026-07-03T10:01:00Z","iter":82,"slug":"event-only","score":29,"verdict":"PROMOTE","synthesis":"synthesis/event-only.md","staged_skill":null}',
    "{malformed",
  ].join("\n"));

  const rows = autoloop.mergeAutoresearchRows(ledger, events);
  assert.equal(rows.length, 1, "event-only records must not become source rows");
  assert.equal(rows[0].synthesisPath, "synthesis/second-pass.md");
  assert.equal(rows[0].stagedSkillPath, "skills/second-pass/SKILL.md");
});

test("event parsing rejects structurally invalid records without losing valid neighbors", () => {
  assert.ok(autoloop);
  const events = autoloop.parseAutoresearchEvents([
    '{"ts":"invalid","iter":4,"slug":"bad-date","score":27,"verdict":"PROMOTE","synthesis":"x.md","staged_skill":null}',
    '{"ts":"2026-07-02T10:01:00Z","iter":5,"slug":"valid","score":26,"verdict":"accept","synthesis":"synthesis/valid.md","staged_skill":null}',
    '{"ts":"2026-07-02T10:01:00Z","iter":6,"slug":"","score":26,"verdict":"ACCEPT","synthesis":"synthesis/empty.md","staged_skill":null}',
  ].join("\n"));

  assert.deepEqual(events, [{
    ts: "2026-07-02T10:01:00Z",
    iter: 5,
    slug: "valid",
    score: 26,
    verdict: "ACCEPT",
    synthesisPath: "synthesis/valid.md",
    stagedSkillPath: null,
  }]);
});

test("stream snapshots are runtime-validated before client state accepts them", () => {
  assert.ok(autoloop);
  const valid = {
    type: "snapshot",
    available: true,
    updatedAt: "2026-07-26T10:01:00Z",
    rows: [{
      timestamp: "2026-07-26T10:00:00Z",
      kind: "synthesis",
      iter: 83,
      slug: "valid",
      score: 28,
      verdict: "PROMOTE",
      branch: "main",
      summary: "Verified",
      synthesisPath: "/Users/val/.coven/research/synthesis/valid.md",
      stagedSkillPath: null,
    }],
  };
  assert.equal(autoloop.isAutoresearchSnapshot(valid), true);
  assert.equal(
    autoloop.isAutoresearchSnapshot({ ...valid, rows: [{ ...valid.rows[0], score: 2800 }] }),
    false,
  );
  assert.equal(autoloop.isAutoresearchSnapshot({ ...valid, rows: "not rows" }), false);
});
