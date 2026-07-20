"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Familiar } from "@/lib/types";
import { arrayContentEqual } from "@/lib/array-content-equal";
import { usePausablePoll } from "@/lib/use-pausable-poll";
import { useAnnouncer } from "@/components/ui/live-region";
import type { InboxItem, LinkRef } from "@/lib/cave-inbox";
import {
  buildInboxGroups,
  groupInboxFeed,
  INBOX_GROUP_BY_OPTIONS,
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
import { useDateTimePrefs } from "@/lib/datetime-format";
import { relativeTimeSigned } from "@/lib/relative-time";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { StandardSelect } from "@/components/ui/select";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { UndoToast } from "@/components/ui/undo-toast";
import { useUndoDelete } from "@/lib/use-undo-delete";
import { SearchInput } from "@/components/ui/search-input";
import { Tabs, type TabItem } from "@/components/ui/tabs";
import { SelectionToolbar } from "@/components/ui/selection-toolbar";
import { Popover, PopoverBody, PopoverItem } from "@/components/ui/popover";
import { useMultiSelect } from "@/lib/use-multi-select";
import { CwdPickerField } from "@/components/cwd-picker-field";
import { FamiliarMultiSelect } from "@/components/automation-familiar-select";
import { SkillSelect } from "@/components/automation-skill-select";
import { FamiliarAvatar } from "@/components/familiar-avatar";
import { useResolvedFamiliars, type ResolvedFamiliar } from "@/lib/familiar-resolve";
import { automationMatchesFilter } from "@/lib/familiar-multiselect";
import { buildRitualWeek, ritualAgendaItems, ritualLogItems, type RitualDay } from "@/lib/rituals-overview";
import { AutomationCreateDialog, type AutomationCreateInput, type AutomationCreateInitialValues } from "@/components/automation-create-dialog";
import type { AutomationTemplate } from "@/lib/automation-templates";
import { StatusIcon } from "@/components/automations/status-icon";
import { CodexDetailPanel } from "@/components/automations/cron-detail-panel";
import { DetailPanel } from "@/components/automations/reminder-detail-panel";
import { AutomationsPanel, ScheduleActionsContext } from "@/components/automations/schedule-list";
import { AutomationAllList, FlowList } from "@/components/automations/automation-lists";
import { InboxFeedList } from "@/components/automations/inbox-feed-list";
import { TemplatesPanel } from "@/components/automations/templates-panel";
import {
  RitualAgendaThread,
  RitualItemRow,
  RitualNeedsRow,
  ritualWeekLabel,
  type RitualOverviewPane,
  useRitualNow,
} from "@/components/automations/ritual-overview";
import {
  buildAutomationEntries,
  filterEntries,
  countByType,
  type AutomationEntry,
} from "@/lib/automations/automation-entry";

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

// The active Rituals surface: Inbox (the full feed, mostly reminders) plus
// Calendar and Crons. The broader Automations/Flow experience lives on
// feature/automations-flow.
type AutomationTab = "overview" | "calendar" | "crons";

const RITUAL_TABS = [
  { id: "overview", label: "Overview" },
  { id: "calendar", label: "Calendar" },
  { id: "crons", label: "Crons" },
] satisfies ReadonlyArray<TabItem<AutomationTab>>;

// Fire a cross-surface navigation so "Open" on a flow jumps to its
// dedicated editor surface (the Workspace owns setMode; see cave:navigate-mode).
function navigateToMode(mode: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode } }));
}

function relTime(iso: string | undefined | null): string {
  if (!iso) return "—";
  return relativeTimeSigned(iso);
}



// Beginner-facing names for the schedule cadence modes: the presets read as
// plain cadences, and the raw-RRULE escape hatch is labeled for what it is.
const SCHEDULE_MODE_LABEL: Record<"weekly" | "daily" | "raw", string> = {
  weekly: "Weekly",
  daily: "Daily",
  raw: "Advanced",
};


const automationFieldBaseClass =
  "w-full rounded-[var(--radius-control)] border border-[var(--border-hairline)] bg-[var(--bg-base)] text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--border-strong)]";
const automationInputClass = `${automationFieldBaseClass} h-8 px-2 text-[length:var(--text-sm)]`;
const automationSelectClass = `${automationFieldBaseClass} h-8 px-2 text-[length:var(--text-sm)]`;
const automationTextareaClass = `${automationFieldBaseClass} resize-y px-2 py-2 text-[length:var(--text-sm)] leading-relaxed`;
const automationMonoTextareaClass = `${automationTextareaClass} font-mono text-[length:var(--text-xs)]`;

// Row quick-actions (run-now, pause/resume) are wired once at the top of the
// view and read by each leaf row — so the most-used actions sit right on the
// row instead of buried in the detail panel. Avoids threading callbacks through
// the list/section components.
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
        <span className="block text-[length:var(--text-base)] font-medium [color:var(--text-primary)]!">{label}</span>
        <span className="block text-[length:var(--text-xs)] [color:var(--text-muted)]!">{blurb}</span>
      </span>
    </button>
  );
}

// ── Ritual overview ──────────────────────────────────────────────────────────

// ── Root ──────────────────────────────────────────────────────────────────────
export function AutomationsView({ familiars, onOpenSession, onNewReminder, onEdit, onOpenLink, calendarSlot, initialTab }: Props) {
  useDateTimePrefs(); // subscribe: re-render when the date/time density pref changes
  const ritualNow = useRitualNow();
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
  const manageBtnRef = useRef<HTMLButtonElement | null>(null);
  const overviewSwipeStartRef = useRef<number | null>(null);
  const [activeTab, setActiveTab] = useState<AutomationTab>(
    initialTab === "calendar" && calendarSlot ? "calendar" : initialTab === "crons" ? "crons" : "overview",
  );
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [manageMenuOpen, setManageMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [eventsOpen, setEventsOpen] = useState(true);
  const [overviewPane, setOverviewPane] = useState<RitualOverviewPane>("log");
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

  // ── Detail panel notification controls (mark read/unread, mute, snooze
  // presets, reopen) — the panel-level counterparts to the row quick-actions
  // above, wired to the same endpoints. ─────────────────────────────────────
  const snoozeItemFor = (item: InboxItem, minutes: number, label: string) => {
    announce(`Snoozed '${item.title}' for ${label}.`);
    return actItem(item.id, "snooze", { minutes });
  };
  const snoozeItemUntilTomorrow = (item: InboxItem) => {
    const next = new Date();
    next.setDate(next.getDate() + 1);
    next.setHours(9, 0, 0, 0);
    announce(`Snoozed '${item.title}' until tomorrow, 9 AM.`);
    return actItem(item.id, "snooze", { untilIso: next.toISOString() });
  };
  const cancelSnoozeItem = (item: InboxItem) => {
    announce(`Cancelled snooze for '${item.title}'.`);
    return patchItem(item.id, { status: "fired", snoozeUntil: null });
  };
  const reopenInboxItem = (item: InboxItem) => {
    announce(`Reopened '${item.title}'.`);
    return patchItem(item.id, { status: "fired", readAt: null });
  };
  const toggleMuteItem = (item: InboxItem) => {
    announce(item.muted ? `Unmuted '${item.title}'.` : `Muted '${item.title}'.`);
    return patchItem(item.id, { muted: !item.muted });
  };
  const toggleReadItem = useCallback(async (item: InboxItem) => {
    const action = item.readAt ? "unread" : "read";
    setBusyId(item.id);
    try {
      const res = await fetch("/api/inbox/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ids: [item.id] }),
      });
      if (!res.ok) throw new Error(`http ${res.status}`);
      announce(action === "read" ? `Marked '${item.title}' as read.` : `Marked '${item.title}' as unread.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "action failed");
    } finally { setBusyId(null); }
  }, [load, announce]);

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
  const ritualWeek = useMemo(
    () => ritualNow ? buildRitualWeek(inboxVisible, ritualNow) : [],
    [inboxVisible, ritualNow],
  );
  const ritualAgenda = useMemo(() => ritualAgendaItems(inboxVisible), [inboxVisible]);
  const needsYouIds = useMemo(() => new Set(inboxFeed.needsYou.map((item) => item.id)), [inboxFeed.needsYou]);
  const ritualLog = useMemo(
    () => ritualLogItems(inboxVisible).filter((item) => !needsYouIds.has(item.id)),
    [inboxVisible, needsYouIds],
  );
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
    setSearchOpen(false);
    inboxSelect.exit(); // selection is an inbox-tab mode, never carried across
    // Clear any open detail on switch — the new tab may not host that type.
    setSelectedItem(null);
    setSelectedCodex(null);
  };

  const openCalendarDay = (day: RitualDay) => {
    window.sessionStorage.setItem("cave:calendar:pending-open-date", day.key);
    selectTab("calendar");
  };

  const finishOverviewSwipe = (clientX: number) => {
    const start = overviewSwipeStartRef.current;
    overviewSwipeStartRef.current = null;
    if (start === null) return;
    const distance = clientX - start;
    if (distance <= -40) setOverviewPane("agenda");
    if (distance >= 40) setOverviewPane("log");
  };

  return (
    <ScheduleActionsContext.Provider
      value={{
        runAutomation: runCodexNow,
        togglePauseAutomation: toggleCodex,
      }}
    >
    <section className="flex h-full [background:var(--bg-base)]!">
      {/* ── Main list ──────────────────────────────────────────────────────── */}
      <div className={`${detailOpen ? (cronDetailExpanded ? "hidden" : "hidden md:flex") : "flex"} flex-1 min-w-0 flex-col`}>
        <div className="surface-compact-header rituals-overview__header">
          <Icon name="ph:moon" width={15} className="rituals-overview__moon" aria-hidden />
          <h1 className="surface-compact-title">Rituals</h1>
          {activeTab === "overview" ? (
            <p className="surface-compact-summary">{ritualWeekLabel(ritualWeek)}</p>
          ) : null}
          {activeTab === "calendar" ? <p className="surface-compact-summary">Calendar</p> : null}
          {activeTab === "crons" && initialLoadDone && summary.active + summary.paused > 0 && (
            <p className="surface-compact-summary">
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full [background:var(--accent-presence)]!" />
                {summary.active} active
              </span>
              {summary.paused > 0 && <span>· {summary.paused} paused</span>}
              {summary.soonest && (
                <span title={`Next fire: ${summary.soonest}`}>· next fire {relTime(summary.soonest)}</span>
              )}
            </p>
          )}
          <div className="surface-compact-actions">
            {activeTab === "overview" && searchOpen && initialLoadDone && items.length > 0 ? (
              <div className="surface-compact-search">
                <SearchInput
                  value={query}
                  onValueChange={setQuery}
                  onClear={() => { setQuery(""); setSearchOpen(false); }}
                  placeholder="Filter rituals…"
                  aria-label="Filter rituals"
                />
              </div>
            ) : null}
            {activeTab === "overview" && !searchOpen ? (
              <Button
                aria-label="Search rituals"
                size="sm"
                variant="ghost"
                leadingIcon="ph:magnifying-glass"
                onClick={() => setSearchOpen(true)}
              />
            ) : null}
            {activeTab === "crons" && initialLoadDone && codexAutos.length > 0 ? (
              <div className="surface-compact-search">
                <SearchInput
                  value={query}
                  onValueChange={setQuery}
                  onClear={() => setQuery("")}
                  placeholder="Filter crons…"
                  aria-label="Filter crons"
                />
              </div>
            ) : null}
            {activeTab === "overview" ? (
              <>
                <Button
                  ref={newBtnRef}
                  size="sm"
                  className="automation-create-chat-btn"
                  leadingIcon="ph:plus"
                  aria-expanded={newMenuOpen}
                  aria-haspopup="menu"
                  onClick={() => setNewMenuOpen((open) => !open)}
                >
                  New
                </Button>
                <Popover
                  open={newMenuOpen}
                  onOpenChange={setNewMenuOpen}
                  anchorRef={newBtnRef}
                  placement="bottom-end"
                  minWidth={190}
                  ariaLabel="Create ritual"
                >
                  <PopoverBody role="menu" ariaLabel="Create ritual">
                    <PopoverItem icon="ph:bell" disabled={!onNewReminder} onSelect={() => { setNewMenuOpen(false); onNewReminder?.(); }}>
                      New reminder
                    </PopoverItem>
                    <PopoverItem icon="ph:clock-countdown" onSelect={() => { setNewMenuOpen(false); setCreateOpen(true); }}>
                      New cron
                    </PopoverItem>
                  </PopoverBody>
                </Popover>
                <Button
                  ref={manageBtnRef}
                  size="sm"
                  variant="ghost"
                  aria-label="More Rituals options"
                  aria-expanded={manageMenuOpen}
                  aria-haspopup="menu"
                  leadingIcon="ph:dots-three"
                  onClick={() => setManageMenuOpen((open) => !open)}
                />
                <Popover
                  open={manageMenuOpen}
                  onOpenChange={setManageMenuOpen}
                  anchorRef={manageBtnRef}
                  placement="bottom-end"
                  minWidth={220}
                  ariaLabel="Rituals options"
                >
                  <PopoverBody role="menu" ariaLabel="Rituals options">
                    <PopoverItem icon="ph:github-logo" onSelect={() => { setManageMenuOpen(false); void openSubscriptions(); }}>
                      Subscriptions
                    </PopoverItem>
                    {inboxVisible.length > 0 ? (
                      <PopoverItem icon="ph:check-square" onSelect={() => { setManageMenuOpen(false); inboxSelect.setSelectMode(true); }}>
                        Select ritual items
                      </PopoverItem>
                    ) : null}
                    {INBOX_GROUP_BY_OPTIONS.map((option) => (
                      <PopoverItem
                        key={option.value}
                        checked={inboxGroupBy === option.value}
                        onSelect={() => { setManageMenuOpen(false); updateInboxGroupBy(option.value); }}
                      >
                        Group selection by {option.label.toLowerCase()}
                      </PopoverItem>
                    ))}
                  </PopoverBody>
                </Popover>
              </>
            ) : null}
            {activeTab === "calendar" && onNewReminder ? (
              <Button
                size="sm"
                className="automation-create-chat-btn"
                leadingIcon="ph:plus"
                onClick={onNewReminder}
              >
                New reminder
              </Button>
            ) : null}
            {activeTab === "crons" ? (
              <Button size="sm" className="automation-create-chat-btn" leadingIcon="ph:plus" onClick={() => setCreateOpen(true)}>
                New cron
              </Button>
            ) : null}
          </div>
        </div>
        <Tabs
          items={RITUAL_TABS}
          value={activeTab}
          onChange={selectTab}
          ariaLabel="Rituals sections"
          idPrefix="automations"
          size="sm"
          className="shrink-0 px-3"
        />
        {RITUAL_TABS.filter((tab) => tab.id !== activeTab).map((tab) => (
          <div
            key={tab.id}
            role="tabpanel"
            id={`automations-panel-${tab.id}`}
            aria-labelledby={`automations-tab-${tab.id}`}
            hidden
          />
        ))}

        {error && (
          <div
            role="alert"
            className="mx-8 mt-3 mb-3 flex items-center gap-2 rounded-lg border border-[color-mix(in_oklch,var(--color-warning)_40%,transparent)] bg-[color-mix(in_oklch,var(--color-warning)_20%,transparent)] px-4 py-2 text-[length:var(--text-xs)] text-[var(--color-warning)]"
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
          aria-label={activeTab === "overview" ? "Rituals overview" : activeTab === "calendar" ? "Rituals calendar" : "Rituals crons"}
          className={activeTab === "calendar" ? "flex-1 min-h-0 overflow-hidden" : activeTab === "overview" ? "@container flex-1 overflow-y-auto rituals-overview" : "@container flex-1 overflow-y-auto px-4 pt-4 pb-8 @min-[640px]:px-8"}>
          {activeTab === "calendar" ? (
            calendarSlot
          ) : !initialLoadDone ? (
            <div className="space-y-2 pt-2">
              {Array.from({ length: 5 }).map((_, index) => (
                <div
                  key={index}
                  className="ui-skeleton ui-skeleton--row [height:56px]!"
                />
              ))}
            </div>
          ) : activeTab === "overview" ? (
            inboxFeed.needsYou.length + inboxFeed.active.length + inboxFeed.resolved.length === 0 ? (
              q ? (
                <EmptyState
                  className="mt-12"
                  icon="ph:magnifying-glass"
                  headline={`No matches for “${query.trim()}”`}
                  subtitle="Try a different search term."
                />
              ) : (
                <EmptyState className="mt-12" icon="ph:moon" headline="All quiet"
                  subtitle="Reminders, events, and familiar activity will gather here."
                  actions={onNewReminder ? <Button leadingIcon="ph:plus" onClick={onNewReminder}>New reminder</Button> : undefined} />
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
                {inboxSelect.selectMode ? (
                  <div className="rituals-overview__selection">
                    <InboxFeedList
                      groups={inboxGroups}
                      selectedId={selectedItem?.id ?? null}
                      selectMode
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
                  </div>
                ) : (
                  <>
                    <section className="rituals-overview__events" aria-labelledby="rituals-events-heading">
                      <button
                        type="button"
                        className="rituals-overview__section-toggle focus-ring"
                        aria-label="Toggle events ribbon"
                        aria-expanded={eventsOpen}
                        onClick={() => setEventsOpen((open) => !open)}
                      >
                        <span id="rituals-events-heading">Events</span>
                        <Icon name={eventsOpen ? "ph:caret-down" : "ph:caret-right"} width={11} aria-hidden />
                        <span aria-hidden className="rituals-overview__fade-rule" />
                      </button>
                      {eventsOpen && ritualWeek.length > 0 ? (
                        <div className="rituals-overview__week" aria-label={ritualWeekLabel(ritualWeek)}>
                          {ritualWeek.map((day) => (
                            <button
                              type="button"
                              key={day.key}
                              className={`rituals-overview__day focus-ring${day.isToday ? " rituals-overview__day--today" : ""}`}
                              aria-label={`Open ${new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(day.date)} in calendar`}
                              aria-current={day.isToday ? "date" : undefined}
                              onClick={() => openCalendarDay(day)}
                            >
                              <span>{day.weekday}</span>
                              <strong>{day.day}</strong>
                              {day.hasItems ? <i aria-hidden /> : null}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </section>

                    {inboxFeed.needsYou.length > 0 ? (
                      <section className="rituals-overview__needs" aria-labelledby="rituals-needs-heading">
                        <h2 id="rituals-needs-heading">Needs you · {inboxFeed.needsYou.length}</h2>
                        <ul>
                          {inboxFeed.needsYou.map((item) => (
                            <RitualNeedsRow
                              key={item.id}
                              item={item}
                              familiarLabel={familiarLabel}
                              onSelect={(next) => { setSelectedItem(next); setSelectedCodex(null); }}
                              onDone={(next) => void completeInboxItem(next)}
                              onSnooze={(next) => void snoozeInboxItem(next)}
                              onDismiss={(next) => void dismissInboxItem(next)}
                              onUnwatch={(next, repo) => void unwatchRepo(next, repo)}
                            />
                          ))}
                        </ul>
                      </section>
                    ) : null}

                    <section className="rituals-overview__lower" aria-label="Ritual activity">
                      <div className="rituals-overview__pane-nav">
                        <button type="button" className="focus-ring" aria-label="Show ritual log"
                          aria-pressed={overviewPane === "log"} onClick={() => setOverviewPane("log")}>
                          Log · {ritualLog.length}
                        </button>
                        <button type="button" className="focus-ring" aria-label="Show agenda thread"
                          aria-pressed={overviewPane === "agenda"} onClick={() => setOverviewPane("agenda")}>
                          Agenda thread
                        </button>
                        <span />
                        <button type="button" className="focus-ring" aria-label="Show previous ritual pane"
                          onClick={() => setOverviewPane("log")} disabled={overviewPane === "log"}>
                          <Icon name="ph:caret-left" width={13} aria-hidden />
                        </button>
                        <button type="button" className="focus-ring" aria-label="Show next ritual pane"
                          onClick={() => setOverviewPane("agenda")} disabled={overviewPane === "agenda"}>
                          <Icon name="ph:caret-right" width={13} aria-hidden />
                        </button>
                      </div>
                      <div
                        className="rituals-overview__pane"
                        onPointerDown={(event) => { overviewSwipeStartRef.current = event.clientX; }}
                        onPointerUp={(event) => finishOverviewSwipe(event.clientX)}
                        onPointerCancel={() => { overviewSwipeStartRef.current = null; }}
                      >
                        {overviewPane === "log" ? (
                          <div className="rituals-overview__log">
                            {ritualLog.length > 0 ? ritualLog.map((item) => (
                              <RitualItemRow key={item.id} item={item} familiarLabel={familiarLabel}
                                onSelect={(next) => { setSelectedItem(next); setSelectedCodex(null); }} />
                            )) : <p className="rituals-overview__empty">No quiet activity yet.</p>}
                          </div>
                        ) : (
                          <RitualAgendaThread items={ritualAgenda} familiarLabel={familiarLabel}
                            onSelect={(next) => { setSelectedItem(next); setSelectedCodex(null); }} />
                        )}
                      </div>
                    </section>
                  </>
                )}
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
                <p className="mt-2 text-[length:var(--text-sm)] [color:var(--text-muted)]!">
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
          className={[(cronDetailExpanded
              ? "w-full min-w-0 flex-1 overflow-hidden"
              : "w-full min-w-0 shrink-0 overflow-hidden md:w-[380px] md:max-w-[42vw]"), "[border-left:1px_solid_var(--border-hairline)]!"].filter(Boolean).join(" ")}
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
              onDone={completeInboxItem}
              onReopen={reopenInboxItem}
              onSnooze10={(next) => snoozeItemFor(next, 10, "10 minutes")}
              onSnooze60={(next) => snoozeItemFor(next, 60, "1 hour")}
              onSnoozeTomorrow={snoozeItemUntilTomorrow}
              onCancelSnooze={cancelSnoozeItem}
              onToggleMute={toggleMuteItem}
              onToggleRead={(next) => void toggleReadItem(next)}
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
