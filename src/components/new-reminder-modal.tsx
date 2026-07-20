"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Familiar } from "@/lib/types";
import { computeNextOccurrence, type Recurrence } from "@/lib/inbox-recurrence";
import { parseWhen } from "@/lib/parse-when";
import { describeRecurrence, nextOccurrences } from "@/lib/schedule-plan";
import { parseCron } from "@/lib/cron";
import { Icon } from "@/lib/icon";
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

const WHEN_EXAMPLES = [
  "in 30m",
  "tomorrow at 9am",
  "every tuesday 4pm",
  "jul 20",
] as const;
type WhenExample = (typeof WHEN_EXAMPLES)[number];

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
  const [detailsOpen, setDetailsOpen] = useState(false);
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
      const mapped = presetForRecurrence(editing.recurrence);
      setRecurPreset(mapped.preset);
      setCronExpr(mapped.cronExpr ?? "*/15 * * * *");
      setCustomRec(mapped.customRec ?? null);
      setLink(editing.link ?? null);
      setDetailsOpen(mapped.preset !== "none" || editing.link != null);
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
    setDetailsOpen(false);
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

  const selectWhenExample = (example: WhenExample) => {
    setWhenText(example);
    setManualFireAt("");
    setWhenDirty(true);
    setError(null);
  };

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
  const planSummary = planCadence ?? previewLabel;
  const planDetail = planCadence
    ? planUpcoming.length > 0
      ? `Next: ${planUpcoming
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
          .join(" · ")}`
      : "Next occurrences are not available yet."
    : previewLabel
      ? "Fires once."
      : null;

  return (
    <div
      onClick={onClose}
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm"
    >
      <div
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-reminder-title"
        tabIndex={-1}
        className="flex max-h-[calc(100dvh-1.5rem)] w-[560px] max-w-[94vw] flex-col overflow-hidden rounded-[var(--radius-panel)] border border-[var(--border-hairline)] bg-[var(--bg-raised)] shadow-[0_24px_70px_color-mix(in_oklch,var(--bg-base)_72%,transparent)] outline-none"
      >
        <header className="flex items-start justify-between gap-4 px-6 pb-3 pt-6">
          <div className="min-w-0">
            <h2
              id="new-reminder-title"
              className="text-[19px] font-medium leading-tight text-[var(--text-primary)]"
            >
              {isEditing ? "Edit reminder" : "New reminder"}
            </h2>
            <p className="text-[length:var(--text-sm)] text-[var(--text-muted)]">
              Say when in plain words — the plan below shows exactly what fires.
            </p>
          </div>
          <IconButton
            onClick={onClose}
            icon="ph:x-bold"
            aria-label="Close"
            size="sm"
            className="shrink-0 border border-[var(--border-hairline)] bg-[var(--bg-base)]/45"
          />
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-3">
          <div className="space-y-4">
            <FloatingField id="new-reminder-what" label="Remind me to">
              <input
                id="new-reminder-what"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="check the deploy"
                autoFocus={!coarse}
                className="focus-ring h-11 w-full rounded-[var(--radius-control)] border border-[var(--border-hairline)] bg-transparent px-3 text-[14px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-presence)]"
              />
            </FloatingField>

            <FloatingField id="new-reminder-when" label="When">
              <input
                id="new-reminder-when"
                value={whenText}
                onChange={(e) => {
                  setWhenText(e.target.value);
                  setWhenDirty(true);
                  if (e.target.value.trim()) setManualFireAt("");
                }}
                placeholder="in 30m · tomorrow at 9am · every tuesday 4pm · jul 20"
                className={`focus-ring h-11 w-full rounded-[var(--radius-control)] border bg-transparent px-3 text-[14px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-presence)] ${
                  whenText && !parsed
                    ? "border-[color-mix(in_oklch,var(--color-warning)_60%,transparent)]"
                    : "border-[var(--border-hairline)]"
                }`}
              />
            </FloatingField>

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-0.5 text-[11px] text-[var(--text-muted)]">Try</span>
              {WHEN_EXAMPLES.map((example) => (
                <Button
                  key={example}
                  variant="secondary"
                  size="xs"
                  onClick={() => selectWhenExample(example)}
                  className="!h-6 !rounded-full !border-[var(--border-hairline)] !bg-transparent !px-2.5 !text-[11px] !font-normal !text-[var(--text-secondary)] hover:!bg-[var(--bg-hover)] hover:!text-[var(--text-primary)]"
                >
                  {example}
                </Button>
              ))}
            </div>

            <div aria-live="polite">
              {whenText && !parsed ? (
                <div className="rounded-[var(--radius-control)] border border-[color-mix(in_oklch,var(--color-warning)_42%,var(--border-hairline))] bg-[color-mix(in_oklch,var(--color-warning)_8%,var(--bg-raised))] px-3 py-2 text-[12px] leading-5 text-[var(--text-secondary)]">
                  Couldn't parse that phrase. Try one of the examples, or open Adjust details
                  to set an exact date and time.
                </div>
              ) : resolvedFireAt ? (
                <div
                  data-reminder-plan="true"
                  className="relative overflow-hidden rounded-[var(--radius-control)] border border-[var(--border-hairline)] bg-[color-mix(in_oklch,var(--bg-base)_52%,var(--bg-raised))] py-3 pl-5 pr-4"
                >
                  <span
                    aria-hidden="true"
                    className="absolute bottom-2 left-0 top-2 w-0.5 rounded-full bg-[var(--accent-presence)]"
                  />
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-[var(--accent-presence)] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--accent-presence-foreground)]">
                      {planCadence ? "Repeats" : "Once"}
                    </span>
                    <p
                      id="new-reminder-plan-summary"
                      className="min-w-0 text-[13px] font-medium leading-5 text-[var(--text-primary)]"
                    >
                      {planSummary}
                    </p>
                  </div>
                  {planDetail ? (
                    <p className="mt-1 text-[11px] leading-4 text-[var(--text-muted)]">
                      {planDetail}
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="text-[11px] text-[var(--text-muted)]">
                  Enter a phrase to preview the reminder plan.
                </p>
              )}
            </div>

            <div
              aria-hidden="true"
              className="h-px bg-[linear-gradient(90deg,transparent,var(--border-hairline)_18%,var(--border-hairline)_82%,transparent)]"
            />

            <Button
              variant="ghost"
              size="sm"
              aria-expanded={detailsOpen}
              aria-controls="new-reminder-details"
              onClick={() => setDetailsOpen((open) => !open)}
              className="!h-auto !p-0 !text-[12px] !font-medium !text-[var(--text-secondary)] hover:!bg-transparent hover:!text-[var(--text-primary)]"
            >
              <Icon
                name="ph:caret-right"
                width={12}
                aria-hidden
                className={`transition-transform ${detailsOpen ? "rotate-90" : ""}`}
              />
              {detailsOpen ? "Hide details" : "Adjust details"}
            </Button>

            {detailsOpen ? (
              <div
                id="new-reminder-details"
                className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2"
              >
                <Field id="new-reminder-exact-date" label="Exact date / time">
                  <input
                    id="new-reminder-exact-date"
                    type="datetime-local"
                    value={manualFireAt}
                    onChange={(e) => {
                      setManualFireAt(e.target.value);
                      if (e.target.value) setWhenText("");
                    }}
                    min={toLocalInput(new Date().toISOString())}
                    className="focus-ring h-10 w-full rounded-[var(--radius-control)] border border-[var(--border-hairline)] bg-[var(--bg-base)]/40 px-3 text-sm text-[var(--text-primary)] focus:border-[var(--accent-presence)]"
                  />
                </Field>

                <Field id="new-reminder-repeat" label="Repeat">
                  <Select
                    id="new-reminder-repeat"
                    label="Repeat"
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

                <Field id="new-reminder-familiar" label="Familiar">
                  <Select
                    id="new-reminder-familiar"
                    label="Familiar"
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

                <fieldset className="min-w-0 sm:col-span-2">
                  <legend className="mb-1.5 text-[11px] font-medium text-[var(--text-muted)]">
                    Link (optional)
                  </legend>
                  <ReminderLinkField value={link} onChange={setLink} />
                </fieldset>

                {recurPreset === "cron" ? (
                  <Field
                    id="new-reminder-cron"
                    label="Cron expression (min hour day month weekday)"
                    className="sm:col-span-2"
                  >
                    <input
                      id="new-reminder-cron"
                      value={cronExpr}
                      onChange={(e) => setCronExpr(e.target.value)}
                      placeholder="*/15 * * * *"
                      className={`focus-ring h-10 w-full rounded-[var(--radius-control)] border bg-[var(--bg-base)]/40 px-3 font-mono text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-presence)] ${
                        cronExpr && !cronFields
                          ? "border-[color-mix(in_oklch,var(--color-warning)_60%,transparent)]"
                          : "border-[var(--border-hairline)]"
                      }`}
                    />
                    <div className="mt-1 text-[10px] leading-4 text-[var(--text-muted)]">
                      {cronExpr && !cronFields
                        ? "Invalid cron expression."
                        : cronNextFire
                          ? `Next fire → ${new Date(cronNextFire).toLocaleString(undefined, {
                              weekday: "short",
                              month: "short",
                              day: "numeric",
                              hour: "numeric",
                              minute: "2-digit",
                              hour12: readDateTimePrefs().clock !== "24h",
                            })}`
                          : "Try “0 9 * * 1-5” for weekdays at 9am."}
                    </div>
                  </Field>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        {error ? (
          <div className="mx-6 mb-2 rounded-[var(--radius-control)] border border-[color-mix(in_oklch,var(--color-warning)_40%,transparent)] bg-[color-mix(in_oklch,var(--color-warning)_12%,transparent)] px-3 py-2 text-xs text-[var(--color-warning)]">
            {error}
          </div>
        ) : null}

        <footer className="px-6 pb-5 pt-3">
          <div
            aria-hidden="true"
            className="mb-3 h-px bg-[linear-gradient(90deg,transparent,var(--border-hairline)_18%,var(--border-hairline)_82%,transparent)]"
          />
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
            <Button variant="secondary" onClick={onClose} className="w-full sm:w-auto">
              Cancel
            </Button>
            <Button
              variant="secondary"
              onClick={create}
              disabled={!title.trim() || !resolvedFireAt || busy}
              className="w-full min-w-24 sm:w-auto !border-[color-mix(in_oklch,var(--accent-presence)_52%,var(--border-strong))] !bg-transparent !whitespace-normal !text-center hover:!bg-[color-mix(in_oklch,var(--accent-presence)_10%,var(--bg-raised))]"
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
          </div>
        </footer>
      </div>
    </div>
  );
}

function FloatingField({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="relative pt-1">
      <label
        htmlFor={id}
        className="absolute left-3 top-1 z-10 -translate-y-1/2 bg-[var(--bg-raised)] px-1 text-[10px] font-medium text-[var(--text-muted)]"
      >
        {label}
      </label>
      {children}
    </div>
  );
}

function Field({
  id,
  label,
  children,
  className = "",
}: {
  id: string;
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label
        htmlFor={id}
        className="mb-1.5 block text-[11px] font-medium text-[var(--text-muted)]"
      >
        {label}
      </label>
      {children}
    </div>
  );
}

function Select({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <StandardSelect
      id={id}
      label={label}
      value={value}
      onChange={onChange}
      options={options}
      className="h-10 w-full rounded-[var(--radius-control)] border border-[var(--border-hairline)] bg-[var(--bg-base)]/40 px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent-presence)]"
    />
  );
}

// Backward-compatible export for callers that imported the helper alongside
// the modal before the modal became a lazy workspace boundary.
export { draftFromSlashArgs } from "@/lib/reminder-slash-draft";
