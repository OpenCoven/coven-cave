"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { Familiar } from "@/lib/types";
import type { InboxItem, LinkRef } from "@/lib/cave-inbox";
import type { Recurrence } from "@/lib/inbox-recurrence";
import type {
  AutomationStatus,
  CodexAutomation,
  CodexAutomationPatch,
} from "@/lib/codex-automations-types";
import { Icon } from "@/lib/icon";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { ProjectTree } from "@/components/project-tree";
import type { CaveProject } from "@/lib/cave-projects-types";

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
};

function linkLabel(link: LinkRef): string {
  if (link.kind === "url") return link.ref;
  if (link.kind === "card") return "Card";
  if (link.kind === "session") return "Session";
  return "Memory";
}

type ScheduleTab = "reminders" | "automations";

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_INITIALS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const RRULE_DAY_ORDER = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const RRULE_DAY_LABEL: Record<string, string> = {
  SU: "Sun",
  MO: "Mon",
  TU: "Tue",
  WE: "Wed",
  TH: "Thu",
  FR: "Fri",
  SA: "Sat",
};

function pad(n: number) {
  return n.toString().padStart(2, "0");
}

function humanSchedule(rec: Recurrence | undefined): string {
  if (!rec || rec.type === "none") return "One-shot";
  if (rec.type === "interval") {
    const m = Math.round(rec.everyMs / 60000);
    if (m < 60) return `Every ${m}m`;
    const h = Math.round(m / 60);
    if (h < 24) return `Every ${h}h`;
    return `Every ${Math.round(h / 24)}d`;
  }
  if (rec.type === "daily")
    return `Daily at ${pad(rec.hour)}:${pad(rec.minute)}`;
  if (rec.type === "weekly") {
    const days = rec.days.map((d) => WEEKDAY[d] ?? "?").join("/");
    return `${days}s at ${pad(rec.hour)}:${pad(rec.minute)}`;
  }
  if (rec.type === "cron") return `Cron: ${rec.expr}`;
  return "Scheduled";
}

function isScheduleInboxItem(item: InboxItem): boolean {
  return item.kind === "reminder" || item.kind === "daily-summary";
}

function relTime(iso: string | undefined | null): string {
  if (!iso) return "—";
  const delta = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(delta);
  const m = Math.round(abs / 60000);
  if (m < 1) return delta > 0 ? "soon" : "just now";
  if (m < 60) return delta > 0 ? `in ${m}m` : `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return delta > 0 ? `in ${h}h` : `${h}h ago`;
  const d = Math.round(h / 24);
  return delta > 0 ? `in ${d}d` : `${d}d ago`;
}

function parseCodexRrule(rrule: string | null): {
  mode: "daily" | "weekly" | "raw";
  days: string[];
  time: string;
  raw: string;
} {
  const raw = rrule ?? "";
  const freq = raw.match(/FREQ=(\w+)/)?.[1];
  const hour = raw.match(/BYHOUR=(\d+)/)?.[1];
  const min = raw.match(/BYMINUTE=(\d+)/)?.[1];
  const days = raw.match(/BYDAY=([^;]+)/)?.[1]?.split(",").filter(Boolean) ?? [];
  const time = `${(hour ?? "9").padStart(2, "0")}:${(min ?? "0").padStart(2, "0")}`;

  if (freq === "DAILY" && hour !== undefined) return { mode: "daily", days: [], time, raw };
  if (freq === "WEEKLY" && hour !== undefined) {
    return {
      mode: "weekly",
      days: days.length > 0 ? days : RRULE_DAY_ORDER,
      time,
      raw,
    };
  }
  return { mode: "raw", days: RRULE_DAY_ORDER, time, raw };
}

function buildCodexRrule(mode: "daily" | "weekly" | "raw", time: string, days: string[], raw: string): string {
  if (mode === "raw") return raw.trim();
  const [hour = "9", minute = "0"] = time.split(":");
  const parts = [
    "RRULE:FREQ=" + (mode === "daily" ? "DAILY" : "WEEKLY"),
    `BYHOUR=${Number(hour)}`,
    `BYMINUTE=${Number(minute)}`,
  ];
  if (mode === "weekly") {
    const ordered = RRULE_DAY_ORDER.filter((day) => days.includes(day));
    parts.push(`BYDAY=${ordered.join(",")}`);
  }
  return parts.join(";");
}

function listInput(values: string[]): string {
  return values.join("\n");
}

function commaInput(values: string[]): string {
  return values.join(", ");
}

function parseListInput(value: string): string[] {
  return value
    .split(/\n|,/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function splitAutomationPrompt(prompt: string): {
  goals: string;
  deliverables: string;
  hasStructuredSections: boolean;
} {
  const sectionPattern = /^\s*(?:#{1,6}\s*)?(Goals|Deliverables)\s*:?\s*$/gim;
  const matches = [...prompt.matchAll(sectionPattern)];
  if (matches.length === 0) {
    return { goals: prompt, deliverables: "", hasStructuredSections: false };
  }

  const parts = { goals: "", deliverables: "" };
  const leading = prompt.slice(0, matches[0].index ?? 0).trim();
  if (leading) parts.goals = leading;

  matches.forEach((match, index) => {
    const key = match[1].toLowerCase() === "deliverables" ? "deliverables" : "goals";
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? prompt.length;
    const value = prompt.slice(start, end).trim();
    parts[key] = parts[key] ? `${parts[key]}\n\n${value}`.trim() : value;
  });

  return { ...parts, hasStructuredSections: true };
}

function composeAutomationPrompt(
  goals: string,
  deliverables: string,
  includeHeadings: boolean,
): string {
  const nextGoals = goals.trim();
  const nextDeliverables = deliverables.trim();

  if (!includeHeadings && !nextDeliverables) return nextGoals;

  const sections: string[] = [];
  if (nextGoals) sections.push(`Goals:\n${nextGoals}`);
  if (nextDeliverables) sections.push(`Deliverables:\n${nextDeliverables}`);
  return sections.join("\n\n");
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
        <button type="button" onClick={onClose}
          className="rounded p-1 transition-colors hover:bg-white/5"
          style={{ color: "var(--text-muted)" }}>
          <Icon name="ph:x" width={14} />
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
              <p className="text-[12px]" style={{ color: "var(--text-primary)" }}>
                {relTime(item.fireAt)}
              </p>
            </div>
          )}
          <div>
            <FieldLabel>{isDailySummary ? "Sent" : "Last run"}</FieldLabel>
            <p className="text-[12px]" style={{ color: item.firedAt ? "oklch(0.75 0.1 150)" : "var(--text-muted)" }}>
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
              className="inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] transition-colors hover:bg-white/5"
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

function ReminderTaskRow({
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
  const schedule = item.kind === "daily-summary"
    ? "Daily summary"
    : item.recurrence?.type !== "none"
    ? humanSchedule(item.recurrence)
    : item.fireAt
    ? relTime(item.fireAt)
    : "Paused";

  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(item)}
        className="automation-list-row group flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors"
        style={{
          background: selected ? "rgba(255,255,255,0.05)" : "transparent",
        }}
        onMouseEnter={(e) => {
          if (!selected) (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.03)";
        }}
        onMouseLeave={(e) => {
          if (!selected) (e.currentTarget as HTMLButtonElement).style.background = "transparent";
        }}
      >
        <StatusIcon item={item} />
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
        <span className="shrink-0 text-[12px] tabular-nums" style={{ color: "var(--text-muted)" }}>
          {schedule}
        </span>
      </button>
    </li>
  );
}

function ReminderTaskSection({
  title,
  items,
  selectedId,
  familiarLabel,
  onSelect,
}: {
  title: string;
  items: InboxItem[];
  selectedId: string | null;
  familiarLabel: (fid?: string | null) => string | null;
  onSelect: (item: InboxItem) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="mb-6">
      <div className="flex items-center gap-3 mb-1 rounded-md px-3 py-1.5"
        style={{ background: "color-mix(in oklch, var(--bg-base) 86%, var(--foreground) 14%)", borderBottom: "1px solid var(--border-hairline)" }}>
        <span className="text-[12px] font-bold" style={{ color: "var(--text-primary)" }}>
          {title}
        </span>
      </div>
      <ul>
        {items.map((item) => (
          <ReminderTaskRow
            key={item.id}
            item={item}
            selected={selectedId === item.id}
            familiarLabel={familiarLabel}
            onSelect={onSelect}
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
  familiarLabel,
  onSelect,
}: {
  current: InboxItem[];
  paused: InboxItem[];
  oneShots: InboxItem[];
  history: InboxItem[];
  selectedId: string | null;
  familiarLabel: (fid?: string | null) => string | null;
  onSelect: (item: InboxItem) => void;
}) {
  return (
    <>
      <ReminderTaskSection title="Repeating" items={current} selectedId={selectedId}
        familiarLabel={familiarLabel} onSelect={onSelect} />
      <ReminderTaskSection title="Paused" items={paused} selectedId={selectedId}
        familiarLabel={familiarLabel} onSelect={onSelect} />
      <ReminderTaskSection title="One-time" items={oneShots} selectedId={selectedId}
        familiarLabel={familiarLabel} onSelect={onSelect} />
      {history.length > 0 && (
        <ReminderTaskSection title="History" items={history} selectedId={selectedId}
          familiarLabel={familiarLabel} onSelect={onSelect} />
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
}: {
  auto: CodexAutomation;
  busy: boolean;
  onClose: () => void;
  onToggle: (auto: CodexAutomation) => void;
  onSave: (auto: CodexAutomation, patch: CodexAutomationPatch) => void;
}) {
  const isActive = auto.status === "ACTIVE";
  const parsedSchedule = useMemo(() => parseCodexRrule(auto.rrule), [auto.rrule]);
  const promptParts = splitAutomationPrompt(auto.prompt);
  const [name, setName] = useState(auto.name);
  const [goals, setGoals] = useState(promptParts.goals);
  const [deliverables, setDeliverables] = useState(promptParts.deliverables);
  const [model, setModel] = useState(auto.model ?? "");
  const [reasoningEffort, setReasoningEffort] = useState(auto.reasoningEffort ?? "medium");
  const [executionEnvironment, setExecutionEnvironment] = useState(auto.executionEnvironment ?? "worktree");
  const [tagsText, setTagsText] = useState(commaInput(auto.tags));
  const [cwdsText, setCwdsText] = useState(listInput(auto.cwds));
  // Folder-picker ("browse") state for the Working directories field.
  const [cwdPickerOpen, setCwdPickerOpen] = useState(false);
  const [cwdProjects, setCwdProjects] = useState<CaveProject[]>([]);
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
    setScheduleMode(nextSchedule.mode);
    setScheduleTime(nextSchedule.time);
    setScheduleDays(nextSchedule.days);
    setRawRrule(nextSchedule.raw);
  }, [auto]);

  const nextRrule = buildCodexRrule(scheduleMode, scheduleTime, scheduleDays, rawRrule);
  const tags = parseListInput(tagsText);
  const cwds = parseListInput(cwdsText);
  const cwdSet = useMemo(() => new Set(cwds), [cwdsText]); // eslint-disable-line react-hooks/exhaustive-deps
  const addCwd = useCallback((dir: string) => {
    const clean = dir.trim();
    if (!clean) return;
    setCwdsText((prev) => {
      const list = parseListInput(prev);
      if (list.includes(clean)) return prev;
      return listInput([...list, clean]);
    });
  }, []);

  useEffect(() => {
    if (!cwdPickerOpen || cwdProjects.length > 0) return;
    let alive = true;
    void fetch("/api/projects")
      .then((res) => res.json())
      .then((data: { ok?: boolean; projects?: CaveProject[] }) => {
        if (alive && data.ok && Array.isArray(data.projects)) setCwdProjects(data.projects);
      })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [cwdPickerOpen, cwdProjects.length]);
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
    nextRrule !== (auto.rrule ?? "");
  const canSave = !busy && dirty && name.trim().length > 0 && !invalidSchedule;

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
        <button type="button" onClick={onClose}
          className="rounded p-1 transition-colors hover:bg-white/5"
          style={{ color: "var(--text-muted)" }}>
          <Icon name="ph:x" width={14} />
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
            <div className="flex items-start gap-2">
              <textarea
                value={cwdsText}
                onChange={(event) => setCwdsText(event.target.value)}
                rows={3}
                className={`${automationMonoTextareaClass} min-w-0 flex-1`}
                style={fieldStyle}
              />
              <button
                type="button"
                onClick={() => setCwdPickerOpen(true)}
                className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[var(--border-hairline)] px-2 py-1.5 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
              >
                <Icon name="ph:folder-open" width={12} /> Browse…
              </button>
            </div>
          </div>

          {cwdPickerOpen && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
              role="dialog"
              aria-modal="true"
              aria-label="Pick working directories"
              onClick={() => setCwdPickerOpen(false)}
            >
              <div
                className="flex max-h-[80vh] w-[460px] max-w-full flex-col overflow-hidden rounded-lg border border-[var(--border-hairline)] shadow-xl"
                style={{ background: "var(--bg-panel)" }}
                onClick={(event) => event.stopPropagation()}
              >
                <div className="flex items-center justify-between border-b border-[var(--border-hairline)] px-3 py-2">
                  <span className="text-[13px] font-semibold text-[var(--text-primary)]">Working directories</span>
                  <button
                    type="button"
                    onClick={() => setCwdPickerOpen(false)}
                    aria-label="Close"
                    className="grid h-6 w-6 place-items-center rounded text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
                  >
                    <Icon name="ph:x" width={14} />
                  </button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-2">
                  {cwdProjects.length === 0 ? (
                    <p className="px-2 py-4 text-[12px] text-[var(--text-muted)]">
                      No projects found. Add a project in the Code workspace first, or type a path into the field.
                    </p>
                  ) : (
                    cwdProjects.map((proj) => (
                      <div key={proj.root} className="mb-2">
                        <div className="flex items-center justify-between gap-2 px-1 py-1">
                          <span className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                            {proj.name}
                          </span>
                          <button
                            type="button"
                            onClick={() => addCwd(proj.root)}
                            className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
                              cwdSet.has(proj.root)
                                ? "text-[var(--accent-presence)]"
                                : "text-[var(--text-muted)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
                            }`}
                          >
                            {cwdSet.has(proj.root) ? "Added" : "Use root"}
                          </button>
                        </div>
                        <ProjectTree root={proj.root} onDirSelect={addCwd} selectedDirs={cwdSet} />
                      </div>
                    ))
                  )}
                </div>
                <div className="flex items-center justify-between border-t border-[var(--border-hairline)] px-3 py-2">
                  <span className="text-[11px] text-[var(--text-muted)]">
                    {cwds.length} {cwds.length === 1 ? "directory" : "directories"} selected
                  </span>
                  <button
                    type="button"
                    onClick={() => setCwdPickerOpen(false)}
                    className="rounded-md px-3 py-1 text-[12px] font-medium text-white"
                    style={{ background: "var(--accent-presence)" }}
                  >
                    Done
                  </button>
                </div>
              </div>
            </div>
          )}

          <div>
            <FieldLabel>Tags</FieldLabel>
            <input
              value={tagsText}
              onChange={(event) => setTagsText(event.target.value)}
              className={automationInputClass}
              style={fieldStyle}
            />
          </div>
          {auto.skillPath && (
            <div>
              <FieldLabel>Skill</FieldLabel>
              <p className="break-all font-mono text-[10px]" style={{ color: "var(--text-muted)" }}>
                {auto.skillPath}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="border-t px-5 py-4 space-y-2"
        style={{ borderColor: "var(--border-hairline)" }}>
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
      </div>
    </div>
  );
}

function AutomationScheduleRow({
  auto,
  selected,
  onSelect,
}: {
  auto: CodexAutomation;
  selected: boolean;
  onSelect: (auto: CodexAutomation) => void;
}) {
  const isActive = auto.status === "ACTIVE";
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(auto)}
        className="automation-list-row group flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors"
        style={{ background: selected ? "rgba(255,255,255,0.05)" : "transparent" }}
        onMouseEnter={(e) => { if (!selected) (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.03)"; }}
        onMouseLeave={(e) => { if (!selected) (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
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
        <span className="shrink-0 text-[12px] tabular-nums" style={{ color: "var(--text-muted)" }}>
          {auto.scheduleHuman}
        </span>
      </button>
    </li>
  );
}

function AutomationScheduleSection({
  title,
  items,
  selectedId,
  onSelect,
}: {
  title: string;
  items: CodexAutomation[];
  selectedId: string | null;
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
  onSelect,
}: {
  active: CodexAutomation[];
  paused: CodexAutomation[];
  selectedId: string | null;
  onSelect: (auto: CodexAutomation) => void;
}) {
  return (
    <>
      <AutomationScheduleSection title="Active" items={active}
        selectedId={selectedId}
        onSelect={onSelect} />
      <AutomationScheduleSection title="Paused" items={paused}
        selectedId={selectedId}
        onSelect={onSelect} />
    </>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────
export function AutomationsView({ familiars, onOpenSession, onNewReminder, onEdit, onOpenLink }: Props) {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [codexAutos, setCodexAutos] = useState<CodexAutomation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ScheduleTab>("reminders");
  // Selected item is either an InboxItem or a CodexAutomation — track by kind
  const [selectedItem, setSelectedItem] = useState<InboxItem | null>(null);
  const [selectedCodex, setSelectedCodex] = useState<CodexAutomation | null>(null);

  const load = useCallback(async () => {
    try {
      const [inboxRes, codexRes] = await Promise.all([
        fetch("/api/inbox", { cache: "no-store" }),
        fetch("/api/codex-automations", { cache: "no-store" }),
      ]);
      const inboxJson = await inboxRes.json();
      if (!inboxJson.ok) { setError(inboxJson.error ?? "load failed"); return; }
      setItems(inboxJson.items ?? []);
      const codexJson = await codexRes.json();
      if (codexJson.ok) setCodexAutos(codexJson.automations ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "fetch failed");
    } finally {
      setInitialLoadDone(true);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  // Keep selectedCodex in sync after reload
  useEffect(() => {
    if (!selectedCodex) return;
    const fresh = codexAutos.find((a) => a.id === selectedCodex.id);
    if (fresh) setSelectedCodex(fresh);
    else setSelectedCodex(null);
  }, [codexAutos, selectedCodex?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const removeItem = useCallback(async (id: string) => {
    if (id.startsWith("eph:")) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/inbox/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`http ${res.status}`);
      setSelectedItem((prev) => prev?.id === id ? null : prev);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "delete failed");
    } finally { setBusyId(null); }
  }, [load]);

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

  // ── Sections ──────────────────────────────────────────────────────────────
  const reminderItems = useMemo(() =>
    items.filter(isScheduleInboxItem),
    [items]);

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

  const codexActive = useMemo(
    () => codexAutos.filter((a) => a.status === "ACTIVE"),
    [codexAutos],
  );
  const codexPaused = useMemo(
    () => codexAutos.filter((a) => a.status === "PAUSED"),
    [codexAutos],
  );

  const remindersEmpty = current.length + paused.length + oneShots.length + history.length === 0;
  const automationsEmpty = codexAutos.length === 0;
  const selectedReminderId = selectedItem?.id ?? null;
  const selectedAutomationId = selectedCodex?.id ?? null;

  const selectTab = (tab: ScheduleTab) => {
    setActiveTab(tab);
    if (tab === "reminders") setSelectedCodex(null);
    else setSelectedItem(null);
  };

  return (
    <section className="flex h-full" style={{ background: "var(--bg-base)" }}>
      {/* ── Main list ──────────────────────────────────────────────────────── */}
      <div className="flex flex-1 min-w-0 flex-col">
        {/* Page header */}
        <div className="flex items-center justify-between px-8 pt-8 pb-5">
          <h1 className="text-[22px] font-semibold" style={{ color: "var(--text-primary)" }}>
            Schedules
          </h1>
          {onNewReminder && (
            <button
              type="button"
              onClick={onNewReminder}
              className="automation-create-chat-btn inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium whitespace-nowrap transition-colors hover:bg-white/5"
              style={{
                background: "var(--bg-raised)",
                border: "1px solid var(--border-hairline)",
                color: "var(--text-primary)",
              }}
            >
              Create via chat
              <span style={{ color: "var(--text-muted)", display: "flex" }}><Icon name="ph:caret-down" width={11} /></span>
            </button>
          )}
        </div>

        <div className="px-8 pb-4">
          <div className="inline-flex rounded-lg border p-1"
            style={{ borderColor: "var(--border-hairline)", background: "var(--bg-raised)" }}>
            {([
              ["reminders", "Reminders", reminderItems.length],
              ["automations", "Automations", codexAutos.length],
            ] as const).map(([id, label, count]) => (
              <button
                key={id}
                type="button"
                onClick={() => selectTab(id)}
                aria-pressed={activeTab === id}
                className="rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors"
                style={{
                  background: activeTab === id ? "rgba(255,255,255,0.08)" : "transparent",
                  color: activeTab === id ? "var(--text-primary)" : "var(--text-muted)",
                }}
              >
                {label}
                <span className="ml-2 text-[10px]" style={{ color: "var(--text-muted)" }}>{count}</span>
              </button>
            ))}
          </div>
        </div>

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

        {/* List */}
        <div className="flex-1 overflow-y-auto px-8 pb-8">
          {!initialLoadDone ? (
            <div className="space-y-2 pt-2">
              {Array.from({ length: 5 }).map((_, index) => (
                <div
                  key={index}
                  className="h-14 animate-pulse rounded-lg bg-[var(--bg-raised)]"
                />
              ))}
            </div>
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
          ) : activeTab === "automations" && automationsEmpty ? (
            <EmptyState
              className="mt-12"
              icon="ph:robot"
              headline="No automations configured"
              subtitle="Automations run a familiar on a schedule — set one up to get started."
            />
          ) : (
            <>
              {activeTab === "reminders" ? (
                <ReminderTaskList
                  current={current}
                  paused={paused}
                  oneShots={oneShots}
                  history={history}
                  selectedId={selectedReminderId}
                  familiarLabel={familiarLabel}
                  onSelect={(item) => { setSelectedItem(item); setSelectedCodex(null); }}
                />
              ) : (
                <AutomationsPanel
                  active={codexActive}
                  paused={codexPaused}
                  selectedId={selectedAutomationId}
                  onSelect={(auto) => { setSelectedCodex(auto); setSelectedItem(null); }}
                />
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
            />
          )}
        </div>
      )}
    </section>
  );
}
