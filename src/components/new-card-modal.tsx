"use client";

import { useEffect, useState } from "react";
import type { Familiar, SessionRow } from "@/lib/types";
import { Modal } from "@/components/ui/modal";
import { PropertyPill } from "@/components/ui/property-pill";

const TEMPLATES = ["Bugfix", "Docs", "Release", "PR review", "Plugin"];
const STATUSES: CardStatus[] = ["inbox", "running", "review"];
const PRIORITIES: CardPriority[] = ["urgent", "high", "medium", "low"];

type CardStatus = "inbox" | "running" | "review";
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
          .split(/[,\s]+/)
          .map((s) => s.trim())
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

  const familiarLabel =
    familiars.find((f) => f.id === familiarId)?.display_name ?? "Default familiar";
  const sessionLabel =
    sessions.find((s) => s.id === sessionId)?.title ?? null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      breadcrumb={["Board", "New card"]}
      footerPills={
        <>
          <PropertyPill
            icon="ph:circle"
            label={`Status: ${cap(status)}`}
            filled
            title="Status (set in fields above)"
          />
          <PropertyPill
            icon="ph:circle-fill"
            label={`Priority: ${cap(priority)}`}
            filled
            title="Priority (set in fields above)"
          />
          <PropertyPill
            icon="ph:sparkle"
            label={familiarLabel}
            filled={familiarId !== null}
          />
          {sessionLabel ? (
            <PropertyPill icon="ph:chat-circle-dots" label={sessionLabel} filled />
          ) : null}
        </>
      }
      footerActions={
        <>
          <button
            onClick={onClose}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-muted"
          >
            Cancel
          </button>
          <button
            onClick={create}
            disabled={!title.trim() || busy}
            className="rounded-md border border-border-strong bg-muted px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-card disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create"}
          </button>
        </>
      }
    >
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
                  ? "border-border-strong bg-muted text-foreground"
                  : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
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
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-border-strong"
        />
      </Field>

      <Field label="Notes">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes, acceptance criteria, links"
          rows={6}
          className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-border-strong"
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

        <Field label="Familiar">
          <Select
            value={familiarId ?? ""}
            onChange={(v) => {
              setFamiliarId(v || null);
              setSessionId(null);
            }}
            options={[
              { value: "", label: "Default familiar" },
              ...familiars.map((f) => ({
                value: f.id,
                label: `${f.display_name} · ${f.harness ?? "?"}`,
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
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-border-strong"
        />
      </Field>

      {error ? (
        <div className="mb-3 rounded border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground">
          {error}
        </div>
      ) : null}
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mb-4 block">
      <div className="mb-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
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
        className="w-full appearance-none rounded-md border border-border bg-background px-3 py-2 pr-8 text-sm text-foreground outline-none focus:border-border-strong"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-card">
            {o.label}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
        ▾
      </span>
    </div>
  );
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
