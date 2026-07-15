"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Familiar } from "@/lib/types";
import { computeNextOccurrence, type Recurrence } from "@/lib/inbox-recurrence";
import { parseWhen } from "@/lib/parse-when";
import { describeRecurrence, nextOccurrences } from "@/lib/schedule-plan";
import { draftReminderFromText } from "@/lib/reminder-draft";
import { parseCron } from "@/lib/cron";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { readDateTimePrefs } from "@/lib/datetime-format";
import { useIsCoarsePointer } from "@/lib/use-viewport";
import { ReminderLinkField } from "@/components/reminder-link-field";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { StandardSelect } from "@/components/ui/select";
import type { LinkRef } from "@/lib/cave-inbox";

export type NewReminderDraft = {
  title: string;
  body?: string;
  fireAt: string;
  familiarId: string | null;
  recurrence?: Recurrence;
  link?: LinkRef | null;
  /** The human phrase the plan came from — persisted so edits round-trip it. */
  whenText?: string | null;
};

type RecurPreset =
  | "none"
  | "every-30m"
  | "every-1h"
  | "every-day"
  | "every-weekday"
  | "every-weekend"
  | "custom"
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
  customRec: Recurrence | null,
): Recurrence {
  if (preset === "none") return { type: "none" };
  if (preset === "every-30m") return { type: "interval", everyMs: 30 * 60_000 };
  if (preset === "every-1h") return { type: "interval", everyMs: 60 * 60_000 };
  if (preset === "cron") return { type: "cron", expr: cronExpr.trim() };
  // The phrase (or the reminder being edited) described a schedule no preset
  // represents — keep the exact plan instead of silently downgrading it.
  if (preset === "custom") return customRec ?? { type: "none" };
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
// reminder's stored recurrence back onto the picker when editing. Anything a
// named preset can't represent maps to "custom" carrying the exact recurrence,
// so editing never silently rewrites the stored plan.
function presetForRecurrence(rec: Recurrence | undefined): {
  preset: RecurPreset;
  cronExpr?: string;
  customRec?: Recurrence;
} {
  if (!rec || rec.type === "none") return { preset: "none" };
  if (rec.type === "interval" && rec.everyMs === 30 * 60_000)
    return { preset: "every-30m" };
  if (rec.type === "interval" && rec.everyMs === 60 * 60_000)
    return { preset: "every-1h" };
  if (rec.type === "interval") return { preset: "custom", customRec: rec };
  if (rec.type === "daily") return { preset: "every-day" };
  if (rec.type === "weekly") {
    const days = rec.days.slice().sort().join(",");
    if (days === "1,2,3,4,5") return { preset: "every-weekday" };
    if (days === "0,6") return { preset: "every-weekend" };
    return { preset: "custom", customRec: rec };
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
  // The exact recurrence behind the "custom" preset (from the phrase or the
  // reminder being edited) — held verbatim so the saved plan matches it.
  const [customRec, setCustomRec] = useState<Recurrence | null>(null);
  // In edit mode the picker starts from the STORED recurrence; only once the
  // user retypes the phrase does the parse retake the picker (whenDirty).
  const [whenDirty, setWhenDirty] = useState(false);
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
      const { preset, cronExpr: cron, customRec: custom } = presetForRecurrence(editing.recurrence);
      setRecurPreset(preset);
      setCronExpr(cron ?? "*/15 * * * *");
      setCustomRec(custom ?? null);
      setLink(editing.link ?? null);
      setWhenDirty(false);
      setError(null);
      return;
    }
    setTitle(defaultTitle);
    setWhenText(defaultWhenText);
    setManualFireAt(defaultFireAt ? toLocalInput(defaultFireAt) : "");
    setFamiliarId(defaultFamiliarId);
    setRecurPreset("none");
    setCronExpr("*/15 * * * *");
    setCustomRec(null);
    setLink(null);
    setWhenDirty(false);
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
  // picker — user sees what was inferred and can override. Schedules with no
  // named preset (e.g. "every tuesday 4pm") become the "custom" preset holding
  // the exact parsed recurrence instead of silently saving a one-shot. In edit
  // mode this only kicks in after the user actually retypes the phrase.
  useEffect(() => {
    if (isEditing && !whenDirty) return;
    if (!parsed) return;
    const { preset, cronExpr: cron, customRec: custom } = presetForRecurrence(parsed.recurrence);
    setRecurPreset(preset);
    if (cron) setCronExpr(cron);
    setCustomRec(custom ?? null);
  }, [parsed, isEditing, whenDirty]);

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
        recurrence: recurrenceFor(recurPreset, resolvedFireAt, cronExpr, customRec),
        link,
        // Persist the phrase that produced the plan so editing round-trips
        // the human input, not just the machine schedule.
        whenText: whenText.trim() || null,
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

  const hour12 = readDateTimePrefs().clock !== "24h";
  const previewLabel = resolvedFireAt
    ? new Date(resolvedFireAt).toLocaleString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        // Honor the user's 12h/24h clock preference for the fire-time preview.
        hour12,
      })
    : null;

  // The plan the dialog will actually save, echoed back for verification:
  // cadence sentence for recurring plans + the next few concrete fires.
  const planRecurrence = resolvedFireAt
    ? recurrenceFor(recurPreset, resolvedFireAt, cronExpr, customRec)
    : null;
  const planCadence = planRecurrence ? describeRecurrence(planRecurrence, { hour12 }) : null;
  // Cheap (≤3 next-occurrence steps) — computed per render; no hook after the
  // early `if (!open) return null` above.
  const planUpcoming: string[] =
    planRecurrence && planRecurrence.type !== "none"
      ? nextOccurrences(planRecurrence, Date.now(), 3)
      : [];

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
              Type a natural phrase like “in 30m” or “every tuesday 4pm” — the plan below shows exactly what will fire.
            </p>
          </div>
          <IconButton
            onClick={onClose}
            icon="ph:x-bold"
            aria-label="Close"
            className="border border-[var(--border-hairline)]"
          />
        </div>

        <Field label="Remind me to">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="check the deploy"
            autoFocus={!coarse}
            className="w-full rounded-[var(--radius-control)] border border-[var(--border-hairline)] bg-[var(--bg-raised)]/40 px-3 py-2 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--accent-presence)]"
          />
        </Field>

        <Field label="When">
          <input
            value={whenText}
            onChange={(e) => {
              setWhenText(e.target.value);
              setWhenDirty(true);
              if (e.target.value.trim()) setManualFireAt("");
            }}
            placeholder="in 30m · tomorrow at 9am · every tuesday 4pm · jul 20"
            className={`w-full rounded-[var(--radius-control)] border bg-[var(--bg-raised)]/40 px-3 py-2 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] ${
              whenText && !parsed
                ? "border-[color-mix(in_oklch,var(--color-warning)_60%,transparent)]"
                : "border-[var(--border-hairline)] focus:border-[var(--accent-presence)]"
            }`}
          />
          <div
            aria-live="polite"
            className="mt-1.5 text-[10px] text-[var(--text-muted)]"
          >
            {whenText && !parsed ? (
              <span>Couldn't parse — try “in 30m”, “tomorrow at 9am”, “every tuesday 4pm”, or use the picker below.</span>
            ) : resolvedFireAt ? (
              <div className="rounded-[var(--radius-control)] border border-[var(--border-hairline)] bg-[var(--bg-raised)]/40 px-2.5 py-1.5">
                <div className="flex items-baseline gap-1.5">
                  <span className="font-semibold uppercase tracking-widest text-[var(--accent-presence)]">
                    {planCadence ? "Repeats" : "Once"}
                  </span>
                  <span className="text-[11px] text-[var(--text-primary)]">
                    {planCadence ?? previewLabel}
                  </span>
                </div>
                {planUpcoming.length > 0 ? (
                  <div className="mt-0.5">
                    Next:{" "}
                    {planUpcoming
                      .map((isoDate) =>
                        new Date(isoDate).toLocaleString(undefined, {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                          hour12,
                        }),
                      )
                      .join(" · ")}
                  </div>
                ) : null}
              </div>
            ) : (
              <span>Or pick exactly:</span>
            )}
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
            className="w-full rounded-[var(--radius-control)] border border-[var(--border-hairline)] bg-[var(--bg-raised)]/40 px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-presence)]"
          />
        </Field>

        <div className="mb-4 grid grid-cols-2 gap-4">
          <Field label="Repeat">
            <Select
              value={recurPreset}
              onChange={(v) => setRecurPreset(v as RecurPreset)}
              options={
                // "Custom" only exists while a phrase/edit holds an exact
                // schedule no named preset represents — never hand-pickable.
                recurPreset === "custom"
                  ? [
                      {
                        value: "custom",
                        label: `Custom — ${describeRecurrence(customRec ?? { type: "none" }, { hour12 }) ?? "from phrase"}`,
                      },
                      ...RECUR_PRESETS,
                    ]
                  : RECUR_PRESETS
              }
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
              className={`w-full rounded-[var(--radius-control)] border bg-[var(--bg-raised)]/40 px-3 py-2 font-mono text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] ${
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
                    // Match the fire-time preview above — honor the 12h/24h pref.
                    hour12: readDateTimePrefs().clock !== "24h",
                  })}`
                : "Try “0 9 * * 1-5” for weekdays at 9am."}
            </div>
          </Field>
        ) : null}

        <Field label="Link (optional)">
          <ReminderLinkField value={link} onChange={setLink} />
        </Field>

        {error ? (
          <div className="mb-3 rounded-[var(--radius-control)] border border-[color-mix(in_oklch,var(--color-warning)_40%,transparent)] bg-[color-mix(in_oklch,var(--color-warning)_20%,transparent)] px-3 py-1.5 text-xs text-[var(--color-warning)]">
            {error}
          </div>
        ) : null}

        <div className="flex items-center justify-end gap-2">
          <Button
            variant="danger"
            onClick={create}
            disabled={!title.trim() || !resolvedFireAt || busy}
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
          </Button>
          <Button
            variant="secondary"
            onClick={onClose}
          >
            Cancel
          </Button>
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
    <StandardSelect
      label="Choose value"
      value={value}
      onChange={onChange}
      options={options}
      className="w-full border-[var(--border-hairline)] bg-[var(--bg-raised)]/40 px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent-presence)]"
    />
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
