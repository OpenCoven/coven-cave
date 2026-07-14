import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addSignalDismissal,
  clearSignalDismissals,
  loadSignalDismissals,
  partitionDismissedSignals,
  pruneSignalDismissals,
  SIGNAL_DISMISSAL_CAP,
  signalDismissalKey,
  signalIdentity,
  type DismissStorage,
} from "./thread-signal-dismissals.ts";
import type { ThreadSignalReviewItem } from "./thread-self-report.ts";

function fakeStorage(): DismissStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

function item(kind: ThreadSignalReviewItem["kind"], title: string): ThreadSignalReviewItem {
  return { kind, title, severity: "warning", detail: "d" };
}

const NOW = Date.parse("2026-06-25T12:00:00.000Z");

describe("signal identity + storage round-trip", () => {
  it("keys dismissals by kind + title (details drift with frequencies)", () => {
    assert.equal(signalIdentity(item("blocker", "Auth expired")), "blocker:Auth expired");
  });

  it("persists per familiar and loads back", () => {
    const storage = fakeStorage();
    addSignalDismissal("cody", item("blocker", "Auth expired"), storage, NOW);
    assert.deepEqual(loadSignalDismissals("cody", storage), {
      "blocker:Auth expired": "2026-06-25T12:00:00.000Z",
    });
    assert.deepEqual(loadSignalDismissals("other", storage), {}, "scoped per familiar");
    assert.ok(storage.data.has(signalDismissalKey("cody")));
  });

  it("clear removes the key entirely and returns the empty map", () => {
    const storage = fakeStorage();
    addSignalDismissal("cody", item("blocker", "Auth expired"), storage, NOW);
    assert.deepEqual(clearSignalDismissals("cody", storage), {});
    assert.equal(storage.data.has(signalDismissalKey("cody")), false);
  });

  it("tolerates missing storage and malformed payloads", () => {
    assert.deepEqual(loadSignalDismissals("cody", null), {});
    assert.deepEqual(addSignalDismissal("cody", item("blocker", "x"), undefined, NOW), {
      "blocker:x": "2026-06-25T12:00:00.000Z",
    });
    const storage = fakeStorage();
    storage.data.set(signalDismissalKey("cody"), "not json");
    assert.deepEqual(loadSignalDismissals("cody", storage), {});
    storage.data.set(signalDismissalKey("cody"), JSON.stringify(["array"]));
    assert.deepEqual(loadSignalDismissals("cody", storage), {});
    storage.data.set(signalDismissalKey("cody"), JSON.stringify({ ok: "2026-01-01T00:00:00.000Z", bad: 7 }));
    assert.deepEqual(loadSignalDismissals("cody", storage), { ok: "2026-01-01T00:00:00.000Z" });
  });
});

describe("pruning", () => {
  it("caps the map at the newest entries", () => {
    const big: Record<string, string> = {};
    for (let index = 0; index < SIGNAL_DISMISSAL_CAP + 10; index++) {
      big[`blocker:b${index}`] = new Date(NOW + index * 1000).toISOString();
    }
    const pruned = pruneSignalDismissals(big);
    assert.equal(Object.keys(pruned).length, SIGNAL_DISMISSAL_CAP);
    assert.equal("blocker:b0" in pruned, false, "oldest dropped");
    assert.equal(`blocker:b${SIGNAL_DISMISSAL_CAP + 9}` in pruned, true, "newest kept");
  });

  it("returns the same map when under the cap", () => {
    const map = { "blocker:x": "2026-01-01T00:00:00.000Z" };
    assert.equal(pruneSignalDismissals(map), map);
  });
});

describe("partitioning a queue", () => {
  it("splits into visible and dismissed, preserving order", () => {
    const storage = fakeStorage();
    const dismissals = addSignalDismissal("cody", item("skill-access", "github"), storage, NOW);
    const queue = [
      item("blocker", "Auth expired"),
      item("skill-access", "github"),
      item("skill-clarity", "deploy"),
    ];
    const { visible, dismissed } = partitionDismissedSignals(queue, dismissals);
    assert.deepEqual(visible.map((entry) => entry.title), ["Auth expired", "deploy"]);
    assert.deepEqual(dismissed.map((entry) => entry.title), ["github"]);
  });
});
