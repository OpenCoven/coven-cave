// @ts-nocheck
import assert from "node:assert/strict";
import {
  chatArchiveNudgeDismissKey,
  clearChatArchiveNudgeDismissed,
  isChatArchiveNudgeDismissed,
  markChatArchiveNudgeDismissed,
  shouldShowChatArchiveNudge,
} from "./chat-archive-nudge.ts";

// Fresh in-memory storage per case so dismissals from one case don't bleed.
function makeStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    _dump: () => Object.fromEntries(map),
  };
}

// 1. Dismiss key is namespaced per session and deterministic — we rely on this
//    being stable so an old dismiss stays honored across builds.
assert.equal(
  chatArchiveNudgeDismissKey("s-1"),
  "cave:chat-archive-nudge-dismissed:s-1",
  "dismiss key is namespaced and includes the session id",
);

// 2. shouldShowChatArchiveNudge — happy path: completed + active + not dismissed.
assert.equal(
  shouldShowChatArchiveNudge({
    taskLifecycle: "completed",
    sessionArchived: false,
    dismissed: false,
  }),
  true,
  "shows when task is completed and chat is active and not dismissed",
);

// 3. Suppressed when the session is already archived (no nudge after the fact).
assert.equal(
  shouldShowChatArchiveNudge({
    taskLifecycle: "completed",
    sessionArchived: true,
    dismissed: false,
  }),
  false,
  "hides once the chat is archived",
);

// 4. Suppressed when the user previously dismissed the nudge for this session.
assert.equal(
  shouldShowChatArchiveNudge({
    taskLifecycle: "completed",
    sessionArchived: false,
    dismissed: true,
  }),
  false,
  "hides once the user dismissed it for this session",
);

// 5. Suppressed for every non-terminal lifecycle.
for (const lifecycle of ["queued", "dispatched", "running", "review", "failed", "cancelled"]) {
  assert.equal(
    shouldShowChatArchiveNudge({
      taskLifecycle: lifecycle,
      sessionArchived: false,
      dismissed: false,
    }),
    false,
    `does not show for lifecycle=${lifecycle}`,
  );
}

// 6. Suppressed when there's no linked task at all (chat with no task tie).
for (const lifecycle of [null, undefined, ""]) {
  assert.equal(
    shouldShowChatArchiveNudge({
      taskLifecycle: lifecycle,
      sessionArchived: false,
      dismissed: false,
    }),
    false,
    `does not show when taskLifecycle is ${JSON.stringify(lifecycle)}`,
  );
}

// 7. Dismiss storage round-trip — write, read back as dismissed, clear.
{
  const storage = makeStorage();
  assert.equal(
    isChatArchiveNudgeDismissed("s-2", storage),
    false,
    "starts out not dismissed",
  );
  markChatArchiveNudgeDismissed("s-2", storage);
  assert.equal(
    isChatArchiveNudgeDismissed("s-2", storage),
    true,
    "is dismissed after mark",
  );
  assert.equal(
    storage._dump()["cave:chat-archive-nudge-dismissed:s-2"],
    "1",
    "persists as the literal '1' marker so future reads stay cheap",
  );
  clearChatArchiveNudgeDismissed("s-2", storage);
  assert.equal(
    isChatArchiveNudgeDismissed("s-2", storage),
    false,
    "no longer dismissed after clear",
  );
}

// 8. Per-session isolation — dismissing one session does NOT dismiss another.
{
  const storage = makeStorage();
  markChatArchiveNudgeDismissed("s-a", storage);
  assert.equal(isChatArchiveNudgeDismissed("s-a", storage), true);
  assert.equal(
    isChatArchiveNudgeDismissed("s-b", storage),
    false,
    "dismiss is per-session and does not leak across sessions",
  );
}

// 9. Tolerates a missing or throwing storage (Safari private mode, no-window).
{
  assert.equal(
    isChatArchiveNudgeDismissed("s-3", null),
    false,
    "treats missing storage as not-dismissed",
  );
  // Should not throw on a hostile storage either.
  const hostile = {
    getItem: () => {
      throw new Error("denied");
    },
    setItem: () => {
      throw new Error("denied");
    },
    removeItem: () => {
      throw new Error("denied");
    },
  };
  assert.equal(
    isChatArchiveNudgeDismissed("s-3", hostile),
    false,
    "swallows read errors from a hostile storage",
  );
  // These must not throw.
  markChatArchiveNudgeDismissed("s-3", hostile);
  clearChatArchiveNudgeDismissed("s-3", hostile);
}

console.log("chat-archive-nudge.test.ts ok");
