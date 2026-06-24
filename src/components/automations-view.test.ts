// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./automations-view.tsx", import.meta.url), "utf8");

// Save is gated on a valid, changed form: not busy, dirty, named, and a valid
// schedule (weekly needs ≥1 day).
assert.match(
  source,
  /const canSave = !busy && dirty && name\.trim\(\)\.length > 0 && !invalidSchedule;/,
  "Save is disabled unless the form is changed, named, and has a valid schedule",
);
assert.match(
  source,
  /scheduleMode === "weekly" && scheduleDays\.length === 0/,
  "a weekly schedule with no days selected is treated as invalid",
);

// A disabled Save must explain itself rather than being a dead button.
assert.match(
  source,
  /const saveBlockedReason =/,
  "an explicit reason is computed when the form blocks saving",
);
assert.match(
  source,
  /Pick at least one day for a weekly schedule\./,
  "weekly-with-no-days surfaces a specific, actionable message",
);
assert.match(
  source,
  /\{saveBlockedReason \?[\s\S]{0,160}?role="alert"/,
  "the blocking reason renders as an alert above the Save button",
);
assert.match(
  source,
  /disabled=\{!canSave\}/,
  "the Save button stays disabled while canSave is false",
);

// List rows + detail-panel close buttons show a visible keyboard focus ring.
assert.ok(source.includes("focus-ring-inset automation-list-row"), "list rows have a focus ring");
assert.ok(source.includes("focus-ring rounded p-1 transition-colors hover:bg-white/5"), "panel close buttons have a focus ring");

// Reminders bulk-select: the shared multi-select hook + toolbar drive it.
assert.match(source, /useMultiSelect\(reminderVisible/, "reminders use the shared useMultiSelect hook over the visible rows");
assert.match(source, /<SelectionToolbar/, "select mode renders the shared SelectionToolbar");
assert.match(
  source,
  /role=\{selectMode \? "checkbox" : undefined\}/,
  "reminder rows flip from button to checkbox role in select mode",
);
assert.match(source, /aria-checked=\{selectMode \? checked : undefined\}/, "checkbox rows expose aria-checked");
// The three bulk actions exist and hit the right transitions.
assert.match(source, /bulkPatchReminders\(\{ status: "dismissed" \}\)/, "bulk Pause dismisses the selected reminders");
assert.match(source, /bulkPatchReminders\(\{ status: "pending" \}\)/, "bulk Resume re-pends the selected reminders");
assert.match(source, /const bulkDeleteReminders = \(\) =>/, "bulk Delete is wired (deferred + undoable, no async confirm)");
assert.match(source, /scheduleDelete\(ids,/, "bulk Delete routes through the deferred useUndoDelete helper");
// Ephemeral inbox items can't be mutated server-side, so they're filtered out.
assert.match(source, /\.filter\(\(id\) => !id\.startsWith\("eph:"\)\)/, "bulk actions skip ephemeral (eph:) ids");

// ── Polling pauses while hidden + async fetch guards ────────────────────────
// The 15s list poll + 2.5s in-flight run poll otherwise keep firing in a
// backgrounded tab; a refetch on return brings the surface current.
assert.match(source, /const tick = \(\) => \{ if \(!document\.hidden\) void load\(\); \}/, "the 15s poll skips a hidden tab");
assert.match(source, /addEventListener\("visibilitychange", onVis\)/, "polling resumes when the tab returns");
assert.match(source, /if \(document\.hidden\) return;.*don't poll a backgrounded tab/, "the in-flight run poll skips a hidden tab");
// All loaders guard against setState after unmount; refreshRuns also drops stale responses.
assert.match(source, /const mountedRef = useRef\(true\)/, "tracks mounted state for async guards");
assert.match(source, /const runsReqRef = useRef\(0\)/, "refreshRuns tracks a request id");
assert.match(source, /if \(reqId !== runsReqRef\.current \|\| !mountedRef\.current\) return/, "a stale/late runs fetch is dropped");

// ── Per-row quick actions (run-now + pause/resume), revealed on hover ──
assert.match(source, /const ScheduleActionsContext = createContext/, "row actions are provided via context (no prop threading)");
assert.match(source, /<ScheduleActionsContext\.Provider/, "AutomationsView provides the row actions");
assert.match(source, /runReminder: runNow/, "reminder run-now is wired");
assert.match(source, /togglePauseReminder: togglePaused/, "reminder pause/resume is wired");
assert.match(source, /runAutomation: runCodexNow/, "automation run-now is wired");
assert.match(source, /togglePauseAutomation: toggleCodex/, "automation pause/resume is wired");
// Hidden actions must not steal clicks meant for the row's detail panel.
assert.match(source, /pointer-events-none[\s\S]*?group-hover\/srow:pointer-events-auto/, "hidden row actions keep pointer-events:none until hover/focus");
assert.match(source, /onClick=\{\(e\) => \{ e\.stopPropagation\(\); onClick\(\); \}\}/, "a row action stops the click from opening the detail panel");
assert.match(source, /actions\.runAutomation\(auto\)/, "the automation row exposes run-now");
assert.match(source, /actions\.togglePauseReminder\(item\)/, "the reminder row exposes pause/resume");
assert.match(source, /item\.kind !== "daily-summary"/, "daily-summary rows get no run/pause actions");

console.log("automations-view.test.ts: ok");
