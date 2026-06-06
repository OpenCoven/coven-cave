"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Familiar } from "@/lib/types";
import type { InboxItem } from "@/lib/cave-inbox";
import type { Recurrence } from "@/lib/inbox-recurrence";
import { Icon } from "@/lib/icon";

// ── Codex automation types (mirrored from lib/codex-automations.ts) ──────────
type AutomationStatus = "ACTIVE" | "PAUSED";
type CodexAutomation = {
  id: string;
  name: string;
  kind: string;
  status: AutomationStatus;
  rrule: string | null;
  model: string | null;
  tags: string[];
  prompt: string;
  scheduleHuman: string;
  tomlPath: string;
};

// AutomationsView — redesigned June 2026
// Clean list layout matching the sleek/professional reference design:
//   • No tabs — items grouped by status section (Current / Paused / Pending / History)
//   • Minimal rows: name · workspace badge · schedule string, action icons on hover
//   • Click any row → dedicated detail panel slides in
//   • "Create via chat" CTA top-right

type Props = {
  familiars: Familiar[];
  onOpenSession?: (sessionId: string, familiarId: string | null) => void;
  onNewReminder?: () => void;
};

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_INITIALS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

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
        style={{ background: "oklch(0.65 0.18 280)" }} />
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
}: {
  item: InboxItem;
  familiarLabel: (fid?: string | null) => string | null;
  busyId: string | null;
  onClose: () => void;
  runNow: (id: string) => void;
  togglePaused: (item: InboxItem) => void;
  stopRecurrence: (id: string) => void;
  removeItem: (id: string) => void;
}) {
  const paused = item.status === "dismissed" && item.recurrence?.type !== "none";
  const isRecurring = item.recurrence && item.recurrence.type !== "none";
  const busy = busyId === item.id;

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

        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest"
              style={{ color: "var(--text-muted)" }}>Schedule</p>
            <p className="text-[12px]" style={{ color: "var(--text-primary)" }}>
              {humanSchedule(item.recurrence)}
            </p>
          </div>
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest"
              style={{ color: "var(--text-muted)" }}>Status</p>
            <p className="text-[12px] capitalize" style={{ color: paused ? "var(--text-muted)" : "var(--text-primary)" }}>
              {paused ? "Paused" : item.status}
            </p>
          </div>
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest"
              style={{ color: "var(--text-muted)" }}>Next run</p>
            <p className="text-[12px]" style={{ color: "var(--text-primary)" }}>
              {relTime(item.fireAt)}
            </p>
          </div>
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest"
              style={{ color: "var(--text-muted)" }}>Last run</p>
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
      </div>

      {/* Actions */}
      <div className="border-t px-5 py-4 space-y-2"
        style={{ borderColor: "var(--border-hairline)" }}>
        <button type="button" disabled={busy || paused} onClick={() => runNow(item.id)}
          className="w-full rounded-lg py-2 text-[12px] font-medium text-white transition-colors disabled:opacity-40"
          style={{ background: "oklch(0.65 0.18 280)" }}>
          Run now
        </button>
        <button type="button" disabled={busy} onClick={() => togglePaused(item)}
          className="w-full rounded-lg border py-2 text-[12px] font-medium transition-colors hover:bg-white/5 disabled:opacity-40"
          style={{ borderColor: "var(--border-hairline)", color: "var(--text-secondary)" }}>
          {paused ? "Resume" : "Pause"}
        </button>
        {isRecurring && (
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

// ── Section ───────────────────────────────────────────────────────────────────
function Section({
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
      <div className="flex items-center gap-3 mb-1 pb-2"
        style={{ borderBottom: "1px solid var(--border-hairline)" }}>
        <span className="text-[12px] font-semibold" style={{ color: "var(--text-secondary)" }}>
          {title}
        </span>
      </div>
      <ul>
        {items.map((item) => {
          const workspace = familiarLabel(item.familiarId);
          const schedule = item.recurrence?.type !== "none"
            ? humanSchedule(item.recurrence)
            : item.fireAt
            ? relTime(item.fireAt)
            : "Paused";
          const selected = selectedId === item.id;

          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onSelect(item)}
                className="group flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors"
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
        })}
      </ul>
    </div>
  );
}

// ── Codex automation detail panel ────────────────────────────────────────────
function CodexDetailPanel({
  auto,
  busy,
  onClose,
  onToggle,
}: {
  auto: CodexAutomation;
  busy: boolean;
  onClose: () => void;
  onToggle: (auto: CodexAutomation) => void;
}) {
  const isActive = auto.status === "ACTIVE";
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
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest"
            style={{ color: "var(--text-muted)" }}>Name</p>
          <p className="text-[14px] font-medium" style={{ color: "var(--text-primary)" }}>
            {auto.name}
          </p>
        </div>

        {auto.prompt && (
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest"
              style={{ color: "var(--text-muted)" }}>Prompt</p>
            <p className="text-[12px] leading-relaxed whitespace-pre-wrap line-clamp-6"
              style={{ color: "var(--text-secondary)" }}>
              {auto.prompt}
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest"
              style={{ color: "var(--text-muted)" }}>Schedule</p>
            <p className="text-[12px]" style={{ color: "var(--text-primary)" }}>
              {auto.scheduleHuman}
            </p>
          </div>
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest"
              style={{ color: "var(--text-muted)" }}>Status</p>
            <p className="text-[12px]" style={{ color: isActive ? "oklch(0.75 0.1 150)" : "var(--text-muted)" }}>
              {isActive ? "Active" : "Paused"}
            </p>
          </div>
          {auto.model && (
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest"
                style={{ color: "var(--text-muted)" }}>Model</p>
              <p className="text-[12px]" style={{ color: "var(--text-primary)" }}>
                {auto.model}
              </p>
            </div>
          )}
          {auto.tags.length > 0 && (
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest"
                style={{ color: "var(--text-muted)" }}>Tags</p>
              <p className="text-[12px]" style={{ color: "var(--text-secondary)" }}>
                {auto.tags.join(", ")}
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
          disabled={busy}
          onClick={() => onToggle(auto)}
          className="w-full rounded-lg py-2 text-[12px] font-medium text-white transition-colors disabled:opacity-40"
          style={{ background: isActive ? "oklch(0.45 0.12 20)" : "oklch(0.65 0.18 280)" }}
        >
          {busy ? (isActive ? "Pausing…" : "Activating…") : (isActive ? "Pause" : "Activate")}
        </button>
      </div>
    </div>
  );
}

// ── Codex automation row ──────────────────────────────────────────────────────
function CodexRow({
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
        className="group flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors"
        style={{ background: selected ? "rgba(255,255,255,0.05)" : "transparent" }}
        onMouseEnter={(e) => { if (!selected) (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.03)"; }}
        onMouseLeave={(e) => { if (!selected) (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
      >
        {/* Status dot */}
        {isActive ? (
          <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full"
            style={{ background: "oklch(0.65 0.18 280)" }} />
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

// ── Codex Section ─────────────────────────────────────────────────────────────
function CodexSection({
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
      <div className="flex items-center gap-3 mb-1 pb-2"
        style={{ borderBottom: "1px solid var(--border-hairline)" }}>
        <span className="text-[12px] font-semibold" style={{ color: "var(--text-secondary)" }}>
          {title}
        </span>
        <span className="text-[10px] px-1.5 py-0.5 rounded"
          style={{ background: "var(--bg-raised)", color: "var(--text-muted)" }}>
          Codex
        </span>
      </div>
      <ul>
        {items.map((auto) => (
          <CodexRow
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

// ── Root ──────────────────────────────────────────────────────────────────────
export function AutomationsView({ familiars, onOpenSession, onNewReminder }: Props) {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [codexAutos, setCodexAutos] = useState<CodexAutomation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
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

  // ── Sections ──────────────────────────────────────────────────────────────
  const current = useMemo(() =>
    items.filter((it) =>
      (it.status === "pending" || it.status === "fired") &&
      it.recurrence && it.recurrence.type !== "none"
    ).sort((a, b) => (a.fireAt ?? "").localeCompare(b.fireAt ?? "")),
    [items]);

  const paused = useMemo(() =>
    items.filter((it) =>
      it.status === "dismissed" && it.recurrence && it.recurrence.type !== "none"
    ).sort((a, b) => (a.title).localeCompare(b.title)),
    [items]);

  const oneShots = useMemo(() =>
    items.filter((it) =>
      (!it.recurrence || it.recurrence.type === "none") &&
      (it.status === "pending" || it.status === "snoozed")
    ).sort((a, b) => (a.fireAt ?? "").localeCompare(b.fireAt ?? "")),
    [items]);

  const history = useMemo(() =>
    items.filter((it) =>
      it.status === "fired" || it.status === "done" ||
      (it.status === "dismissed" && (!it.recurrence || it.recurrence.type === "none"))
    ).sort((a, b) => (b.firedAt ?? b.updatedAt).localeCompare(a.firedAt ?? a.updatedAt))
      .slice(0, 20),
    [items]);

  const codexActive = useMemo(
    () => codexAutos.filter((a) => a.status === "ACTIVE"),
    [codexAutos],
  );
  const codexPaused = useMemo(
    () => codexAutos.filter((a) => a.status === "PAUSED"),
    [codexAutos],
  );

  const isEmpty =
    current.length + paused.length + oneShots.length + codexAutos.length === 0;

  return (
    <section className="flex h-full" style={{ background: "var(--bg-base)" }}>
      {/* ── Main list ──────────────────────────────────────────────────────── */}
      <div className="flex flex-1 min-w-0 flex-col">
        {/* Page header */}
        <div className="flex items-center justify-between px-8 pt-8 pb-5">
          <h1 className="text-[22px] font-semibold" style={{ color: "var(--text-primary)" }}>
            Automations
          </h1>
          {onNewReminder && (
            <button
              type="button"
              onClick={onNewReminder}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors hover:bg-white/5"
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

        {error && (
          <div className="mx-8 mb-3 rounded-lg border border-amber-700/40 bg-amber-900/20 px-4 py-2 text-[11px] text-amber-200">
            {error}
          </div>
        )}

        {/* List */}
        <div className="flex-1 overflow-y-auto px-8 pb-8">
          {isEmpty ? (
            <div className="mt-12 text-center text-[13px]" style={{ color: "var(--text-muted)" }}>
              No automations yet.{" "}
              {onNewReminder && (
                <button type="button" onClick={onNewReminder}
                  className="underline underline-offset-2 hover:opacity-80"
                  style={{ color: "var(--text-secondary)" }}>
                  Create one via chat.
                </button>
              )}
            </div>
          ) : (
            <>
              <Section title="Current" items={current} selectedId={selectedItem?.id ?? null}
                familiarLabel={familiarLabel} onSelect={(item) => { setSelectedItem(item); setSelectedCodex(null); }} />
              <CodexSection title="Active Schedules" items={codexActive}
                selectedId={selectedCodex?.id ?? null}
                onSelect={(auto) => { setSelectedCodex(auto); setSelectedItem(null); }} />
              <Section title="Paused" items={paused} selectedId={selectedItem?.id ?? null}
                familiarLabel={familiarLabel} onSelect={(item) => { setSelectedItem(item); setSelectedCodex(null); }} />
              <CodexSection title="Paused Schedules" items={codexPaused}
                selectedId={selectedCodex?.id ?? null}
                onSelect={(auto) => { setSelectedCodex(auto); setSelectedItem(null); }} />
              <Section title="Pending" items={oneShots} selectedId={selectedItem?.id ?? null}
                familiarLabel={familiarLabel} onSelect={(item) => { setSelectedItem(item); setSelectedCodex(null); }} />
              {history.length > 0 && (
                <Section title="History" items={history} selectedId={selectedItem?.id ?? null}
                  familiarLabel={familiarLabel} onSelect={(item) => { setSelectedItem(item); setSelectedCodex(null); }} />
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Detail panel ───────────────────────────────────────────────────── */}
      {(selectedItem || selectedCodex) && (
        <div className="w-72 shrink-0 overflow-hidden" style={{ borderLeft: "1px solid var(--border-hairline)" }}>
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
            />
          )}
          {selectedCodex && (
            <CodexDetailPanel
              auto={selectedCodex}
              busy={busyId === selectedCodex.id}
              onClose={() => setSelectedCodex(null)}
              onToggle={toggleCodex}
            />
          )}
        </div>
      )}
    </section>
  );
}
