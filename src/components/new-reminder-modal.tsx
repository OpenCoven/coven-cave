"use client";

import { useEffect, useMemo, useState } from "react";
import type { Familiar } from "@/lib/types";
import { computeNextOccurrence, type Recurrence } from "@/lib/inbox-recurrence";
import { parseWhen, splitWhenAndText } from "@/lib/parse-when";
import { parseCron } from "@/lib/cron";
import { Icon } from "@/lib/icon";

export type NewReminderDraft = {
  title: string;
  body?: string;
  fireAt: string;
  familiarId: string | null;
  recurrence?: Recurrence;
};

type RecurPreset =
  | "none"
  | "every-30m"
  | "every-1h"
  | "every-day"
  | "every-weekday"
  | "every-weekend"
  | "cron";

const RECUR_PRESETS: { value: RecurPreset; label: string }[] = [
  { value: "none", label: "One-shot" },
  { value: "every-30m", label: "Every 30 min" },
  { value: "every-1h", label: "Every 1 hour" },
  { value: "every-day", label: "Every day (same time)" },
  { value: "every-weekday", label: "Every weekday (same time)" },
  { value: "every-weekend", label: "Every weekend (same time)" },
  { value: "cron", label: "Cron expression…" },
];

function recurrenceFor(
  preset: RecurPreset,
  fireAt: string,
  cronExpr: string,
): Recurrence {
  if (preset === "none") return { type: "none" };
  if (preset === "every-30m") return { type: "interval", everyMs: 30 * 60_000 };
  if (preset === "every-1h") return { type: "interval", everyMs: 60 * 60_000 };
  if (preset === "cron") return { type: "cron", expr: cronExpr.trim() };
  const d = new Date(fireAt);
  const hour = d.getHours();
  const minute = d.getMinutes();
  if (preset === "every-day") return { type: "daily", hour, minute };
  if (preset === "every-weekday")
    return { type: "weekly", days: [1, 2, 3, 4, 5], hour, minute };
  // every-weekend
  return { type: "weekly", days: [0, 6], hour, minute };
}

type Props = {
  open: boolean;
  onClose: () => void;
  familiars: Familiar[];
  defaultFamiliarId?: string | null;
  defaultWhenText?: string;
  defaultTitle?: string;
  onCreate: (draft: NewReminderDraft) => Promise<void> | void;
};

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

export function NewReminderModal({
  open,
  onClose,
  familiars,
  defaultFamiliarId = null,
  defaultWhenText = "",
  defaultTitle = "",
  onCreate,
}: Props) {
  const [title, setTitle] = useState(defaultTitle);
  const [whenText, setWhenText] = useState(defaultWhenText);
  const [manualFireAt, setManualFireAt] = useState<string>("");
  const [familiarId, setFamiliarId] = useState<string | null>(defaultFamiliarId);
  const [recurPreset, setRecurPreset] = useState<RecurPreset>("none");
  const [cronExpr, setCronExpr] = useState<string>("*/15 * * * *");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(defaultTitle);
    setWhenText(defaultWhenText);
    setManualFireAt("");
    setFamiliarId(defaultFamiliarId);
    setRecurPreset("none");
    setCronExpr("*/15 * * * *");
    setError(null);
  }, [open, defaultFamiliarId, defaultWhenText, defaultTitle]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const parsed = useMemo(() => {
    const w = whenText.trim();
    if (!w) return null;
    return parseWhen(w);
  }, [whenText]);

  // If the natural-language phrase implies a recurrence, reflect it in the
  // picker — user sees what was inferred and can override.
  useEffect(() => {
    if (!parsed) return;
    const r = parsed.recurrence;
    if (r.type === "none") {
      setRecurPreset("none");
    } else if (r.type === "interval" && r.everyMs === 30 * 60_000) {
      setRecurPreset("every-30m");
    } else if (r.type === "interval" && r.everyMs === 60 * 60_000) {
      setRecurPreset("every-1h");
    } else if (r.type === "daily") {
      setRecurPreset("every-day");
    } else if (r.type === "weekly") {
      const days = r.days.slice().sort().join(",");
      if (days === "1,2,3,4,5") setRecurPreset("every-weekday");
      else if (days === "0,6") setRecurPreset("every-weekend");
    } else if (r.type === "cron") {
      setRecurPreset("cron");
      setCronExpr(r.expr);
    }
  }, [parsed]);

  const cronFields = useMemo(() => {
    if (recurPreset !== "cron") return null;
    return parseCron(cronExpr);
  }, [recurPreset, cronExpr]);

  const cronNextFire = useMemo<string | null>(() => {
    if (recurPreset !== "cron" || !cronFields) return null;
    return computeNextOccurrence(
      { type: "cron", expr: cronExpr.trim() },
      Date.now(),
    );
  }, [recurPreset, cronFields, cronExpr]);

  const resolvedFireAt = useMemo<string | null>(() => {
    // Cron drives its own fireAt directly from the expression.
    if (recurPreset === "cron") return cronNextFire;
    if (manualFireAt) {
      const t = new Date(manualFireAt).getTime();
      return Number.isFinite(t) ? new Date(t).toISOString() : null;
    }
    if (parsed) return parsed.fireAt;
    return null;
  }, [manualFireAt, parsed, recurPreset, cronNextFire]);

  if (!open) return null;

  const create = async () => {
    if (!title.trim() || !resolvedFireAt || busy) return;
    if (recurPreset === "cron" && !cronFields) {
      setError("cron expression is invalid");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onCreate({
        title: title.trim(),
        fireAt: resolvedFireAt,
        familiarId,
        recurrence: recurrenceFor(recurPreset, resolvedFireAt, cronExpr),
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "create failed");
    } finally {
      setBusy(false);
    }
  };

  const previewLabel = resolvedFireAt
    ? new Date(resolvedFireAt).toLocaleString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[560px] max-w-[94vw] max-h-[90vh] overflow-y-auto rounded-2xl border border-[--border-hairline] bg-[--bg-base] p-6 shadow-2xl"
      >
        <div className="mb-5 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-[--text-primary]">New reminder</h2>
            <p className="text-[12px] text-[--text-muted]">
              Type a natural phrase like “in 30m” or pick a date.
            </p>
          </div>
          <button
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded border border-[--border-hairline] text-[--text-secondary] hover:bg-[--bg-raised]"
            aria-label="Close"
          >
            <Icon name="ph:x-bold" />
          </button>
        </div>

        <Field label="Remind me to">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="check the deploy"
            autoFocus
            className="w-full rounded-md border border-[--border-hairline] bg-[--bg-raised]/40 px-3 py-2 text-sm text-[--text-primary] outline-none placeholder:text-[--text-muted] focus:border-purple-600"
          />
        </Field>

        <Field label="When">
          <input
            value={whenText}
            onChange={(e) => {
              setWhenText(e.target.value);
              if (e.target.value.trim()) setManualFireAt("");
            }}
            placeholder="in 30m · in 2h · today 17:30 · tomorrow 9am"
            className={`w-full rounded-md border bg-[--bg-raised]/40 px-3 py-2 text-sm text-[--text-primary] outline-none placeholder:text-[--text-muted] ${
              whenText && !parsed
                ? "border-amber-600/60"
                : "border-[--border-hairline] focus:border-purple-600"
            }`}
          />
          <div className="mt-1 flex items-center justify-between text-[10px] text-[--text-muted]">
            <span>
              {whenText && !parsed
                ? "Couldn't parse — try “in 30m”, “today 9pm”, or use the picker below."
                : parsed
                ? `Parsed → ${previewLabel}`
                : "Or pick exactly:"}
            </span>
          </div>
        </Field>

        <Field label="Exact date / time">
          <input
            type="datetime-local"
            value={manualFireAt}
            onChange={(e) => {
              setManualFireAt(e.target.value);
              if (e.target.value) setWhenText("");
            }}
            min={toLocalInput(new Date().toISOString())}
            className="w-full rounded-md border border-[--border-hairline] bg-[--bg-raised]/40 px-3 py-2 text-sm text-[--text-primary] outline-none focus:border-purple-600"
          />
        </Field>

        <div className="mb-4 grid grid-cols-2 gap-4">
          <Field label="Repeat">
            <Select
              value={recurPreset}
              onChange={(v) => setRecurPreset(v as RecurPreset)}
              options={RECUR_PRESETS}
            />
          </Field>
          <Field label="Familiar">
            <Select
              value={familiarId ?? ""}
              onChange={(v) => setFamiliarId(v || null)}
              options={[
                { value: "", label: "No familiar" },
                ...familiars.map((f) => ({
                  value: f.id,
                  label: `${f.display_name} · ${f.harness ?? "?"}`,
                })),
              ]}
            />
          </Field>
        </div>

        {recurPreset === "cron" ? (
          <Field label="Cron expression (min hour day month weekday)">
            <input
              value={cronExpr}
              onChange={(e) => setCronExpr(e.target.value)}
              placeholder="*/15 * * * *"
              className={`w-full rounded-md border bg-[--bg-raised]/40 px-3 py-2 font-mono text-sm text-[--text-primary] outline-none placeholder:text-[--text-muted] ${
                cronExpr && !cronFields
                  ? "border-amber-600/60"
                  : "border-[--border-hairline] focus:border-purple-600"
              }`}
            />
            <div className="mt-1 text-[10px] text-[--text-muted]">
              {cronExpr && !cronFields
                ? "Invalid cron expression."
                : cronNextFire
                ? `Next fire → ${new Date(cronNextFire).toLocaleString(undefined, {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}`
                : "Try “0 9 * * 1-5” for weekdays at 9am."}
            </div>
          </Field>
        ) : null}

        {error ? (
          <div className="mb-3 rounded border border-amber-700/40 bg-amber-900/20 px-3 py-1.5 text-xs text-amber-200">
            {error}
          </div>
        ) : null}

        <div className="flex items-center justify-end gap-2">
          <button
            onClick={create}
            disabled={!title.trim() || !resolvedFireAt || busy}
            className="rounded-md bg-rose-700 px-4 py-1.5 text-sm font-medium text-zinc-50 transition-colors hover:bg-rose-600 disabled:opacity-50"
          >
            {busy ? "Creating…" : previewLabel ? `Remind ${previewLabel}` : "Create"}
          </button>
          <button
            onClick={onClose}
            className="rounded-md border border-[--border-hairline] bg-[--bg-raised] px-4 py-1.5 text-sm text-[--text-primary] hover:bg-[--bg-raised]"
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
      <div className="mb-1.5 text-[10px] uppercase tracking-widest text-[--text-muted]">
        {label}
      </div>
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
        className="w-full appearance-none rounded-md border border-[--border-hairline] bg-[--bg-raised]/40 px-3 py-2 pr-8 text-sm text-[--text-primary] outline-none focus:border-purple-600"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-[--bg-raised]">
            {o.label}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[--text-muted]">
        ▾
      </span>
    </div>
  );
}

/**
 * Helper to map a "/remind …" args string into modal defaults — used by the
 * palette/slash handler to pre-fill the modal with the parsed body.
 */
export function draftFromSlashArgs(args: string): {
  title: string;
  whenText: string;
} {
  const trimmed = args.trim();
  const { when, text } = splitWhenAndText(trimmed);
  if (!when) return { title: trimmed, whenText: "" };
  // text is the trailing slice; whenText is whatever leads up to it.
  const whenText = text ? trimmed.slice(0, trimmed.length - text.length).trim() : trimmed;
  return { title: text, whenText };
}
