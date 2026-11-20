"use client";

import { useMemo } from "react";
import { CronDetailSection } from "@/components/automations/cron-detail-primitives";
import { readDateTimePrefs } from "@/lib/datetime-format";
import { sameRoutineRrule } from "@/lib/automations/routine-rrule";
import { Icon } from "@/lib/icon";
import type { AutomationHealthView, AutomationLifecycleView } from "@/lib/automations/lifecycle";
import {
  formatInZone,
  formatLocalDate,
  formatUtcOffset,
  previewSchedule,
  type ScheduleWarning,
} from "@/lib/automations/schedule-preview";

function viewerTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function warningText(warning: ScheduleWarning, zone: string, hour12: boolean): string {
  switch (warning.kind) {
    case "offset-change":
      return `Clocks change in ${zone}: from ${formatInZone(warning.at, zone, { hour12 })} it runs at ${formatUtcOffset(warning.toOffsetMinutes)} instead of ${formatUtcOffset(warning.fromOffsetMinutes)}.`;
    case "nonexistent":
      return `On ${formatLocalDate(warning.date)} this time doesn't exist in ${zone}, because clocks skip ahead. Coven's scheduler decides whether and when that day's run happens.`;
    case "repeated":
      return `On ${formatLocalDate(warning.date)} this time happens twice in ${zone}, because clocks fall back. The preview shows the first; Coven's scheduler decides which one runs.`;
  }
}

/**
 * When this automation would run, in the zone Coven runs it in, checked
 * against the next slot Coven itself reports. Coven's scheduler stays the
 * authority; this is a preview a person reads before saving or resuming.
 */
export function AutomationSchedulePreview({
  rrule,
  savedRrule,
  lifecycle,
  health,
  nowMs,
}: {
  /** The rule being edited, `RRULE:` prefix optional. */
  rrule: string;
  /** The rule Coven holds now. */
  savedRrule: string;
  lifecycle: AutomationLifecycleView;
  /** Health Coven reported; `null` when it couldn't be read, `undefined` while reading. */
  health: AutomationHealthView | null | undefined;
  nowMs: number;
}) {
  const hour12 = readDateTimePrefs().clock !== "24h";
  const viewerZone = viewerTimeZone();
  const zone = lifecycle.timezone ?? viewerZone;
  const zoneVerified = lifecycle.timezone !== null;
  // Recompute once a minute at most, not on every render.
  const minute = Math.floor(nowMs / 60_000) * 60_000;
  const preview = useMemo(() => previewSchedule(rrule, zone, minute), [rrule, zone, minute]);
  const unsaved = !sameRoutineRrule(rrule, savedRrule);
  const shownZone = preview.kind === "parsed" ? preview.zone : zone;
  const nextDue = health?.nextDueAt ?? null;
  const firstPreview = preview.kind === "parsed" ? preview.occurrences[0]?.at ?? null : null;

  return (
    <CronDetailSection title="Schedule preview" description="When this automation would run. Coven's scheduler is the authority.">
      <div className="space-y-3 text-[length:var(--text-xs)] text-[var(--text-secondary)]" aria-live="polite">
        <p>
          {zoneVerified
            ? <>Times are in <strong className="font-medium text-[var(--text-primary)]">{shownZone}</strong>, the zone Coven runs this automation in.</>
            : <>Coven&apos;s time zone for this automation isn&apos;t verified, so times are shown in your time zone ({viewerZone}).</>}
        </p>
        {lifecycle.state === "paused" ? (
          <p role="note">Paused. Nothing runs until it&apos;s resumed. If it were resumed now, these would be the next runs.</p>
        ) : lifecycle.state === "disabled" ? (
          <p role="note">Disabled. Nothing runs, and it can&apos;t be resumed directly.</p>
        ) : null}
        {unsaved ? <p role="note">Previewing unsaved changes. Coven runs the saved schedule until you save.</p> : null}

        {preview.kind === "unparsed" ? (
          <p role="note">Cave can&apos;t preview this rule. Coven runs only daily or weekly rules on the hour.</p>
        ) : preview.kind === "invalid-zone" ? (
          <p role="note">This browser doesn&apos;t know the time zone {preview.zone}, so Cave can&apos;t preview the schedule.</p>
        ) : preview.occurrences.length === 0 ? (
          <p role="note">This rule has no runs in the next year.</p>
        ) : (
          <ol className="space-y-1" aria-label={`Next ${preview.occurrences.length} runs`}>
            {preview.occurrences.map((occurrence) => (
              <li key={occurrence.at} className="tabular-nums">
                <time dateTime={occurrence.at} className="text-[var(--text-primary)]">{formatInZone(occurrence.at, preview.zone, { hour12 })}</time>
                {preview.zone !== viewerZone ? (
                  <span className="text-[var(--text-muted)]"> · {formatInZone(occurrence.at, viewerZone, { hour12 })} your time</span>
                ) : null}
                {occurrence.repeated ? <span className="text-[var(--text-muted)]"> · this time happens twice that day</span> : null}
              </li>
            ))}
          </ol>
        )}

        {preview.kind === "parsed" && preview.warnings.length > 0 ? (
          <ul className="space-y-1" aria-label="Clock changes ahead">
            {preview.warnings.map((warning) => (
              <li key={`${warning.kind}:${"at" in warning ? warning.at : warning.date}`} className="flex gap-1.5 text-[var(--color-warning)]">
                <Icon name="ph:warning" width={12} aria-hidden className="mt-0.5 shrink-0" />
                <span>{warningText(warning, preview.zone, hour12)}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {health === undefined ? (
          <p role="status">Reading Coven&apos;s next scheduled slot…</p>
        ) : health === null ? (
          <p>Coven&apos;s next scheduled slot couldn&apos;t be read.</p>
        ) : nextDue ? (
          <p>
            Coven&apos;s next scheduled slot: <time dateTime={nextDue} className="text-[var(--text-primary)]">{formatInZone(nextDue, shownZone, { hour12 })}</time>.
            {lifecycle.state !== "active" ? " It runs only once the automation is active." : null}
            {!unsaved && firstPreview && Date.parse(firstPreview) !== Date.parse(nextDue)
              ? " Cave's preview differs from it; Coven's slot is the one that counts."
              : null}
          </p>
        ) : (
          <p>Coven reports no upcoming slot.</p>
        )}
      </div>
    </CronDetailSection>
  );
}
