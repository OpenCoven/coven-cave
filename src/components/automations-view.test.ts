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
// (Hidden-tab pause + refetch-on-return now come from the shared
// usePausablePoll hook — the hand-rolled tick/visibilitychange pair is gone.)
assert.doesNotMatch(source, /addEventListener\("visibilitychange"/, "no hand-rolled visibility handling remains for the list poll");
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
assert.match(
  source,
  /entry\.name[\s\S]*?aria-label=\{`Run \$\{entry\.name\} now`\}/,
  "unified automation row actions render below the automation name",
);
assert.match(
  source,
  /\{name\}<\/span>[\s\S]*?onClick=\{onRun\}[\s\S]*?onClick=\{onOpen\}/,
  "managed automation row actions render below the automation name",
);
assert.match(
  source,
  /aria-label=\{`Run \$\{name\} now`\}/,
  "the managed row's Run button carries a distinct accessible name (not just \"Run\"/\"…\")",
);

console.log("automations-view.test.ts: ok");

// ── 2026-07-03 audit fixes ────────────────────────────────────────────────────
// Poll guards: unchanged responses keep previous references so the open detail
// panel's form-reset effect doesn't wipe in-progress edits every 15s, and the
// per-cron runs fan-out doesn't re-fire.
assert.match(source, /setItems\(\(prev\) => \(arrayContentEqual\(prev, nextItems\) \? prev : nextItems\)\)/, "inbox poll is content-guarded");
assert.match(source, /setCodexAutos\(\(prev\) => \(arrayContentEqual\(prev, nextAutos\) \? prev : nextAutos\)\)/, "codex poll is content-guarded");
assert.match(source, /setFlows\(\(prev\) => \(arrayContentEqual\(prev, nextFlows\) \? prev : nextFlows\)\)/, "flows poll is content-guarded");
assert.match(source, /usePausablePoll\(\(\) => \{ void load\(\); \}, 15_000/, "the 15s poll uses the shared pausable-poll hook");
// Selected-detail syncs only adopt content changes — a new-but-identical
// reference would re-fire the form reset (cron) or is pointless churn (reminder).
assert.match(source, /if \(JSON\.stringify\(fresh\) !== JSON\.stringify\(selectedCodex\)\) setSelectedCodex\(fresh\)/, "cron detail sync is content-guarded");
assert.match(source, /if \(JSON\.stringify\(fresh\) !== JSON\.stringify\(selectedItem\)\) setSelectedItem\(fresh\)/, "reminder detail panel re-syncs after polls");

// ── 2026-07-03 a11y batch ─────────────────────────────────────────────────────
assert.match(source, /const \{ announce \} = useAnnouncer\(\)/, "AutomationsView consumes the shared announcer");
assert.match(source, /announce\(`\$\{newStatus === "PAUSED" \? "Paused" : "Resumed"\} '\$\{auto\.name\}'\.`\)/, "cron pause/resume announces");
assert.match(source, /announce\(`Run started for '\$\{auto\.name\}'\.`\)/, "run-now announces");
assert.match(source, /announce\(`Created cron '\$\{input\.name\}'\.`\)/, "create announces");
assert.match(source, /role="img" aria-label="Paused"/, "status dots carry accessible names");
assert.match(source, /<section aria-labelledby=\{headingId\}/, "list sections are labelled landmarks with real headings");
assert.match(source, /idPrefix="automations"/, "tabs get ids so the panel can reference them");
assert.match(source, /role="tabpanel"[\s\S]{0,120}aria-labelledby=\{`automations-tab-\$\{activeTab\}`\}/, "the content region is a labelled tabpanel");
assert.match(source, /if \(e\.key === "Escape"\) \{[\s\S]{0,120}setNewMenuOpen\(false\);[\s\S]{0,60}newBtnRef\.current\?\.focus\(\)/, "the New menu closes on Escape and returns focus to its trigger");
assert.match(source, /window\.setTimeout\(\(\) => newBtnRef\.current\?\.focus\(\), 0\)/, "deletes hand focus somewhere stable instead of dropping it on <body>");
