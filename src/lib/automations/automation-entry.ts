// Unified automation model.
//
// Coven Cave grew three separate "make something happen later / automatically"
// primitives, each with its own surface, store, and vocabulary:
//
//   • reminder — a nudge (one-shot or recurring) in the inbox store
//   • cron     — a familiar run on an rrule schedule (Codex automation, TOML)
//   • flow     — a freeform node graph wired on a canvas
//
// To a user these are all just "automations": a thing that runs, on a trigger,
// maybe on a schedule, maybe tied to a familiar. This module normalizes all
// three into one `AutomationEntry` so a single surface can list, filter, count,
// and route them together. It is pure / framework-free / client-safe (no node
// imports) so the surface component and any server aggregator can share it.

import type { InboxItem } from "../cave-inbox";
import type { Recurrence } from "../inbox-recurrence";
import type { CodexAutomation } from "../codex-automations-types";
import type { FlowDoc } from "../flow/flow-doc.ts";

export type AutomationType = "reminder" | "cron" | "flow";

/** Whether the entry is armed, idle, or unfinished. */
export type AutomationState = "active" | "paused" | "draft";

export type AutomationEntry = {
  /** Stable cross-type key, `${type}:${nativeId}` — unique across the surface. */
  key: string;
  type: AutomationType;
  /** Id within the native store (inbox id, codex id, workflow id, flow id). */
  nativeId: string;
  name: string;
  summary?: string;
  state: AutomationState;
  /** Human trigger line, e.g. "Daily at 9:00 AM", "Manual", "On chat". */
  trigger: string;
  /** True when the trigger is time-based (drives the "scheduled" filter/icon). */
  scheduled: boolean;
  familiarId?: string | null;
  /** ISO timestamp used for recency sorting; best-effort per type. */
  sortAt: string;
  /**
   * ISO timestamp of the next scheduled fire, when known client-side. Reminders
   * carry a daemon-maintained `fireAt` (the next occurrence); crons/flows compute
   * their next fire server-side, so this stays undefined for them. The UI shows a
   * friendly "next" relative time when present.
   */
  nextFireAt?: string;
};

export const AUTOMATION_TYPES: AutomationType[] = ["reminder", "cron", "flow"];

export type AutomationTypeMeta = {
  /** Singular noun. */
  label: string;
  /** Plural noun (tab labels, counts). */
  plural: string;
  /** Phosphor icon name. */
  icon: string;
  /** CSS accent var for the type chip. */
  accent: string;
  /** One-line description for the "New" menu and empty states. */
  blurb: string;
  /** Which surface mode owns deep editing for this type (for "Open"). */
  editorMode: "inbox" | "flow";
};

export const AUTOMATION_TYPE_META: Record<AutomationType, AutomationTypeMeta> = {
  reminder: {
    label: "Reminder",
    plural: "Reminders",
    icon: "ph:bell",
    accent: "var(--color-info)",
    blurb: "Nudge you or a familiar at a set time",
    editorMode: "inbox",
  },
  cron: {
    label: "Cron",
    plural: "Crons",
    icon: "ph:clock-countdown",
    accent: "var(--color-success)",
    blurb: "Run a familiar on a recurring schedule",
    editorMode: "inbox",
  },
  flow: {
    label: "Flow",
    plural: "Flows",
    icon: "ph:flow-arrow",
    accent: "var(--color-warning)",
    blurb: "Freeform node graph wired on a canvas",
    editorMode: "flow",
  },
};

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Human-readable trigger line for a reminder-style recurrence. Pure, and
 * clock-format agnostic (renders 24h "HH:MM"); the surface re-formats clock
 * times against the user's 12h/24h pref when it has the prefs hook.
 */
/** Default time formatter — fixed 24h `HH:MM`. Kept here so the pure module
 *  stays framework-free; UIs inject a clock-pref-aware formatter instead. */
const pad2Clock = (h: number, m: number) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;

/**
 * Human schedule line for a Recurrence — the single source of truth for this
 * formatting. `formatTime` lets callers inject a clock-pref-aware time formatter
 * (the Automations view passes one that honors the 12h/24h preference); it
 * defaults to fixed 24h so this module — and its tests — stay framework-free.
 */
export function humanRecurrence(
  rec: Recurrence | undefined | null,
  formatTime: (hour: number, minute: number) => string = pad2Clock,
): string {
  if (!rec || rec.type === "none") return "One-time";
  if (rec.type === "interval") {
    const m = Math.round(rec.everyMs / 60000);
    if (m < 60) return `Every ${m}m`;
    const h = Math.round(m / 60);
    if (h < 24) return `Every ${h}h`;
    return `Every ${Math.round(h / 24)}d`;
  }
  if (rec.type === "daily") return `Daily at ${formatTime(rec.hour, rec.minute)}`;
  if (rec.type === "weekly") {
    const days = rec.days.map((d) => WEEKDAY[d] ?? "?").join("/");
    return `${days} at ${formatTime(rec.hour, rec.minute)}`;
  }
  if (rec.type === "cron") return `Cron: ${rec.expr}`;
  return "Scheduled";
}

/** Derive a flow's trigger line + scheduled-ness from its trigger nodes. */
export function flowTrigger(flow: FlowDoc): { trigger: string; scheduled: boolean } {
  const triggers = flow.nodes.filter((n) => n.type.startsWith("trigger.") && !n.disabled);
  if (triggers.length === 0) return { trigger: "Manual", scheduled: false };
  const has = (t: string) => triggers.some((n) => n.type === t);
  if (has("trigger.schedule")) return { trigger: "On schedule", scheduled: true };
  if (has("trigger.webhook")) return { trigger: "On webhook", scheduled: false };
  if (has("trigger.chat")) return { trigger: "On chat", scheduled: false };
  return { trigger: "Manual", scheduled: false };
}

export function reminderToEntry(item: InboxItem): AutomationEntry {
  const recurring = !!item.recurrence && item.recurrence.type !== "none";
  return {
    key: `reminder:${item.id}`,
    type: "reminder",
    nativeId: item.id,
    name: item.title || "Reminder",
    summary: item.body || undefined,
    state: item.status === "dismissed" ? "paused" : "active",
    trigger: humanRecurrence(item.recurrence),
    scheduled: recurring || !!item.fireAt,
    familiarId: item.familiarId ?? null,
    sortAt: item.fireAt || item.updatedAt || item.createdAt || "",
    // `fireAt` is the daemon-maintained next occurrence; surface it as the next
    // fire for active reminders only (a dismissed/paused reminder won't fire).
    nextFireAt: item.status === "dismissed" ? undefined : item.fireAt || undefined,
  };
}

export function cronToEntry(auto: CodexAutomation): AutomationEntry {
  return {
    key: `cron:${auto.id}`,
    type: "cron",
    nativeId: auto.id,
    name: auto.name || auto.id,
    summary: auto.prompt ? auto.prompt.split("\n")[0]?.slice(0, 140) : undefined,
    state: auto.status === "PAUSED" ? "paused" : "active",
    trigger: auto.scheduleHuman || "Scheduled",
    scheduled: true,
    familiarId: auto.familiars?.[0] ?? null,
    // Codex automations carry no updatedAt; sort them after dated entries.
    sortAt: "",
  };
}

export function flowToEntry(flow: FlowDoc): AutomationEntry {
  const { trigger, scheduled } = flowTrigger(flow);
  return {
    key: `flow:${flow.id}`,
    type: "flow",
    nativeId: flow.id,
    name: flow.name || "Untitled flow",
    summary: undefined,
    state: flow.active ? "active" : "paused",
    trigger,
    scheduled,
    familiarId: null,
    sortAt: flow.updatedAt || flow.createdAt || "",
  };
}

export type AutomationSources = {
  reminders?: InboxItem[];
  crons?: CodexAutomation[];
  flows?: FlowDoc[];
};

/**
 * Normalize the three native source lists into one recency-sorted entry list.
 * Entries with a `sortAt` timestamp sort newest-first ahead of the undated
 * ones (crons), which fall back to alphabetical by name.
 */
export function buildAutomationEntries(sources: AutomationSources): AutomationEntry[] {
  const entries: AutomationEntry[] = [
    ...(sources.reminders ?? []).map(reminderToEntry),
    ...(sources.crons ?? []).map(cronToEntry),
    ...(sources.flows ?? []).map(flowToEntry),
  ];
  return entries.sort((a, b) => {
    if (a.sortAt && b.sortAt) return b.sortAt.localeCompare(a.sortAt);
    if (a.sortAt) return -1;
    if (b.sortAt) return 1;
    return a.name.localeCompare(b.name);
  });
}

/** Count entries per type (for tab badges). */
export function countByType(entries: AutomationEntry[]): Record<AutomationType, number> {
  const counts: Record<AutomationType, number> = { reminder: 0, cron: 0, flow: 0 };
  for (const e of entries) counts[e.type] += 1;
  return counts;
}

/** Case-insensitive filter over an entry's name, summary, and trigger. */
export function filterEntries(entries: AutomationEntry[], query: string): AutomationEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  return entries.filter(
    (e) =>
      e.name.toLowerCase().includes(q) ||
      (e.summary ?? "").toLowerCase().includes(q) ||
      e.trigger.toLowerCase().includes(q),
  );
}
