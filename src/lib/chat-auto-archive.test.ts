// @ts-nocheck
import assert from "node:assert/strict";
import {
  autoArchiveDecisions,
  clampExtendDays,
  DEFAULT_CHAT_AUTO_ARCHIVE_POLICY,
  extendUntilIso,
  normalizeChatAutoArchivePolicy,
  sessionCreatedExternally,
  shouldAutoArchiveOnReflection,
  shouldAutoArchiveOnTaskCompletion,
  SUMMON_GRACE_DAYS,
} from "./chat-auto-archive.ts";

const NOW = new Date("2026-07-12T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(days) {
  return new Date(NOW.getTime() - days * DAY_MS).toISOString();
}

function row(overrides = {}) {
  return {
    id: "s-1",
    status: "completed",
    archived_at: null,
    updated_at: daysAgo(1),
    origin: "chat",
    ...overrides,
  };
}

function context(overrides = {}) {
  return { keep: {}, extendedUntil: {}, now: NOW, ...overrides };
}

const policy = { ...DEFAULT_CHAT_AUTO_ARCHIVE_POLICY };

// --- normalizeChatAutoArchivePolicy -----------------------------------------

// 1. Missing/corrupt stored policies fall back to defaults.
assert.deepEqual(normalizeChatAutoArchivePolicy(undefined), DEFAULT_CHAT_AUTO_ARCHIVE_POLICY);
assert.deepEqual(normalizeChatAutoArchivePolicy(null), DEFAULT_CHAT_AUTO_ARCHIVE_POLICY);
assert.deepEqual(normalizeChatAutoArchivePolicy("bogus"), DEFAULT_CHAT_AUTO_ARCHIVE_POLICY);

// 2. Partial policies inherit defaults; day values clamp to 0..365 integers.
assert.deepEqual(
  normalizeChatAutoArchivePolicy({ idleAfterDays: 9000, externalAfterDays: -3 }),
  { ...DEFAULT_CHAT_AUTO_ARCHIVE_POLICY, idleAfterDays: 365, externalAfterDays: 0 },
  "day windows clamp; negatives mean off",
);
assert.equal(
  normalizeChatAutoArchivePolicy({ idleAfterDays: 2.9 }).idleAfterDays,
  2,
  "fractional day values floor",
);
assert.equal(
  normalizeChatAutoArchivePolicy({ archiveOnTaskCompletion: true }).archiveOnTaskCompletion,
  true,
);
assert.equal(
  normalizeChatAutoArchivePolicy({ archiveOnReflection: true }).archiveOnReflection,
  true,
);
assert.equal(
  DEFAULT_CHAT_AUTO_ARCHIVE_POLICY.archiveOnReflection,
  false,
  "reflection auto-archive is opt-in via the chat Settings tab",
);
assert.equal(
  normalizeChatAutoArchivePolicy({ archiveOnReflection: "yes" }).archiveOnReflection,
  false,
  "non-boolean reflection flags fall back to the default",
);
assert.equal(
  DEFAULT_CHAT_AUTO_ARCHIVE_POLICY.archiveOnPrMerge,
  true,
  "merged-PR auto-archive is on by default (preserves shipped behavior)",
);
assert.equal(
  normalizeChatAutoArchivePolicy({ archiveOnPrMerge: false }).archiveOnPrMerge,
  false,
  "the Settings-tab toggle can turn merged-PR auto-archive off",
);
assert.equal(
  normalizeChatAutoArchivePolicy({ archiveOnPrMerge: "no" }).archiveOnPrMerge,
  true,
  "non-boolean merged-PR flags fall back to the default",
);

// --- sessionCreatedExternally ------------------------------------------------

// 3. Generated daemon runs and system origins are external; chat-surface
//    origins are not.
assert.equal(sessionCreatedExternally({ origin: "chat", generated: true }), true);
for (const origin of ["cron", "heartbeat", "journal", "board", "enhance"]) {
  assert.equal(sessionCreatedExternally({ origin }), true, `${origin} is external`);
}
for (const origin of ["chat", "mention", "call", "canvas"]) {
  assert.equal(sessionCreatedExternally({ origin }), false, `${origin} is user-facing`);
}
assert.equal(sessionCreatedExternally({}), false, "no origin metadata → not external");

// --- autoArchiveDecisions ----------------------------------------------------

// 4. Disabled policy sweeps nothing, regardless of eligibility.
assert.deepEqual(
  autoArchiveDecisions([row({ updated_at: daysAgo(100) })], { ...policy, enabled: false }, context()),
  [],
);

// 5. Idle chats past the window archive with reason "idle"; fresh ones don't.
assert.deepEqual(
  autoArchiveDecisions(
    [row({ id: "old", updated_at: daysAgo(31) }), row({ id: "fresh", updated_at: daysAgo(3) })],
    policy,
    context(),
  ),
  [{ sessionId: "old", reason: "idle" }],
);

// 6. Externally-created chats use the shorter window and win over "idle".
assert.deepEqual(
  autoArchiveDecisions(
    [row({ id: "cron-run", origin: "cron", updated_at: daysAgo(8) })],
    policy,
    context(),
  ),
  [{ sessionId: "cron-run", reason: "external" }],
);
assert.deepEqual(
  autoArchiveDecisions(
    [row({ id: "gen", generated: true, updated_at: daysAgo(40) })],
    policy,
    context(),
  ),
  [{ sessionId: "gen", reason: "external" }],
  "a long-idle generated run reports the external reason, not idle",
);

// 7. Window = 0 disables that rule independently.
assert.deepEqual(
  autoArchiveDecisions(
    [row({ id: "cron-run", origin: "cron", updated_at: daysAgo(8) })],
    { ...policy, externalAfterDays: 0 },
    context(),
  ),
  [],
  "externalAfterDays 0 turns the origin rule off (8 idle days < 30)",
);
assert.deepEqual(
  autoArchiveDecisions(
    [row({ updated_at: daysAgo(100) })],
    { ...policy, idleAfterDays: 0, externalAfterDays: 0 },
    context(),
  ),
  [],
);

// 8. Keep-marked sessions never sweep.
assert.deepEqual(
  autoArchiveDecisions(
    [row({ id: "kept", updated_at: daysAgo(100) })],
    policy,
    context({ keep: { kept: daysAgo(50) } }),
  ),
  [],
);

// 9. An unexpired extension blocks the sweep; an expired one doesn't.
assert.deepEqual(
  autoArchiveDecisions(
    [row({ id: "ext", updated_at: daysAgo(100) })],
    policy,
    context({ extendedUntil: { ext: new Date(NOW.getTime() + DAY_MS).toISOString() } }),
  ),
  [],
  "extension in the future skips the row",
);
assert.deepEqual(
  autoArchiveDecisions(
    [row({ id: "ext", updated_at: daysAgo(100) })],
    policy,
    context({ extendedUntil: { ext: daysAgo(1) } }),
  ),
  [{ sessionId: "ext", reason: "idle" }],
  "expired extension no longer protects",
);

// 10. Already-archived rows and active work are skipped.
assert.deepEqual(
  autoArchiveDecisions(
    [
      row({ id: "done", archived_at: daysAgo(2), updated_at: daysAgo(100) }),
      row({ id: "busy", status: "running", updated_at: daysAgo(100) }),
    ],
    policy,
    context(),
  ),
  [],
);

// 11. Unparseable timestamps never qualify (fail safe: keep the chat).
assert.deepEqual(
  autoArchiveDecisions([row({ updated_at: "not-a-date" })], policy, context()),
  [],
);

// --- shouldAutoArchiveOnTaskCompletion ----------------------------------------

const completionPolicy = { ...policy, archiveOnTaskCompletion: true };

// 12. Archives only when opted in, with a session, not kept, not archived.
assert.equal(
  shouldAutoArchiveOnTaskCompletion("s-1", completionPolicy, { keep: {}, archivedSessionIds: [] }),
  true,
);
assert.equal(
  shouldAutoArchiveOnTaskCompletion("s-1", policy, { keep: {}, archivedSessionIds: [] }),
  false,
  "default policy nudges instead of archiving",
);
assert.equal(
  shouldAutoArchiveOnTaskCompletion(null, completionPolicy, { keep: {}, archivedSessionIds: [] }),
  false,
);
assert.equal(
  shouldAutoArchiveOnTaskCompletion(
    "s-1",
    { ...completionPolicy, enabled: false },
    { keep: {}, archivedSessionIds: [] },
  ),
  false,
);
assert.equal(
  shouldAutoArchiveOnTaskCompletion("s-1", completionPolicy, {
    keep: { "s-1": daysAgo(1) },
    archivedSessionIds: [],
  }),
  false,
  "keep-marked chats are never auto-archived on completion",
);
assert.equal(
  shouldAutoArchiveOnTaskCompletion("s-1", completionPolicy, {
    keep: {},
    archivedSessionIds: ["s-1"],
  }),
  false,
);

// --- shouldAutoArchiveOnReflection --------------------------------------------

const reflectionPolicy = { ...policy, archiveOnReflection: true };

// 13. A landed reflection archives only when opted in, with a session, not
//     kept, not already archived — and never for periodic (mid-flight) reports.
assert.equal(
  shouldAutoArchiveOnReflection("s-1", "manual", reflectionPolicy, { keep: {}, archivedSessionIds: [] }),
  true,
);
assert.equal(
  shouldAutoArchiveOnReflection("s-1", "auto", reflectionPolicy, { keep: {}, archivedSessionIds: [] }),
  true,
  "auto self-reports archive too — the thread already reached a closed state",
);
assert.equal(
  shouldAutoArchiveOnReflection("s-1", "periodic", reflectionPolicy, { keep: {}, archivedSessionIds: [] }),
  false,
  "periodic reports are mid-flight health checks, never an archive trigger",
);
assert.equal(
  shouldAutoArchiveOnReflection("s-1", "manual", policy, { keep: {}, archivedSessionIds: [] }),
  false,
  "default policy leaves reflected threads alone",
);
assert.equal(
  shouldAutoArchiveOnReflection(null, "manual", reflectionPolicy, { keep: {}, archivedSessionIds: [] }),
  false,
);
assert.equal(
  shouldAutoArchiveOnReflection(
    "s-1",
    "manual",
    { ...reflectionPolicy, enabled: false },
    { keep: {}, archivedSessionIds: [] },
  ),
  false,
  "the master switch also gates reflection archiving",
);
assert.equal(
  shouldAutoArchiveOnReflection("s-1", "manual", reflectionPolicy, {
    keep: { "s-1": daysAgo(1) },
    archivedSessionIds: [],
  }),
  false,
  "keep-marked chats are never auto-archived on reflection",
);
assert.equal(
  shouldAutoArchiveOnReflection("s-1", "manual", reflectionPolicy, {
    keep: {},
    archivedSessionIds: ["s-1"],
  }),
  false,
);

// --- clampExtendDays / extendUntilIso ----------------------------------------

// 13. Extension requests clamp to 1..365 whole days; junk is rejected (null).
assert.equal(clampExtendDays(7), 7);
assert.equal(clampExtendDays(7.9), 7);
assert.equal(clampExtendDays(10_000), 365);
assert.equal(clampExtendDays(0), null);
assert.equal(clampExtendDays(-2), null);
assert.equal(clampExtendDays("7"), null);
assert.equal(clampExtendDays(Number.NaN), null);

// 14. extendUntilIso lands exactly N days out.
assert.equal(extendUntilIso(NOW, 3), new Date(NOW.getTime() + 3 * DAY_MS).toISOString());

// 15. The summon grace exists and shields a freshly unarchived idle chat.
assert.ok(SUMMON_GRACE_DAYS >= 1);
assert.deepEqual(
  autoArchiveDecisions(
    [row({ id: "resurrected", updated_at: daysAgo(200) })],
    policy,
    context({ extendedUntil: { resurrected: extendUntilIso(NOW, SUMMON_GRACE_DAYS) } }),
  ),
  [],
  "summon-grace extension keeps a just-unarchived chat out of the next sweep",
);

console.log("chat-auto-archive.test.ts ok");
