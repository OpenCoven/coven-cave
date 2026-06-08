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

  const visible = useMemo(() => {
    const list = items.filter((it) => {
      if (it.state === "snoozed") return false;
      if (it.state === "dismissed") return false;
      if (!showResolved && it.state === "resolved") return false;
      return true;
    });
    return sortEscalations(list);
  }, [items, showResolved]);

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

  const advance = (delta: number) => {
    if (visible.length === 0) return;
    setActiveIdx((i) => Math.max(0, Math.min(visible.length - 1, i + delta)));
  };

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
        case "e":
          if (active) void patchItem(active.id, { state: "acknowledged" });
          break;
        case "r":
          if (active) void patchItem(active.id, { state: "resolved" });
          break;
        case "x":
          if (active) void patchItem(active.id, { state: "dismissed" });
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
  }, [visible, activeIdx, patchItem, onOpenSource, snoozeMenuFor]);

  const newCount = items.filter((i) => i.state === "new").length;
  const criticalCount = items.filter(
    (i) => i.severity === "critical" && i.state !== "resolved" && i.state !== "dismissed",
  ).length;

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
                Show resolved
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
                  <p className="text-sm text-foreground">Nothing needs you.</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    The Inbox surfaces items when a familiar (or a system signal) decides the user should look. Quiet means everything is handled.
                  </p>
                </div>
              ) : (
                <ul
                  className="divide-y"
                  style={{ borderColor: "var(--border-hairline)" }}
                >
                  {visible.map((it, idx) => {
                    const isActive = idx === activeIdx;
                    return (
                      <li
                        key={it.id}
                        onClick={() => setActiveIdx(idx)}
                        className={`cursor-pointer px-3 py-3 transition-colors ${
                          isActive
                            ? "bg-muted"
                            : "hover:bg-muted/50"
                        }`}
                        aria-current={isActive ? "true" : undefined}
                      >
                        <EscalationRow
                          item={it}
                          isActive={isActive}
                          onPatch={(body) => void patchItem(it.id, body)}
                          onOpenSource={() => onOpenSource?.(it)}
                          onAskSnooze={() => setSnoozeMenuFor(it.id)}
                        />
                        {snoozeMenuFor === it.id ? (
                          <SnoozeMenu
                            onClose={() => setSnoozeMenuFor(null)}
                            onPick={(preset) => {
                              setSnoozeMenuFor(null);
                              void patchItem(it.id, { state: "snoozed", snoozePreset: preset });
                            }}
                          />
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          <footer
            className="px-5 py-2 text-[10px] text-muted-foreground"
            style={{ borderTop: "1px solid var(--border-hairline)" }}
          >
            j/k navigate · e acknowledge · r resolve · x dismiss · s snooze · o open source
          </footer>
        </>
      )}
    </section>
  );
}

function EscalationRow({
  item,
  isActive,
  onPatch,
  onOpenSource,
  onAskSnooze,
}: {
  item: Escalation;
  isActive: boolean;
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

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-start gap-2">
        <span
          className={`mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
            item.state === "new" ? "bg-foreground" : "bg-border"
          }`}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 text-sm text-foreground">
            <span
              className={`shrink-0 rounded border px-1.5 py-px text-[9px] uppercase tracking-widest ${sevColor}`}
              title={item.severityReason ?? SEVERITY_LABEL[item.severity]}
            >
              {SEVERITY_LABEL[item.severity]}
            </span>
            {originChipFor(item.origin)}
            <span className="min-w-0 flex-1 truncate" title={item.title}>
              {item.title}
            </span>
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {item.fromFamiliar ? <>From <span className="text-foreground">{item.fromFamiliar}</span> · </> : null}
            {item.aboutFamiliar ? <>about <span className="text-foreground">{item.aboutFamiliar}</span> · </> : null}
            <span title={item.createdAt}>{age(item.createdAt)} ago</span>
            {item.state !== "new" ? <> · <span>{item.state}</span></> : null}
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
