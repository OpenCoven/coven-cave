// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./automations-view.tsx", import.meta.url), "utf8");
const detailPanelControls = source.slice(
  source.indexOf("function DetailPanel"),
  source.indexOf("function RowActions"),
);
const codexDetailPanel = source.slice(
  source.indexOf("function CodexDetailPanel"),
  source.indexOf("function AutomationScheduleRow"),
);

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

// Crons detail UX: the panel should read like an operational editor instead of
// a long undifferentiated form. Key facts are summarized first, editing is
// grouped into named zones, and primary/destructive actions are separated.
assert.match(codexDetailPanel, />\s*Cron details\s*</, "cron detail panel uses Cron-specific title copy");
assert.match(codexDetailPanel, /className="[^"]*cron-detail-summary-grid/, "cron detail panel renders an at-a-glance summary grid");
assert.match(codexDetailPanel, /<CronDetailSection title="Identity"/, "cron detail groups identity fields");
assert.match(codexDetailPanel, /<CronDetailSection title="Instructions"/, "cron detail groups prompt fields");
assert.match(codexDetailPanel, /<CronDetailSection title="Schedule"/, "cron detail groups schedule fields");
assert.match(codexDetailPanel, /<CronDetailSection title="Runtime"/, "cron detail groups runtime fields");
assert.match(codexDetailPanel, /className="[^"]*cron-detail-actions/, "cron detail actions live in a dedicated action rail");
assert.match(codexDetailPanel, /Save changes[\s\S]*Run now[\s\S]*Delete/, "cron detail actions prioritize save, then run, with delete last");
assert.match(codexDetailPanel, /leadingIcon="ph:floppy-disk-bold"/, "save action uses a recognizable icon");
assert.match(codexDetailPanel, /variant="danger-ghost"[\s\S]*Delete/, "delete remains visually separated as a destructive action");
assert.match(source, /const detailOpen = Boolean\(selectedItem \|\| selectedCodex\)/, "Schedules tracks whether a detail panel is open");
assert.match(source, /detailOpen \? "hidden md:flex" : "flex"/, "Schedules hides the list on narrow screens while a detail panel is open");
assert.match(source, /w-full[\s\S]*md:w-\[380px\][\s\S]*md:max-w-\[42vw\]/, "detail panel becomes full-width on narrow screens and a side rail on desktop");

// List rows + detail-panel close buttons show a visible keyboard focus ring.
assert.ok(source.includes("focus-ring-inset automation-list-row"), "list rows have a focus ring");
assert.match(detailPanelControls, /aria-label="Close"[\s\S]{0,220}rounded-\[var\(--radius-control\)\]/, "panel close buttons have a tokenized focusable hit target");
assert.match(detailPanelControls, /<Button/, "detail panel actions should use the shared Button primitive");
assert.doesNotMatch(detailPanelControls, /<button\b/, "detail panel actions should not hand-roll button controls");
assert.doesNotMatch(
  detailPanelControls,
  /rounded-full|rounded-md|rounded-lg|rounded(?=\s|")/,
  "detail panel actions should use radius tokens instead of hard-coded radii",
);

// The active Schedules surface is narrowed to Calendar + Crons; reminder bulk
// selection belongs to the older unified Automations surface.
assert.match(source, /type AutomationTab = "calendar" \| "crons"/, "Schedules exposes only Calendar and Crons tabs");
assert.doesNotMatch(source, /<SelectionToolbar/, "Schedules no longer renders reminder bulk-select chrome");
assert.match(source, /initialTab === "calendar" && calendarSlot \? "calendar" : calendarSlot \? "calendar" : "crons"/, "non-calendar deep links land on Crons");

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

// ── Per-row quick actions (run-now + pause/resume), always visible ──
assert.match(source, /const ScheduleActionsContext = createContext/, "row actions are provided via context (no prop threading)");
assert.match(source, /<ScheduleActionsContext\.Provider/, "AutomationsView provides the row actions");
assert.match(source, /runReminder: runNow/, "reminder run-now is wired");
assert.match(source, /togglePauseReminder: togglePaused/, "reminder pause/resume is wired");
assert.match(source, /runAutomation: runCodexNow/, "automation run-now is wired");
assert.match(source, /togglePauseAutomation: toggleCodex/, "automation pause/resume is wired");
// Actions are labeled, always-visible siblings of the row button (never a
// hover-revealed overlay, and never nested inside the row's own button).
assert.doesNotMatch(source, /group-hover\/srow/, "row actions are always visible — no hover reveal remains");
assert.match(source, /text=\{paused \? "Resume" : "Pause"\}/, "the reminder row's pause action is a labeled button");
assert.match(source, /text=\{isActive \? "Pause" : "Resume"\}/, "the cron row's pause action is a labeled button");
assert.match(source, /actions\.runAutomation\(auto\)/, "the automation row exposes run-now");
assert.match(source, /actions\.togglePauseReminder\(item\)/, "the reminder row exposes pause/resume");
assert.match(source, /item\.kind !== "daily-summary"/, "daily-summary rows get no run/pause actions");
assert.match(
  source,
  /entry\.name[\s\S]*?label=\{`Run \$\{entry\.name\} now`\}/,
  "unified automation row Run action routes through RowActionButton (label → aria-label)",
);
assert.match(
  source,
  /\{name\}<\/span>[\s\S]*?onClick=\{onRun\}[\s\S]*?onClick=\{onOpen\}/,
  "managed automation row actions render below the automation name",
);
assert.match(
  source,
  /label=\{`Run \$\{name\} now`\}/,
  "the managed row's Run action carries a distinct accessible name (not just \"Run\"/\"…\")",
);

// cave-4op: every Schedules row action (Run / Pause / Open) routes through the
// shared RowActionButton (a ghost Button primitive), which now supports a
// disabled/busy state — no row hand-rolls its own <button> action.
assert.match(
  source,
  /function RowActionButton\(\{ icon, label, text, onClick, disabled \}/,
  "RowActionButton accepts a disabled/busy state",
);
assert.doesNotMatch(
  source,
  /<button[\s\S]{0,220}aria-label=\{`Run \$\{(entry\.name|name)\} now`\}/,
  "no hand-rolled Run row-action buttons remain — they use RowActionButton",
);

console.log("automations-view.test.ts: ok");

// ── 2026-07-03 audit fixes ────────────────────────────────────────────────────
// Poll guards: unchanged responses keep previous references so the open detail
// panel's form-reset effect doesn't wipe in-progress edits every 15s, and the
// per-cron runs fan-out doesn't re-fire.
assert.match(source, /setItems\(\(prev\) => \(arrayContentEqual\(prev, nextItems\) \? prev : nextItems\)\)/, "inbox poll is content-guarded");
assert.match(source, /setCodexAutos\(\(prev\) => \(arrayContentEqual\(prev, nextAutos\) \? prev : nextAutos\)\)/, "codex poll is content-guarded");
assert.doesNotMatch(source, /setFlows\(|listFlows\(/, "Schedules no longer polls Flow docs");
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
assert.match(source, /onClose=\{\(\) => \{ setCreateOpen\(false\); setTemplateInitialValues\(undefined\); \}\}/, "the create dialog closes through one reset path");
assert.match(source, /window\.setTimeout\(\(\) => newBtnRef\.current\?\.focus\(\), 0\)/, "deletes hand focus somewhere stable instead of dropping it on <body>");

// ── 2026-07-03 audit batch C ──────────────────────────────────────────────────
// The Activity tab opens this panel for agent/response items too — those are
// records, not schedules, so the run/pause/edit mutations are reminder-only.
assert.match(source, /const isReminder = item\.kind === "reminder"/, "the detail panel derives the selected item's kind");
assert.match(source, /isReminder \? "Reminder details" : "Activity details"/, "non-reminder activity gets an honest panel heading");
assert.match(source, /\{onEdit && isReminder && \(/, "Edit only renders for reminders");
assert.match(source, /\{isRecurring && isReminder && \(/, "Stop-repeating only renders for reminders");
assert.doesNotMatch(source, /\{onEdit && !isDailySummary && \(/, "the old summary-only action gate is gone");
// Reminder run-now confirms like crons; the older Flow/All dispatch surface is
// intentionally absent from this narrowed schedule page.
assert.match(source, /This fires the reminder immediately\./, "reminder run-now is confirm-gated");
assert.doesNotMatch(source, /const toggleFlowActive = useCallback|saveFlow\(setFlowActive|setFlows\(/, "Flow pause/poll mutations are absent");
assert.match(source, /runAutomation: runCodexNow/, "cron run-now remains wired");
assert.match(source, /togglePauseAutomation: toggleCodex/, "cron pause/resume remains wired");
