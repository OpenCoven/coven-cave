// @ts-nocheck
// Notification bell mutations must not silently no-op on network failure
// (cave-qhz3): every fetch is fire-and-forget with SSE reconcile as the only
// feedback, so a failed request needs res.ok verification and an assertive
// announcement — and clear-all must not abandon the fan-out on one rejection.
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
  ["setSound", "Sound change failed"],
  ["dismiss", "Dismiss failed"],
  ["snooze", "Snooze failed"],
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

// Clear-all: one failed dismiss must not reject the whole fan-out.
assert.match(
  src,
  /Promise\.allSettled\(\s*\n\s*dismissableIds\.map/,
  "clear-all uses allSettled so one failure doesn't abandon the rest",
);
assert.match(
  src,
  /could not be dismissed — check your connection\./,
  "clear-all reports how many dismissals failed",
);
assert.doesNotMatch(
  src,
  /await Promise\.all\(\s*\n\s*dismissableIds/,
  "the all-or-nothing Promise.all fan-out must not return",
);

console.log("notification-bell-mutations.test.ts: ok");
