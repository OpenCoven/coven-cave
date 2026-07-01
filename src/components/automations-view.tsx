"use client";

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Familiar } from "@/lib/types";
import type { InboxItem, LinkRef } from "@/lib/cave-inbox";
import type { Recurrence } from "@/lib/inbox-recurrence";
import { groupInboxFeed, inboxKindLabel } from "@/lib/inbox-feed";
import type {
  AutomationStatus,
  CodexAutomation,
  CodexAutomationPatch,
} from "@/lib/codex-automations-types";
import type { AutomationRunRecord } from "@/lib/automation-runs";
import { Icon } from "@/lib/icon";
import type { IconName } from "@/lib/icon";
import { formatTimestamp, formatClock, readDateTimePrefs, useDateTimePrefs } from "@/lib/datetime-format";
import { relativeTimeSigned } from "@/lib/relative-time";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { UndoToast } from "@/components/ui/undo-toast";
import { useUndoDelete } from "@/lib/use-undo-delete";
import { SearchInput } from "@/components/ui/search-input";
import { SelectionToolbar } from "@/components/ui/selection-toolbar";
import { Tabs, type TabItem } from "@/components/ui/tabs";
import { useMultiSelect } from "@/lib/use-multi-select";
import { CwdPickerField } from "@/components/cwd-picker-field";
import { FamiliarMultiSelect } from "@/components/automation-familiar-select";
import { SkillSelect } from "@/components/automation-skill-select";
import { FamiliarAvatar } from "@/components/familiar-avatar";
import { useResolvedFamiliars, type ResolvedFamiliar } from "@/lib/familiar-resolve";
import { automationMatchesFilter } from "@/lib/familiar-multiselect";
import { AutomationCreateDialog, type AutomationCreateInput } from "@/components/automation-create-dialog";
import { listFlows, runFlow, type FlowDoc } from "@/lib/flows";
import {
  buildAutomationEntries,
  filterEntries,
  countByType,
  flowTrigger,
  humanRecurrence,
  AUTOMATION_TYPE_META,
  type AutomationType,
  type AutomationEntry,
} from "@/lib/automations/automation-entry";
import { listInput, commaInput, parseListInput } from "@/lib/automations/list-input";
import { runStatusColor } from "@/lib/automations/run-status";

// AutomationsView — Schedules surface, redesigned June 2026
// Clean list layout matching the sleek/professional reference design:
//   • Reminders and Automations split into tabs with dedicated row/section components
//   • Minimal rows: name · workspace badge · schedule string, action icons on hover
//   • Click any row → dedicated detail panel slides in
//   • "Create via chat" CTA top-right

type Props = {
  familiars: Familiar[];
  onOpenSession?: (sessionId: string, familiarId: string | null) => void;
  onNewReminder?: () => void;
  onEdit?: (item: InboxItem) => void;
  onOpenLink?: (link: LinkRef) => void;
  /** When provided, adds a "Calendar" tab that renders this node full-height.
   *  Lets the Calendar surface live inside Automations as one schedule page
   *  without coupling this view to CalendarView's prop shape. */
  calendarSlot?: ReactNode;
  /** Tab to open on mount (deep-link target — e.g. the Calendar nav button). */
  initialTab?: AutomationTab;
};

function linkLabel(link: LinkRef): string {
  if (link.kind === "url") return link.ref;
  if (link.kind === "card") return "Card";
  if (link.kind === "session") return "Session";
  return "Memory";
}

// The Automations surface unifies three primitives under one typed model:
// reminders, crons (Codex automations), and flows — plus an Activity
// feed (the full inbox). "all" shows every automation in one list. "calendar"
// (only present when a calendarSlot is supplied) hosts the Calendar surface so
// the two former top-level pages share one schedule view.
type AutomationTab = "all" | "reminders" | "crons" | "flows" | "activity" | "calendar";

// Fire a cross-surface navigation so "Open" on a flow jumps to its
// dedicated editor surface (the Workspace owns setMode; see cave:navigate-mode).
function navigateToMode(mode: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode } }));
}

import {
  RRULE_DAY_ORDER,
  RRULE_DAY_LABEL,
  parseCodexRrule,
  buildCodexRrule,
  splitAutomationPrompt,
  composeAutomationPrompt,
} from "@/lib/codex-automation-form";

// Clock-pref-aware time formatter (12h/24h) injected into the shared
// humanRecurrence() so the schedule line honors the user's preference — one
// formatter, instead of a forked humanSchedule() that drifted from it.
function scheduleTime(hour: number, minute: number): string {
  return formatClock(new Date(2000, 0, 1, hour, minute, 0).toISOString());
}

const humanSchedule = (rec: Recurrence | undefined | null): string =>
  humanRecurrence(rec, scheduleTime);

function isScheduleInboxItem(item: InboxItem): boolean {
  return item.kind === "reminder" || item.kind === "daily-summary";
}

// A one-shot reminder still pending after its fire time never fired (e.g. the
// daemon was offline) — worth surfacing instead of a quiet "3h ago".
function isReminderOverdue(item: InboxItem): boolean {
  return (
    item.kind !== "daily-summary" &&
    (item.recurrence?.type ?? "none") === "none" &&
    item.status === "pending" &&
    !!item.fireAt &&
    new Date(item.fireAt).getTime() < Date.now()
  );
}

function relTime(iso: string | undefined | null): string {
  if (!iso) return "—";
  return relativeTimeSigned(iso);
}


function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <label className="mb-1 block text-[10px] font-semibold uppercase tracking-widest"
      style={{ color: "var(--text-muted)" }}>
      {children}
    </label>
  );
}

const automationFieldBaseClass =
  "w-full rounded-md border bg-[var(--bg-base)] text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--border-strong)]";
const automationInputClass = `${automationFieldBaseClass} h-8 px-2 text-[12px]`;
const automationSelectClass = `${automationFieldBaseClass} h-8 px-2 text-[12px]`;
const automationTextareaClass = `${automationFieldBaseClass} resize-y px-2 py-2 text-[12px] leading-relaxed`;
const automationMonoTextareaClass = `${automationTextareaClass} font-mono text-[11px]`;

const fieldStyle = {
  borderColor: "var(--border-hairline)",
} as const;

// ── Status icon ──────────────────────────────────────────────────────────────
function StatusIcon({ item }: { item: InboxItem }) {
  const paused = item.status === "dismissed" && item.recurrence?.type !== "none";
  const active = item.status === "pending" || item.status === "fired";
  const hasRun = !!item.firedAt;

  if (paused) {
    // Pause icon — two vertical bars inside circle
    return (
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border"
        style={{ borderColor: "rgba(255,255,255,0.18)", color: "rgba(255,255,255,0.35)" }}>
        <Icon name="ph:minus" width={8} />
      </span>
    );
  }
  if (active && hasRun) {
    // Filled purple circle — has fired before
    return (
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full"
        style={{ background: "var(--accent-presence)" }} />
    );
  }
  // Hollow circle — active, never fired yet
  return (
    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border"
      style={{ borderColor: "rgba(255,255,255,0.28)" }} />
  );
}

// ── Detail panel (slides in on row click) ────────────────────────────────────
function DetailPanel({
  item,
  familiarLabel,
  busyId,
  onClose,
  runNow,
  togglePaused,
  stopRecurrence,
  removeItem,
  onEdit,
  onOpenLink,
}: {
  item: InboxItem;
  familiarLabel: (fid?: string | null) => string | null;
  busyId: string | null;
  onClose: () => void;
  runNow: (id: string) => void;
  togglePaused: (item: InboxItem) => void;
  stopRecurrence: (id: string) => void;
  removeItem: (id: string) => void;
  onEdit?: (item: InboxItem) => void;
  onOpenLink?: (link: LinkRef) => void;
}) {
  const paused = item.status === "dismissed" && item.recurrence?.type !== "none";
  const isRecurring = item.recurrence && item.recurrence.type !== "none";
  const isDailySummary = item.kind === "daily-summary";
  const busy = busyId === item.id;

  return (
    <div className="flex h-full flex-col"
      style={{ background: "var(--bg-raised)", borderLeft: "1px solid var(--border-hairline)" }}>
      {/* Header */}
      <div className="flex items-center justify-between border-b px-5 py-3"
        style={{ borderColor: "var(--border-hairline)" }}>
        <h2 className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>
          {isDailySummary ? "Daily summary details" : "Reminder details"}
        </h2>
        <button type="button" onClick={onClose} aria-label="Close"
          className="focus-ring rounded p-1 transition-colors hover:bg-white/5"
          style={{ color: "var(--text-muted)" }}>
          <Icon name="ph:x" width={14} aria-hidden />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest"
            style={{ color: "var(--text-muted)" }}>Name</p>
          <p className="text-[14px] font-medium" style={{ color: "var(--text-primary)" }}>
            {item.title}
          </p>
        </div>

        {item.body && (
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest"
              style={{ color: "var(--text-muted)" }}>Description</p>
            <p className="text-[12px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>
              {item.body}
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4">
          {!isDailySummary && (
            <div>
              <FieldLabel>Schedule</FieldLabel>
              <p className="text-[12px]" style={{ color: "var(--text-primary)" }}>
                {humanSchedule(item.recurrence)}
              </p>
            </div>
          )}
          <div>
            <FieldLabel>Status</FieldLabel>
            <p className="text-[12px] capitalize" style={{ color: paused ? "var(--text-muted)" : "var(--text-primary)" }}>
              {paused ? "Paused" : item.status}
            </p>
          </div>
          {!isDailySummary && (
            <div>
              <FieldLabel>Next run</FieldLabel>
              <p
                className="text-[12px]"
                style={{ color: "var(--text-primary)" }}
                title={item.fireAt ? formatTimestamp(item.fireAt, readDateTimePrefs()) : undefined}
              >
                {relTime(item.fireAt)}
              </p>
            </div>
          )}
          <div>
            <FieldLabel>{isDailySummary ? "Sent" : "Last run"}</FieldLabel>
            <p
              className="text-[12px]"
              style={{ color: item.firedAt ? "oklch(0.75 0.1 150)" : "var(--text-muted)" }}
              title={item.firedAt ? formatTimestamp(item.firedAt, readDateTimePrefs()) : undefined}
            >
              {item.firedAt ? relTime(item.firedAt) : "Never"}
            </p>
          </div>
        </div>

        {familiarLabel(item.familiarId) && (
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest"
              style={{ color: "var(--text-muted)" }}>Familiar</p>
            <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px]"
              style={{ background: "var(--bg-base)", border: "1px solid var(--border-hairline)", color: "var(--text-secondary)" }}>
              {familiarLabel(item.familiarId)}
            </span>
          </div>
        )}

        {item.link && (
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest"
              style={{ color: "var(--text-muted)" }}>Link</p>
            <button
              type="button"
              onClick={() => item.link && onOpenLink?.(item.link)}
              className="focus-ring inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] transition-colors hover:bg-white/5"
              style={{ background: "var(--bg-base)", border: "1px solid var(--border-hairline)", color: "var(--text-secondary)" }}
            >
              <Icon name="ph:link" width={12} className="shrink-0" />
              <span className="truncate">{linkLabel(item.link)}</span>
            </button>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="border-t px-5 py-4 space-y-2"
        style={{ borderColor: "var(--border-hairline)" }}>
        {onEdit && !isDailySummary && (
          <button type="button" disabled={busy} onClick={() => onEdit(item)}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border py-2 text-[12px] font-medium transition-colors hover:bg-white/5 disabled:opacity-40"
            style={{ borderColor: "var(--border-hairline)", color: "var(--text-secondary)" }}>
            <Icon name="ph:pencil-simple" width={13} />
            Edit
          </button>
        )}
        {!isDailySummary && (
          <>
            <button type="button" disabled={busy || paused} onClick={() => runNow(item.id)}
              className="w-full rounded-lg py-2 text-[12px] font-medium text-white transition-colors disabled:opacity-40"
              style={{ background: "var(--accent-presence)" }}>
              Run now
            </button>
            <button type="button" disabled={busy} onClick={() => togglePaused(item)}
              className="w-full rounded-lg border py-2 text-[12px] font-medium transition-colors hover:bg-white/5 disabled:opacity-40"
              style={{ borderColor: "var(--border-hairline)", color: "var(--text-secondary)" }}>
              {paused ? "Resume" : "Pause"}
            </button>
          </>
        )}
        {isRecurring && !isDailySummary && (
          <button type="button" disabled={busy} onClick={() => stopRecurrence(item.id)}
            className="w-full rounded-lg border py-2 text-[12px] font-medium transition-colors hover:bg-white/5 disabled:opacity-40"
            style={{ borderColor: "var(--border-hairline)", color: "var(--text-secondary)" }}>
            Stop repeating
          </button>
        )}
        <button type="button" disabled={busy} onClick={() => removeItem(item.id)}
          className="w-full rounded-lg py-2 text-[12px] font-medium transition-colors hover:bg-red-900/20 disabled:opacity-40"
          style={{ color: "oklch(0.65 0.18 20)" }}>
          Delete
        </button>
      </div>
    </div>
  );
}

// Row quick-actions (run-now, pause/resume) are wired once at the top of the
// view and read by each leaf row — so the most-used actions are one hover away
// instead of buried in the detail panel. Avoids threading callbacks through the
// list/section components.
type ScheduleActions = {
  runReminder: (id: string) => void;
  togglePauseReminder: (item: InboxItem) => void;
  runAutomation: (auto: CodexAutomation) => void;
  togglePauseAutomation: (auto: CodexAutomation) => void;
};
const ScheduleActionsContext = createContext<ScheduleActions | null>(null);

function RowActionButton({ icon, label, onClick }: { icon: IconName; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="focus-ring grid h-6 w-6 place-items-center rounded text-[var(--text-muted)] transition-colors hover:bg-white/10 hover:text-[var(--text-primary)]"
    >
      <Icon name={icon} width={12} />
    </button>
  );
}

// Hover/focus-revealed action cluster pinned to the right of a schedule row.
// Hidden rows keep `pointer-events:none` so a non-hover click still opens the
// row's detail panel rather than landing on an invisible action.
function RowActions({ children }: { children: ReactNode }) {
  return (
    <div
      className="pointer-events-none absolute right-1.5 top-1/2 z-10 flex -translate-y-1/2 items-center gap-0.5 rounded-md border border-[var(--border-hairline)] px-0.5 py-0.5 opacity-0 transition-opacity group-hover/srow:pointer-events-auto group-hover/srow:opacity-100 group-focus-within/srow:pointer-events-auto group-focus-within/srow:opacity-100 motion-reduce:transition-none"
      style={{ background: "var(--bg-elevated)" }}
    >
      {children}
    </div>
  );
}

function ReminderTaskRow({
  item,
  selected,
  selectMode,
  checked,
  familiarLabel,
  onSelect,
  onToggle,
}: {
  item: InboxItem;
  selected: boolean;
  selectMode: boolean;
  checked: boolean;
  familiarLabel: (fid?: string | null) => string | null;
  onSelect: (item: InboxItem) => void;
  onToggle: (id: string) => void;
}) {
  const workspace = familiarLabel(item.familiarId);
  const isOverdue = isReminderOverdue(item);
  const schedule = item.kind === "daily-summary"
    ? "Daily summary"
    : item.recurrence?.type !== "none"
    ? humanSchedule(item.recurrence)
    : isOverdue
    ? "Overdue"
    : item.fireAt
    ? relTime(item.fireAt)
    : "Paused";

  // In select mode the row IS a checkbox (click/Enter/Space toggle); otherwise
  // it opens the detail panel. The active-row highlight tracks `checked` while
  // selecting, and the detail-panel `selected` highlight otherwise.
  const active = selectMode ? checked : selected;
  const activate = () => (selectMode ? onToggle(item.id) : onSelect(item));
  const actions = useContext(ScheduleActionsContext);
  const paused = item.status === "dismissed";
  // Run-now / pause make sense for actual reminders, not daily summaries, and
  // never while picking rows in select mode.
  const showActions = !selectMode && item.kind !== "daily-summary" && !!actions;

  return (
    <li className="group/srow relative">
      <button
        type="button"
        role={selectMode ? "checkbox" : undefined}
        aria-checked={selectMode ? checked : undefined}
        onClick={activate}
        className="focus-ring-inset automation-list-row group flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors"
        style={{
          background: active ? "rgba(255,255,255,0.05)" : "transparent",
        }}
        onMouseEnter={(e) => {
          if (!active) (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.03)";
        }}
        onMouseLeave={(e) => {
          if (!active) (e.currentTarget as HTMLButtonElement).style.background = "transparent";
        }}
      >
        {selectMode ? (
          <span
            aria-hidden
            className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border transition-colors"
            style={{
              borderColor: checked ? "var(--accent-presence)" : "var(--border-strong)",
              background: checked ? "var(--accent-presence)" : "transparent",
            }}
          >
            {checked && <Icon name="ph:check-bold" width={12} className="text-white" />}
          </span>
        ) : (
          <StatusIcon item={item} />
        )}
        <span className="flex-1 min-w-0 flex items-baseline gap-2">
          <span className="text-[13px] truncate" style={{ color: "var(--text-primary)" }}>
            {item.title}
          </span>
          {workspace && (
            <span className="shrink-0 text-[11px]" style={{ color: "var(--text-muted)" }}>
              {workspace}
            </span>
          )}
        </span>
        <span className="shrink-0 text-[12px] tabular-nums" style={{ color: isOverdue ? "var(--color-warning)" : "var(--text-muted)" }}>
          {schedule}
        </span>
      </button>
      {showActions && actions && (
        <RowActions>
          {!paused && (
            <RowActionButton icon="ph:lightning-bold" label={`Run ${item.title} now`} onClick={() => actions.runReminder(item.id)} />
          )}
          <RowActionButton
            icon={paused ? "ph:play-fill" : "ph:pause-fill"}
            label={`${paused ? "Resume" : "Pause"} ${item.title}`}
            onClick={() => actions.togglePauseReminder(item)}
          />
        </RowActions>
      )}
    </li>
  );
}

function ReminderTaskSection({
  title,
  items,
  selectedId,
  selectMode,
  isSelected,
  familiarLabel,
  onSelect,
  onToggle,
}: {
  title: string;
  items: InboxItem[];
  selectedId: string | null;
  selectMode: boolean;
  isSelected: (id: string) => boolean;
  familiarLabel: (fid?: string | null) => string | null;
  onSelect: (item: InboxItem) => void;
  onToggle: (id: string) => void;
}) {
  if (items.length === 0) return null;
  const overdueCount = items.filter(isReminderOverdue).length;
  return (
    <div className="mb-6">
      <div className="flex items-center gap-3 mb-1 rounded-md px-3 py-1.5"
        style={{ background: "color-mix(in oklch, var(--bg-base) 86%, var(--foreground) 14%)", borderBottom: "1px solid var(--border-hairline)" }}>
        <span className="text-[12px] font-bold" style={{ color: "var(--text-primary)" }}>
          {title}
        </span>
        {overdueCount > 0 && (
          <span
            className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
            style={{ background: "color-mix(in oklch, var(--color-warning) 18%, transparent)", color: "var(--color-warning)" }}
          >
            {overdueCount} overdue
          </span>
        )}
      </div>
      <ul>
        {items.map((item) => (
          <ReminderTaskRow
            key={item.id}
            item={item}
            selected={selectedId === item.id}
            selectMode={selectMode}
            checked={isSelected(item.id)}
            familiarLabel={familiarLabel}
            onSelect={onSelect}
            onToggle={onToggle}
          />
        ))}
      </ul>
    </div>
  );
}

function ReminderTaskList({
  current,
  paused,
  oneShots,
  history,
  selectedId,
  selectMode,
  isSelected,
  familiarLabel,
  onSelect,
  onToggle,
}: {
  current: InboxItem[];
  paused: InboxItem[];
  oneShots: InboxItem[];
  history: InboxItem[];
  selectedId: string | null;
  selectMode: boolean;
  isSelected: (id: string) => boolean;
  familiarLabel: (fid?: string | null) => string | null;
  onSelect: (item: InboxItem) => void;
  onToggle: (id: string) => void;
}) {
  const shared = { selectedId, selectMode, isSelected, familiarLabel, onSelect, onToggle };
  return (
    <>
      <ReminderTaskSection title="Repeating" items={current} {...shared} />
      <ReminderTaskSection title="Paused" items={paused} {...shared} />
      <ReminderTaskSection title="One-time" items={oneShots} {...shared} />
      {history.length > 0 && (
        <ReminderTaskSection title="History" items={history} {...shared} />
      )}
    </>
  );
}

// ── Codex automation detail panel ────────────────────────────────────────────
function CodexDetailPanel({
  auto,
  busy,
  onClose,
  onToggle,
  onSave,
  onDelete,
  onRun,
  runs,
}: {
  auto: CodexAutomation;
  busy: boolean;
  onClose: () => void;
  onToggle: (auto: CodexAutomation) => void;
  onSave: (auto: CodexAutomation, patch: CodexAutomationPatch) => void;
  onDelete: (auto: CodexAutomation) => void;
  onRun: (auto: CodexAutomation) => void;
  runs: AutomationRunRecord[];
}) {
  const isActive = auto.status === "ACTIVE";
  const parsedSchedule = useMemo(() => parseCodexRrule(auto.rrule), [auto.rrule]);
  const promptParts = splitAutomationPrompt(auto.prompt);
  const [openRunId, setOpenRunId] = useState<string | null>(null);
  const [runLog, setRunLog] = useState<string>("");
  const [runLogLoading, setRunLogLoading] = useState(false);
  const toggleRunLog = async (runId: string) => {
    if (openRunId === runId) { setOpenRunId(null); return; }
    setOpenRunId(runId);
    setRunLog("");
    setRunLogLoading(true);
    try {
      const res = await fetch(`/api/codex-automations/${encodeURIComponent(auto.id)}/runs/${encodeURIComponent(runId)}/log`, { cache: "no-store" });
      const json = await res.json().catch(() => null);
      setRunLog(json?.ok ? (json.truncated ? "…(truncated)…\n" : "") + (json.log ?? "") : (json?.error ?? "no log"));
    } catch {
      setRunLog("failed to load log");
    } finally {
      setRunLogLoading(false);
    }
  };
  const [name, setName] = useState(auto.name);
  const [goals, setGoals] = useState(promptParts.goals);
  const [deliverables, setDeliverables] = useState(promptParts.deliverables);
  const [model, setModel] = useState(auto.model ?? "");
  const [reasoningEffort, setReasoningEffort] = useState(auto.reasoningEffort ?? "medium");
  const [executionEnvironment, setExecutionEnvironment] = useState(auto.executionEnvironment ?? "worktree");
  const [tagsText, setTagsText] = useState(commaInput(auto.tags));
  const [cwdsText, setCwdsText] = useState(listInput(auto.cwds));
  const [skillPath, setSkillPath] = useState(auto.skillPath ?? "");
  const [scheduleMode, setScheduleMode] = useState<"daily" | "weekly" | "raw">(parsedSchedule.mode);
  const [scheduleTime, setScheduleTime] = useState(parsedSchedule.time);
  const [scheduleDays, setScheduleDays] = useState(parsedSchedule.days);
  const [rawRrule, setRawRrule] = useState(parsedSchedule.raw);

  useEffect(() => {
    const nextSchedule = parseCodexRrule(auto.rrule);
    const nextPromptParts = splitAutomationPrompt(auto.prompt);
    setName(auto.name);
    setGoals(nextPromptParts.goals);
    setDeliverables(nextPromptParts.deliverables);
    setModel(auto.model ?? "");
    setReasoningEffort(auto.reasoningEffort ?? "medium");
    setExecutionEnvironment(auto.executionEnvironment ?? "worktree");
    setTagsText(commaInput(auto.tags));
    setCwdsText(listInput(auto.cwds));
    setSkillPath(auto.skillPath ?? "");
    setScheduleMode(nextSchedule.mode);
    setScheduleTime(nextSchedule.time);
    setScheduleDays(nextSchedule.days);
    setRawRrule(nextSchedule.raw);
  }, [auto]);

  const nextRrule = buildCodexRrule(scheduleMode, scheduleTime, scheduleDays, rawRrule);
  const tags = parseListInput(tagsText);
  const cwds = parseListInput(cwdsText);
  const promptDirty = goals !== promptParts.goals || deliverables !== promptParts.deliverables;
  const nextPrompt = promptDirty
    ? composeAutomationPrompt(goals, deliverables, promptParts.hasStructuredSections || deliverables.trim().length > 0)
    : auto.prompt;
  const invalidSchedule =
    !nextRrule.startsWith("RRULE:") || (scheduleMode === "weekly" && scheduleDays.length === 0);
  const dirty =
    name !== auto.name ||
    promptDirty ||
    model !== (auto.model ?? "") ||
    reasoningEffort !== (auto.reasoningEffort ?? "medium") ||
    executionEnvironment !== (auto.executionEnvironment ?? "worktree") ||
    tagsText !== commaInput(auto.tags) ||
    cwdsText !== listInput(auto.cwds) ||
    skillPath.trim() !== (auto.skillPath ?? "") ||
    nextRrule !== (auto.rrule ?? "");
  const canSave = !busy && dirty && name.trim().length > 0 && !invalidSchedule;

  // When Save is disabled because the form is invalid (not merely unchanged),
  // explain why instead of leaving the user with a dead button.
  const saveBlockedReason =
    name.trim().length === 0
      ? "Give the automation a name."
      : scheduleMode === "weekly" && scheduleDays.length === 0
        ? "Pick at least one day for a weekly schedule."
        : !nextRrule.startsWith("RRULE:")
          ? "Enter a valid schedule."
          : null;

  const toggleDay = (day: string) => {
    setScheduleDays((prev) =>
      prev.includes(day) ? prev.filter((item) => item !== day) : [...prev, day],
    );
  };

  const save = () => {
    if (!canSave) return;
    onSave(auto, {
      name: name.trim(),
      prompt: nextPrompt,
      rrule: nextRrule,
      model: model.trim(),
      reasoning_effort: reasoningEffort,
      execution_environment: executionEnvironment,
      tags,
      cwds,
      // Send "" (not undefined) so selecting "— none —" actually clears the skill.
      skill_path: skillPath.trim(),
    });
  };

  return (
    <div className="flex h-full flex-col"
      style={{ background: "var(--bg-raised)", borderLeft: "1px solid var(--border-hairline)" }}>
      {/* Header */}
      <div className="flex items-center justify-between border-b px-5 py-3"
        style={{ borderColor: "var(--border-hairline)" }}>
        <h2 className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>
          Automation details
        </h2>
        <button type="button" onClick={onClose} aria-label="Close"
          className="focus-ring rounded p-1 transition-colors hover:bg-white/5"
          style={{ color: "var(--text-muted)" }}>
          <Icon name="ph:x" width={14} aria-hidden />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
        <div>
          <FieldLabel>Name</FieldLabel>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className={automationInputClass}
            style={fieldStyle}
          />
        </div>

        <div>
          <FieldLabel>Goals</FieldLabel>
          <textarea
            value={goals}
            onChange={(event) => setGoals(event.target.value)}
            rows={6}
            className={automationTextareaClass}
            style={fieldStyle}
          />
        </div>

        <div>
          <FieldLabel>Deliverables</FieldLabel>
          <textarea
            value={deliverables}
            onChange={(event) => setDeliverables(event.target.value)}
            rows={5}
            className={automationTextareaClass}
            style={fieldStyle}
          />
        </div>

        <div>
          <FieldLabel>Schedule</FieldLabel>
          <div className="mb-2 inline-flex rounded-md border p-0.5"
            style={{ borderColor: "var(--border-hairline)", background: "var(--bg-base)" }}>
            {(["weekly", "daily", "raw"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setScheduleMode(mode)}
                className="rounded px-2 py-1 text-[11px] capitalize transition-colors"
                style={{
                  background: scheduleMode === mode ? "rgba(255,255,255,0.08)" : "transparent",
                  color: scheduleMode === mode ? "var(--text-primary)" : "var(--text-muted)",
                }}
              >
                {mode}
              </button>
            ))}
          </div>

          {scheduleMode === "raw" ? (
            <textarea
              value={rawRrule}
              onChange={(event) => setRawRrule(event.target.value)}
              rows={3}
              className={automationMonoTextareaClass}
              style={fieldStyle}
            />
          ) : (
            <div className="space-y-3">
              {scheduleMode === "weekly" && (
                <div className="flex flex-wrap gap-1.5">
                  {RRULE_DAY_ORDER.map((day) => {
                    const selected = scheduleDays.includes(day);
                    return (
                      <button
                        key={day}
                        type="button"
                        onClick={() => toggleDay(day)}
                        className="rounded-md border px-2 py-1 text-[11px] transition-colors"
                        style={{
                          background: selected ? "color-mix(in oklch, var(--accent-presence) 18%, transparent)" : "var(--bg-base)",
                          borderColor: selected ? "color-mix(in oklch, var(--accent-presence) 50%, transparent)" : "var(--border-hairline)",
                          color: selected ? "var(--text-primary)" : "var(--text-muted)",
                        }}
                      >
                        {RRULE_DAY_LABEL[day]}
                      </button>
                    );
                  })}
                </div>
              )}
              <input
                type="time"
                value={scheduleTime}
                onChange={(event) => setScheduleTime(event.target.value)}
                className={automationInputClass}
                style={fieldStyle}
              />
            </div>
          )}
          <p className="mt-2 break-all font-mono text-[10px]" style={{ color: invalidSchedule ? "oklch(0.7 0.16 35)" : "var(--text-muted)" }}>
            {nextRrule || "RRULE required"}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4">
          <div>
            <FieldLabel>Status</FieldLabel>
            <p className="text-[12px]" style={{ color: isActive ? "oklch(0.75 0.1 150)" : "var(--text-muted)" }}>
              {isActive ? "Active" : "Paused"}
            </p>
          </div>
          <div>
            <FieldLabel>Model</FieldLabel>
            <input
              value={model}
              onChange={(event) => setModel(event.target.value)}
              className={automationInputClass}
              style={fieldStyle}
            />
          </div>
          <div>
            <FieldLabel>Reasoning</FieldLabel>
            <select
              value={reasoningEffort}
              onChange={(event) => setReasoningEffort(event.target.value)}
              className={automationSelectClass}
              style={fieldStyle}
            >
              {!["low", "medium", "high"].includes(reasoningEffort) && (
                <option value={reasoningEffort}>{reasoningEffort}</option>
              )}
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
            </select>
          </div>
          <div>
            <FieldLabel>Environment</FieldLabel>
            <select
              value={executionEnvironment}
              onChange={(event) => setExecutionEnvironment(event.target.value)}
              className={automationSelectClass}
              style={fieldStyle}
            >
              {!["worktree", "repo"].includes(executionEnvironment) && (
                <option value={executionEnvironment}>{executionEnvironment}</option>
              )}
              <option value="worktree">worktree</option>
              <option value="repo">repo</option>
            </select>
          </div>
          <div>
            <FieldLabel>Working directories</FieldLabel>
            <CwdPickerField
              value={cwdsText}
              onChange={setCwdsText}
              familiarId={auto.familiars[0] ?? ""}
              textareaClass={automationMonoTextareaClass}
              fieldStyle={fieldStyle}
            />
          </div>

          <div>
            <FieldLabel>Tags</FieldLabel>
            <input
              value={tagsText}
              onChange={(event) => setTagsText(event.target.value)}
              className={automationInputClass}
              style={fieldStyle}
            />
          </div>
          <div>
            <FieldLabel>Skill</FieldLabel>
            <SkillSelect value={skillPath || null} onChange={(p) => setSkillPath(p ?? "")} className={automationSelectClass} />
          </div>
        </div>

        {runs.length > 0 && (
          <div>
            <FieldLabel>Recent runs</FieldLabel>
            <ul className="mt-1 space-y-1">
              {runs.slice(0, 10).map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => void toggleRunLog(r.id)}
                    aria-expanded={openRunId === r.id}
                    aria-controls={`automation-run-log-${r.id}`}
                    aria-label={`${r.status} run ${relTime(r.startedAt)}${r.summary ? ` — ${r.summary}` : ""}, ${openRunId === r.id ? "hide" : "show"} log`}
                    className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-[12px] hover:bg-white/5"
                  >
                    <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: runStatusColor(r.status) }} />
                    <span style={{ color: "var(--text-secondary)" }} title={r.startedAt ? formatTimestamp(r.startedAt, readDateTimePrefs()) : undefined}>{relTime(r.startedAt)}</span>
                    {r.summary && <span className="truncate" style={{ color: "var(--text-muted)" }}>{r.summary}</span>}
                    <span aria-hidden className="ml-auto shrink-0" style={{ color: "var(--text-muted)", lineHeight: 0 }}>
                      <Icon name={openRunId === r.id ? "ph:caret-down" : "ph:caret-right"} width={11} />
                    </span>
                  </button>
                  {openRunId === r.id && (
                    <pre
                      id={`automation-run-log-${r.id}`}
                      className="mt-1 max-h-48 overflow-auto rounded bg-[var(--bg-base)] p-2 text-[10px] leading-snug"
                      style={{ color: "var(--text-muted)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}
                    >
                      {runLogLoading ? "Loading…" : (runLog || "(empty log)")}
                    </pre>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="border-t px-5 py-4 space-y-2"
        style={{ borderColor: "var(--border-hairline)" }}>
        <button type="button" disabled={busy} onClick={() => onRun(auto)}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-medium hover:bg-white/5 disabled:opacity-50">
          <Icon name="ph:play" width={13} /> Run now
        </button>
        {saveBlockedReason ? (
          <p className="text-[11px]" style={{ color: "oklch(0.7 0.16 35)" }} role="alert">
            {saveBlockedReason}
          </p>
        ) : null}
        <button
          type="button"
          disabled={!canSave}
          onClick={save}
          className="w-full rounded-lg py-2 text-[12px] font-medium text-white transition-colors disabled:opacity-40"
          style={{ background: "var(--accent-presence)" }}
        >
          {busy ? "Saving..." : "Save changes"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onToggle(auto)}
          className="w-full rounded-lg py-2 text-[12px] font-medium text-white transition-colors disabled:opacity-40"
          style={{ background: isActive ? "oklch(0.45 0.12 20)" : "var(--accent-presence)" }}
        >
          {busy ? (isActive ? "Pausing…" : "Activating…") : (isActive ? "Pause" : "Activate")}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onDelete(auto)}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-medium text-[var(--color-danger)] hover:bg-[color-mix(in_oklch,var(--color-danger)_12%,transparent)] disabled:opacity-50"
        >
          <Icon name="ph:trash" width={13} /> Delete
        </button>
      </div>
    </div>
  );
}

function AutomationScheduleRow({
  auto,
  selected,
  familiarsById,
  lastRun,
  onSelect,
}: {
  auto: CodexAutomation;
  selected: boolean;
  familiarsById: Map<string, ResolvedFamiliar>;
  lastRun?: AutomationRunRecord;
  onSelect: (auto: CodexAutomation) => void;
}) {
  const isActive = auto.status === "ACTIVE";
  const actions = useContext(ScheduleActionsContext);
  return (
    <li className="group/srow relative">
      <button
        type="button"
        onClick={() => onSelect(auto)}
        aria-current={selected ? "true" : undefined}
        className={`focus-ring-inset automation-list-row group flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors ${selected ? "bg-white/5" : "hover:bg-white/5"}`}
      >
        {/* Status dot */}
        {isActive ? (
          <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full"
            style={{ background: "var(--accent-presence)" }} />
        ) : (
          <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border"
            style={{ borderColor: "rgba(255,255,255,0.18)", color: "rgba(255,255,255,0.35)" }}>
            <Icon name="ph:minus" width={8} />
          </span>
        )}
        <span className="flex-1 min-w-0 flex items-baseline gap-2">
          <span className="text-[13px] truncate" style={{ color: "var(--text-primary)" }}>
            {auto.name}
          </span>
          {auto.tags.includes("coven") && (
            <span className="shrink-0 text-[11px]" style={{ color: "var(--text-muted)" }}>coven</span>
          )}
        </span>
        {auto.familiars.length > 0 && (
          <span className="flex shrink-0 -space-x-1.5">
            {auto.familiars.slice(0, 3).map((fid) => {
              const f = familiarsById.get(fid);
              return f ? (
                <FamiliarAvatar key={fid} familiar={f} size="sm" title={f.display_name} className="rounded-full ring-1 ring-[var(--bg-base)]" />
              ) : null;
            })}
            {auto.familiars.length > 3 && (
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[var(--bg-raised)] text-[9px] text-[var(--text-muted)] ring-1 ring-[var(--bg-base)]">
                +{auto.familiars.length - 3}
              </span>
            )}
          </span>
        )}
        {lastRun && (
          <span className="shrink-0 text-[11px]" title={lastRun.startedAt ? formatTimestamp(lastRun.startedAt, readDateTimePrefs()) : undefined} style={{ color: runStatusColor(lastRun.status, { quietSuccess: true }) }}>
            Run {relTime(lastRun.startedAt)}
          </span>
        )}
        <span className="shrink-0 text-[12px] tabular-nums" style={{ color: "var(--text-muted)" }}>
          {auto.scheduleHuman}
        </span>
      </button>
      {actions && (
        <RowActions>
          <RowActionButton icon="ph:lightning-bold" label={`Run ${auto.name} now`} onClick={() => actions.runAutomation(auto)} />
          <RowActionButton
            icon={isActive ? "ph:pause-fill" : "ph:play-fill"}
            label={`${isActive ? "Pause" : "Activate"} ${auto.name}`}
            onClick={() => actions.togglePauseAutomation(auto)}
          />
        </RowActions>
      )}
    </li>
  );
}

function AutomationScheduleSection({
  title,
  items,
  selectedId,
  familiarsById,
  lastRunById,
  onSelect,
}: {
  title: string;
  items: CodexAutomation[];
  selectedId: string | null;
  familiarsById: Map<string, ResolvedFamiliar>;
  lastRunById: Map<string, AutomationRunRecord>;
  onSelect: (auto: CodexAutomation) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="mb-6">
      <div className="flex items-center gap-3 mb-1 rounded-md px-3 py-1.5"
        style={{ background: "color-mix(in oklch, var(--bg-base) 86%, var(--foreground) 14%)", borderBottom: "1px solid var(--border-hairline)" }}>
        <span className="text-[12px] font-bold" style={{ color: "var(--text-primary)" }}>
          {title}
        </span>
        <span className="text-[10px] px-1.5 py-0.5 rounded"
          style={{ background: "var(--bg-raised)", color: "var(--text-muted)" }}>
          Codex
        </span>
      </div>
      <ul>
        {items.map((auto) => (
          <AutomationScheduleRow
            key={auto.id}
            auto={auto}
            selected={selectedId === auto.id}
            familiarsById={familiarsById}
            lastRun={lastRunById.get(auto.id)}
            onSelect={onSelect}
          />
        ))}
      </ul>
    </div>
  );
}

function AutomationsPanel({
  active,
  paused,
  selectedId,
  familiarsById,
  lastRunById,
  onSelect,
}: {
  active: CodexAutomation[];
  paused: CodexAutomation[];
  selectedId: string | null;
  familiarsById: Map<string, ResolvedFamiliar>;
  lastRunById: Map<string, AutomationRunRecord>;
  onSelect: (auto: CodexAutomation) => void;
}) {
  return (
    <>
      <AutomationScheduleSection title="Active" items={active}
        selectedId={selectedId}
        familiarsById={familiarsById}
        lastRunById={lastRunById}
        onSelect={onSelect} />
      <AutomationScheduleSection title="Paused" items={paused}
        selectedId={selectedId}
        familiarsById={familiarsById}
        lastRunById={lastRunById}
        onSelect={onSelect} />
    </>
  );
}

// ── Inbox feed (full inbox: reminders, summaries, agent + response items) ─────
function InboxKindBadge({ kind }: { kind: InboxItem["kind"] }) {
  return (
    <span
      className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
      style={{ background: "var(--bg-base)", border: "1px solid var(--border-hairline)", color: "var(--text-muted)" }}
    >
      {inboxKindLabel(kind)}
    </span>
  );
}

function InboxFeedRow({
  item,
  selected,
  familiarLabel,
  onSelect,
}: {
  item: InboxItem;
  selected: boolean;
  familiarLabel: (fid?: string | null) => string | null;
  onSelect: (item: InboxItem) => void;
}) {
  const workspace = familiarLabel(item.familiarId);
  const when = item.firedAt
    ? `fired ${relTime(item.firedAt)}`
    : item.fireAt
    ? relTime(item.fireAt)
    : relTime(item.updatedAt);

  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(item)}
        aria-current={selected ? "true" : undefined}
        className={`focus-ring-inset automation-list-row group flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors ${selected ? "bg-white/5" : "hover:bg-white/5"}`}
      >
        <StatusIcon item={item} />
        <span className="flex-1 min-w-0 flex items-center gap-2">
          <span className="text-[13px] truncate" style={{ color: "var(--text-primary)" }}>
            {item.title}
          </span>
          <InboxKindBadge kind={item.kind} />
          {workspace && (
            <span className="shrink-0 text-[11px]" style={{ color: "var(--text-muted)" }}>
              {workspace}
            </span>
          )}
        </span>
        <span className="shrink-0 text-[12px] tabular-nums" style={{ color: "var(--text-muted)" }}>
          {when}
        </span>
      </button>
    </li>
  );
}

function InboxFeedSection({
  title,
  accent,
  items,
  selectedId,
  familiarLabel,
  onSelect,
}: {
  title: string;
  accent?: boolean;
  items: InboxItem[];
  selectedId: string | null;
  familiarLabel: (fid?: string | null) => string | null;
  onSelect: (item: InboxItem) => void;
}) {
  const headingId = useId();
  if (items.length === 0) return null;
  return (
    <section className="mb-6" aria-labelledby={headingId}>
      <div className="flex items-center gap-3 mb-1 rounded-md px-3 py-1.5"
        style={{ background: "color-mix(in oklch, var(--bg-base) 86%, var(--foreground) 14%)", borderBottom: "1px solid var(--border-hairline)" }}>
        <h3 id={headingId} className="text-[12px] font-bold" style={{ color: "var(--text-primary)" }}>
          {title}
        </h3>
        <span
          className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
          style={
            accent
              ? { background: "color-mix(in oklch, var(--color-warning) 18%, transparent)", color: "var(--color-warning)" }
              : { background: "var(--bg-raised)", color: "var(--text-muted)" }
          }
        >
          {items.length}
        </span>
      </div>
      <ul aria-labelledby={headingId}>
        {items.map((item) => (
          <InboxFeedRow
            key={item.id}
            item={item}
            selected={selectedId === item.id}
            familiarLabel={familiarLabel}
            onSelect={onSelect}
          />
        ))}
      </ul>
    </section>
  );
}

function InboxFeedList({
  needsYou,
  active,
  resolved,
  selectedId,
  familiarLabel,
  onSelect,
}: {
  needsYou: InboxItem[];
  active: InboxItem[];
  resolved: InboxItem[];
  selectedId: string | null;
  familiarLabel: (fid?: string | null) => string | null;
  onSelect: (item: InboxItem) => void;
}) {
  return (
    <>
      <InboxFeedSection title="Needs you" accent items={needsYou} selectedId={selectedId}
        familiarLabel={familiarLabel} onSelect={onSelect} />
      <InboxFeedSection title="Active" items={active} selectedId={selectedId}
        familiarLabel={familiarLabel} onSelect={onSelect} />
      <InboxFeedSection title="Resolved" items={resolved} selectedId={selectedId}
        familiarLabel={familiarLabel} onSelect={onSelect} />
    </>
  );
}

// ── Typed "New" menu item ───────────────────────────────────────────────────
function NewMenuItem({
  icon,
  accent,
  label,
  blurb,
  disabled,
  onClick,
}: {
  icon: string;
  accent: string;
  label: string;
  blurb: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className="flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors hover:bg-white/5 disabled:opacity-40"
    >
      <span
        className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
        style={{ background: `color-mix(in oklch, ${accent} 18%, transparent)`, color: accent }}
      >
        <Icon name={icon as IconName} width={13} />
      </span>
      <span className="min-w-0">
        <span className="block text-[12.5px] font-medium" style={{ color: "var(--text-primary)" }}>{label}</span>
        <span className="block text-[11px]" style={{ color: "var(--text-muted)" }}>{blurb}</span>
      </span>
    </button>
  );
}

// ── Type chip (the visual marker that unifies the four primitives) ────────────
function AutomationTypeChip({ type }: { type: AutomationType }) {
  const meta = AUTOMATION_TYPE_META[type];
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium"
      style={{ background: `color-mix(in oklch, ${meta.accent} 16%, transparent)`, color: meta.accent }}
    >
      <Icon name={meta.icon as IconName} width={10} aria-hidden />
      {meta.label}
    </span>
  );
}

function StateDot({ state }: { state: AutomationEntry["state"] }) {
  const color =
    state === "active" ? "var(--color-success)" : state === "draft" ? "var(--color-warning)" : "var(--text-muted)";
  const label = state === "active" ? "Active" : state === "draft" ? "Draft" : "Paused";
  return (
    <span className="inline-flex items-center gap-1 text-[10.5px]" style={{ color: "var(--text-muted)" }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} aria-hidden />
      {label}
    </span>
  );
}

// A single unified row in the "All" list — type chip + name + trigger + state.
/** busyId encoding differs per native store: flows are `flow:<id>`, the rest use
 *  the bare native id. Mirror that here so the All row's Run button shows the
 *  spinner for the right entry. */
function entryBusyKey(entry: AutomationEntry): string {
  return entry.type === "flow" ? `flow:${entry.nativeId}` : entry.nativeId;
}

function AutomationEntryRow({
  entry,
  familiarLabel,
  busy,
  onRun,
  onOpen,
}: {
  entry: AutomationEntry;
  familiarLabel: (id?: string | null) => string | null;
  busy: boolean;
  onRun: (entry: AutomationEntry) => void;
  onOpen: (entry: AutomationEntry) => void;
}) {
  const fam = familiarLabel(entry.familiarId);
  // Next fire (reminders only, for now) as a friendly relative time alongside the
  // schedule string — so the unified list answers "when next?" at a glance.
  const nextFire = entry.state === "active" && entry.nextFireAt ? relTime(entry.nextFireAt) : null;
  return (
    <div
      className="automation-list-row group/srow flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-white/5"
      style={{ border: "1px solid var(--border-hairline)" }}
    >
      <AutomationTypeChip type={entry.type} />
      <span className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => onOpen(entry)}
          className="focus-ring-inset block w-full rounded-md text-left"
        >
          <span className="block truncate text-[13px] font-medium" style={{ color: "var(--text-primary)" }}>
            {entry.name}
          </span>
          <span className="mt-0.5 flex items-center gap-2 text-[11px]" style={{ color: "var(--text-muted)" }}>
            <span className="inline-flex shrink-0 items-center gap-1">
              <Icon name={entry.scheduled ? "ph:clock" : "ph:play"} width={11} aria-hidden />
              {entry.trigger}
            </span>
            {nextFire && (
              <span className="shrink-0 whitespace-nowrap" style={{ color: "var(--text-secondary)" }} title={`Next fire: ${entry.nextFireAt}`}>
                · {nextFire}
              </span>
            )}
            {fam && <span className="truncate">· {fam}</span>}
          </span>
        </button>
        <span className="automation-entry-row__actions mt-1.5 flex items-center gap-1">
          <button
            type="button"
            disabled={busy}
            onClick={() => onRun(entry)}
            aria-label={`Run ${entry.name} now`}
            className="focus-ring inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors hover:bg-white/10 disabled:opacity-50"
            style={{ color: "var(--text-secondary)" }}
          >
            <Icon name="ph:play" width={11} aria-hidden />
            {busy ? "…" : "Run"}
          </button>
        </span>
      </span>
      <StateDot state={entry.state} />
    </div>
  );
}

function AutomationAllList({
  entries,
  busyId,
  familiarLabel,
  onRun,
  onOpen,
}: {
  entries: AutomationEntry[];
  busyId: string | null;
  familiarLabel: (id?: string | null) => string | null;
  onRun: (entry: AutomationEntry) => void;
  onOpen: (entry: AutomationEntry) => void;
}) {
  return (
    <div className="space-y-1.5 pt-1">
      {entries.map((entry) => (
        <AutomationEntryRow
          key={entry.key}
          entry={entry}
          familiarLabel={familiarLabel}
          busy={busyId === entryBusyKey(entry)}
          onRun={onRun}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}

// Shared row shell for managed automation tabs: name, meta, Run + Open actions.
function ManagedAutomationRow({
  type,
  name,
  meta,
  busy,
  onRun,
  onOpen,
}: {
  type: AutomationType;
  name: string;
  meta: string;
  busy: boolean;
  onRun: () => void;
  onOpen: () => void;
}) {
  return (
    <div
      className="automation-list-row group/srow flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-white/5"
      style={{ border: "1px solid var(--border-hairline)" }}
    >
      <AutomationTypeChip type={type} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium" style={{ color: "var(--text-primary)" }}>{name}</span>
        <span className="mt-0.5 block truncate text-[11px]" style={{ color: "var(--text-muted)" }}>{meta}</span>
        <span className="managed-automation-row__actions mt-1.5 flex items-center gap-1">
          <button
            type="button"
            disabled={busy}
            onClick={onRun}
            className="focus-ring inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors hover:bg-white/10 disabled:opacity-50"
            style={{ color: "var(--text-secondary)" }}
          >
            <Icon name="ph:play" width={11} aria-hidden />
            {busy ? "…" : "Run"}
          </button>
          <button
            type="button"
            onClick={onOpen}
            className="focus-ring inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors hover:bg-white/10"
            style={{ color: "var(--text-secondary)" }}
          >
            <Icon name="ph:arrow-square-out" width={11} aria-hidden />
            Open
          </button>
        </span>
      </span>
    </div>
  );
}

function FlowList({
  flows,
  query,
  busyId,
  onRun,
  onOpen,
}: {
  flows: FlowDoc[];
  query: string;
  busyId: string | null;
  onRun: (flow: FlowDoc) => void;
  onOpen: (flow: FlowDoc) => void;
}) {
  const visible = flows.filter((f) => !query || (f.name || "").toLowerCase().includes(query));
  return (
    <div className="space-y-1.5 pt-1">
      {visible.map((flow) => {
        const { trigger } = flowTrigger(flow);
        const nodeCount = flow.nodes.filter((n) => n.type !== "sticky").length;
        return (
          <ManagedAutomationRow
            key={flow.id}
            type="flow"
            name={flow.name || "Untitled flow"}
            meta={`${trigger} · ${nodeCount} node${nodeCount === 1 ? "" : "s"}${flow.active ? "" : " · paused"}`}
            busy={busyId === `flow:${flow.id}`}
            onRun={() => onRun(flow)}
            onOpen={() => onOpen(flow)}
          />
        );
      })}
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────
export function AutomationsView({ familiars, onOpenSession, onNewReminder, onEdit, onOpenLink, calendarSlot, initialTab }: Props) {
  useDateTimePrefs(); // subscribe: re-render when the date/time density pref changes
  const confirm = useConfirm(); // still used by "Run now" (a non-delete action)
  // Deferred + undoable deletes (reminders, automations, bulk): rows hide at
  // once, the DELETEs fire only after the undo window, and Undo restores them.
  const { pending: deletePending, scheduleDelete, undo: undoDelete, commit: commitDelete } = useUndoDelete<string[]>();
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<InboxItem[]>([]);
  const [codexAutos, setCodexAutos] = useState<CodexAutomation[]>([]);
  const [flows, setFlows] = useState<FlowDoc[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<AutomationTab>(
    initialTab && (initialTab !== "calendar" || calendarSlot) ? initialTab : "all",
  );
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  // Selected item is either an InboxItem or a CodexAutomation — track by kind
  const [selectedItem, setSelectedItem] = useState<InboxItem | null>(null);
  const [selectedCodex, setSelectedCodex] = useState<CodexAutomation | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [automationRuns, setAutomationRuns] = useState<AutomationRunRecord[]>([]);
  const [lastRunById, setLastRunById] = useState<Map<string, AutomationRunRecord>>(new Map());
  // Guards async setState after unmount; runsReqRef drops a stale per-automation
  // runs fetch when a faster, later selection won.
  const mountedRef = useRef(true);
  const runsReqRef = useRef(0);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const load = useCallback(async () => {
    try {
      const [inboxRes, codexRes, flowRes] = await Promise.all([
        fetch("/api/inbox", { cache: "no-store" }),
        fetch("/api/codex-automations", { cache: "no-store" }),
        listFlows().catch(() => ({ ok: false, flows: [] })),
      ]);
      const inboxJson = await inboxRes.json();
      if (!mountedRef.current) return;
      if (!inboxJson.ok) { setError(inboxJson.error ?? "load failed"); return; }
      setItems(inboxJson.items ?? []);
      const codexJson = await codexRes.json();
      if (!mountedRef.current) return;
      if (codexJson.ok) setCodexAutos(codexJson.automations ?? []);
      // Flows are best-effort: a missing daemon/store shouldn't blank the whole
      // surface, just drop Flow rows from the list.
      if (flowRes.ok) setFlows(flowRes.flows ?? []);
      setError(null);
    } catch (err) {
      if (mountedRef.current) setError(err instanceof Error ? err.message : "fetch failed");
    } finally {
      if (mountedRef.current) setInitialLoadDone(true);
    }
  }, []);

  const refreshRuns = useCallback(async (id: string) => {
    const reqId = ++runsReqRef.current;
    try {
      const res = await fetch(`/api/codex-automations/${encodeURIComponent(id)}/runs`);
      const json = await res.json().catch(() => null);
      // Drop a stale runs response: a later selection (or poll) superseded it.
      if (reqId !== runsReqRef.current || !mountedRef.current) return;
      if (json?.ok && Array.isArray(json.runs)) setAutomationRuns(json.runs);
    } catch {
      /* ignore */
    }
  }, []);

  const refreshLastRuns = useCallback(async () => {
    try {
      const entries = await Promise.all(
        codexAutos.map((a) =>
          fetch(`/api/codex-automations/${encodeURIComponent(a.id)}/runs`)
            .then((r) => r.json())
            .then((j) => [a.id, j?.runs?.[0]] as const)
            .catch(() => [a.id, undefined] as const),
        ),
      );
      if (!mountedRef.current) return;
      const map = new Map<string, AutomationRunRecord>();
      for (const [id, run] of entries) {
        if (run) map.set(id, run);
      }
      setLastRunById(map);
    } catch {
      /* ignore */
    }
  }, [codexAutos]);

  // Background polling pauses while the tab is hidden — Schedules otherwise kept
  // hitting /api/inbox + /api/codex-automations every 15s with nobody looking.
  // A refetch on return brings it current immediately.
  useEffect(() => {
    void load();
    const tick = () => { if (!document.hidden) void load(); };
    const t = setInterval(tick, 15000);
    const onVis = () => { if (!document.hidden) void load(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [load]);

  // Keep selectedCodex in sync after reload
  useEffect(() => {
    if (!selectedCodex) return;
    const fresh = codexAutos.find((a) => a.id === selectedCodex.id);
    if (fresh) setSelectedCodex(fresh);
    else setSelectedCodex(null);
  }, [codexAutos, selectedCodex?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh runs for the selected automation when it changes
  useEffect(() => {
    if (selectedCodex?.id) {
      void refreshRuns(selectedCodex.id);
    } else {
      setAutomationRuns([]);
    }
  }, [selectedCodex?.id, refreshRuns]); // eslint-disable-line react-hooks/exhaustive-deps

  // While a run is in flight, poll so its status + log fill in without a manual refresh.
  useEffect(() => {
    if (!selectedCodex?.id) return;
    if (!automationRuns.some((r) => r.status === "running")) return;
    const id = selectedCodex.id;
    const t = setInterval(() => {
      if (document.hidden) return; // don't poll a backgrounded tab
      void refreshRuns(id);
      void refreshLastRuns();
    }, 2500);
    return () => clearInterval(t);
  }, [selectedCodex?.id, automationRuns, refreshRuns, refreshLastRuns]); // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh last-run map whenever the automation list changes
  useEffect(() => {
    if (codexAutos.length > 0) void refreshLastRuns();
  }, [codexAutos, refreshLastRuns]); // eslint-disable-line react-hooks/exhaustive-deps

  const famById = useMemo(() => {
    const m = new Map<string, Familiar>();
    for (const f of familiars) m.set(f.id, f);
    return m;
  }, [familiars]);

  const familiarLabel = useCallback(
    (fid?: string | null) => fid ? (famById.get(fid)?.display_name ?? fid) : null,
    [famById],
  );

  const patchItem = useCallback(async (id: string, body: object) => {
    if (id.startsWith("eph:")) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/inbox/${id}`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`http ${res.status}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "patch failed");
    } finally { setBusyId(null); }
  }, [load]);

  const actItem = useCallback(async (id: string, path: string, body?: object) => {
    if (id.startsWith("eph:")) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/inbox/${id}/${path}`, {
        method: "POST",
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) throw new Error(`http ${res.status}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "action failed");
    } finally { setBusyId(null); }
  }, [load]);

  const removeItem = useCallback((id: string) => {
    if (id.startsWith("eph:")) return;
    const target = items.find((i) => i.id === id);
    const label = target?.title ? `“${target.title}”` : "reminder";
    setSelectedItem((prev) => prev?.id === id ? null : prev);
    scheduleDelete([id], label, async () => {
      setItems((prev) => prev.filter((i) => i.id !== id));
      try {
        const res = await fetch(`/api/inbox/${id}`, { method: "DELETE" });
        if (!res.ok) throw new Error(`http ${res.status}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "delete failed");
      } finally { await load(); }
    });
  }, [items, scheduleDelete, load]);

  const runNow = (id: string) =>
    patchItem(id, { fireAt: new Date().toISOString(), status: "pending" });

  const togglePaused = (item: InboxItem) =>
    patchItem(item.id, { status: item.status === "dismissed" ? "pending" : "dismissed" });

  const stopRecurrence = (id: string) =>
    patchItem(id, { recurrence: { type: "none" } });

  // ── Codex toggle ──────────────────────────────────────────────────────────
  const toggleCodex = useCallback(async (auto: CodexAutomation) => {
    setBusyId(auto.id);
    try {
      const newStatus: AutomationStatus = auto.status === "ACTIVE" ? "PAUSED" : "ACTIVE";
      const res = await fetch(`/api/codex-automations/${encodeURIComponent(auto.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error(`http ${res.status}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "codex patch failed");
    } finally {
      setBusyId(null);
    }
  }, [load]);

  const saveCodex = useCallback(async (auto: CodexAutomation, patch: CodexAutomationPatch) => {
    setBusyId(auto.id);
    try {
      const res = await fetch(`/api/codex-automations/${encodeURIComponent(auto.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? `http ${res.status}`);
      if (json.automation) setSelectedCodex(json.automation);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "codex save failed");
    } finally {
      setBusyId(null);
    }
  }, [load]);

  const deleteCodex = useCallback((auto: CodexAutomation) => {
    setSelectedCodex(null);
    scheduleDelete([auto.id], `automation “${auto.name}”`, async () => {
      setCodexAutos((prev) => prev.filter((a) => a.id !== auto.id));
      try {
        const res = await fetch(`/api/codex-automations/${encodeURIComponent(auto.id)}`, { method: "DELETE" });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.ok) throw new Error(json?.error ?? `http ${res.status}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "codex delete failed");
      } finally { await load(); }
    });
  }, [scheduleDelete, load]);

  const runCodexNow = useCallback(async (auto: CodexAutomation) => {
    if (!(await confirm({ title: `Run “${auto.name}” now?`, body: "This executes the agent immediately.", confirmLabel: "Run now" }))) return;
    setBusyId(auto.id);
    try {
      const res = await fetch(`/api/codex-automations/${encodeURIComponent(auto.id)}/run`, { method: "POST" });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? `http ${res.status}`);
      await refreshRuns(auto.id);
      await refreshLastRuns();
    } catch (err) {
      setError(err instanceof Error ? err.message : "run failed");
    } finally {
      setBusyId(null);
    }
  }, [refreshRuns, refreshLastRuns]);

  const createCodex = useCallback(async (input: AutomationCreateInput) => {
    try {
      const res = await fetch("/api/codex-automations", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? `http ${res.status}`);
      setCreateOpen(false);
      await load();
      if (json.automation) { setSelectedCodex(json.automation); setSelectedItem(null); }
    } catch (err) {
      setError(err instanceof Error ? err.message : "codex create failed");
    }
  }, [load]);

  // ── Flows ───────────────────────────────────────────────────────────────
  // Cave has no native execution engine, so "run" is daemon-first and returns
  // { unavailable: true } when the daemon is offline rather than faking a run.
  const runFlowNow = useCallback(async (flow: FlowDoc) => {
    if (!(await confirm({ title: `Run “${flow.name}”?`, body: "This spawns an agent session to execute the flow graph.", confirmLabel: "Run" }))) return;
    setBusyId(`flow:${flow.id}`);
    try {
      const res = await runFlow(flow.id);
      if (res.unavailable) { setError("Flows run through the Coven daemon — it isn't reachable right now."); return; }
      if (!res.ok) throw new Error(res.error ?? "run failed");
      if (res.sessionId) onOpenSession?.(res.sessionId, null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "flow run failed");
    } finally {
      setBusyId(null);
    }
  }, [confirm, onOpenSession]);

  // "Open" routes to each type's dedicated editor surface.
  const openEntry = useCallback((entry: AutomationEntry) => {
    if (entry.type === "flow") { navigateToMode("flow"); return; }
    // reminders + crons are edited inline here — select their detail panel.
    if (entry.type === "reminder") {
      const item = items.find((i) => i.id === entry.nativeId);
      if (item) { setSelectedItem(item); setSelectedCodex(null); }
      return;
    }
    const auto = codexAutos.find((a) => a.id === entry.nativeId);
    if (auto) { setSelectedCodex(auto); setSelectedItem(null); }
  }, [items, codexAutos]);

  // Run any entry straight from the unified "All" list, dispatching to the right
  // per-type handler (crons + flows confirm first; reminders fire immediately).
  const runEntry = useCallback((entry: AutomationEntry) => {
    if (entry.type === "reminder") { void runNow(entry.nativeId); return; }
    if (entry.type === "cron") {
      const auto = codexAutos.find((a) => a.id === entry.nativeId);
      if (auto) void runCodexNow(auto);
      return;
    }
    if (entry.type === "flow") {
      const flow = flows.find((f) => f.id === entry.nativeId);
      if (flow) void runFlowNow(flow);
    }
  }, [codexAutos, flows, runNow, runCodexNow, runFlowNow]);

  // Ids whose delete is pending in the undo window — hidden everywhere until the
  // window lapses (committing the delete) or Undo restores them.
  const hiddenIds = useMemo(() => new Set(deletePending?.item ?? []), [deletePending]);
  // Normalized text filter applied to whichever tab is active (title/name).
  const q = query.trim().toLowerCase();

  // ── Sections ──────────────────────────────────────────────────────────────
  const reminderItems = useMemo(() =>
    items.filter((it) => isScheduleInboxItem(it) && !hiddenIds.has(it.id) && (!q || (it.title ?? "").toLowerCase().includes(q))),
    [items, hiddenIds, q]);

  const current = useMemo(() =>
    reminderItems.filter((it) =>
      (it.status === "pending" || it.status === "fired") &&
      it.recurrence && it.recurrence.type !== "none"
    ).sort((a, b) => (a.fireAt ?? "").localeCompare(b.fireAt ?? "")),
    [reminderItems]);

  const paused = useMemo(() =>
    reminderItems.filter((it) =>
      it.status === "dismissed" && it.recurrence && it.recurrence.type !== "none"
    ).sort((a, b) => (a.title).localeCompare(b.title)),
    [reminderItems]);

  const oneShots = useMemo(() =>
    reminderItems.filter((it) =>
      (!it.recurrence || it.recurrence.type === "none") &&
      (it.status === "pending" || it.status === "snoozed")
    ).sort((a, b) => (a.fireAt ?? "").localeCompare(b.fireAt ?? "")),
    [reminderItems]);

  const history = useMemo(() =>
    reminderItems.filter((it) =>
      it.status === "fired" || it.status === "done" ||
      (it.status === "dismissed" && (!it.recurrence || it.recurrence.type === "none"))
    ).sort((a, b) => (b.firedAt ?? b.updatedAt).localeCompare(a.firedAt ?? a.updatedAt))
      .slice(0, 20),
    [reminderItems]);

  // Multi-select over exactly the reminders rendered across the four sections,
  // so "Select all" and the count match what's on screen.
  const reminderVisible = useMemo(
    () => [...current, ...paused, ...oneShots, ...history],
    [current, paused, oneShots, history],
  );
  const reminderSelect = useMultiSelect(reminderVisible, (it) => it.id);
  const [bulkBusy, setBulkBusy] = useState(false);
  const selectedRealIds = () =>
    reminderSelect
      .selectedFrom(reminderVisible)
      .map((it) => it.id)
      .filter((id) => !id.startsWith("eph:"));

  const bulkPatchReminders = async (body: object) => {
    const ids = selectedRealIds();
    if (ids.length === 0) { reminderSelect.exit(); return; }
    setBulkBusy(true);
    try {
      await Promise.all(ids.map((id) =>
        fetch(`/api/inbox/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }).then((r) => { if (!r.ok) throw new Error(`http ${r.status}`); })));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "bulk action failed");
    } finally {
      setBulkBusy(false);
      reminderSelect.exit();
    }
  };

  const bulkDeleteReminders = () => {
    const ids = selectedRealIds();
    if (ids.length === 0) { reminderSelect.exit(); return; }
    reminderSelect.exit();
    scheduleDelete(ids, `${ids.length} reminder${ids.length === 1 ? "" : "s"}`, async () => {
      const idSet = new Set(ids);
      setItems((prev) => prev.filter((i) => !idSet.has(i.id)));
      try {
        await Promise.all(ids.map((id) =>
          fetch(`/api/inbox/${id}`, { method: "DELETE" })
            .then((r) => { if (!r.ok) throw new Error(`http ${r.status}`); })));
      } catch (err) {
        setError(err instanceof Error ? err.message : "bulk delete failed");
      } finally { await load(); }
    });
  };

  const resolvedFamiliars = useResolvedFamiliars(familiars);
  const familiarsById = useMemo(
    () => new Map(resolvedFamiliars.map((f) => [f.id, f])),
    [resolvedFamiliars],
  );
  const [familiarFilter, setFamiliarFilter] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    const raw = window.localStorage.getItem("cave:automations:familiar-filter");
    if (!raw) return new Set();
    return new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
  });
  const updateFamiliarFilter = useCallback((next: Set<string>) => {
    setFamiliarFilter(next);
    try {
      window.localStorage.setItem("cave:automations:familiar-filter", [...next].join(","));
    } catch {
      /* ignore storage errors */
    }
  }, []);

  const codexActive = useMemo(
    () =>
      codexAutos.filter(
        (a) => a.status === "ACTIVE" && !hiddenIds.has(a.id) && automationMatchesFilter(a.familiars, familiarFilter) && (!q || a.name.toLowerCase().includes(q)),
      ),
    [codexAutos, familiarFilter, hiddenIds, q],
  );
  const codexPaused = useMemo(
    () =>
      codexAutos.filter(
        (a) => a.status === "PAUSED" && !hiddenIds.has(a.id) && automationMatchesFilter(a.familiars, familiarFilter) && (!q || a.name.toLowerCase().includes(q)),
      ),
    [codexAutos, familiarFilter, hiddenIds, q],
  );

  // Inbox tab: the FULL feed (every kind), grouped by attention tier.
  const inboxFeed = useMemo(() => groupInboxFeed(items.filter((it) => !hiddenIds.has(it.id) && (!q || (it.title ?? "").toLowerCase().includes(q)))), [items, hiddenIds, q]);
  const remindersEmpty = current.length + paused.length + oneShots.length + history.length === 0;
  const automationsEmpty = codexAutos.length === 0;
  const inboxEmpty = items.length === 0;
  const selectedReminderId = selectedItem?.id ?? null;
  const selectedAutomationId = selectedCodex?.id ?? null;

  // ── Unified entries (the "All" tab) ─────────────────────────────────────
  // Every automation primitive normalized into one typed, recency-sorted list.
  // Reminders are the schedule-shaped subset (no raw inbox notifications), so
  // the All list reads as "things you've set up" rather than a notification feed.
  const allEntries = useMemo(
    () =>
      filterEntries(
        buildAutomationEntries({
          reminders: items.filter((it) => isScheduleInboxItem(it) && !hiddenIds.has(it.id)),
          crons: codexAutos.filter((a) => !hiddenIds.has(a.id)),
          flows,
        }),
        q,
      ),
    [items, codexAutos, flows, hiddenIds, q],
  );
  const typeCounts = useMemo(
    () =>
      countByType(
        buildAutomationEntries({
          reminders: items.filter(isScheduleInboxItem),
          crons: codexAutos,
          flows,
        }),
      ),
    [items, codexAutos, flows],
  );

  // At-a-glance operational summary for the header: how many automations are
  // live vs paused, and when the soonest known fire is (reminders carry
  // nextFireAt; crons/flows fire server-side so they don't contribute a time).
  const summary = useMemo(() => {
    let active = 0;
    let paused = 0;
    let soonest: string | undefined;
    for (const entry of allEntries) {
      if (entry.state === "paused") paused += 1;
      else active += 1;
      if (entry.state === "active" && entry.nextFireAt && (!soonest || entry.nextFireAt < soonest)) {
        soonest = entry.nextFireAt;
      }
    }
    return { active, paused, soonest };
  }, [allEntries]);

  const selectTab = (tab: AutomationTab) => {
    setActiveTab(tab);
    setQuery(""); // the filter is scoped to one tab at a time
    // Clear any open detail on switch — the new tab may not host that type.
    setSelectedItem(null);
    setSelectedCodex(null);
  };

  return (
    <ScheduleActionsContext.Provider
      value={{
        runReminder: runNow,
        togglePauseReminder: togglePaused,
        runAutomation: runCodexNow,
        togglePauseAutomation: toggleCodex,
      }}
    >
    <section className="flex h-full" style={{ background: "var(--bg-base)" }}>
      {/* ── Main list ──────────────────────────────────────────────────────── */}
      <div className="flex flex-1 min-w-0 flex-col">
        {/* Page header */}
        <div className="flex items-center justify-between px-8 pt-8 pb-5">
          <div>
            <h1 className="text-[22px] font-semibold" style={{ color: "var(--text-primary)" }}>
              Automations
            </h1>
            <p className="mt-0.5 text-[12px]" style={{ color: "var(--text-muted)" }}>
              {activeTab === "calendar"
                ? "Your reminders, crons, and deadlines on a calendar."
                : "Reminders, crons, and flows — everything that runs for you, in one place."}
            </p>
            {activeTab !== "calendar" && initialLoadDone && summary.active + summary.paused > 0 && (
              <p className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--accent-presence)" }} />
                  {summary.active} active
                </span>
                {summary.paused > 0 && <span>· {summary.paused} paused</span>}
                {summary.soonest && (
                  <span title={`Next fire: ${summary.soonest}`}>· next fire {relTime(summary.soonest)}</span>
                )}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {activeTab === "reminders" && !remindersEmpty && !reminderSelect.selectMode && (
              <button
                type="button"
                onClick={() => reminderSelect.setSelectMode(true)}
                className="focus-ring inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium whitespace-nowrap transition-colors hover:bg-white/5"
                style={{ background: "var(--bg-raised)", border: "1px solid var(--border-hairline)", color: "var(--text-primary)" }}
              >
                <Icon name="ph:check-square" width={13} />
                Select
              </button>
            )}
            {/* Typed "New" menu — one entry point for the automation types. */}
            <div className="relative">
              <Button className="automation-create-chat-btn" leadingIcon="ph:plus" onClick={() => setNewMenuOpen((v) => !v)} aria-haspopup="menu" aria-expanded={newMenuOpen}>
                New
                <span style={{ display: "flex" }}><Icon name="ph:caret-down" width={11} /></span>
              </Button>
              {newMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setNewMenuOpen(false)} aria-hidden />
                  <div
                    role="menu"
                    className="absolute right-0 z-50 mt-1.5 w-[260px] overflow-hidden rounded-xl py-1 shadow-xl"
                    style={{ background: "var(--bg-raised)", border: "1px solid var(--border-hairline)" }}
                  >
                    <NewMenuItem
                      icon={AUTOMATION_TYPE_META.reminder.icon}
                      accent={AUTOMATION_TYPE_META.reminder.accent}
                      label="Reminder"
                      blurb={AUTOMATION_TYPE_META.reminder.blurb}
                      disabled={!onNewReminder}
                      onClick={() => { setNewMenuOpen(false); onNewReminder?.(); }}
                    />
                    <NewMenuItem
                      icon={AUTOMATION_TYPE_META.cron.icon}
                      accent={AUTOMATION_TYPE_META.cron.accent}
                      label="Cron"
                      blurb={AUTOMATION_TYPE_META.cron.blurb}
                      onClick={() => { setNewMenuOpen(false); setCreateOpen(true); }}
                    />
                    <NewMenuItem
                      icon={AUTOMATION_TYPE_META.flow.icon}
                      accent={AUTOMATION_TYPE_META.flow.accent}
                      label="Flow"
                      blurb={AUTOMATION_TYPE_META.flow.blurb}
                      onClick={() => { setNewMenuOpen(false); navigateToMode("flow"); }}
                    />
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="px-8 pb-4">
          <Tabs
            variant="segment"
            ariaLabel="Automations tabs"
            value={activeTab}
            onChange={selectTab}
            items={[
              ...(calendarSlot ? [{ id: "calendar" as const, label: "Calendar" }] : []),
              { id: "all", label: "All", count: allEntries.length },
              { id: "reminders", label: "Reminders", count: typeCounts.reminder },
              { id: "crons", label: "Crons", count: typeCounts.cron },
              { id: "flows", label: "Flows", count: typeCounts.flow },
              { id: "activity", label: "Activity", count: items.length },
            ] satisfies TabItem<AutomationTab>[]}
          />
        </div>

        {/* Text filter for the active tab. Gated on the UNfiltered presence of
            rows so filtering to zero never hides the box (you can still clear). */}
        {activeTab !== "calendar" && initialLoadDone && !reminderSelect.selectMode && (
          activeTab === "all" ? typeCounts.reminder + typeCounts.cron + typeCounts.flow > 0
          : activeTab === "activity" ? items.length > 0
          : activeTab === "crons" ? codexAutos.length > 0
          : activeTab === "flows" ? flows.length > 0
          : items.some(isScheduleInboxItem)
        ) ? (
          <div className="px-8 pb-4">
            <SearchInput
              value={query}
              onValueChange={setQuery}
              onClear={() => setQuery("")}
              placeholder={
                activeTab === "all" ? "Filter automations…"
                : activeTab === "crons" ? "Filter crons…"
                : activeTab === "flows" ? "Filter flows…"
                : activeTab === "activity" ? "Filter activity…"
                : "Filter reminders…"
              }
              aria-label="Filter automations"
            />
          </div>
        ) : null}

        {error && (
          <div
            role="alert"
            className="mx-8 mb-3 flex items-center gap-2 rounded-lg border border-[color-mix(in_oklch,var(--color-warning)_40%,transparent)] bg-[color-mix(in_oklch,var(--color-warning)_20%,transparent)] px-4 py-2 text-[11px] text-[var(--color-warning)]"
          >
            <Icon name="ph:warning-circle" width={13} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">{error}</span>
            <button
              type="button"
              onClick={() => void load()}
              className="shrink-0 rounded px-1.5 py-0.5 font-medium hover:bg-white/10"
            >
              Retry
            </button>
          </div>
        )}

        {/* List (or the Calendar surface when that tab is active) */}
        <div className={activeTab === "calendar" ? "flex-1 min-h-0 overflow-hidden" : "flex-1 overflow-y-auto px-8 pb-8"}>
          {activeTab === "calendar" ? (
            calendarSlot
          ) : !initialLoadDone ? (
            <div className="space-y-2 pt-2">
              {Array.from({ length: 5 }).map((_, index) => (
                <div
                  key={index}
                  className="h-14 animate-pulse rounded-lg bg-[var(--bg-raised)]"
                />
              ))}
            </div>
          ) : q && (
            (activeTab === "all" && allEntries.length === 0) ||
            (activeTab === "reminders" && remindersEmpty) ||
            (activeTab === "crons" && codexActive.length + codexPaused.length === 0) ||
            (activeTab === "flows" && flows.filter((f) => (f.name || "").toLowerCase().includes(q)).length === 0) ||
            (activeTab === "activity" && inboxFeed.needsYou.length + inboxFeed.active.length + inboxFeed.resolved.length === 0)
          ) ? (
            <EmptyState
              className="mt-12"
              icon="ph:magnifying-glass"
              headline={`No matches for “${query.trim()}”`}
              subtitle="Try a different search term."
            />
          ) : activeTab === "all" && allEntries.length === 0 ? (
            <EmptyState
              className="mt-12"
              icon="ph:lightning-bold"
              headline="No automations yet"
              subtitle="Reminders, crons, and flows all live here. Use “New” to create one."
            />
          ) : activeTab === "reminders" && remindersEmpty ? (
            <EmptyState
              className="mt-12"
              icon="ph:bell"
              headline="No reminders yet"
              subtitle="Reminders nudge you or a familiar at a scheduled time."
              actions={
                onNewReminder ? (
                  <Button leadingIcon="ph:plus" onClick={onNewReminder}>
                    Create via chat
                  </Button>
                ) : undefined
              }
            />
          ) : activeTab === "crons" && automationsEmpty ? (
            <EmptyState
              className="mt-12"
              icon="ph:clock-countdown"
              headline="No crons configured"
              subtitle="A cron runs a familiar on a recurring schedule — set one up to get started."
              actions={<Button leadingIcon="ph:plus" onClick={() => setCreateOpen(true)}>New cron</Button>}
            />
          ) : activeTab === "flows" && flows.length === 0 ? (
            <EmptyState
              className="mt-12"
              icon="ph:flow-arrow"
              headline="No flows yet"
              subtitle="Flows are freeform node graphs you wire on a canvas."
              actions={<Button leadingIcon="ph:arrow-square-out" onClick={() => navigateToMode("flow")}>Open Flow editor</Button>}
            />
          ) : activeTab === "activity" && inboxEmpty ? (
            <EmptyState
              className="mt-12"
              icon="ph:tray"
              headline="Nothing in your activity feed"
              subtitle="Fired reminders, responses, and agent notifications all land here."
            />
          ) : (
            <>
              {activeTab === "all" ? (
                <AutomationAllList
                  entries={allEntries}
                  busyId={busyId}
                  familiarLabel={familiarLabel}
                  onRun={runEntry}
                  onOpen={openEntry}
                />
              ) : activeTab === "reminders" ? (
                <>
                  {reminderSelect.selectMode && (
                    <SelectionToolbar
                      allSelected={reminderSelect.allSelected(reminderVisible)}
                      count={reminderSelect.selectedCount}
                      onToggleSelectAll={() => reminderSelect.toggleSelectAll(reminderVisible)}
                      onCancel={reminderSelect.exit}
                    >
                      <button
                        type="button"
                        disabled={bulkBusy || reminderSelect.selectedCount === 0}
                        onClick={() => void bulkPatchReminders({ status: "dismissed" })}
                        className="focus-ring rounded px-1.5 py-0.5 text-[11px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-50"
                      >
                        Pause
                      </button>
                      <button
                        type="button"
                        disabled={bulkBusy || reminderSelect.selectedCount === 0}
                        onClick={() => void bulkPatchReminders({ status: "pending" })}
                        className="focus-ring rounded px-1.5 py-0.5 text-[11px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-50"
                      >
                        Resume
                      </button>
                      <button
                        type="button"
                        disabled={bulkBusy || reminderSelect.selectedCount === 0}
                        onClick={() => void bulkDeleteReminders()}
                        className="focus-ring inline-flex items-center gap-1 rounded border border-[var(--color-danger)]/50 bg-[var(--color-danger)]/10 px-1.5 py-0.5 text-[11px] text-[var(--color-danger)] hover:bg-[var(--color-danger)]/15 disabled:opacity-50"
                      >
                        <Icon name="ph:trash-bold" width={11} aria-hidden />
                        {bulkBusy ? "Working…" : `Delete${reminderSelect.selectedCount ? ` ${reminderSelect.selectedCount}` : ""}`}
                      </button>
                    </SelectionToolbar>
                  )}
                  <ReminderTaskList
                    current={current}
                    paused={paused}
                    oneShots={oneShots}
                    history={history}
                    selectedId={selectedReminderId}
                    selectMode={reminderSelect.selectMode}
                    isSelected={reminderSelect.isSelected}
                    familiarLabel={familiarLabel}
                    onSelect={(item) => { setSelectedItem(item); setSelectedCodex(null); }}
                    onToggle={reminderSelect.toggle}
                  />
                </>
              ) : activeTab === "activity" ? (
                <InboxFeedList
                  needsYou={inboxFeed.needsYou}
                  active={inboxFeed.active}
                  resolved={inboxFeed.resolved}
                  selectedId={selectedReminderId}
                  familiarLabel={familiarLabel}
                  onSelect={(item) => { setSelectedItem(item); setSelectedCodex(null); }}
                />
              ) : activeTab === "flows" ? (
                <FlowList
                  flows={flows}
                  query={q}
                  busyId={busyId}
                  onRun={runFlowNow}
                  onOpen={() => navigateToMode("flow")}
                />
              ) : (
                <>
                  {resolvedFamiliars.length > 0 && (
                    <FamiliarMultiSelect
                      familiars={resolvedFamiliars}
                      selected={familiarFilter}
                      onChange={updateFamiliarFilter}
                    />
                  )}
                  <AutomationsPanel
                    active={codexActive}
                    paused={codexPaused}
                    selectedId={selectedAutomationId}
                    familiarsById={familiarsById}
                    lastRunById={lastRunById}
                    onSelect={(auto) => { setSelectedCodex(auto); setSelectedItem(null); }}
                  />
                  {familiarFilter.size > 0 && codexActive.length === 0 && codexPaused.length === 0 && (
                    <p className="mt-2 text-[12px]" style={{ color: "var(--text-muted)" }}>
                      No crons match this familiar filter.
                    </p>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Detail panel ───────────────────────────────────────────────────── */}
      {(selectedItem || selectedCodex) && (
        <div className="w-[380px] max-w-[42vw] shrink-0 overflow-hidden" style={{ borderLeft: "1px solid var(--border-hairline)" }}>
          {selectedItem && (
            <DetailPanel
              item={selectedItem}
              familiarLabel={familiarLabel}
              busyId={busyId}
              onClose={() => setSelectedItem(null)}
              runNow={runNow}
              togglePaused={togglePaused}
              stopRecurrence={stopRecurrence}
              removeItem={removeItem}
              onEdit={onEdit}
              onOpenLink={onOpenLink}
            />
          )}
          {selectedCodex && (
            <CodexDetailPanel
              auto={selectedCodex}
              busy={busyId === selectedCodex.id}
              onClose={() => setSelectedCodex(null)}
              onToggle={toggleCodex}
              onSave={saveCodex}
              onDelete={deleteCodex}
              onRun={runCodexNow}
              runs={automationRuns}
            />
          )}
        </div>
      )}

      {/* ── Create automation dialog ───────────────────────────────────────── */}
      {createOpen && (
        <AutomationCreateDialog
          resolvedFamiliars={resolvedFamiliars}
          onClose={() => setCreateOpen(false)}
          onCreate={(i) => void createCodex(i)}
        />
      )}

      {deletePending ? (
        <UndoToast
          key={deletePending.id}
          message={`Deleted ${deletePending.label}`}
          undoAriaLabel="Undo delete"
          onUndo={undoDelete}
          onDismiss={commitDelete}
        />
      ) : null}
    </section>
    </ScheduleActionsContext.Provider>
  );
}
