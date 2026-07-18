// @ts-nocheck
/**
 * Client polling discipline (cave-e794).
 *
 * usePausablePoll exists because surfaces kept hand-rolling the same
 * setInterval + document.hidden + visibilitychange trio, and the hand-rolled
 * copies kept forgetting the hidden-tab pause — a permanently mounted 2s
 * lane poll (open-coven-tools-update) and a 10s theme reconcile
 * (remote-theme-controller) fetched from hidden windows for as long as the
 * app was open.
 *
 * This test makes the discipline structural:
 *
 *  1. every `setInterval(` in a "use client" file must either sit next to a
 *     hidden/visibility guard or use the shared hook — OR the file must be on
 *     the explicit ticker/scoped allowlist below with a reason;
 *  2. the migrated surfaces stay migrated (pins);
 *  3. new unguarded client polls fail CI with a pointer to usePausablePoll.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Files allowed to keep raw setInterval WITHOUT a visibility guard.
 * Every entry needs a reason; "ticker" means a cheap local-state clock with
 * no network I/O (pausing a call timer or elapsed counter would be wrong or
 * pointless — they cost no requests).
 */
const RAW_INTERVAL_ALLOWLIST = new Map([
  ["components/ui/thinking-indicator.tsx", "elapsed-time ticker while a turn is pending; no network"],
  ["components/voice-call-overlay.tsx", "live call-duration ticker; pausing it would misreport the call"],
  ["components/home/home-feed.tsx", "minute ticker for relative timestamps; no network"],
  ["components/calendar-view.tsx", "wall-clock minute ticker for the now-line; no network"],
  ["components/chat-view.tsx", "1s elapsed ticker on the streaming meta line; no network"],
  ["components/familiar-studio-projects-tab.tsx", "30s grant-undo countdown while an accepting row is visible; no network"],
  ["components/update-available.tsx", "6-hour recheck cadence; a hidden-tab skip would defer updates for days"],
  ["components/onboarding-overlay.tsx", "modal-scoped 2s install polls; only run while the overlay is open mid-setup"],
  ["lib/use-pausable-poll.ts", "the shared hook's own interval (it self-guards via document.hidden)"],
]);

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else yield full;
  }
}

const offenders = [];
const guarded = [];
for (const file of walk(SRC)) {
  if (!/\.(ts|tsx)$/.test(file) || /\.test\./.test(file)) continue;
  const source = readFileSync(file, "utf8");
  const firstLines = source.slice(0, 200);
  if (!firstLines.includes('"use client"')) continue;

  const rel = path.relative(SRC, file);
  let index = 0;
  let unguardedHere = 0;
  while ((index = source.indexOf("setInterval(", index)) !== -1) {
    // The guard usually lives inside the polled callback, which is commonly
    // declared just above the interval — look far enough back to see it.
    const context = source.slice(Math.max(0, index - 2000), index + 700);
    const isGuarded = /document\.hidden|visibilityState/.test(context);
    if (isGuarded) guarded.push(rel);
    else unguardedHere += 1;
    index += "setInterval(".length;
  }
  if (unguardedHere > 0 && !RAW_INTERVAL_ALLOWLIST.has(rel)) {
    offenders.push(`${rel} (${unguardedHere} unguarded setInterval call(s))`);
  }
}

assert.deepEqual(
  offenders,
  [],
  `Unguarded setInterval in client code. Recurring network polls must use ` +
    `usePausablePoll (src/lib/use-pausable-poll.ts) — it pauses while hidden ` +
    `and refreshes on return. Cheap non-network tickers can be added to the ` +
    `allowlist in this test WITH a reason. Offenders:\n  ${offenders.join("\n  ")}`,
);

// ── Migrated surfaces stay migrated ─────────────────────────────────────────
const changesSummary = readFileSync(path.join(SRC, "lib/use-changes-summary.ts"), "utf8");
assert.match(
  changesSummary,
  /usePausablePoll\(\(\) => void load\(\), POLL_MS, \{ enabled: active && Boolean\(projectRoot\) \}\)/,
  "use-changes-summary polls through the shared hook",
);
assert.ok(
  !changesSummary.includes("setInterval("),
  "use-changes-summary must not hand-roll its interval again",
);
assert.ok(
  !changesSummary.includes('addEventListener("visibilitychange"'),
  "use-changes-summary must not hand-roll the visibility listener (the hook owns on-return refresh)",
);
assert.match(
  changesSummary,
  /generation\.current !== gen\) return;/,
  "a stale in-flight response for the previous project root must not write into the new root's state",
);

const githubView = readFileSync(path.join(SRC, "components/github-view.tsx"), "utf8");
assert.match(
  githubView,
  /usePausablePoll\(\(\) => setTick\(\(t\) => t \+ 1\), 30_000, \{ enabled: rollup === "pending" \}\)/,
  "the CI-rollup live refresh polls through the shared hook (hidden pause + instant on-return tick)",
);

const toolsUpdate = readFileSync(path.join(SRC, "components/open-coven-tools-update.tsx"), "utf8");
assert.match(
  toolsUpdate,
  /usePausablePoll\(\(\) => void refreshNpmLane\(\), 2000\)/,
  "the always-mounted npm-lane poll goes through the shared hook — it used to fetch every 2s from hidden windows",
);

const remoteTheme = readFileSync(path.join(SRC, "components/remote-theme-controller.tsx"), "utf8");
assert.match(
  remoteTheme,
  /if \(document\.hidden\) return;\s*\n\s*void reconcileRemote\(\);/,
  "the remote-theme reconcile poll skips hidden windows (onVisible refreshes on return)",
);

console.log(
  `pausable-poll-discipline.test.ts: ok (${guarded.length} guarded interval(s), ` +
    `${RAW_INTERVAL_ALLOWLIST.size} allowlisted ticker/scoped file(s))`,
);
