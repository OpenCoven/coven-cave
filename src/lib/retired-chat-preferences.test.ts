// @ts-nocheck
// Behavioural tests for the retired-chat-preference purge (cave-5m5hv), plus a
// source pin that chat-view actually runs it.
//
// This file replaces thread-instruments-visibility.test.ts. That file's
// assertions were all properties of the preference itself — "unset defaults to
// visible", "an explicit 0 hides them", "the kebab flips it" — and every one of
// them describes behaviour this change deletes. What it did NOT cover was the
// left turn spine (unmounted at the time) or the rail's existence; its only
// rail-side property was that the rail was *conditional*. So nothing carried
// over verbatim, and what is pinned here is the inverse: the stored value is
// removed, and removing it is safe to repeat.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const KEY = "cave:chat:thread-instruments";

function withStorage(storage: unknown) {
  globalThis.window = { localStorage: storage } as never;
}

const { purgeRetiredChatPreferences } = await import("./retired-chat-preferences.ts");

function makeStore(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    api: {
      getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
      removeItem: (k: string) => { map.delete(k); },
      setItem: (k: string, v: string) => { map.set(k, v); },
    },
  };
}

// ── the opt-out a real browser is carrying is deleted ──────────────────────
// "0" is the value that matters: it is what the retired "Hide activity map"
// item wrote, and the state a user could be stuck in with no UI left to exit.
{
  const { map, api } = makeStore({ [KEY]: "0", "cave:chat:keep-me": "1" });
  withStorage(api);
  const removed = purgeRetiredChatPreferences();
  assert.deepEqual(removed, [KEY], "the retired key is reported as removed");
  assert.equal(map.has(KEY), false, "the retired key is gone from storage");
  assert.equal(map.get("cave:chat:keep-me"), "1", "unrelated chat keys are untouched");
}

// A "1" is just as dead — the purge is about the key, not about which way the
// switch was left.
{
  const { map, api } = makeStore({ [KEY]: "1" });
  withStorage(api);
  assert.deepEqual(purgeRetiredChatPreferences(), [KEY]);
  assert.equal(map.has(KEY), false);
}

// ── idempotent: it runs on every chat mount ────────────────────────────────
{
  const { api } = makeStore({ [KEY]: "0" });
  withStorage(api);
  assert.deepEqual(purgeRetiredChatPreferences(), [KEY], "first pass removes");
  assert.deepEqual(purgeRetiredChatPreferences(), [], "second pass reports nothing and does not throw");
}

// ── never throws where storage is unavailable ──────────────────────────────
// Private mode, a quota error, or a browser with site data blocked. A purge
// that throws here would take the whole transcript down with it.
{
  withStorage({
    getItem: () => { throw new Error("SecurityError"); },
    removeItem: () => { throw new Error("SecurityError"); },
  });
  assert.deepEqual(purgeRetiredChatPreferences(), [], "a throwing store degrades to a no-op");
}

// Server render: there is no window at all.
{
  delete (globalThis as Record<string, unknown>).window;
  assert.deepEqual(purgeRetiredChatPreferences(), [], "no window → no-op, never a crash");
}

// ── the purge actually reaches the chat ────────────────────────────────────
const chatView = readFileSync(new URL("../components/chat-view.tsx", import.meta.url), "utf8");
assert.match(
  chatView,
  /^import \{ purgeRetiredChatPreferences \} from "@\/lib\/retired-chat-preferences";$/m,
  "chat-view imports the purge",
);
assert.match(
  chatView,
  /useEffect\(\(\) => \{\s*\n\s*purgeRetiredChatPreferences\(\);\s*\n\s*\}, \[\]\);/,
  "chat-view runs the purge once per mount — an unimported purge cleans nothing",
);

console.log("retired-chat-preferences tests passed");
