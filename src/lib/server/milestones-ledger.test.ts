import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

// Point the ledger at a throwaway home BEFORE importing the module under
// test. LEDGER_PATH resolves caveHome() per call, but setting the env first
// keeps this robust if that ever changes.
const FAKE_HOME = mkdtempSync(path.join(tmpdir(), "cave-milestones-"));
process.env.COVEN_HOME = FAKE_HOME;

const { loadLedger, recordAwards } = await import("./milestones-ledger.ts");

after(() => {
  rmSync(FAKE_HOME, { recursive: true, force: true });
});

describe("milestones ledger", () => {
  it("starts empty and flags the first run", async () => {
    assert.deepEqual(await loadLedger(), {});
    const first = await recordAwards([
      { key: "summon:first", title: "First summoning", body: "b" },
      { key: "streak:7", title: "Seven-day ritual", body: "b" },
    ]);
    assert.equal(first.firstRun, true);
    assert.deepEqual(first.newly.map((a) => a.key), ["summon:first", "streak:7"]);
  });

  it("dedupes already-awarded keys and clears firstRun", async () => {
    const again = await recordAwards([
      { key: "summon:first", title: "First summoning", body: "b" },
      { key: "sessions:100", title: "One hundred sessions", body: "b" },
    ]);
    assert.equal(again.firstRun, false);
    assert.deepEqual(again.newly.map((a) => a.key), ["sessions:100"]);
    const ledger = await loadLedger();
    assert.deepEqual(Object.keys(ledger).sort(), ["sessions:100", "streak:7", "summon:first"]);
    for (const at of Object.values(ledger)) {
      assert.ok(Number.isFinite(Date.parse(at)), "award timestamps are ISO dates");
    }
  });

  it("concurrent awards of the same key land exactly once", async () => {
    const [a, b] = await Promise.all([
      recordAwards([{ key: "tier:nova:magus", title: "Nova ascends to magus", body: "b" }]),
      recordAwards([{ key: "tier:nova:magus", title: "Nova ascends to magus", body: "b" }]),
    ]);
    const total = a.newly.length + b.newly.length;
    assert.equal(total, 1, "the write lock serializes the double-award race");
  });
});
