// @ts-nocheck
import assert from "node:assert/strict";
import {
  applyManualOrder,
  partitionPinnedFirst,
  mergeVisibleOrder,
  readSessionOrder,
  writeSessionOrder,
  CHAT_SESSION_ORDER_KEY,
} from "./chat-session-order.ts";

const row = (id, extra = {}) => ({
  id,
  project_root: "",
  harness: "codex",
  title: id,
  status: "completed",
  exit_code: null,
  archived_at: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  ...extra,
});

// ── applyManualOrder ──────────────────────────────────────────────────────────
{
  const sessions = [row("a"), row("b"), row("c")];
  // empty order → same reference (memo bail)
  assert.equal(applyManualOrder(sessions, []), sessions, "empty order returns same ref");

  // order [c, a] floats c then a; b (untracked) keeps recency behind them
  const out = applyManualOrder(sessions, ["c", "a"]);
  assert.deepEqual(out.map((s) => s.id), ["c", "a", "b"], "ranked ids lead in order");

  // order that matches the natural order → same reference
  const same = applyManualOrder(sessions, ["a", "b", "c"]);
  assert.equal(same, sessions, "no-op order returns same ref");

  // stale ids in order are ignored
  const stale = applyManualOrder(sessions, ["zzz", "b"]);
  assert.deepEqual(stale.map((s) => s.id), ["b", "a", "c"], "stale ids ignored, b floats");
}

// ── partitionPinnedFirst ──────────────────────────────────────────────────────
{
  const sessions = [row("a"), row("b"), row("c"), row("d")];
  assert.equal(partitionPinnedFirst(sessions, []), sessions, "no pins → same ref");
  const out = partitionPinnedFirst(sessions, ["c"]);
  assert.deepEqual(out.map((s) => s.id), ["c", "a", "b", "d"], "pinned floats, order preserved");
  const multi = partitionPinnedFirst(sessions, ["d", "b"]);
  assert.deepEqual(
    multi.map((s) => s.id),
    ["b", "d", "a", "c"],
    "multiple pins keep their incoming relative order",
  );
  // pin id not present → no-op same ref
  assert.equal(partitionPinnedFirst(sessions, ["nope"]), sessions, "absent pin → same ref");
}

// ── mergeVisibleOrder ─────────────────────────────────────────────────────────
{
  // prev tracks [a,b,c,d]; user drags visible [b,a,d] (c hidden by a filter)
  // → the visible slots in prev are a,b,d; replace them in document order with
  //   the dragged order b,a,d, leaving c where it sat.
  const merged = mergeVisibleOrder(["a", "b", "c", "d"], ["b", "a", "d"]);
  assert.deepEqual(merged, ["b", "a", "c", "d"], "hidden ids keep their slot");

  // a brand-new visible id (never tracked) lands at the front
  const withFresh = mergeVisibleOrder(["a", "b"], ["x", "b", "a"]);
  assert.deepEqual(withFresh, ["x", "b", "a"], "fresh visible id leads");
}

// ── localStorage read/write (SSR-safe + corrupt-safe) ─────────────────────────
{
  // No window in node → both no-op safely
  assert.deepEqual(readSessionOrder(), [], "readSessionOrder is SSR-safe");
  writeSessionOrder(["a", "b"]); // must not throw without window

  // Simulate a browser-ish window with localStorage
  const store = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, v),
    },
  };
  writeSessionOrder(["x", "y", "z"]);
  assert.equal(store.get(CHAT_SESSION_ORDER_KEY), JSON.stringify(["x", "y", "z"]));
  assert.deepEqual(readSessionOrder(), ["x", "y", "z"], "round-trips through storage");

  store.set(CHAT_SESSION_ORDER_KEY, "{not json");
  assert.deepEqual(readSessionOrder(), [], "corrupt value → empty");

  store.set(CHAT_SESSION_ORDER_KEY, JSON.stringify(["ok", 5, null, "two"]));
  assert.deepEqual(readSessionOrder(), ["ok", "two"], "non-string entries filtered out");
  delete globalThis.window;
}

console.log("chat-session-order.test.ts: ok");
