"use client";

import { useEffect, useState } from "react";
import type { Familiar, SessionRow } from "@/lib/types";

const TEMPLATES = ["Bugfix", "Docs", "Release", "PR review", "Plugin"];
const STATUSES: CardStatus[] = ["inbox", "running", "review", "blocked"];
const PRIORITIES: CardPriority[] = ["urgent", "high", "medium", "low"];

type CardStatus = "inbox" | "running" | "review" | "blocked";
type CardPriority = "low" | "medium" | "high" | "urgent";

export type NewCardDraft = {
  title: string;
  notes: string;
  status: CardStatus;
  priority: CardPriority;
  familiarId: string | null;
  sessionId: string | null;
  labels: string[];
  template: string | null;
};

type Props = {
  open: boolean;
  onClose: () => void;
  familiars: Familiar[];
  sessions: SessionRow[];
  defaultStatus?: CardStatus;
  defaultFamiliarId?: string | null;
  onCreate: (draft: NewCardDraft) => Promise<void> | void;
};

export function NewCardModal({
  open,
  onClose,
  familiars,
  sessions,
  defaultStatus = "inbox",
  defaultFamiliarId = null,
  onCreate,
}: Props) {
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<CardStatus>(defaultStatus);
  const [priority, setPriority] = useState<CardPriority>("medium");
  const [familiarId, setFamiliarId] = useState<string | null>(defaultFamiliarId);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [labels, setLabels] = useState("");
  const [template, setTemplate] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setNotes("");
    setStatus(defaultStatus);
    setPriority("medium");
    setFamiliarId(defaultFamiliarId);
    setSessionId(null);
    setLabels("");
    setTemplate(null);
    setError(null);
  }, [open, defaultStatus, defaultFamiliarId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const eligibleSessions = familiarId
    ? sessions.filter((s) => s.familiarId === familiarId)
    : sessions;

  const create = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate({
        title: title.trim(),
        notes: notes.trim(),
        status,
        priority,
        familiarId,
        sessionId,
        labels: labels
          .split(",")
          .map((l) => l.trim())
          .filter(Boolean),
        template,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "create failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[680px] max-w-[94vw] max-h-[90vh] overflow-y-auto rounded-2xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl"
      >
        <div className="mb-5 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-zinc-100">New card</h2>
            <p className="text-[12px] text-zinc-500">Queue work for an agent session.</p>
          </div>
          <button
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded border border-zinc-800 text-zinc-400 hover:bg-zinc-900"
          >
            ✕
          </button>
        </div>

        <div className="mb-5 flex flex-wrap gap-2">
          {TEMPLATES.map((t) => {
            const active = template === t;
            return (
              <button
                key={t}
                onClick={() => {
                  setTemplate(active ? null : t);
                  if (!active && !title.trim()) setTitle(`${t}: `);
                }}
                className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                  active
                    ? "border-violet-500 bg-violet-500/20 text-violet-100"
                    : "border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
                }`}
              >
                {t}
              </button>
            );
          })}
        </div>

        <Field label="Title">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Card title"
            autoFocus
            className="w-full rounded-md border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-violet-600"
          />
        </Field>

        <Field label="Notes">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes, acceptance criteria, links"
            rows={6}
            className="w-full resize-y rounded-md border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-violet-600"
          />
        </Field>

        <div className="mb-4 grid grid-cols-2 gap-4">
          <Field label="Status">
            <Select
              value={status}
              onChange={(v) => setStatus(v as CardStatus)}
              options={STATUSES.map((s) => ({ value: s, label: cap(s) }))}
            />
          </Field>
          <Field label="Priority">
            <Select
              value={priority}
              onChange={(v) => setPriority(v as CardPriority)}
              options={PRIORITIES.map((p) => ({ value: p, label: cap(p) }))}
            />
          </Field>

          <Field label="Agent">
            <Select
              value={familiarId ?? ""}
              onChange={(v) => {
                setFamiliarId(v || null);
                setSessionId(null);
              }}
              options={[
                { value: "", label: "Default agent" },
                ...familiars.map((f) => ({
                  value: f.id,
                  label: `${f.emoji} ${f.display_name} · ${f.harness ?? "?"}`,
                })),
              ]}
            />
          </Field>
          <Field label="Session">
            <Select
              value={sessionId ?? ""}
              onChange={(v) => setSessionId(v || null)}
              options={[
                { value: "", label: "No linked session" },
                ...eligibleSessions.slice(0, 30).map((s) => ({
                  value: s.id,
                  label: `${s.title || "(untitled)"} · ${s.harness}`,
                })),
              ]}
            />
          </Field>
        </div>

        <Field label="Labels">
          <input
            value={labels}
            onChange={(e) => setLabels(e.target.value)}
            placeholder="ui, docs"
            className="w-full rounded-md border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-violet-600"
          />
        </Field>

        {error ? (
          <div className="mb-3 rounded border border-amber-700/40 bg-amber-900/20 px-3 py-1.5 text-xs text-amber-200">
            {error}
          </div>
        ) : null}

        <div className="flex items-center justify-end gap-2">
          <button
            onClick={create}
            disabled={!title.trim() || busy}
            className="rounded-md bg-rose-700 px-4 py-1.5 text-sm font-medium text-zinc-50 transition-colors hover:bg-rose-600 disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create"}
          </button>
          <button
            onClick={onClose}
            className="rounded-md border border-zinc-800 bg-zinc-900 px-4 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mb-4 block">
      <div className="mb-1.5 text-[10px] uppercase tracking-widest text-zinc-500">{label}</div>
      {children}
    </label>
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full appearance-none rounded-md border border-zinc-800 bg-zinc-900/40 px-3 py-2 pr-8 text-sm text-zinc-100 outline-none focus:border-violet-600"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-zinc-900">
            {o.label}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500">
        ▾
      </span>
    </div>
  );
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
