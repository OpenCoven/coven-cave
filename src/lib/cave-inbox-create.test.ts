import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

// Sandbox the inbox before importing the store (INBOX_PATH resolves caveHome
// at module load).
const FAKE_HOME = mkdtempSync(path.join(tmpdir(), "cave-inbox-create-"));
process.env.COVEN_HOME = FAKE_HOME;

const { createItem } = await import("./cave-inbox.ts");

after(() => {
  rmSync(FAKE_HOME, { recursive: true, force: true });
});

describe("createItem status", () => {
  it("agent, daily-summary, and milestone items without fireAt fire immediately", async () => {
    // "fired" is what the SSE created-handler gates toasts on — a kind left
    // "pending" with no fireAt would sit silent forever (the milestone kind
    // shipped that way once; this pins the contract).
    for (const kind of ["agent", "daily-summary", "milestone"] as const) {
      const item = await createItem({ kind, title: `t-${kind}`, source: "system" });
      assert.equal(item.status, "fired", `${kind} without fireAt is born fired`);
      assert.ok(item.firedAt, `${kind} carries firedAt`);
    }
  });

  it("a reminder with fireAt stays pending until the scheduler fires it", async () => {
    const item = await createItem({
      kind: "reminder",
      title: "later",
      fireAt: new Date(Date.now() + 60_000).toISOString(),
      source: "user",
    });
    assert.equal(item.status, "pending");
    assert.equal(item.firedAt, null);
  });
});
