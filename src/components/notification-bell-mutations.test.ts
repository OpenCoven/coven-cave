// @ts-nocheck
// Notification bell mutations must not silently no-op on network failure
// (cave-qhz3): every fetch is fire-and-forget with SSE reconcile as the only
// feedback, so a failed request needs res.ok verification and an assertive
// announcement. Bulk actions (clear-all, mark-all-read) go through ONE
// /api/inbox/bulk POST — a single file write + broadcast server-side — not a
// per-item fan-out racing its own SSE reconciles (cave-uu2d).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./notification-bell.tsx", import.meta.url), "utf8");

assert.match(
  src,
  /const \{ announce \} = useAnnouncer\(\)/,
  "bell announces mutation failures via the shared live region",
);

assert.match(
  src,
  /const mutate = useCallback\(\s*\n\s*async \(run: \(\) => Promise<Response>, failureMessage: string\): Promise<boolean> => \{[\s\S]*?if \(!res\.ok\) throw new Error\(String\(res\.status\)\);[\s\S]*?announce\(failureMessage, "assertive"\);/,
  "all bell mutations route through one guard that checks res.ok and announces failures assertively",
);

// Each mutation goes through the guard — no bare fire-and-forget fetch remains.
for (const [name, message] of [
  ["toggleMute", "Mute change failed"],
  ["toggleKindMute", "Mute change failed"],
  ["setSound", "Sound change failed"],
  ["dismiss", "Dismiss failed"],
  ["snooze", "Snooze failed"],
  ["markRead", "Mark read failed"],
  ["markAllRead", "Mark all read failed"],
  ["dismissAll", "Notifications could not be dismissed"],
]) {
  assert.match(
    src,
    new RegExp(`const ${name} = useCallback\\([\\s\\S]*?await mutate\\([\\s\\S]*?${message}`),
    `${name} routes through the failure-announcing guard`,
  );
}

// Prefs mutations only refresh prefs after a confirmed success.
assert.match(
  src,
  /const ok = await mutate\([\s\S]{0,400}?if \(ok\) onPrefsChanged\(\);/,
  "prefs refresh only fires after the server accepted the change",
);

// Bulk actions are single atomic POSTs to /api/inbox/bulk — the old
// per-item fan-out (N fetches, N file rewrites, N broadcasts) must not return.
assert.match(
  src,
  /const dismissAll = useCallback\([\s\S]*?"\/api\/inbox\/bulk"[\s\S]*?action: "dismiss", all: true/,
  "clear-all is one atomic bulk dismiss",
);
assert.match(
  src,
  /const markAllRead = useCallback\([\s\S]*?"\/api\/inbox\/bulk"[\s\S]*?action: "read", all: true/,
  "mark-all-read is one atomic bulk read",
);
assert.doesNotMatch(
  src,
  /Promise\.allSettled|Promise\.all\(/,
  "no per-item fan-out remains in the bell",
);

// Ephemeral response-needed rows (eph:*) are client-synthesized — there is
// nothing to mark read server-side, so markRead must skip them.
assert.match(
  src,
  /const markRead = useCallback\(\s*\n\s*async \(id: string\) => \{\s*\n\s*if \(id\.startsWith\("eph:"\)\) return;/,
  "markRead skips ephemeral response-needed rows",
);

// The badge counts unread from the SAME items the list shows (one shared
// definition) — never a separately polled count that can disagree.
assert.match(
  src,
  /const derivedBadgeCount = useMemo\(\(\) => unreadInboxCount\(items\), \[items\]\)/,
  "bell badge derives from unreadInboxCount over the listed items",
);

console.log("notification-bell-mutations.test.ts: ok");
