import assert from "node:assert/strict";
import {
  NEEDS_YOU_SEEN_KEY,
  NEEDS_YOU_SEEN_LIMIT,
  markNeedsYouSeen,
  readNeedsYouSeen,
  writeNeedsYouSeen,
} from "./needs-you-seen.ts";

// A minimal localStorage stand-in. `throwOnWrite` reproduces a full quota and
// private-mode browsers, where the accessor itself throws.
function installStorage(options: { throwOnWrite?: boolean } = {}) {
  const store = new Map<string, string>();
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (options.throwOnWrite) throw new Error("QuotaExceededError");
        store.set(key, value);
      },
    },
  };
  return store;
}

function clearStorage() {
  delete (globalThis as { window?: unknown }).window;
}

// ── Server rendering has no storage, and must not throw ──────────────────────
clearStorage();
assert.deepEqual([...readNeedsYouSeen()], [], "no window → nothing seen");
assert.deepEqual([...writeNeedsYouSeen(["a"])], ["a"], "a write without storage still returns the set");

// ── Round trip ───────────────────────────────────────────────────────────────
{
  const store = installStorage();
  writeNeedsYouSeen(["s1@t1", "s2@t2"]);
  assert.deepEqual([...readNeedsYouSeen()], ["s1@t1", "s2@t2"]);
  assert.equal(
    store.get(NEEDS_YOU_SEEN_KEY),
    JSON.stringify(["s1@t1", "s2@t2"]),
    "stored as a plain JSON array",
  );
  clearStorage();
}

// ── Garbage can never widen the type ─────────────────────────────────────────
{
  const store = installStorage();
  store.set(NEEDS_YOU_SEEN_KEY, "not json at all");
  assert.deepEqual([...readNeedsYouSeen()], [], "unparseable storage reads as empty");

  store.set(NEEDS_YOU_SEEN_KEY, JSON.stringify({ s1: true }));
  assert.deepEqual([...readNeedsYouSeen()], [], "a non-array reads as empty");

  store.set(NEEDS_YOU_SEEN_KEY, JSON.stringify(["ok", 42, null, "  ", " padded "]));
  assert.deepEqual(
    [...readNeedsYouSeen()],
    ["ok", "padded"],
    "non-strings and blanks are dropped, values trimmed",
  );
  clearStorage();
}

// ── Failing open: a blocked write never hides an ask ─────────────────────────
{
  installStorage({ throwOnWrite: true });
  const result = writeNeedsYouSeen(["s1@t1"]);
  assert.deepEqual([...result], ["s1@t1"], "the caller still gets the set for this session");
  assert.deepEqual([...readNeedsYouSeen()], [], "nothing persisted, so the ask returns on reload");
  clearStorage();
}

// ── Bounded, evicting genuinely stale keys ───────────────────────────────────
{
  installStorage();
  const many = Array.from({ length: NEEDS_YOU_SEEN_LIMIT + 50 }, (_, i) => `s${i}@t`);
  const stored = writeNeedsYouSeen(many);
  assert.equal(stored.size, NEEDS_YOU_SEEN_LIMIT, "capped at the limit");
  assert.ok(!stored.has("s0@t"), "the oldest dismissals are evicted first");
  assert.ok(stored.has(`s${NEEDS_YOU_SEEN_LIMIT + 49}@t`), "the newest are kept");
  clearStorage();
}

// Re-dismissing moves a key to the recent end rather than duplicating it, so
// the cap evicts by staleness rather than by insertion accident.
{
  installStorage();
  const refreshed = writeNeedsYouSeen(["a", "b", "c", "a"]);
  assert.deepEqual([...refreshed], ["b", "c", "a"], "a repeat moves to the end, no duplicate");
  clearStorage();
}

// ── markNeedsYouSeen merges onto what is already there ───────────────────────
{
  installStorage();
  const first = markNeedsYouSeen(new Set(), ["s1@t1"]);
  const second = markNeedsYouSeen(first, ["s2@t2", "s3@t3"]);
  assert.deepEqual([...second], ["s1@t1", "s2@t2", "s3@t3"]);
  assert.deepEqual([...readNeedsYouSeen()], ["s1@t1", "s2@t2", "s3@t3"], "merge is persisted");
  clearStorage();
}
