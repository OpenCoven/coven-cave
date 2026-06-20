"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Familiar } from "@/lib/types";
import { computeNextOccurrence, type Recurrence } from "@/lib/inbox-recurrence";
import { parseWhen } from "@/lib/parse-when";
import { draftReminderFromText } from "@/lib/reminder-draft";
import { parseCron } from "@/lib/cron";
import { Icon } from "@/lib/icon";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { readDateTimePrefs } from "@/lib/datetime-format";
import { useIsCoarsePointer } from "@/lib/use-viewport";
import { ReminderLinkField } from "@/components/reminder-link-field";
import type { LinkRef } from "@/lib/cave-inbox";

export type NewReminderDraft = {
  title: string;
  body?: string;
  fireAt: string;
  familiarId: string | null;
  recurrence?: Recurrence;
  link?: LinkRef | null;
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

export type ReminderEdit = {
  id: string;
  title: string;
  whenText?: string;
  fireAt: string;
  recurrence?: Recurrence;
  link?: LinkRef | null;
};

type Props = {
  open: boolean;
  onClose: () => void;
  familiars: Familiar[];
  defaultFamiliarId?: string | null;
  defaultFireAt?: string;
  defaultWhenText?: string;
  defaultTitle?: string;
  onCreate: (draft: NewReminderDraft) => Promise<void> | void;
  editing?: ReminderEdit;
  onUpdate?: (id: string, draft: NewReminderDraft) => Promise<void> | void;
};

// Mirror of the parsed-recurrence → preset effect, used to map an existing
// reminder's stored recurrence back onto the picker when editing.
function presetForRecurrence(rec: Recurrence | undefined): {
  preset: RecurPreset;
  cronExpr?: string;
} {
  if (!rec || rec.type === "none") return { preset: "none" };
  if (rec.type === "interval" && rec.everyMs === 30 * 60_000)
    return { preset: "every-30m" };
  if (rec.type === "interval" && rec.everyMs === 60 * 60_000)
    return { preset: "every-1h" };
  if (rec.type === "daily") return { preset: "every-day" };
  if (rec.type === "weekly") {
    const days = rec.days.slice().sort().join(",");
    if (days === "1,2,3,4,5") return { preset: "every-weekday" };
    if (days === "0,6") return { preset: "every-weekend" };
    return { preset: "none" };
  }
  if (rec.type === "cron") return { preset: "cron", cronExpr: rec.expr };
  return { preset: "none" };
}

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
  defaultFireAt = "",
  defaultWhenText = "",
  defaultTitle = "",
  onCreate,
  editing,
  onUpdate,
}: Props) {
  const [title, setTitle] = useState(defaultTitle);
  const [whenText, setWhenText] = useState(defaultWhenText);
  const [manualFireAt, setManualFireAt] = useState<string>("");
  const [familiarId, setFamiliarId] = useState<string | null>(defaultFamiliarId);
  const [recurPreset, setRecurPreset] = useState<RecurPreset>("none");
  const [cronExpr, setCronExpr] = useState<string>("*/15 * * * *");
  const [link, setLink] = useState<LinkRef | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const coarse = useIsCoarsePointer();
  const isEditing = !!editing;

  useEffect(() => {
    if (!open) return;
    if (editing) {
      // Edit mode: prefill from the existing reminder.
      setTitle(editing.title);
      setWhenText(editing.whenText ?? "");
      setManualFireAt(editing.whenText ? "" : toLocalInput(editing.fireAt));
      setFamiliarId(defaultFamiliarId);
      const { preset, cronExpr: cron } = presetForRecurrence(editing.recurrence);
      setRecurPreset(preset);
      setCronExpr(cron ?? "*/15 * * * *");
      setLink(editing.link ?? null);
      setError(null);
      return;
    }
    setTitle(defaultTitle);
    setWhenText(defaultWhenText);
    setManualFireAt(defaultFireAt ? toLocalInput(defaultFireAt) : "");
    setFamiliarId(defaultFamiliarId);
    setRecurPreset("none");
    setCronExpr("*/15 * * * *");
    setLink(null);
    setError(null);
  }, [open, defaultFamiliarId, defaultFireAt, defaultWhenText, defaultTitle, editing]);

  const dialogRef = useRef<HTMLDivElement | null>(null);
  // Trap focus inside the dialog and close on Escape (replaces the old
  // window-level Escape listener; adds Tab containment).
  useFocusTrap(open, dialogRef, { onEscape: onClose });

  const parsed = useMemo(() => {
    const w = whenText.trim();
    if (!w) return null;
    return parseWhen(w);
  }, [whenText]);

  // If the natural-language phrase implies a recurrence, reflect it in the
  // picker — user sees what was inferred and can override.
  useEffect(() => {
    if (isEditing) return;
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
  }, [parsed, isEditing]);

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
      const draft: NewReminderDraft = {
        title: title.trim(),
        fireAt: resolvedFireAt,
        familiarId,
        recurrence: recurrenceFor(recurPreset, resolvedFireAt, cronExpr),
        link,
      };
      if (editing && onUpdate) {
        await onUpdate(editing.id, draft);
      } else {
        await onCreate(draft);
      }
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
        // Honor the user's 12h/24h clock preference for the fire-time preview.
        hour12: readDateTimePrefs().clock !== "24h",
      })
    : null;

  return (
    <div
      onClick={onClose}
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
    >
      <div
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-reminder-title"
        tabIndex={-1}
        className="w-[560px] max-w-[94vw] max-h-[90vh] overflow-y-auto rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-base)] p-6 shadow-2xl"
      >
        <div className="mb-5 flex items-start justify-between">
          <div>
            <h2 id="new-reminder-title" className="text-lg font-semibold text-[var(--text-primary)]">
              {isEditing ? "Edit reminder" : "New reminder"}
            </h2>
            <p className="text-[12px] text-[var(--text-muted)]">
              Type a natural phrase like “in 30m” or pick a date.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="focus-ring grid h-7 w-7 place-items-center rounded border border-[var(--border-hairline)] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
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
            autoFocus={!coarse}
            className="w-full rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)]/40 px-3 py-2 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--accent-presence)]"
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
            className={`w-full rounded-md border bg-[var(--bg-raised)]/40 px-3 py-2 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] ${
              whenText && !parsed
                ? "border-[color-mix(in_oklch,var(--color-warning)_60%,transparent)]"
                : "border-[var(--border-hairline)] focus:border-[var(--accent-presence)]"
            }`}
          />
          <div className="mt-1 flex items-center justify-between text-[10px] text-[var(--text-muted)]">
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
            className="w-full rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)]/40 px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-presence)]"
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
              className={`w-full rounded-md border bg-[var(--bg-raised)]/40 px-3 py-2 font-mono text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] ${
                cronExpr && !cronFields
                  ? "border-[color-mix(in_oklch,var(--color-warning)_60%,transparent)]"
                  : "border-[var(--border-hairline)] focus:border-[var(--accent-presence)]"
              }`}
            />
            <div className="mt-1 text-[10px] text-[var(--text-muted)]">
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

        <Field label="Link (optional)">
          <ReminderLinkField value={link} onChange={setLink} />
        </Field>

        {error ? (
          <div className="mb-3 rounded border border-[color-mix(in_oklch,var(--color-warning)_40%,transparent)] bg-[color-mix(in_oklch,var(--color-warning)_20%,transparent)] px-3 py-1.5 text-xs text-[var(--color-warning)]">
            {error}
          </div>
        ) : null}

        <div className="flex items-center justify-end gap-2">
          <button
            onClick={create}
            disabled={!title.trim() || !resolvedFireAt || busy}
            className="rounded-md bg-[var(--color-danger)] px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[var(--color-danger)] disabled:opacity-50"
          >
            {isEditing
              ? busy
                ? "Saving…"
                : "Save"
              : busy
              ? "Creating…"
              : previewLabel
              ? `Remind ${previewLabel}`
              : "Create"}
          </button>
          <button
            onClick={onClose}
            className="rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-4 py-1.5 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-raised)]"
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
      <div className="mb-1.5 text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
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
        className="w-full appearance-none rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)]/40 px-3 py-2 pr-8 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-presence)]"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-[var(--bg-raised)]">
            {o.label}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]">
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
  const draft = draftReminderFromText(trimmed);
  if (!draft.ok) return { title: trimmed, whenText: "" };
  return { title: draft.title, whenText: draft.whenText };
}
