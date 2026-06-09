"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import { OriginChip } from "@/components/ui/origin-chip";
import {
  SNOOZE_PRESETS,
  type Escalation,
  type EscalationOrigin,
  type EscalationSeverity,
  type EscalationState,
  type SnoozePresetId,
  sortEscalations,
} from "@/lib/escalations-types";
import { DEMO_MODE, DEMO_ESCALATIONS } from "@/lib/demo-seed";
import type { Familiar } from "@/lib/types";
import { AutomationsView } from "@/components/automations-view";

type Props = {
  onOpenSource?: (item: Escalation) => void;
  familiars?: Familiar[];
  onNewReminder?: () => void;
  onOpenSession?: (sessionId: string, familiarId?: string | null) => void;
  defaultTab?: "escalations" | "schedules";
};

const SEVERITY_LABEL: Record<EscalationSeverity, string> = {
  critical: "critical",
  warn: "warn",
  info: "info",
};

const SEVERITY_GROUP_LABEL: Record<EscalationSeverity, string> = {
  critical: "Critical",
  warn: "Warning",
  info: "Info",
};

/** Token var for the colored rail on the row left edge + group headers. */
const SEVERITY_VAR: Record<EscalationSeverity, string> = {
  critical: "var(--color-danger)",
  warn: "var(--color-warning)",
  info: "var(--color-info)",
};

/** Map escalation origins onto the OriginChip's 6-origin contract — the
 *  escalation spec adds `gateway` and `task` on top of those. We render
 *  them with adjacent icons (`ph:plug` / `ph:wrench-bold`) so the chip
 *  primitive stays narrow. */
function originChipFor(origin: EscalationOrigin) {
  if (
    origin === "chat" ||
    origin === "mention" ||
    origin === "board" ||
    origin === "cron" ||
    origin === "heartbeat" ||
    origin === "call"
  ) {
    return <OriginChip origin={origin} />;
  }
  const icon = origin === "gateway" ? "ph:plug" : "ph:wrench-bold";
  return (
    <span className="ui-origin-chip" data-origin={origin} title={origin}>
      <Icon name={icon} width={11} height={11} aria-hidden />
      <span className="ui-origin-chip-label">{origin}</span>
    </span>
  );
}

function age(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function InboxEscalationsView({
  onOpenSource,
  familiars,
  onNewReminder,
  onOpenSession,
  defaultTab,
}: Props) {
  const [tab, setTab] = useState<"escalations" | "schedules">(defaultTab ?? "escalations");
  const [items, setItems] = useState<Escalation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [snoozeMenuFor, setSnoozeMenuFor] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState<EscalationSeverity | "all">("all");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const rootRef = useRef<HTMLElement | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/escalations", { cache: "no-store" });
      const json = await res.json();
      if (json.ok) {
        const loaded = json.items as Escalation[];
        // Demo mode only seeds when the API actually returned ok+empty —
        // never when the API errored. Otherwise demo dogfooding silently
        // hides production failures from the developer.
        setItems(DEMO_MODE && loaded.length === 0 ? DEMO_ESCALATIONS : loaded);
        setError(null);
      } else {
        setItems([]);
        setError(json.error ?? "load failed");
      }
    } catch (err) {
      setItems([]);
      setError(err instanceof Error ? err.message : "load failed");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 30_000);
    return () => clearInterval(id);
  }, [refresh]);

  // Items visible after state filters (snoozed/dismissed/resolved) but BEFORE
  // the severity-chip filter — counts on the chip row come from this list so
  // they reflect "what's in the inbox" not "what's currently shown".
  const inSeverity = useMemo(() => {
    const list = items.filter((it) => {
      if (it.state === "snoozed") return false;
      if (it.state === "dismissed") return false;
      if (!showResolved && it.state === "resolved") return false;
      return true;
    });
    return sortEscalations(list);
  }, [items, showResolved]);

  const severityCounts = useMemo(() => {
    const counts: Record<EscalationSeverity, number> = { critical: 0, warn: 0, info: 0 };
    for (const it of inSeverity) counts[it.severity] += 1;
    return counts;
  }, [inSeverity]);

  const visible = useMemo(
    () =>
      severityFilter === "all"
        ? inSeverity
        : inSeverity.filter((it) => it.severity === severityFilter),
    [inSeverity, severityFilter],
  );

  // Selection only kept for ids still visible — when filters narrow the list,
  // hidden rows silently drop out of the selection set.
  useEffect(() => {
    setSelected((prev) => {
      const visibleIds = new Set(visible.map((it) => it.id));
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (visibleIds.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [visible]);

  // Reset active index when the visible list shrinks
  useEffect(() => {
    if (activeIdx >= visible.length) setActiveIdx(Math.max(0, visible.length - 1));
  }, [visible.length, activeIdx]);

  const patchItem = useCallback(
    async (id: string, body: Record<string, unknown>) => {
      try {
        const res = await fetch(`/api/escalations/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = await res.json();
        if (!json.ok) {
          setError(json.error ?? "patch failed");
          return;
        }
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "patch failed");
      }
    },
    [refresh],
  );

  // Fire patches in parallel then refresh once. Any individual failure leaves
  // the error banner with the first one encountered; later successes still
  // win on the row state because refresh() reloads from the server.
  const patchMany = useCallback(
    async (ids: string[], body: Record<string, unknown>) => {
      if (ids.length === 0) return;
      try {
        const results = await Promise.all(
          ids.map((id) =>
            fetch(`/api/escalations/${id}`, {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(body),
            })
              .then((r) => r.json())
              .catch((err) => ({ ok: false, error: err instanceof Error ? err.message : "patch failed" })),
          ),
        );
        const firstError = results.find((r) => !r.ok);
        if (firstError) setError(firstError.error ?? "patch failed");
        setSelected(new Set());
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "patch failed");
      }
    },
    [refresh],
  );

  const advance = (delta: number) => {
    if (visible.length === 0) return;
    setActiveIdx((i) => Math.max(0, Math.min(visible.length - 1, i + delta)));
  };

  const toggleSelected = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Keyboard nav (j/k/e/r/x/s/o). Bound to the section itself so it stays
  // scoped to when the view is focused; spec also calls for `g i` jump from
  // anywhere — that lives outside this component (workspace shortcut).
  useEffect(() => {
    const handler = (ev: KeyboardEvent) => {
      const target = ev.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (target?.isContentEditable) return;
      if (snoozeMenuFor) return;
      const active = visible[activeIdx];
      // When something is selected, e/r/x apply to the whole selection so
      // bulk actions are reachable from the keyboard, not just the toolbar.
      const targets = selected.size > 0 ? Array.from(selected) : active ? [active.id] : [];
      switch (ev.key) {
        case "j":
        case "ArrowDown":
          ev.preventDefault();
          advance(1);
          break;
        case "k":
        case "ArrowUp":
          ev.preventDefault();
          advance(-1);
          break;
        case " ":
          if (active) {
            ev.preventDefault();
            toggleSelected(active.id);
          }
          break;
        case "a":
          if (visible.length > 0) {
            ev.preventDefault();
            setSelected((prev) =>
              prev.size === visible.length ? new Set() : new Set(visible.map((it) => it.id)),
            );
          }
          break;
        case "e":
          if (targets.length > 1) void patchMany(targets, { state: "acknowledged" });
          else if (active) void patchItem(active.id, { state: "acknowledged" });
          break;
        case "r":
          if (targets.length > 1) void patchMany(targets, { state: "resolved" });
          else if (active) void patchItem(active.id, { state: "resolved" });
          break;
        case "x":
          if (targets.length > 1) void patchMany(targets, { state: "dismissed" });
          else if (active) void patchItem(active.id, { state: "dismissed" });
          break;
        case "Escape":
          if (selected.size > 0) {
            ev.preventDefault();
            setSelected(new Set());
          }
          break;
        case "s":
          if (active) setSnoozeMenuFor(active.id);
          break;
        case "o":
          if (active) onOpenSource?.(active);
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [visible, activeIdx, patchItem, patchMany, onOpenSource, snoozeMenuFor, selected, toggleSelected]);

  const newCount = items.filter((i) => i.state === "new").length;
  const criticalCount = items.filter(
    (i) => i.severity === "critical" && i.state !== "resolved" && i.state !== "dismissed",
  ).length;
  const resolvedCount = items.filter((i) => i.state === "resolved").length;

  return (
    <section
      ref={rootRef}
      className="flex h-full flex-col bg-background text-foreground"
    >
      <nav className="inbox-view__tabs">
        <button
          type="button"
          className={`inbox-view__tab${tab === "escalations" ? " inbox-view__tab--active" : ""}`}
          onClick={() => setTab("escalations")}
        >
          Escalations
        </button>
        <button
          type="button"
          className={`inbox-view__tab${tab === "schedules" ? " inbox-view__tab--active" : ""}`}
          onClick={() => setTab("schedules")}
        >
          Schedules
        </button>
      </nav>

      {tab === "schedules" ? (
        <AutomationsView
          familiars={familiars ?? []}
          onNewReminder={onNewReminder ?? (() => {})}
          onOpenSession={onOpenSession}
        />
      ) : (
        <>
          <header
            className="flex items-center gap-3 px-5 py-3 text-[11px]"
            style={{ borderBottom: "1px solid var(--border-hairline)" }}
          >
            <span className="font-medium text-foreground">Inbox</span>
            <span className="text-muted-foreground">
              {newCount} new · {criticalCount} critical
            </span>
            <span className="ml-auto flex items-center gap-2 text-muted-foreground">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showResolved}
                  onChange={(e) => setShowResolved(e.target.checked)}
                  className="accent-foreground"
                />
                Show resolved{resolvedCount > 0 ? ` (${resolvedCount})` : ""}
              </label>
              <button
                onClick={() => void refresh()}
                className="focus-ring rounded border border-border px-2 py-0.5 transition-colors hover:bg-muted"
                title="Refresh"
              >
                <Icon name="ph:arrows-clockwise-bold" width={11} height={11} aria-hidden />
              </button>
            </span>
          </header>

          {/* Filter chip row collapses into a bulk-action bar the moment any
              row is selected — they occupy the same vertical slot so the list
              doesn't jump. */}
          <div
            className="flex items-center gap-1.5 px-5 py-2 text-[11px]"
            style={{ borderBottom: "1px solid var(--border-hairline)" }}
          >
            {selected.size > 0 ? (
              <BulkBar
                count={selected.size}
                onAcknowledge={() => void patchMany(Array.from(selected), { state: "acknowledged" })}
                onResolve={() => void patchMany(Array.from(selected), { state: "resolved" })}
                onDismiss={() => void patchMany(Array.from(selected), { state: "dismissed" })}
                onClear={() => setSelected(new Set())}
              />
            ) : (
              <FilterChips
                value={severityFilter}
                counts={severityCounts}
                total={inSeverity.length}
                onChange={setSeverityFilter}
              />
            )}
          </div>

          {error ? (
            <div
              className="border-b border-[var(--border-hairline)] px-5 py-1.5 text-xs text-[var(--color-danger)]"
              style={{ background: "color-mix(in oklch, var(--color-danger) 10%, var(--bg-base))" }}
            >
              {error}
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <div className="mx-auto w-full max-w-[1200px]">
              {visible.length === 0 ? (
                <div
                  className="rounded-2xl border px-6 py-12 text-center"
                  style={{ borderColor: "var(--border-hairline)", background: "var(--bg-raised)" }}
                >
                  <p className="text-sm text-foreground">
                    {severityFilter === "all" ? "Nothing needs you." : `No ${severityFilter} items.`}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {severityFilter === "all"
                      ? "The Inbox surfaces items when a familiar (or a system signal) decides the user should look. Quiet means everything is handled."
                      : "Switch back to All to see other severities."}
                  </p>
                </div>
              ) : (
                <GroupedList
                  visible={visible}
                  grouped={severityFilter === "all"}
                  activeIdx={activeIdx}
                  selected={selected}
                  snoozeMenuFor={snoozeMenuFor}
                  onActivate={setActiveIdx}
                  onToggleSelect={toggleSelected}
                  onPatch={(id, body) => void patchItem(id, body)}
                  onOpenSource={(it) => onOpenSource?.(it)}
                  onAskSnooze={(id) => setSnoozeMenuFor(id)}
                  onCloseSnooze={() => setSnoozeMenuFor(null)}
                  onPickSnooze={(id, preset) => {
                    setSnoozeMenuFor(null);
                    void patchItem(id, { state: "snoozed", snoozePreset: preset });
                  }}
                />
              )}
            </div>
          </div>

          <footer
            className="px-5 py-2 text-[10px] text-muted-foreground"
            style={{ borderTop: "1px solid var(--border-hairline)" }}
          >
            j/k navigate · space select · a select all · e ack · r resolve · x dismiss · s snooze · o open
          </footer>
        </>
      )}
    </section>
  );
}

function FilterChips({
  value,
  counts,
  total,
  onChange,
}: {
  value: EscalationSeverity | "all";
  counts: Record<EscalationSeverity, number>;
  total: number;
  onChange: (v: EscalationSeverity | "all") => void;
}) {
  const chip = (
    id: EscalationSeverity | "all",
    label: string,
    count: number,
    accent?: string,
  ) => {
    const active = value === id;
    return (
      <button
        key={id}
        type="button"
        onClick={() => onChange(id)}
        className="focus-ring inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 transition-colors"
        style={{
          borderColor: active && accent
            ? `color-mix(in oklch, ${accent} 55%, var(--border-hairline))`
            : "var(--border-hairline)",
          background: active
            ? accent
              ? `color-mix(in oklch, ${accent} 14%, transparent)`
              : "var(--bg-raised)"
            : "transparent",
          color: active ? "var(--text-primary, inherit)" : "var(--text-secondary)",
        }}
        aria-pressed={active}
      >
        {accent ? (
          <span
            aria-hidden
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ background: accent }}
          />
        ) : null}
        <span>{label}</span>
        <span className="text-[10px] text-muted-foreground">{count}</span>
      </button>
    );
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chip("all", "All", total)}
      {chip("critical", "Critical", counts.critical, SEVERITY_VAR.critical)}
      {chip("warn", "Warning", counts.warn, SEVERITY_VAR.warn)}
      {chip("info", "Info", counts.info, SEVERITY_VAR.info)}
    </div>
  );
}

function BulkBar({
  count,
  onAcknowledge,
  onResolve,
  onDismiss,
  onClear,
}: {
  count: number;
  onAcknowledge: () => void;
  onResolve: () => void;
  onDismiss: () => void;
  onClear: () => void;
}) {
  return (
    <div className="flex w-full items-center gap-2">
      <span className="text-foreground">
        <span className="font-medium">{count}</span>{" "}
        <span className="text-muted-foreground">selected</span>
      </span>
      <span className="ml-auto flex items-center gap-1.5">
        <ActionButton onClick={onAcknowledge}>Acknowledge</ActionButton>
        <ActionButton onClick={onResolve} primary>
          Resolve
        </ActionButton>
        <ActionButton onClick={onDismiss}>Dismiss</ActionButton>
        <ActionButton onClick={onClear}>Clear</ActionButton>
      </span>
    </div>
  );
}

function GroupedList({
  visible,
  grouped,
  activeIdx,
  selected,
  snoozeMenuFor,
  onActivate,
  onToggleSelect,
  onPatch,
  onOpenSource,
  onAskSnooze,
  onCloseSnooze,
  onPickSnooze,
}: {
  visible: Escalation[];
  grouped: boolean;
  activeIdx: number;
  selected: Set<string>;
  snoozeMenuFor: string | null;
  onActivate: (idx: number) => void;
  onToggleSelect: (id: string) => void;
  onPatch: (id: string, body: Record<string, unknown>) => void;
  onOpenSource: (it: Escalation) => void;
  onAskSnooze: (id: string) => void;
  onCloseSnooze: () => void;
  onPickSnooze: (id: string, preset: SnoozePresetId) => void;
}) {
  const renderRow = (it: Escalation, idx: number) => {
    const isActive = idx === activeIdx;
    const isSelected = selected.has(it.id);
    const accent = SEVERITY_VAR[it.severity];
    return (
      <li
        key={it.id}
        onClick={() => onActivate(idx)}
        className={`group relative cursor-pointer pl-4 pr-3 py-3 transition-colors ${
          isActive ? "bg-muted" : isSelected ? "bg-muted/40" : "hover:bg-muted/50"
        }`}
        aria-current={isActive ? "true" : undefined}
        aria-selected={isSelected}
      >
        <span
          aria-hidden
          className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r"
          style={{
            background:
              it.severity === "critical"
                ? accent
                : `color-mix(in oklch, ${accent} 60%, transparent)`,
            opacity: it.state === "acknowledged" || it.state === "resolved" ? 0.35 : 1,
          }}
        />
        <EscalationRow
          item={it}
          isActive={isActive}
          isSelected={isSelected}
          onToggleSelect={() => onToggleSelect(it.id)}
          onPatch={(body) => onPatch(it.id, body)}
          onOpenSource={() => onOpenSource(it)}
          onAskSnooze={() => onAskSnooze(it.id)}
        />
        {snoozeMenuFor === it.id ? (
          <SnoozeMenu
            onClose={onCloseSnooze}
            onPick={(preset) => onPickSnooze(it.id, preset)}
          />
        ) : null}
      </li>
    );
  };

  if (!grouped) {
    return (
      <ul className="divide-y" style={{ borderColor: "var(--border-hairline)" }}>
        {visible.map((it, idx) => renderRow(it, idx))}
      </ul>
    );
  }

  const groups: { severity: EscalationSeverity; rows: { item: Escalation; idx: number }[] }[] = [];
  visible.forEach((item, idx) => {
    const last = groups[groups.length - 1];
    if (last && last.severity === item.severity) {
      last.rows.push({ item, idx });
    } else {
      groups.push({ severity: item.severity, rows: [{ item, idx }] });
    }
  });

  return (
    <div className="flex flex-col gap-3">
      {groups.map((g) => (
        <section key={g.severity}>
          <header
            className="sticky top-0 z-10 -mx-3 mb-1 flex items-center gap-2 px-3 py-1 text-[10px] uppercase tracking-widest"
            style={{
              background: "color-mix(in oklch, var(--bg-base) 92%, transparent)",
              backdropFilter: "blur(4px)",
              color: SEVERITY_VAR[g.severity],
            }}
          >
            <span
              aria-hidden
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ background: SEVERITY_VAR[g.severity] }}
            />
            <span>{SEVERITY_GROUP_LABEL[g.severity]}</span>
            <span className="text-muted-foreground">· {g.rows.length}</span>
          </header>
          <ul className="divide-y" style={{ borderColor: "var(--border-hairline)" }}>
            {g.rows.map(({ item, idx }) => renderRow(item, idx))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function EscalationRow({
  item,
  isActive,
  isSelected,
  onToggleSelect,
  onPatch,
  onOpenSource,
  onAskSnooze,
}: {
  item: Escalation;
  isActive: boolean;
  isSelected: boolean;
  onToggleSelect: () => void;
  onPatch: (body: Record<string, unknown>) => void;
  onOpenSource: () => void;
  onAskSnooze: () => void;
}) {
  const sevColor =
    item.severity === "critical"
      ? "text-[var(--color-danger)] border-[color-mix(in_oklch,var(--color-danger)_40%,transparent)] bg-[color-mix(in_oklch,var(--color-danger)_10%,transparent)]"
      : item.severity === "warn"
        ? "text-[var(--color-warning)] border-[color-mix(in_oklch,var(--color-warning)_40%,transparent)] bg-[color-mix(in_oklch,var(--color-warning)_10%,transparent)]"
        : "text-muted-foreground border-border bg-card";

  const dotIsLive = item.state === "new";
  const dotPulse = dotIsLive && item.severity === "critical";

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-start gap-2">
        <label
          className={`mt-0.5 inline-flex shrink-0 items-center transition-opacity ${
            isSelected || isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="checkbox"
            checked={isSelected}
            onChange={onToggleSelect}
            className="accent-foreground h-3 w-3 cursor-pointer"
            aria-label={`Select: ${item.title}`}
          />
        </label>
        <span
          className={`mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
            dotIsLive ? "bg-foreground" : "bg-border"
          } ${dotPulse ? "animate-pulse" : ""}`}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 text-sm text-foreground">
            {item.severity === "critical" ? (
              <span
                className={`shrink-0 rounded border px-1.5 py-px text-[9px] uppercase tracking-widest ${sevColor}`}
                title={item.severityReason ?? SEVERITY_LABEL[item.severity]}
              >
                {SEVERITY_LABEL[item.severity]}
              </span>
            ) : null}
            {originChipFor(item.origin)}
            <span className="min-w-0 flex-1 truncate" title={item.title}>
              {item.title}
            </span>
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {item.fromFamiliar ? <>From <span className="text-foreground">{item.fromFamiliar}</span> · </> : null}
            {item.aboutFamiliar ? <>about <span className="text-foreground">{item.aboutFamiliar}</span> · </> : null}
            <span title={item.createdAt}>{age(item.createdAt)} ago</span>
            {item.state !== "new" ? (
              <span className="ml-1.5 inline-block rounded border border-border bg-card px-1 py-px text-[9px] uppercase tracking-widest text-muted-foreground align-middle">
                {item.state}
              </span>
            ) : null}
          </div>
          {item.excerpt ? (
            <p className="mt-1 line-clamp-2 text-[12px] text-muted-foreground">{item.excerpt}</p>
          ) : null}
        </div>
      </div>

      {isActive ? (
        <div className="flex flex-wrap gap-1.5 pl-4 text-[10px]">
          <ActionButton onClick={onOpenSource} disabled={!item.sourceUrl && !item.sourceSessionKey}>
            Open
          </ActionButton>
          <ActionButton
            onClick={() => onPatch({ state: "acknowledged" })}
            disabled={item.state === "acknowledged"}
          >
            Acknowledge
          </ActionButton>
          <ActionButton onClick={onAskSnooze}>Snooze</ActionButton>
          <ActionButton onClick={() => onPatch({ state: "resolved" })} primary>
            Resolve
          </ActionButton>
          <ActionButton onClick={() => onPatch({ state: "dismissed" })}>
            Dismiss
          </ActionButton>
        </div>
      ) : null}
    </div>
  );
}

function ActionButton({
  children,
  onClick,
  disabled,
  primary,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      disabled={disabled}
      className={`focus-ring rounded border px-2 py-0.5 transition-colors disabled:opacity-40 ${
        primary
          ? "border-border-strong bg-muted text-foreground hover:bg-card"
          : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function SnoozeMenu({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (preset: SnoozePresetId) => void;
}) {
  return (
    <div
      role="menu"
      onClick={(e) => e.stopPropagation()}
      className="mt-2 flex flex-col gap-1 rounded border bg-card p-2 text-[11px]"
      style={{ borderColor: "var(--border-hairline)" }}
    >
      <div className="px-1 text-[9px] uppercase tracking-widest text-[var(--text-secondary)]">
        Snooze until
      </div>
      {SNOOZE_PRESETS.map((p) => (
        <button
          key={p.id}
          onClick={() => onPick(p.id)}
          className="focus-ring rounded px-2 py-1 text-left text-foreground transition-colors hover:bg-muted"
        >
          {p.label}
        </button>
      ))}
      <button
        onClick={onClose}
        className="focus-ring mt-1 rounded px-2 py-1 text-left text-muted-foreground transition-colors hover:bg-muted"
      >
        Cancel
      </button>
    </div>
  );
}

/** Severity reasons exported here as a hint to callers writing items —
 *  required when self-tagging critical per spec 3.2. */
export const REQUIRES_REASON: Record<EscalationSeverity, boolean> = {
  critical: true,
  warn: false,
  info: false,
};

/** State-pill color helper exported for surfaces outside this view (e.g.
 *  a daemon-bar badge). */
export function severityRank(s: EscalationSeverity): number {
  return s === "critical" ? 0 : s === "warn" ? 1 : 2;
}

export type { Escalation, EscalationState };
