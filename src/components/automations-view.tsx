"use client";

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useFocusTrap } from "@/lib/use-focus-trap";
import type { Familiar } from "@/lib/types";
import { arrayContentEqual } from "@/lib/array-content-equal";
import { usePausablePoll } from "@/lib/use-pausable-poll";
import { useAnnouncer } from "@/components/ui/live-region";
import type { InboxItem, LinkRef } from "@/lib/cave-inbox";
import type { Recurrence } from "@/lib/inbox-recurrence";
import {
  buildInboxGroups,
  groupInboxFeed,
  INBOX_GROUP_BY_OPTIONS,
  inboxKindLabel,
  type InboxFeedGroup,
  type InboxGroupBy,
} from "@/lib/inbox-feed";
import { repoFromGithubSubTag } from "@/lib/github-sub-tags";
import { GithubSubscriptionsModal } from "@/components/github-subscriptions-modal";
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
import { parseGitHubItemUrl } from "@/lib/github-item-url";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { StandardSelect } from "@/components/ui/select";
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
import { AutomationCreateDialog, type AutomationCreateInput, type AutomationCreateInitialValues } from "@/components/automation-create-dialog";
import { AUTOMATION_TEMPLATES, TEMPLATE_CATEGORIES, type AutomationTemplate } from "@/lib/automation-templates";
import type { FlowDoc } from "@/lib/flows";
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
import { runStatusColor, runStatusIcon } from "@/lib/automations/run-status";

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
  if (link.kind === "url") {
    // GitHub items open natively (cave-qcsv) — say where the button goes
    // instead of printing the raw URL.
    const gh = parseGitHubItemUrl(link.ref);
    if (gh) return `Open in GitHub · ${gh.repo} #${gh.number}`;
    return link.ref;
  }
  if (link.kind === "card") return "Card";
  if (link.kind === "session") return "Session";
  return "Memory";
}

// The active Rituals surface: Inbox (the full feed, mostly reminders) plus
// Calendar and Crons. The broader Automations/Flow experience lives on
// feature/automations-flow.
type AutomationTab = "inbox" | "calendar" | "crons";

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

function relTime(iso: string | undefined | null): string {
  if (!iso) return "—";
  return relativeTimeSigned(iso);
}


function FieldLabel({ htmlFor, children }: { htmlFor?: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-[10px] font-semibold uppercase tracking-widest"
      style={{ color: "var(--text-muted)" }}>
      {children}
    </label>
  );
}

function CronDetailSection({ title, description, className, children }: { title: string; description?: string; className?: string; children: ReactNode }) {
  return (
    <section className={`space-y-3 rounded-[var(--radius-control)] border p-3${className ? ` ${className}` : ""}`}
      style={{ borderColor: "var(--border-hairline)", background: "color-mix(in oklch, var(--bg-base) 72%, transparent)" }}>
      <div>
        <h3 className="text-[12px] font-semibold" style={{ color: "var(--text-primary)" }}>{title}</h3>
        {description ? <p className="mt-0.5 text-[11px]" style={{ color: "var(--text-muted)" }}>{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

// Beginner-facing names for the schedule cadence modes: the presets read as
// plain cadences, and the raw-RRULE escape hatch is labeled for what it is.
const SCHEDULE_MODE_LABEL: Record<"weekly" | "daily" | "raw", string> = {
  weekly: "Weekly",
  daily: "Daily",
  raw: "Advanced",
};

function CronSummaryTile({ label, value, tone = "default" }: { label: string; value: ReactNode; tone?: "default" | "active" | "paused" | "danger" }) {
  const valueColor =
    tone === "active"
      ? "oklch(0.75 0.1 150)"
      : tone === "danger"
        ? "var(--color-danger)"
        : tone === "paused"
          ? "var(--text-muted)"
          : "var(--text-primary)";
  return (
    <div className="rounded-[var(--radius-control)] border px-3 py-2"
      style={{ borderColor: "var(--border-hairline)", background: "var(--bg-base)" }}>
      <p className="text-[9px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>{label}</p>
      <div className="mt-1 min-w-0 truncate text-[12px] font-medium" style={{ color: valueColor }}>{value}</div>
    </div>
  );
}

const automationFieldBaseClass =
  "w-full rounded-[var(--radius-control)] border bg-[var(--bg-base)] text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--border-strong)]";
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

  // Each state carries an accessible name — the dots are otherwise the ONLY
  // per-row signal for paused vs active (a paused recurring reminder still
  // shows its human schedule as row text).
  if (paused) {
    // Pause icon — two vertical bars inside circle
    return (
      <span role="img" aria-label="Paused" className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border"
        style={{ borderColor: "rgba(255,255,255,0.18)", color: "rgba(255,255,255,0.35)" }}>
        <Icon name="ph:minus" width={8} />
      </span>
    );
  }
  if (active && hasRun) {
    // Filled purple circle — has fired before
    return (
      <span role="img" aria-label="Active, has fired" className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full"
        style={{ background: "var(--accent-presence)" }} />
    );
  }
  // Hollow circle — active, never fired yet
  return (
    <span role="img" aria-label="Active, not fired yet" className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border"
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
  // Agent / response-needed items open this panel from the Activity tab too.
  // Those are records, not schedules — the schedule fields and the
  // Run/Pause/Edit mutations only make sense for actual reminders.
  const isReminder = item.kind === "reminder";
  const busy = busyId === item.id;

  // The detail panel is a dialog: trap focus, close on Escape, and restore focus
  // to the row that opened it (useFocusTrap does the return-focus). aria-modal is
  // deliberately omitted — on desktop the list stays an interactive sibling, and
  // on mobile it's display:none, so claiming the rest is inert would be a lie.
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useFocusTrap(true, panelRef, { onEscape: onClose });

  return (
    <div ref={panelRef} role="dialog" aria-labelledby={titleId} tabIndex={-1}
      className="flex h-full flex-col focus:outline-none"
      style={{ background: "var(--bg-raised)", borderLeft: "1px solid var(--border-hairline)" }}>
      {/* Header */}
      <div className="flex items-center justify-between border-b px-5 py-3"
        style={{ borderColor: "var(--border-hairline)" }}>
        <h2 id={titleId} className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>
          {isDailySummary ? "Daily summary details" : isReminder ? "Reminder details" : "Activity details"}
        </h2>
        <Button
          variant="ghost"
          size="xs"
          onClick={onClose}
          aria-label="Close"
          className="rounded-[var(--radius-control)] p-1 text-[var(--text-muted)] transition-colors hover:bg-[color-mix(in_oklch,var(--foreground)_6%,transparent)]"
          leadingIcon="ph:x"
        />
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
          {isReminder && (
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
          {isReminder && (
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
            <FieldLabel>{isDailySummary ? "Sent" : isReminder ? "Last run" : "Received"}</FieldLabel>
            <p
              className="text-[12px]"
              style={{ color: item.firedAt ? "oklch(0.75 0.1 150)" : "var(--text-muted)" }}
              title={item.firedAt ? formatTimestamp(item.firedAt, readDateTimePrefs()) : undefined}
            >
              {item.firedAt ? relTime(item.firedAt) : isReminder ? "Never" : "—"}
            </p>
          </div>
        </div>

        {familiarLabel(item.familiarId) && (
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest"
              style={{ color: "var(--text-muted)" }}>Familiar</p>
            <span className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] px-2.5 py-1 text-[11px]"
              style={{ background: "var(--bg-base)", border: "1px solid var(--border-hairline)", color: "var(--text-secondary)" }}>
              {familiarLabel(item.familiarId)}
            </span>
          </div>
        )}

        {item.link && (
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest"
              style={{ color: "var(--text-muted)" }}>Link</p>
            <Button
              variant="ghost"
              size="xs"
              leadingIcon="ph:link"
              onClick={() => item.link && onOpenLink?.(item.link)}
              className="max-w-full rounded-[var(--radius-control)] px-2.5 py-1 text-[11px] transition-colors hover:bg-[color-mix(in_oklch,var(--foreground)_6%,transparent)]"
              style={{ background: "var(--bg-base)", border: "1px solid var(--border-hairline)", color: "var(--text-secondary)" }}
            >
              <span className="truncate">{linkLabel(item.link)}</span>
            </Button>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="border-t px-5 py-4 space-y-2"
        style={{ borderColor: "var(--border-hairline)" }}>
        {onEdit && isReminder && (
          <Button
            variant="secondary"
            fullWidth
            disabled={busy}
            onClick={() => onEdit(item)}
            className="justify-center rounded-[var(--radius-control)] py-2 text-[12px] font-medium transition-colors hover:bg-[color-mix(in_oklch,var(--foreground)_6%,transparent)] disabled:opacity-40"
            style={{ borderColor: "var(--border-hairline)", color: "var(--text-secondary)" }}
            leadingIcon="ph:pencil-simple"
          >
            Edit
          </Button>
        )}
        {isReminder && (
          <>
            <Button
              variant="primary"
              fullWidth
              disabled={busy || paused}
              onClick={() => runNow(item.id)}
              className="rounded-[var(--radius-control)] py-2 text-[12px] font-medium transition-colors disabled:opacity-40"
            >
              Run now
            </Button>
            <Button
              variant="secondary"
              fullWidth
              disabled={busy}
              onClick={() => togglePaused(item)}
              className="rounded-[var(--radius-control)] py-2 text-[12px] font-medium transition-colors hover:bg-[color-mix(in_oklch,var(--foreground)_6%,transparent)] disabled:opacity-40"
              style={{ borderColor: "var(--border-hairline)", color: "var(--text-secondary)" }}
            >
              {paused ? "Resume" : "Pause"}
            </Button>
          </>
        )}
        {isRecurring && isReminder && (
          <Button
            variant="secondary"
            fullWidth
            disabled={busy}
            onClick={() => stopRecurrence(item.id)}
            className="rounded-[var(--radius-control)] py-2 text-[12px] font-medium transition-colors hover:bg-[color-mix(in_oklch,var(--foreground)_6%,transparent)] disabled:opacity-40"
            style={{ borderColor: "var(--border-hairline)", color: "var(--text-secondary)" }}
          >
            Stop repeating
          </Button>
        )}
        <Button
          variant="danger-ghost"
          fullWidth
          disabled={busy}
          onClick={() => removeItem(item.id)}
          className="rounded-[var(--radius-control)] py-2 text-[12px] font-medium transition-colors hover:bg-red-900/20 disabled:opacity-40"
          style={{ color: "oklch(0.65 0.18 20)" }}
        >
          Delete
        </Button>
      </div>
    </div>
  );
}

// Row quick-actions (run-now, pause/resume) are wired once at the top of the
// view and read by each leaf row — so the most-used actions sit right on the
// row instead of buried in the detail panel. Avoids threading callbacks through
// the list/section components.
type ScheduleActions = {
  runAutomation: (auto: CodexAutomation) => void;
  togglePauseAutomation: (auto: CodexAutomation) => void;
};
const ScheduleActionsContext = createContext<ScheduleActions | null>(null);

// Always-visible labeled row action — the same affordance the All/Flows rows
// use, so every tab exposes identical controls. Rendered as a sibling of the
// row's own button (never nested), so a click can't also open the detail panel.
function RowActionButton({ icon, label, text, onClick, disabled }: { icon: IconName; label: string; text: string; onClick: () => void; disabled?: boolean }) {
  return (
    <Button
      variant="ghost"
      size="xs"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="shrink-0 rounded-[var(--radius-control)] px-2 py-1 text-[11px] font-medium transition-colors hover:bg-[color-mix(in_oklch,var(--foreground)_10%,transparent)]"
      style={{ color: "var(--text-secondary)" }}
      leadingIcon={icon}
    >
      {/* Icon-only when the hosting pane runs narrow (e.g. the md split while a
          detail rail is open) — the aria-label keeps the full action name. */}
      <span className="@max-[520px]:hidden">{text}</span>
    </Button>
  );
}

function RowActions({ children }: { children: ReactNode }) {
  return <span className="flex shrink-0 items-center gap-0.5 pl-1">{children}</span>;
}

// ── Codex automation detail panel ────────────────────────────────────────────
function CodexDetailPanel({
  auto,
  busy,
  expanded,
  onToggleExpanded,
  onClose,
  onToggle,
  onSave,
  onDelete,
  onRun,
  runs,
}: {
  auto: CodexAutomation;
  busy: boolean;
  /** Full-page-width mode: the rail grows to fill the surface and the form
   *  reflows into a two-column canvas (list hidden until collapsed). */
  expanded: boolean;
  onToggleExpanded: () => void;
  onClose: () => void;
  onToggle: (auto: CodexAutomation) => void;
  onSave: (auto: CodexAutomation, patch: CodexAutomationPatch) => void;
  onDelete: (auto: CodexAutomation) => void;
  onRun: (auto: CodexAutomation) => void;
  runs: AutomationRunRecord[];
}) {
  const isActive = auto.status === "ACTIVE";
  // Dialog semantics for the cron detail panel — trap focus, Escape closes, focus
  // returns to the opening row. aria-modal omitted (see DetailPanel's note).
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useFocusTrap(true, panelRef, { onEscape: onClose });
  const parsedSchedule = useMemo(() => parseCodexRrule(auto.rrule), [auto.rrule]);
  const promptParts = splitAutomationPrompt(auto.prompt);
  const [openRunId, setOpenRunId] = useState<string | null>(null);
  const [runLog, setRunLog] = useState<string>("");
  const [runLogLoading, setRunLogLoading] = useState(false);
  // Rapid run switches: only the latest log request may write state, or a
  // slow earlier response renders the WRONG log under the newer run's header
  // (same stale-response guard as runsReqRef for the runs list).
  const runLogReqRef = useRef(0);
  const toggleRunLog = async (runId: string) => {
    if (openRunId === runId) {
      // Closing also invalidates any in-flight fetch for this run's log.
      runLogReqRef.current += 1;
      setOpenRunId(null);
      return;
    }
    const req = ++runLogReqRef.current;
    setOpenRunId(runId);
    setRunLog("");
    setRunLogLoading(true);
    try {
      const res = await fetch(`/api/codex-automations/${encodeURIComponent(auto.id)}/runs/${encodeURIComponent(runId)}/log`, { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (req !== runLogReqRef.current) return;
      setRunLog(json?.ok ? (json.truncated ? "…(truncated)…\n" : "") + (json.log ?? "") : (json?.error ?? "no log"));
    } catch {
      if (req !== runLogReqRef.current) return;
      setRunLog("failed to load log");
    } finally {
      if (req === runLogReqRef.current) setRunLogLoading(false);
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
  const latestRun = runs[0];
  const latestRunLabel = latestRun
    ? `${latestRun.status} ${relTime(latestRun.startedAt)}`
    : "No runs yet";


  // Each section is built once; the layout arranges them per mode. The rail
  // stacks them in priority order (identity, instructions, schedule, runtime),
  // while the expanded canvas pairs them into two independent column stacks so
  // a short section never leaves a row-aligned hole beside a tall one.
  const identitySection = (
    <CronDetailSection title="Identity" description="Name and labels used to recognize this cron in Rituals.">
      <div>
        <FieldLabel htmlFor={`cron-name-${auto.id}`}>Name</FieldLabel>
        <input
          id={`cron-name-${auto.id}`}
          value={name}
          onChange={(event) => setName(event.target.value)}
          className={automationInputClass}
          style={fieldStyle}
        />
      </div>
      <div className="grid grid-cols-1 gap-3 @min-[640px]:grid-cols-2">
        <div>
          <FieldLabel htmlFor={`cron-tags-${auto.id}`}>Tags</FieldLabel>
          <input
            id={`cron-tags-${auto.id}`}
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
    </CronDetailSection>
  );
  const instructionsSection = (
    <CronDetailSection title="Instructions" description="What the cron should do and what output it should leave behind.">
      <div>
        <FieldLabel htmlFor={`cron-goals-${auto.id}`}>Goals</FieldLabel>
        <textarea
          id={`cron-goals-${auto.id}`}
          value={goals}
          onChange={(event) => setGoals(event.target.value)}
          rows={5}
          className={automationTextareaClass}
          style={fieldStyle}
        />
      </div>
      <div>
        <FieldLabel htmlFor={`cron-deliverables-${auto.id}`}>Deliverables</FieldLabel>
        <textarea
          id={`cron-deliverables-${auto.id}`}
          value={deliverables}
          onChange={(event) => setDeliverables(event.target.value)}
          rows={4}
          className={automationTextareaClass}
          style={fieldStyle}
        />
      </div>
    </CronDetailSection>
  );
  const scheduleSection = (
    <CronDetailSection title="Schedule" description="Choose the cadence first; use raw RRULE only when the presets are too narrow.">
      <div className="inline-flex rounded-[var(--radius-control)] border p-0.5"
        style={{ borderColor: "var(--border-hairline)", background: "var(--bg-base)" }}
        role="group"
        aria-label="Schedule mode"
      >
        {(["weekly", "daily", "raw"] as const).map((mode) => (
          <Button
            key={mode}
            variant="ghost"
            size="xs"
            onClick={() => setScheduleMode(mode)}
            aria-pressed={scheduleMode === mode}
            className="rounded-[var(--radius-control)] px-2 py-1 text-[11px]"
            style={{
              background: scheduleMode === mode ? "rgba(255,255,255,0.08)" : "transparent",
              color: scheduleMode === mode ? "var(--text-primary)" : "var(--text-muted)",
            }}
          >
            {SCHEDULE_MODE_LABEL[mode]}
          </Button>
        ))}
      </div>

      {scheduleMode === "raw" ? (
        <textarea
          aria-label="Raw RRULE"
          value={rawRrule}
          onChange={(event) => setRawRrule(event.target.value)}
          rows={3}
          className={automationMonoTextareaClass}
          style={fieldStyle}
        />
      ) : (
        <div className="space-y-3">
          {scheduleMode === "weekly" && (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Days of week">
              {RRULE_DAY_ORDER.map((day) => {
                const selected = scheduleDays.includes(day);
                return (
                  <Button
                    key={day}
                    variant="ghost"
                    size="xs"
                    onClick={() => toggleDay(day)}
                    aria-pressed={selected}
                    className="rounded-[var(--radius-control)] border px-2 py-1 text-[11px]"
                    style={{
                      background: selected ? "color-mix(in oklch, var(--accent-presence) 18%, transparent)" : "var(--bg-base)",
                      borderColor: selected ? "color-mix(in oklch, var(--accent-presence) 50%, transparent)" : "var(--border-hairline)",
                      color: selected ? "var(--text-primary)" : "var(--text-muted)",
                    }}
                  >
                    {RRULE_DAY_LABEL[day]}
                  </Button>
                );
              })}
            </div>
          )}
          <input
            type="time"
            aria-label="Schedule time"
            value={scheduleTime}
            onChange={(event) => setScheduleTime(event.target.value)}
            className={automationInputClass}
            style={fieldStyle}
          />
        </div>
      )}
      {/* Plain-language echo of the chosen cadence for preset modes; the
          cryptic RRULE line only surfaces in Advanced mode or when the
          schedule is invalid — beginners never have to read iCalendar. */}
      {scheduleMode !== "raw" && !invalidSchedule ? (
        <p className="mt-2 text-[11px]" style={{ color: "var(--text-muted)" }}>
          {scheduleMode === "daily"
            ? `Runs every day at ${scheduleTime}`
            : `Runs weekly on ${scheduleDays.map((d) => RRULE_DAY_LABEL[d]).join(", ")} at ${scheduleTime}`}
        </p>
      ) : (
        <p className="mt-2 break-all font-mono text-[10px]" style={{ color: invalidSchedule ? "oklch(0.7 0.16 35)" : "var(--text-muted)" }}>
          {nextRrule || "RRULE required"}
        </p>
      )}
    </CronDetailSection>
  );
  const runtimeSection = (
    <CronDetailSection title="Runtime" description="Where the cron runs and which model settings it should use.">
      <div className="grid grid-cols-1 gap-3 @min-[640px]:grid-cols-2">
        <div>
          <FieldLabel htmlFor={`cron-model-${auto.id}`}>Model</FieldLabel>
          <input
            id={`cron-model-${auto.id}`}
            value={model}
            onChange={(event) => setModel(event.target.value)}
            className={automationInputClass}
            style={fieldStyle}
          />
        </div>
        <div>
          <FieldLabel>Reasoning</FieldLabel>
          <StandardSelect
            label="Reasoning"
            value={reasoningEffort}
            onChange={setReasoningEffort}
            className={automationSelectClass}
            style={fieldStyle}
            options={[
              ...(!["low", "medium", "high"].includes(reasoningEffort)
                ? [{ value: reasoningEffort, label: reasoningEffort }]
                : []),
              { value: "low", label: "low" },
              { value: "medium", label: "medium" },
              { value: "high", label: "high" },
            ]}
          />
        </div>
        <div>
          <FieldLabel>Environment</FieldLabel>
          <StandardSelect
            label="Environment"
            value={executionEnvironment}
            onChange={setExecutionEnvironment}
            className={automationSelectClass}
            style={fieldStyle}
            options={[
              ...(!["worktree", "repo"].includes(executionEnvironment)
                ? [{ value: executionEnvironment, label: executionEnvironment }]
                : []),
              { value: "worktree", label: "worktree" },
              { value: "repo", label: "repo" },
            ]}
          />
        </div>
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
    </CronDetailSection>
  );
  const runsSection = runs.length > 0 ? (
    <CronDetailSection title="Recent runs" description="Open a run to inspect its log without leaving this cron.">
      <ul className="mt-1 space-y-1">
        {runs.slice(0, 10).map((r) => (
          <li key={r.id}>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => void toggleRunLog(r.id)}
              aria-expanded={openRunId === r.id}
              aria-controls={`automation-run-log-${r.id}`}
              aria-label={`${r.status} run ${relTime(r.startedAt)}${r.summary ? ` — ${r.summary}` : ""}, ${openRunId === r.id ? "hide" : "show"} log`}
              className="w-full justify-start rounded-[var(--radius-control)] px-2 py-1 text-left text-[12px] hover:bg-[color-mix(in_oklch,var(--foreground)_6%,transparent)]"
            >
              {/* Shape + color (WCAG 1.4.1): the icon form carries the
                  status for color-blind users; AT reads it from the
                  button's aria-label. */}
              <span aria-hidden className="shrink-0" style={{ color: runStatusColor(r.status), lineHeight: 0 }}>
                <Icon name={runStatusIcon(r.status)} width={12} />
              </span>
              <span style={{ color: "var(--text-secondary)" }} title={r.startedAt ? formatTimestamp(r.startedAt, readDateTimePrefs()) : undefined}>{relTime(r.startedAt)}</span>
              {r.summary && <span className="truncate" style={{ color: "var(--text-muted)" }}>{r.summary}</span>}
              <span aria-hidden className="ml-auto shrink-0" style={{ color: "var(--text-muted)", lineHeight: 0 }}>
                <Icon name={openRunId === r.id ? "ph:caret-down" : "ph:caret-right"} width={11} />
              </span>
            </Button>
            {openRunId === r.id && (
              <pre
                id={`automation-run-log-${r.id}`}
                className="mt-1 max-h-48 overflow-auto rounded-[var(--radius-control)] bg-[var(--bg-base)] p-2 text-[10px] leading-snug"
                style={{ color: "var(--text-muted)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}
              >
                {runLogLoading ? "Loading…" : (runLog || "(empty log)")}
              </pre>
            )}
          </li>
        ))}
      </ul>
    </CronDetailSection>
  ) : null;

  return (
    <div ref={panelRef} role="dialog" aria-labelledby={titleId} tabIndex={-1}
      className="flex h-full flex-col focus:outline-none"
      style={{ background: "var(--bg-raised)", borderLeft: "1px solid var(--border-hairline)" }}>
      <div className="border-b px-5 py-4"
        style={{ borderColor: "var(--border-hairline)" }}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
              Cron details
            </p>
            <h2 id={titleId} className="mt-1 truncate text-[15px] font-semibold" style={{ color: "var(--text-primary)" }}>
              {name.trim() || auto.name}
            </h2>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border px-2 py-1 text-[11px] font-medium"
              style={{
                borderColor: isActive ? "color-mix(in oklch, var(--accent-presence) 45%, transparent)" : "var(--border-hairline)",
                background: isActive ? "color-mix(in oklch, var(--accent-presence) 14%, transparent)" : "var(--bg-base)",
                color: isActive ? "oklch(0.75 0.1 150)" : "var(--text-muted)",
              }}
            >
              <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: isActive ? "oklch(0.75 0.1 150)" : "var(--text-muted)" }} />
              {isActive ? "Active" : "Paused"}
            </span>
            <Button
              variant="ghost"
              size="xs"
              onClick={onToggleExpanded}
              aria-pressed={expanded}
              aria-label={expanded ? "Collapse to side panel" : "Expand to full width"}
              title={expanded ? "Collapse to side panel" : "Expand to full width"}
              className="cron-detail-expand-toggle rounded-[var(--radius-control)] text-[var(--text-muted)] hover:bg-[color-mix(in_oklch,var(--foreground)_6%,transparent)]"
              leadingIcon={expanded ? "ph:arrows-in-simple" : "ph:arrows-out-simple"}
            />
            <Button
              variant="ghost"
              size="xs"
              onClick={onClose}
              aria-label="Close"
              className="rounded-[var(--radius-control)] text-[var(--text-muted)] hover:bg-[color-mix(in_oklch,var(--foreground)_6%,transparent)]"
              leadingIcon="ph:x"
            />
          </div>
        </div>
      </div>

      {/* Merge of main's expanded variant with the split-fit container: columns
          key off the pane, not the viewport (cave-hivd). */}
      <div className={`@container flex-1 overflow-y-auto py-5 ${expanded ? "px-6 md:px-8" : "px-5"}`}>
        <div className={`space-y-5${expanded ? " mx-auto w-full max-w-6xl" : ""}`}>
        <div className={`cron-detail-summary-grid grid grid-cols-2 gap-2${expanded ? " @min-[900px]:grid-cols-4" : ""}`}>
          <CronSummaryTile label="Schedule" value={auto.scheduleHuman || nextRrule || "Not scheduled"} tone={invalidSchedule ? "danger" : "default"} />
          <CronSummaryTile label="Status" value={isActive ? "Active" : "Paused"} tone={isActive ? "active" : "paused"} />
          <CronSummaryTile label="Model" value={model.trim() || "Default"} />
          <CronSummaryTile label="Last run" value={latestRunLabel} tone={latestRun?.status === "failed" ? "danger" : "default"} />
        </div>

        {expanded ? (
          <div className="grid items-start gap-5 lg:grid-cols-2">
            <div className="min-w-0 space-y-5">
              {identitySection}
              {scheduleSection}
            </div>
            <div className="min-w-0 space-y-5">
              {instructionsSection}
              {runtimeSection}
            </div>
            {runsSection && <div className="min-w-0 lg:col-span-2">{runsSection}</div>}
          </div>
        ) : (
          <div className="space-y-5">
            {identitySection}
            {instructionsSection}
            {scheduleSection}
            {runtimeSection}
            {runsSection}
          </div>
        )}
        </div>
      </div>

      <div className="cron-detail-actions border-t px-5 py-4"
        style={{ borderColor: "var(--border-hairline)" }}>
        <div className={`space-y-3${expanded ? " mx-auto w-full max-w-xl" : ""}`}>
        {saveBlockedReason ? (
          <p className="text-[11px]" style={{ color: "oklch(0.7 0.16 35)" }} role="alert">
            {saveBlockedReason}
          </p>
        ) : null}
        <Button
          variant="primary"
          fullWidth
          disabled={!canSave}
          onClick={save}
          className="justify-center rounded-[var(--radius-control)] py-2 text-[12px] font-medium transition-colors disabled:opacity-40"
          leadingIcon="ph:floppy-disk-bold"
        >
          {busy ? "Saving..." : "Save changes"}
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => onRun(auto)}
            className="justify-center rounded-[var(--radius-control)] text-[12px] font-medium"
            leadingIcon="ph:play"
          >
            Run now
          </Button>
          <Button
            variant={isActive ? "danger" : "secondary"}
            disabled={busy}
            onClick={() => onToggle(auto)}
            className="justify-center rounded-[var(--radius-control)] text-[12px] font-medium"
            leadingIcon={isActive ? "ph:pause" : "ph:play"}
          >
            {busy ? (isActive ? "Pausing…" : "Activating…") : (isActive ? "Pause" : "Activate")}
          </Button>
        </div>
        <div className="border-t pt-3" style={{ borderColor: "var(--border-hairline)" }}>
          <Button
            variant="danger-ghost"
            disabled={busy}
            onClick={() => onDelete(auto)}
            className="rounded-[var(--radius-control)] text-[12px] font-medium"
            leadingIcon="ph:trash"
          >
            Delete
          </Button>
        </div>
        </div>
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
    <li className="flex items-center">
      <button
        type="button"
        onClick={() => onSelect(auto)}
        aria-current={selected ? "true" : undefined}
        className={`focus-ring-inset automation-list-row group flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors ${selected ? "bg-[color-mix(in_oklch,var(--foreground)_6%,transparent)]" : "hover:bg-[color-mix(in_oklch,var(--foreground)_6%,transparent)]"}`}
      >
        {/* Status dot */}
        {isActive ? (
          <span role="img" aria-label="Active" className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full"
            style={{ background: "var(--accent-presence)" }} />
        ) : (
          <span role="img" aria-label="Paused" className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border"
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
          <span className="shrink-0 text-[11px] @max-[600px]:hidden" title={lastRun.startedAt ? formatTimestamp(lastRun.startedAt, readDateTimePrefs()) : undefined} style={{ color: runStatusColor(lastRun.status, { quietSuccess: true }) }}>
            Run {relTime(lastRun.startedAt)}
          </span>
        )}
        <span className="cron-schedule-chip shrink-0 @max-[440px]:hidden" title={`Runs ${auto.scheduleHuman}`}>
          <Icon name="ph:clock" width={11} aria-hidden className="cron-schedule-chip__icon" />
          <span className="tabular-nums">{auto.scheduleHuman}</span>
        </span>
      </button>
      {actions && (
        <RowActions>
          <RowActionButton icon="ph:play" label={`Run ${auto.name} now`} text="Run" onClick={() => actions.runAutomation(auto)} />
          <RowActionButton
            icon={isActive ? "ph:pause" : "ph:play"}
            label={`${isActive ? "Pause" : "Resume"} ${auto.name}`}
            text={isActive ? "Pause" : "Resume"}
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
  const headingId = `cron-section-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <section aria-labelledby={headingId} className="mb-6">
      <div className="flex items-center gap-3 mb-1 rounded-md px-3 py-1.5"
        style={{ background: "color-mix(in oklch, var(--bg-base) 86%, var(--foreground) 14%)", borderBottom: "1px solid var(--border-hairline)" }}>
        <h3 id={headingId} className="text-[12px] font-bold" style={{ color: "var(--text-primary)" }}>
          {title}
        </h3>
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
    </section>
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
  selectMode,
  checked,
  familiarLabel,
  onSelect,
  onToggle,
  onDone,
  onSnooze,
  onDismiss,
  onUnwatch,
}: {
  item: InboxItem;
  selected: boolean;
  selectMode: boolean;
  checked: boolean;
  familiarLabel: (fid?: string | null) => string | null;
  onSelect: (item: InboxItem) => void;
  onToggle: (id: string) => void;
  onDone?: (item: InboxItem) => void;
  onSnooze?: (item: InboxItem) => void;
  onDismiss?: (item: InboxItem) => void;
  /** One-click "stop these" for GitHub-event notifications (cave-hlxn). */
  onUnwatch?: (item: InboxItem, repo: string) => void;
}) {
  const workspace = familiarLabel(item.familiarId);
  const when = item.firedAt
    ? `fired ${relTime(item.firedAt)}`
    : item.fireAt
    ? relTime(item.fireAt)
    : relTime(item.updatedAt);
  // Done/snooze/dismiss only make sense while the item is still live; snooze
  // additionally only for something that already fired (re-surface later).
  const resolved = item.status === "done" || item.status === "dismissed";
  // In select mode the row IS a checkbox (click/Enter/Space toggle); otherwise
  // it opens the detail panel — the shared list select-mode pattern.
  const active = selectMode ? checked : selected;
  const activate = () => (selectMode ? onToggle(item.id) : onSelect(item));
  const watchedRepo = repoFromGithubSubTag(item.auto);

  return (
    <li className="flex items-center">
      <button
        type="button"
        role={selectMode ? "checkbox" : undefined}
        aria-checked={selectMode ? checked : undefined}
        onClick={activate}
        aria-current={!selectMode && selected ? "true" : undefined}
        className={`focus-ring-inset automation-list-row group flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors ${active ? "bg-[color-mix(in_oklch,var(--foreground)_6%,transparent)]" : "hover:bg-[color-mix(in_oklch,var(--foreground)_6%,transparent)]"}`}
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
            {checked && <Icon name="ph:check-bold" width={12} className="text-[var(--accent-presence-foreground)]" />}
          </span>
        ) : (
          <StatusIcon item={item} />
        )}
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
      {!selectMode && !resolved && (onDone || onSnooze || onDismiss || onUnwatch) && (
        <RowActions>
          {onDone && (
            <RowActionButton icon="ph:check-bold" label={`Mark ${item.title} done`} text="Done" onClick={() => onDone(item)} />
          )}
          {onSnooze && item.status === "fired" && (
            <RowActionButton icon="ph:clock-countdown" label={`Snooze ${item.title} for 1 hour`} text="Snooze 1h" onClick={() => onSnooze(item)} />
          )}
          {onUnwatch && watchedRepo && (
            <RowActionButton
              icon="ph:bell-slash"
              label={`Unwatch ${watchedRepo} — stop GitHub notifications from it`}
              text="Unwatch"
              onClick={() => onUnwatch(item, watchedRepo)}
            />
          )}
          {onDismiss && (
            <RowActionButton icon="ph:x" label={`Dismiss ${item.title}`} text="Dismiss" onClick={() => onDismiss(item)} />
          )}
        </RowActions>
      )}
    </li>
  );
}

function InboxFeedSection({
  group,
  selectedId,
  selectMode,
  groupChecked,
  onToggleGroup,
  isSelected,
  onToggle,
  familiarLabel,
  onSelect,
  onDone,
  onSnooze,
  onDismiss,
  onUnwatch,
}: {
  group: InboxFeedGroup;
  selectedId: string | null;
  selectMode: boolean;
  groupChecked: boolean;
  onToggleGroup: (group: InboxFeedGroup) => void;
  isSelected: (id: string) => boolean;
  onToggle: (id: string) => void;
  familiarLabel: (fid?: string | null) => string | null;
  onSelect: (item: InboxItem) => void;
  onDone?: (item: InboxItem) => void;
  onSnooze?: (item: InboxItem) => void;
  onDismiss?: (item: InboxItem) => void;
  onUnwatch?: (item: InboxItem, repo: string) => void;
}) {
  const headingId = useId();
  if (group.items.length === 0) return null;
  return (
    <section className="mb-6" aria-labelledby={headingId}>
      <div className="flex items-center gap-3 mb-1 rounded-md px-3 py-1.5"
        style={{ background: "color-mix(in oklch, var(--bg-base) 86%, var(--foreground) 14%)", borderBottom: "1px solid var(--border-hairline)" }}>
        {/* Select a whole group at once — the header grows a checkbox in
            select mode so a tier/kind/familiar bucket is one click to act on. */}
        {selectMode ? (
          <button
            type="button"
            role="checkbox"
            aria-checked={groupChecked}
            aria-label={`Select every item in ${group.title}`}
            title={`Select all ${group.items.length} in ${group.title}`}
            onClick={() => onToggleGroup(group)}
            className="focus-ring flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-[4px] border transition-colors"
            style={{
              borderColor: groupChecked ? "var(--accent-presence)" : "var(--border-strong)",
              background: groupChecked ? "var(--accent-presence)" : "transparent",
            }}
          >
            {groupChecked && <Icon name="ph:check-bold" width={11} className="text-[var(--accent-presence-foreground)]" aria-hidden />}
          </button>
        ) : null}
        <h3 id={headingId} className="text-[12px] font-bold" style={{ color: "var(--text-primary)" }}>
          {group.title}
        </h3>
        <span
          className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
          style={
            group.accent
              ? { background: "color-mix(in oklch, var(--color-warning) 18%, transparent)", color: "var(--color-warning)" }
              : { background: "var(--bg-raised)", color: "var(--text-muted)" }
          }
        >
          {group.items.length}
        </span>
      </div>
      <ul aria-labelledby={headingId}>
        {group.items.map((item) => (
          <InboxFeedRow
            key={item.id}
            item={item}
            selected={selectedId === item.id}
            selectMode={selectMode}
            checked={isSelected(item.id)}
            familiarLabel={familiarLabel}
            onSelect={onSelect}
            onToggle={onToggle}
            onDone={onDone}
            onSnooze={onSnooze}
            onDismiss={onDismiss}
            onUnwatch={onUnwatch}
          />
        ))}
      </ul>
    </section>
  );
}

function InboxFeedList({
  groups,
  selectedId,
  selectMode,
  isSelected,
  groupSelected,
  onToggleGroup,
  onToggle,
  familiarLabel,
  onSelect,
  onDone,
  onSnooze,
  onDismiss,
  onUnwatch,
}: {
  groups: InboxFeedGroup[];
  selectedId: string | null;
  selectMode: boolean;
  isSelected: (id: string) => boolean;
  groupSelected: (group: InboxFeedGroup) => boolean;
  onToggleGroup: (group: InboxFeedGroup) => void;
  onToggle: (id: string) => void;
  familiarLabel: (fid?: string | null) => string | null;
  onSelect: (item: InboxItem) => void;
  onDone?: (item: InboxItem) => void;
  onSnooze?: (item: InboxItem) => void;
  onDismiss?: (item: InboxItem) => void;
  onUnwatch?: (item: InboxItem, repo: string) => void;
}) {
  return (
    <>
      {groups.map((group) => (
        <InboxFeedSection
          key={group.id}
          group={group}
          selectedId={selectedId}
          selectMode={selectMode}
          groupChecked={groupSelected(group)}
          onToggleGroup={onToggleGroup}
          isSelected={isSelected}
          onToggle={onToggle}
          familiarLabel={familiarLabel}
          onSelect={onSelect}
          onDone={onDone}
          onSnooze={onSnooze}
          onDismiss={onDismiss}
          onUnwatch={onUnwatch}
        />
      ))}
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
      className="flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors hover:bg-[color-mix(in_oklch,var(--foreground)_6%,transparent)] disabled:opacity-40"
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
  onTogglePause,
}: {
  entry: AutomationEntry;
  familiarLabel: (id?: string | null) => string | null;
  busy: boolean;
  onRun: (entry: AutomationEntry) => void;
  onOpen: (entry: AutomationEntry) => void;
  onTogglePause?: (entry: AutomationEntry) => void;
}) {
  const fam = familiarLabel(entry.familiarId);
  const entryPaused = entry.state === "paused";
  // Next fire (reminders only, for now) as a friendly relative time alongside the
  // schedule string — so the unified list answers "when next?" at a glance.
  const nextFire = entry.state === "active" && entry.nextFireAt ? relTime(entry.nextFireAt) : null;
  return (
    <div
      className="automation-list-row flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-[color-mix(in_oklch,var(--foreground)_6%,transparent)]"
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
        <span className="mt-1.5 flex items-center gap-1">
          <RowActionButton
            icon="ph:play"
            label={`Run ${entry.name} now`}
            text={busy ? "…" : "Run"}
            onClick={() => onRun(entry)}
            disabled={busy}
          />
          {onTogglePause && (
            <RowActionButton
              icon={entryPaused ? "ph:play" : "ph:pause"}
              label={`${entryPaused ? "Resume" : "Pause"} ${entry.name}`}
              text={entryPaused ? "Resume" : "Pause"}
              onClick={() => onTogglePause(entry)}
              disabled={busy}
            />
          )}
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
  onTogglePause,
  pausable,
}: {
  entries: AutomationEntry[];
  busyId: string | null;
  familiarLabel: (id?: string | null) => string | null;
  onRun: (entry: AutomationEntry) => void;
  onOpen: (entry: AutomationEntry) => void;
  onTogglePause: (entry: AutomationEntry) => void;
  pausable: (entry: AutomationEntry) => boolean;
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
          onTogglePause={pausable(entry) ? onTogglePause : undefined}
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
  paused,
  onRun,
  onOpen,
  onTogglePause,
}: {
  type: AutomationType;
  name: string;
  meta: string;
  busy: boolean;
  paused?: boolean;
  onRun: () => void;
  onOpen: () => void;
  onTogglePause?: () => void;
}) {
  return (
    <div
      className="automation-list-row flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-[color-mix(in_oklch,var(--foreground)_6%,transparent)]"
      style={{ border: "1px solid var(--border-hairline)" }}
    >
      <AutomationTypeChip type={type} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium" style={{ color: "var(--text-primary)" }}>{name}</span>
        <span className="mt-0.5 block truncate text-[11px]" style={{ color: "var(--text-muted)" }}>{meta}</span>
        <span className="mt-1.5 flex items-center gap-1">
          <RowActionButton
            icon="ph:play"
            label={`Run ${name} now`}
            text={busy ? "…" : "Run"}
            onClick={onRun}
            disabled={busy}
          />
          {onTogglePause && (
            <RowActionButton
              icon={paused ? "ph:play" : "ph:pause"}
              label={`${paused ? "Resume" : "Pause"} ${name}`}
              text={paused ? "Resume" : "Pause"}
              onClick={onTogglePause}
              disabled={busy}
            />
          )}
          <RowActionButton
            icon="ph:arrow-square-out"
            label={`Open ${name}`}
            text="Open"
            onClick={onOpen}
          />
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
  onTogglePause,
}: {
  flows: FlowDoc[];
  query: string;
  busyId: string | null;
  onRun: (flow: FlowDoc) => void;
  onOpen: (flow: FlowDoc) => void;
  onTogglePause: (flow: FlowDoc) => void;
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
            paused={!flow.active}
            onRun={() => onRun(flow)}
            onOpen={() => onOpen(flow)}
            onTogglePause={() => onTogglePause(flow)}
          />
        );
      })}
    </div>
  );
}

// ── Templates panel ───────────────────────────────────────────────────────────
function TemplatesPanel({
  query,
  onQueryChange,
  onSelect,
}: {
  query: string;
  onQueryChange: (q: string) => void;
  onSelect: (tpl: AutomationTemplate) => void;
}) {
  const q = query.toLowerCase().trim();
  const filtered = q
    ? AUTOMATION_TEMPLATES.filter(
        (t) => t.title.toLowerCase().includes(q) || t.scheduleLabel.toLowerCase().includes(q),
      )
    : AUTOMATION_TEMPLATES;

  const byCategory = TEMPLATE_CATEGORIES.map((cat) => ({
    cat,
    templates: filtered.filter((t) => t.category === cat),
  })).filter(({ templates }) => templates.length > 0);

  return (
    <div className="automation-templates-panel">
      <div className="mb-5">
        <SearchInput
          value={query}
          onValueChange={onQueryChange}
          onClear={() => onQueryChange("")}
          placeholder="Search templates…"
          aria-label="Search templates"
        />
      </div>
      {byCategory.length === 0 ? (
        <EmptyState
          className="mt-8"
          icon="ph:magnifying-glass"
          headline={`No templates match "${query.trim()}"`}
          subtitle="Try a different search term."
        />
      ) : (
        byCategory.map(({ cat, templates }) => (
          <section key={cat} className="mb-6">
            <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
              {cat}
            </h2>
            <div className="automation-templates-grid">
              {templates.map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  className="automation-template-card focus-ring"
                  onClick={() => onSelect(tpl)}
                >
                  <span className="automation-template-card__emoji" aria-hidden>
                    {tpl.emoji}
                  </span>
                  <span className="automation-template-card__title">{tpl.title}</span>
                  <span className="automation-template-card__schedule">{tpl.scheduleLabel}</span>
                </button>
              ))}
            </div>
          </section>
        ))
      )}
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
  const [error, setError] = useState<string | null>(null);
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Async CRUD results are announced for AT — errors already hit the
  // role="alert" banner and deletes are voiced by UndoToast; everything else
  // (pause/resume/run/create/save/restore) was silent.
  const { announce } = useAnnouncer();
  // Focus lands here after a delete unmounts the detail panel that held it —
  // otherwise it falls to <body> and keyboard users lose their place.
  const newBtnRef = useRef<HTMLButtonElement | null>(null);
  const [activeTab, setActiveTab] = useState<AutomationTab>(
    initialTab === "calendar" && calendarSlot ? "calendar" : initialTab === "crons" ? "crons" : "inbox",
  );
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  // Selected item is either an InboxItem or a CodexAutomation — track by kind
  const [selectedItem, setSelectedItem] = useState<InboxItem | null>(null);
  const [selectedCodex, setSelectedCodex] = useState<CodexAutomation | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  // GitHub subscriptions manager, reachable from the Inbox tab (cave-hlxn).
  const [subsOpen, setSubsOpen] = useState(false);
  const [subsHasPat, setSubsHasPat] = useState(false);
  const [templateInitialValues, setTemplateInitialValues] = useState<AutomationCreateInitialValues | undefined>();
  const [templatesQuery, setTemplatesQuery] = useState("");
  const [automationRuns, setAutomationRuns] = useState<AutomationRunRecord[]>([]);
  const [lastRunById, setLastRunById] = useState<Map<string, AutomationRunRecord>>(new Map());
  // Guards async setState after unmount; runsReqRef drops a stale per-automation
  // runs fetch when a faster, later selection won.
  const mountedRef = useRef(true);
  const runsReqRef = useRef(0);
  // Sequence guard for load(), mirroring runsReqRef: load() runs from mount, the
  // 15s poll, AND after every mutation (toggle/save/delete all await load()), so
  // an in-flight poll can resolve *after* a mutation's reload and reapply its
  // pre-mutation data — a just-paused cron would flip back to Active for up to
  // 15s. Dropping a superseded load's writes closes that revert-flash.
  const loadReqRef = useRef(0);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const load = useCallback(async () => {
    const reqId = ++loadReqRef.current;
    // Live only while this is still the newest load AND the view is mounted; a
    // superseded (or unmounted) load drops all its writes.
    const live = () => reqId === loadReqRef.current && mountedRef.current;
    try {
      const [inboxRes, codexRes] = await Promise.all([
        fetch("/api/inbox", { cache: "no-store" }),
        fetch("/api/codex-automations", { cache: "no-store" }),
      ]);
      const inboxJson = await inboxRes.json();
      if (!live()) return;
      if (!inboxJson.ok) { setError(inboxJson.error ?? "load failed"); return; }
      // Content-equality guards (codebase convention — see board-view/workspace):
      // an unchanged poll keeps the previous references, so derived memos,
      // the selected-detail sync effect, and the per-cron runs fan-out all
      // stay quiet instead of re-firing every 15s.
      const nextItems = inboxJson.items ?? [];
      setItems((prev) => (arrayContentEqual(prev, nextItems) ? prev : nextItems));
      const codexJson = await codexRes.json();
      if (!live()) return;
      if (codexJson.ok) {
        const nextAutos = codexJson.automations ?? [];
        setCodexAutos((prev) => (arrayContentEqual(prev, nextAutos) ? prev : nextAutos));
      }
      setError(null);
    } catch (err) {
      if (live()) setError(err instanceof Error ? err.message : "fetch failed");
    } finally {
      if (live()) setInitialLoadDone(true);
    }
  }, []);

  const refreshRuns = useCallback(async (id: string) => {
    const reqId = ++runsReqRef.current;
    try {
      const res = await fetch(`/api/codex-automations/${encodeURIComponent(id)}/runs`);
      const json = await res.json().catch(() => null);
      // Drop a stale runs response: a later selection (or poll) superseded it.
      if (reqId !== runsReqRef.current || !mountedRef.current) return;
      if (json?.ok && Array.isArray(json.runs)) {
        // Content-guard: an unchanged poll keeps the array identity, so the
        // in-flight poll effect below stops tearing down its interval every
        // 2.5s tick (cave-1e6k).
        const runs = json.runs as AutomationRunRecord[];
        setAutomationRuns((prev) => (arrayContentEqual(prev, runs) ? prev : runs));
        // This response already carries the newest run — update the row badge
        // map here instead of re-fetching the same endpoint via the
        // every-automation fan-out.
        const newest = runs[0];
        if (newest) {
          setLastRunById((prev) => {
            const current = prev.get(id);
            if (current && JSON.stringify(current) === JSON.stringify(newest)) return prev;
            const next = new Map(prev);
            next.set(id, newest);
            return next;
          });
        }
      }
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
  useEffect(() => { void load(); }, [load]);
  usePausablePoll(() => { void load(); }, 15_000, { pauseWhileInputActive: true });

  // Keep the open reminder detail panel in sync after polls — without this it
  // renders the snapshot captured at selection time until reselected.
  useEffect(() => {
    if (!selectedItem) return;
    const fresh = items.find((it) => it.id === selectedItem.id);
    if (fresh) {
      if (JSON.stringify(fresh) !== JSON.stringify(selectedItem)) setSelectedItem(fresh);
    } else {
      setSelectedItem(null);
    }
  }, [items, selectedItem?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep selectedCodex in sync after reload
  useEffect(() => {
    if (!selectedCodex) return;
    const fresh = codexAutos.find((a) => a.id === selectedCodex.id);
    // Adopt the fresh object only when its content actually changed —
    // a new-but-identical reference re-fires CodexDetailPanel's form reset
    // and wipes whatever the user is typing.
    if (fresh) {
      if (JSON.stringify(fresh) !== JSON.stringify(selectedCodex)) setSelectedCodex(fresh);
    } else {
      setSelectedCodex(null);
    }
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
  // Depends on a derived boolean (not the runs array) so the interval survives
  // poll ticks; refreshRuns also maintains this automation's last-run badge,
  // so the every-automation refreshLastRuns fan-out stays out of the hot loop
  // (cave-1e6k).
  const hasRunningRun = automationRuns.some((r) => r.status === "running");
  useEffect(() => {
    if (!selectedCodex?.id || !hasRunningRun) return;
    const id = selectedCodex.id;
    const t = setInterval(() => {
      if (document.hidden) return; // don't poll a backgrounded tab
      void refreshRuns(id);
    }, 2500);
    return () => clearInterval(t);
  }, [selectedCodex?.id, hasRunningRun, refreshRuns]); // eslint-disable-line react-hooks/exhaustive-deps

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
    setSelectedItem((prev) => {
      if (prev?.id === id) {
        // The detail panel (which held focus) unmounts — hand focus somewhere
        // stable instead of letting it fall to <body>.
        window.setTimeout(() => newBtnRef.current?.focus(), 0);
        return null;
      }
      return prev;
    });
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

  // Confirm before firing — crons and flows already do, and the identical Run
  // buttons on the All tab must not behave differently per type.
  const runNow = async (id: string) => {
    const target = items.find((i) => i.id === id);
    const name = target?.title;
    if (!(await confirm({ title: name ? `Run “${name}” now?` : "Run reminder now?", body: "This fires the reminder immediately.", confirmLabel: "Run now" }))) return;
    announce(`Running ${name ? `'${name}'` : "reminder"} now.`);
    return patchItem(id, { fireAt: new Date().toISOString(), status: "pending" });
  };

  const togglePaused = (item: InboxItem) => {
    const pausing = item.status !== "dismissed";
    announce(`${pausing ? "Paused" : "Resumed"} '${item.title}'.`);
    return patchItem(item.id, { status: pausing ? "dismissed" : "pending" });
  };

  const stopRecurrence = (id: string) =>
    patchItem(id, { recurrence: { type: "none" } });

  // ── Inbox feed row actions (Done / Snooze / Dismiss) ──────────────────────
  const completeInboxItem = (item: InboxItem) => {
    announce(`Marked '${item.title}' done.`);
    return actItem(item.id, "done");
  };
  const snoozeInboxItem = (item: InboxItem) => {
    announce(`Snoozed '${item.title}' for 1 hour.`);
    return actItem(item.id, "snooze", { minutes: 60 });
  };
  const dismissInboxItem = (item: InboxItem) => {
    announce(`Dismissed '${item.title}'.`);
    return actItem(item.id, "dismiss");
  };

  const openSubscriptions = useCallback(async () => {
    // The modal renders a connect hint without a PAT — resolve the live
    // status on open instead of polling it alongside the feed.
    try {
      const res = await fetch("/api/github/pat", { cache: "no-store" });
      const data = await res.json().catch(() => null);
      setSubsHasPat(Boolean(data?.hasPat));
    } catch {
      setSubsHasPat(false);
    }
    setSubsOpen(true);
  }, []);

  // One-click "stop these": drop the repo behind a GitHub-event notification
  // from the watch list. Reversible from the Subscriptions manager.
  const unwatchRepo = useCallback(async (item: InboxItem, repo: string) => {
    setBusyId(item.id);
    try {
      const res = await fetch("/api/github/subscriptions", { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!data?.ok) throw new Error(data?.error ?? "could not load subscriptions");
      const repos: string[] = Array.isArray(data.prefs?.repos) ? data.prefs.repos : [];
      if (repos.includes(repo)) {
        const patch = await fetch("/api/github/subscriptions", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ repos: repos.filter((r) => r !== repo) }),
        });
        const patched = await patch.json().catch(() => null);
        if (!patch.ok || !patched?.ok) throw new Error(patched?.error ?? `http ${patch.status}`);
      }
      announce(`Unwatched ${repo} — no new GitHub notifications from it.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "unwatch failed");
    } finally {
      setBusyId(null);
    }
  }, [announce]);

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
      announce(`${newStatus === "PAUSED" ? "Paused" : "Resumed"} '${auto.name}'.`);
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
      announce(`Saved '${patch.name ?? auto.name}'.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "codex save failed");
    } finally {
      setBusyId(null);
    }
  }, [load]);

  const deleteCodex = useCallback((auto: CodexAutomation) => {
    setSelectedCodex(null);
    window.setTimeout(() => newBtnRef.current?.focus(), 0); // panel held focus
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
      announce(`Run started for '${auto.name}'.`);
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
      announce(`Created cron '${input.name}'.`);
      await load();
      if (json.automation) { setSelectedCodex(json.automation); setSelectedItem(null); }
    } catch (err) {
      setError(err instanceof Error ? err.message : "codex create failed");
    }
  }, [load]);

  // "Open" routes to each type's dedicated editor surface.
  const openEntry = useCallback((entry: AutomationEntry) => {
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
  // per-type handler (every type confirms before running).
  const runEntry = useCallback((entry: AutomationEntry) => {
    if (entry.type === "reminder") { void runNow(entry.nativeId); return; }
    if (entry.type === "cron") {
      const auto = codexAutos.find((a) => a.id === entry.nativeId);
      if (auto) void runCodexNow(auto);
    }
  }, [codexAutos, runNow, runCodexNow]);

  // Pause/resume any entry from the "All" list, mirroring runEntry's dispatch.
  const togglePauseEntry = useCallback((entry: AutomationEntry) => {
    if (entry.type === "reminder") {
      const item = items.find((i) => i.id === entry.nativeId);
      if (item) void togglePaused(item);
      return;
    }
    if (entry.type === "cron") {
      const auto = codexAutos.find((a) => a.id === entry.nativeId);
      if (auto) void toggleCodex(auto);
    }
  }, [items, codexAutos, togglePaused, toggleCodex]);

  // Daily summaries ride the reminder pipeline into the All list but aren't
  // pausable (the Reminders tab applies the same gate) — hide the control.
  const entryPausable = useCallback((entry: AutomationEntry) => {
    if (entry.type !== "reminder") return true;
    return items.find((i) => i.id === entry.nativeId)?.kind === "reminder";
  }, [items]);

  // Ids whose delete is pending in the undo window — hidden everywhere until the
  // window lapses (committing the delete) or Undo restores them.
  const hiddenIds = useMemo(() => new Set(deletePending?.item ?? []), [deletePending]);
  // Normalized text filter applied to whichever tab is active (title/name).
  const q = query.trim().toLowerCase();

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

  // Inbox tab: the FULL feed (every kind). `inboxVisible` is the search-filtered
  // flat list — the selection universe, so "select all" always means "all
  // matches" while a filter is active. Groups re-shape per the group-by control.
  const inboxVisible = useMemo(
    () => items.filter((it) => !hiddenIds.has(it.id) && (!q || (it.title ?? "").toLowerCase().includes(q))),
    [items, hiddenIds, q],
  );
  const inboxFeed = useMemo(() => groupInboxFeed(inboxVisible), [inboxVisible]);
  const [inboxGroupBy, setInboxGroupBy] = useState<InboxGroupBy>(() => {
    if (typeof window === "undefined") return "attention";
    const raw = window.localStorage.getItem("cave:inbox:group-by");
    return raw === "kind" || raw === "familiar" ? raw : "attention";
  });
  const updateInboxGroupBy = useCallback((next: InboxGroupBy) => {
    setInboxGroupBy(next);
    try {
      window.localStorage.setItem("cave:inbox:group-by", next);
    } catch {
      /* ignore storage errors */
    }
  }, []);
  const inboxGroups = useMemo(
    () => buildInboxGroups(inboxVisible, inboxGroupBy, familiarLabel),
    [inboxVisible, inboxGroupBy, familiarLabel],
  );

  // Multi-select over exactly the visible (search-filtered) feed, so "Select
  // all" and per-group selection act on what's on screen — a live search term
  // makes the selection universe "every match".
  const inboxSelect = useMultiSelect(inboxVisible, (it) => it.id);
  const [inboxBulkBusy, setInboxBulkBusy] = useState(false);
  // Ephemeral (client-synthesized "eph:*") items have no server row — the
  // single-item PATCH/DELETE paths skip them, and bulk must too.
  const selectedInboxIds = () =>
    inboxSelect
      .selectedFrom(inboxVisible)
      .map((it) => it.id)
      .filter((id) => !id.startsWith("eph:"));

  /** One-write collective action over the current selection (POST /api/inbox/bulk). */
  const inboxBulkAct = async (action: "read" | "done" | "dismiss", pastTense: string) => {
    const ids = selectedInboxIds();
    if (ids.length === 0) { inboxSelect.exit(); return; }
    setInboxBulkBusy(true);
    try {
      const res = await fetch("/api/inbox/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ids }),
      });
      if (!res.ok) throw new Error(`http ${res.status}`);
      announce(`${pastTense} ${ids.length} item${ids.length === 1 ? "" : "s"}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "bulk action failed");
    } finally {
      setInboxBulkBusy(false);
      inboxSelect.exit();
    }
  };

  /** Collective delete rides the shared undo toast, then ONE bulk request. */
  const inboxBulkDelete = () => {
    const ids = selectedInboxIds();
    if (ids.length === 0) { inboxSelect.exit(); return; }
    inboxSelect.exit();
    scheduleDelete(ids, `${ids.length} inbox item${ids.length === 1 ? "" : "s"}`, async () => {
      const idSet = new Set(ids);
      setItems((prev) => prev.filter((i) => !idSet.has(i.id)));
      try {
        const res = await fetch("/api/inbox/bulk", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "delete", ids }),
        });
        if (!res.ok) throw new Error(`http ${res.status}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "bulk delete failed");
      } finally { await load(); }
    });
  };
  const automationsEmpty = codexAutos.length === 0;
  const inboxEmpty = items.length === 0;
  const selectedReminderId = selectedItem?.id ?? null;
  const selectedAutomationId = selectedCodex?.id ?? null;
  const detailOpen = Boolean(selectedItem || selectedCodex);
  // The cron detail can grow from its side rail into the full page width —
  // the compact rail stays the default; expanding gives the form room to
  // breathe (summary tiles go 4-up, sections flow into two columns) and
  // hides the list until collapsed again. Reminder details keep the rail.
  const [detailExpanded, setDetailExpanded] = useState(false);
  const cronDetailExpanded = detailExpanded && Boolean(selectedCodex);

  // At-a-glance operational summary for the header: how many automations are
  // live vs paused. Crons fire server-side, so they don't contribute a next-fire
  // timestamp in this narrowed Calendar/Crons surface.
  const summary = useMemo(() => {
    return {
      active: codexActive.length,
      paused: codexPaused.length,
      soonest: undefined as string | undefined,
    };
  }, [codexActive.length, codexPaused.length]);

  const selectTab = (tab: AutomationTab) => {
    setActiveTab(tab);
    setQuery(""); // the filter is scoped to one tab at a time
    inboxSelect.exit(); // selection is an inbox-tab mode, never carried across
    // Clear any open detail on switch — the new tab may not host that type.
    setSelectedItem(null);
    setSelectedCodex(null);
  };

  return (
    <ScheduleActionsContext.Provider
      value={{
        runAutomation: runCodexNow,
        togglePauseAutomation: toggleCodex,
      }}
    >
    <section className="flex h-full" style={{ background: "var(--bg-base)" }}>
      {/* ── Main list ──────────────────────────────────────────────────────── */}
      <div className={`${detailOpen ? (cronDetailExpanded ? "hidden" : "hidden md:flex") : "flex"} flex-1 min-w-0 flex-col`}>
        {/* Compact header: title, tabs, live summary, filter, and actions in
            ONE slim topmost band — mirrors the GitHub surface's
            gh-compact-header so operational surfaces share the same
            minimalist chrome. */}
        <div className="surface-compact-header">
          <h1 className="surface-compact-title">Rituals</h1>
          <Tabs
            className="surface-compact-tabs"
            variant="segment"
            size="sm"
            ariaLabel="Rituals tabs"
            idPrefix="automations"
            value={activeTab}
            onChange={selectTab}
            items={[
              { id: "inbox" as const, label: "Inbox", count: inboxFeed.needsYou.length },
              ...(calendarSlot ? [{ id: "calendar" as const, label: "Calendar" }] : []),
              { id: "crons", label: "Crons", count: codexAutos.length },
            ] satisfies TabItem<AutomationTab>[]}
          />
          {activeTab === "crons" && initialLoadDone && summary.active + summary.paused > 0 && (
            <p className="surface-compact-summary">
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
          {activeTab === "inbox" && initialLoadDone && inboxFeed.needsYou.length + inboxFeed.active.length > 0 && (
            <p className="surface-compact-summary">
              {inboxFeed.needsYou.length > 0 && (
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--color-warning)" }} />
                  {inboxFeed.needsYou.length} need{inboxFeed.needsYou.length === 1 ? "s" : ""} you
                </span>
              )}
              {inboxFeed.active.length > 0 && <span>{inboxFeed.needsYou.length > 0 ? "· " : ""}{inboxFeed.active.length} active</span>}
            </p>
          )}
          <div className="surface-compact-actions">
            {/* Text filter, scoped per tab. Gated on the UNfiltered presence
                of rows so filtering to zero never hides the box (you can still
                clear) — and it stays up in inbox select mode, so "search →
                select all matches → act" is one flow. */}
            {activeTab !== "calendar" && initialLoadDone &&
              (activeTab === "inbox" ? items.length > 0 : codexAutos.length > 0) ? (
              <div className="surface-compact-search">
                <SearchInput
                  value={query}
                  onValueChange={setQuery}
                  onClear={() => setQuery("")}
                  placeholder={activeTab === "inbox" ? "Filter inbox…" : "Filter crons…"}
                  aria-label={activeTab === "inbox" ? "Filter inbox" : "Filter crons"}
                />
              </div>
            ) : null}
            {activeTab === "inbox" && initialLoadDone && inboxVisible.length > 0 ? (
              // Group-by reads as three visible choices (marketplace kind-filter
              // precedent), not a dropdown — one glance shows the active dimension.
              <Tabs
                variant="segment"
                size="sm"
                bordered={false}
                ariaLabel="Group inbox by"
                value={inboxGroupBy}
                onChange={updateInboxGroupBy}
                items={INBOX_GROUP_BY_OPTIONS.map((option) => ({ id: option.value, label: option.label }))}
              />
            ) : null}
            {activeTab === "inbox" && initialLoadDone && inboxVisible.length > 0 && !inboxSelect.selectMode ? (
              <Button
                size="sm"
                variant="secondary"
                leadingIcon="ph:check-square"
                onClick={() => inboxSelect.setSelectMode(true)}
                title="Pick inbox items (or whole groups) for a collective action"
              >
                Select
              </Button>
            ) : null}
            {activeTab === "inbox" && !inboxSelect.selectMode ? (
              <Button
                size="sm"
                variant="secondary"
                leadingIcon="ph:github-logo"
                onClick={() => void openSubscriptions()}
                title="Choose which GitHub repos and events land in this Inbox"
              >
                Subscriptions
              </Button>
            ) : null}
            {activeTab === "inbox" && onNewReminder ? (
              <Button size="sm" className="automation-create-chat-btn" leadingIcon="ph:plus" onClick={onNewReminder}>
                New reminder
              </Button>
            ) : null}
            {activeTab === "crons" ? (
              <Button ref={newBtnRef} size="sm" className="automation-create-chat-btn" leadingIcon="ph:plus" onClick={() => setCreateOpen(true)}>
                New cron
              </Button>
            ) : null}
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="mx-8 mt-3 mb-3 flex items-center gap-2 rounded-lg border border-[color-mix(in_oklch,var(--color-warning)_40%,transparent)] bg-[color-mix(in_oklch,var(--color-warning)_20%,transparent)] px-4 py-2 text-[11px] text-[var(--color-warning)]"
          >
            <Icon name="ph:warning-circle" width={13} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">{error}</span>
            <button
              type="button"
              onClick={() => void load()}
              className="shrink-0 rounded px-1.5 py-0.5 font-medium hover:bg-[color-mix(in_oklch,var(--foreground)_10%,transparent)]"
            >
              Retry
            </button>
          </div>
        )}

        {/* List (or the Calendar surface when that tab is active) */}
        <div
          role="tabpanel"
          id={`automations-panel-${activeTab}`}
          aria-labelledby={`automations-tab-${activeTab}`}
          className={activeTab === "calendar" ? "flex-1 min-h-0 overflow-hidden" : "@container flex-1 overflow-y-auto px-4 pt-4 pb-8 @min-[640px]:px-8"}>
          {activeTab === "calendar" ? (
            calendarSlot
          ) : !initialLoadDone ? (
            <div className="space-y-2 pt-2">
              {Array.from({ length: 5 }).map((_, index) => (
                <div
                  key={index}
                  className="ui-skeleton ui-skeleton--row"
                  style={{ height: 56 }}
                />
              ))}
            </div>
          ) : activeTab === "inbox" ? (
            inboxFeed.needsYou.length + inboxFeed.active.length + inboxFeed.resolved.length === 0 ? (
              q ? (
                <EmptyState
                  className="mt-12"
                  icon="ph:magnifying-glass"
                  headline={`No matches for “${query.trim()}”`}
                  subtitle="Try a different search term."
                />
              ) : (
                <EmptyState
                  className="mt-12"
                  icon="ph:tray"
                  headline="Inbox zero"
                  subtitle="Reminders and notifications land here as they fire — enjoy the quiet."
                  actions={onNewReminder ? <Button leadingIcon="ph:plus" onClick={onNewReminder}>New reminder</Button> : undefined}
                />
              )
            ) : (
              <>
                {inboxSelect.selectMode ? (
                  <SelectionToolbar
                    allSelected={inboxSelect.allSelected(inboxVisible)}
                    count={inboxSelect.selectedCount}
                    onToggleSelectAll={() => inboxSelect.toggleSelectAll(inboxVisible)}
                    onCancel={() => inboxSelect.exit()}
                    selectAllLabel={
                      q
                        ? `Select all ${inboxVisible.length} match${inboxVisible.length === 1 ? "" : "es"}`
                        : "Select all"
                    }
                  >
                    <Button size="xs" variant="ghost" disabled={inboxBulkBusy || inboxSelect.selectedCount === 0}
                      onClick={() => void inboxBulkAct("read", "Marked read")} title="Stamp the selected items as read">
                      Read
                    </Button>
                    <Button size="xs" variant="ghost" disabled={inboxBulkBusy || inboxSelect.selectedCount === 0}
                      onClick={() => void inboxBulkAct("done", "Marked done")} title="Mark the selected items done">
                      Done
                    </Button>
                    <Button size="xs" variant="ghost" disabled={inboxBulkBusy || inboxSelect.selectedCount === 0}
                      onClick={() => void inboxBulkAct("dismiss", "Dismissed")} title="Dismiss the selected items">
                      Dismiss
                    </Button>
                    <Button size="xs" variant="danger" disabled={inboxBulkBusy || inboxSelect.selectedCount === 0}
                      onClick={inboxBulkDelete} title="Delete the selected items (undo window applies)">
                      Delete
                    </Button>
                  </SelectionToolbar>
                ) : null}
                <InboxFeedList
                  groups={inboxGroups}
                  selectedId={selectedItem?.id ?? null}
                  selectMode={inboxSelect.selectMode}
                  isSelected={inboxSelect.isSelected}
                  groupSelected={(group) => inboxSelect.allSelected(group.items)}
                  onToggleGroup={(group) => inboxSelect.toggleSelectAll(group.items)}
                  onToggle={inboxSelect.toggle}
                  familiarLabel={familiarLabel}
                  onSelect={(item) => { setSelectedItem(item); setSelectedCodex(null); }}
                  onDone={(item) => void completeInboxItem(item)}
                  onSnooze={(item) => void snoozeInboxItem(item)}
                  onDismiss={(item) => void dismissInboxItem(item)}
                  onUnwatch={(item, repo) => void unwatchRepo(item, repo)}
                />
              </>
            )
          ) : q && codexActive.length + codexPaused.length === 0 ? (
            <EmptyState
              className="mt-12"
              icon="ph:magnifying-glass"
              headline={`No matches for “${query.trim()}”`}
              subtitle="Try a different search term."
            />
          ) : activeTab === "crons" && automationsEmpty ? (
            <EmptyState
              className="mt-12"
              icon="ph:clock-countdown"
              headline="No crons configured"
              subtitle="A cron runs a familiar on a recurring schedule — set one up to get started."
              actions={<Button leadingIcon="ph:plus" onClick={() => setCreateOpen(true)}>New cron</Button>}
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
        </div>
      </div>

      {/* ── Detail panel ───────────────────────────────────────────────────── */}
      {detailOpen && (
        <div
          className={
            cronDetailExpanded
              ? "w-full min-w-0 flex-1 overflow-hidden"
              : "w-full min-w-0 shrink-0 overflow-hidden md:w-[380px] md:max-w-[42vw]"
          }
          style={{ borderLeft: "1px solid var(--border-hairline)" }}
        >
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
              expanded={cronDetailExpanded}
              onToggleExpanded={() => setDetailExpanded((v) => !v)}
              onClose={() => { setSelectedCodex(null); setDetailExpanded(false); }}
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
          key={templateInitialValues?.name ?? "blank"}
          resolvedFamiliars={resolvedFamiliars}
          initialValues={templateInitialValues}
          onClose={() => { setCreateOpen(false); setTemplateInitialValues(undefined); }}
          onCreate={(i) => void createCodex(i)}
        />
      )}

      {/* ── GitHub subscriptions manager (Inbox tab) ───────────────────────── */}
      {subsOpen && (
        <GithubSubscriptionsModal
          hasPat={subsHasPat}
          onConnectPat={() => {
            setSubsOpen(false);
            navigateToMode("github");
          }}
          onClose={() => setSubsOpen(false)}
        />
      )}

      {deletePending ? (
        <UndoToast
          key={deletePending.id}
          message={`Deleted ${deletePending.label}`}
          undoAriaLabel="Undo delete"
          onUndo={() => { announce(`Restored ${deletePending.label}.`); undoDelete(); }}
          onDismiss={commitDelete}
        />
      ) : null}
    </section>
    </ScheduleActionsContext.Provider>
  );
}
