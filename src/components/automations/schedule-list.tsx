"use client";

import { createContext, useContext } from "react";
import { FamiliarAvatar } from "@/components/familiar-avatar";
import { Button } from "@/components/ui/button";
import { OverflowMenu } from "@/components/ui/overflow-menu";
import { PopoverItem, PopoverSeparator } from "@/components/ui/popover";
import type { AutomationRunRecord } from "@/lib/automation-runs";
import type { CodexAutomation } from "@/lib/codex-automations-types";
import { formatTimestamp, readDateTimePrefs } from "@/lib/datetime-format";
import { Icon } from "@/lib/icon";
import type { IconName } from "@/lib/icon";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";
import { relativeTimeSigned } from "@/lib/relative-time";
import { runStatusColor } from "@/lib/automations/run-status";
import { cronHealth, cronHealthLabel, cronRunVerb, type CronHealth } from "@/lib/automations/cron-health";
import {
  lifecycleControl,
  lifecycleFreshnessNote,
  lifecycleStateLabel,
  type AutomationLifecycleView,
} from "@/lib/automations/lifecycle";
import { inFlightDescription, inFlightRowText, type InFlightView } from "@/lib/automations/in-flight";

function relTime(iso: string | undefined | null): string {
  return iso ? relativeTimeSigned(iso) : "—";
}

export type ScheduleActions = {
  runAutomation: (auto: CodexAutomation) => void;
  togglePauseAutomation: (auto: CodexAutomation) => void;
  /** Coven's canonical lifecycle for one automation. Rows read their state
   *  from this, never from the legacy routine mirror's `status`. */
  lifecycleOf: (id: string) => AutomationLifecycleView;
  /** What Coven's scheduler reports each automation doing right now. Optional: rows without it show none. */
  inFlightOf?: (id: string) => InFlightView;
  /** The automation with a mutation in flight, if any. Rows disable their own
   *  actions against it so a double-click cannot submit the same run twice —
   *  the second POST comes back 409. The detail panel already did this; the
   *  rows did not, and they are the surface people actually click. */
  busyId?: string | null;
};
export const ScheduleActionsContext = createContext<ScheduleActions | null>(null);

// Always-mounted row action — the same affordance the All/Flows rows use, so
// every tab exposes identical controls. Rendered as a sibling of the row's own
// button (never nested), so a click can't also open the detail panel. It paints
// on row hover/focus (see .rituals-cron-row__hover-actions) but stays in the tab
// order, so a keyboard user never has to hover to reach it.
//
// The label promotes to --text-primary on hover/focus because that is exactly
// when it needs to: the handoff spec's token table measures --text-secondary at
// 4.3:1 over --bg-hover — below AA — and says "promote to primary on hover".
// Tinting only the background made the text hardest to read at the one moment
// the user is reaching for it.
export function RowActionButton({ icon, label, text, onClick, disabled }: { icon: IconName; label: string; text: string; onClick: () => void; disabled?: boolean }) {
  return (
    <Button
      variant="ghost"
      size="xs"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="shrink-0 rounded-[var(--radius-control)] px-2 py-1 text-[length:var(--text-xs)] font-medium transition-colors hover:bg-[color-mix(in_oklch,var(--foreground)_10%,transparent)] [color:var(--text-secondary)]! hover:[color:var(--text-primary)]! focus-visible:[color:var(--text-primary)]!"
      leadingIcon={icon}
    >
      {/* Icon-only when the hosting pane runs narrow (e.g. the md split while a
          detail rail is open) — the aria-label keeps the full action name. */}
      <span className="rituals-cron-row__action-text">{text}</span>
    </Button>
  );
}

/**
 * Status glyph. Every state carries a distinct SHAPE as well as a tint, so the
 * row never encodes health by color alone (WCAG 1.4.1): a filled dot is
 * healthy, a dot inside a ring is running, a warning triangle is failing, a
 * dashed ring is paused. Running's pulse is an enhancement on top of that
 * shape, never the thing that distinguishes it — `prefers-reduced-motion`
 * removes the pulse and the states must still be told apart.
 */
function CronStatusGlyph({ health, label = cronHealthLabel(health) }: { health: CronHealth; label?: string }) {
  return (
    <span role="img" aria-label={label} title={label} className="rituals-cron-row__status">
      <span aria-hidden className={`rituals-cron-row__glyph--${health}`} />
    </span>
  );
}

function AutomationScheduleRow({
  auto,
  selected,
  familiarsById,
  lastRun,
  onSelect,
}: {
  auto: CodexAutomation;
  selected: boolean;
  familiarsById: Map<string, ResolvedFamiliar>;
  lastRun?: AutomationRunRecord;
  onSelect: (auto: CodexAutomation) => void;
}) {
  const actions = useContext(ScheduleActionsContext);
  const lifecycle = actions?.lifecycleOf(auto.id) ?? null;
  const isActive = lifecycle?.state === "active";
  const known = lifecycle !== null && lifecycle.state !== "unknown";
  // An unverified row draws the "off" glyph but names its real state, so the
  // shape never claims a pause Coven did not report.
  const health = cronHealth({ status: isActive ? "ACTIVE" : "PAUSED" }, lastRun);
  const glyphLabel = known ? undefined : lifecycle ? lifecycleStateLabel(lifecycle) : "Not verified";
  const freshnessNote = lifecycle ? lifecycleFreshnessNote(lifecycle, (iso) => formatTimestamp(iso, readDateTimePrefs())) : null;
  const control = lifecycle ? lifecycleControl(lifecycle) : null;
  // Coven's own occurrence state, by name: never one spinner for claimed, running and recovery.
  const inFlight = actions?.inFlightOf?.(auto.id) ?? null;
  const inFlightText = inFlight ? inFlightRowText(inFlight) : null;
  const busy = actions?.busyId === auto.id;
  const toggleDisabled = busy || !control || control.disabledReason !== null;
  const toggleLabel = `${isActive ? "Pause" : "Resume"} ${auto.name}${control?.disabledReason ? `: ${control.disabledReason}` : ""}`;
  const tag = auto.tags[0];
  return (
    <li
      className={`automation-list-row rituals-cron-row${isActive ? "" : " rituals-cron-row--paused"}`}
      aria-current={selected ? "true" : undefined}
      onClick={() => onSelect(auto)}
    >
      <CronStatusGlyph health={health} label={glyphLabel} />

      <span className="rituals-cron-row__name">
        <button
          type="button"
          onClick={() => onSelect(auto)}
          aria-label={`Open ${auto.name} details`}
          className="rituals-cron-row__label focus-ring"
        >
          {auto.name}
        </button>
        {tag ? <span className="rituals-cron-row__tag">{tag}</span> : null}
        {lifecycle && freshnessNote ? (
          <span className="rituals-cron-row__tag" title={freshnessNote}>
            {lifecycle.freshness === "stale" ? `${lifecycleStateLabel(lifecycle)} · stale` : lifecycleStateLabel(lifecycle)}
          </span>
        ) : null}
        {inFlight?.entry && inFlightText ? (
          <span
            className="rituals-cron-row__tag"
            title={inFlightDescription(inFlight.entry, (iso) => formatTimestamp(iso, readDateTimePrefs()))}
            // Recovery needs a person; the label says so, the tint only helps it stand out.
            style={inFlight.entry.state === "recovery_required" ? { color: "var(--color-warning)" } : undefined}
          >
            {inFlightText}
          </span>
        ) : null}
      </span>

      <span className="rituals-cron-row__avatars">
        {auto.familiars.slice(0, 3).map((fid) => {
          const familiar = familiarsById.get(fid);
          return familiar ? (
            <FamiliarAvatar key={fid} familiar={familiar} size="md" title={familiar.display_name} />
          ) : null;
        })}
      </span>

      <span
        className="rituals-cron-row__last"
        // The tint is per-run state, so it cannot live in a class: a healthy
        // row stays muted while failed/running/queued earn their status hue.
        style={lastRun ? { color: runStatusColor(lastRun.status, { quietSuccess: true }) } : undefined}
        title={lastRun?.startedAt ? formatTimestamp(lastRun.startedAt, readDateTimePrefs()) : undefined}
      >
        {lastRun ? `${cronRunVerb(health)} ${relTime(lastRun.startedAt)}` : "—"}
      </span>

      <span className="rituals-cron-row__sched">
        <span className="rituals-cron-row__sched-chip" title={`Runs ${auto.scheduleHuman}`}>
          <Icon name="ph:clock" width={11} aria-hidden />
          <span className="tabular-nums">{auto.scheduleHuman}</span>
        </span>
      </span>

      {/* The row itself selects on click; the action cluster must not also do
          that, or "Pause" would pause AND open the detail rail. */}
      <span className="rituals-cron-row__actions" onClick={(event) => event.stopPropagation()}>
        {actions && (
          <span className="rituals-cron-row__hover-actions">
            {isActive ? (
              <RowActionButton icon="ph:play" label={`Run ${auto.name} now`} text="Run" disabled={busy} onClick={() => actions.runAutomation(auto)} />
            ) : null}
            <RowActionButton
              icon={isActive ? "ph:pause" : "ph:play"}
              label={toggleLabel}
              text={isActive ? "Pause" : "Resume"}
              disabled={toggleDisabled}
              onClick={() => actions.togglePauseAutomation(auto)}
            />
            <RowActionButton
              icon="ph:info"
              label={`Open ${auto.name} details`}
              text="Details"
              onClick={() => onSelect(auto)}
            />
          </span>
        )}
        <OverflowMenu ariaLabel={`More actions for ${auto.name}`} size="xs" minWidth={200}>
          <PopoverItem icon="ph:info" onSelect={() => onSelect(auto)}>
            Open details
          </PopoverItem>
          {actions ? (
            <>
              {isActive ? (
                <PopoverItem icon="ph:play" disabled={busy} onSelect={() => actions.runAutomation(auto)}>
                  Run now
                </PopoverItem>
              ) : null}
              <PopoverSeparator />
              <PopoverItem
                icon={isActive ? "ph:pause" : "ph:play"}
                disabled={toggleDisabled}
                onSelect={() => actions.togglePauseAutomation(auto)}
              >
                {isActive ? "Pause" : "Resume"}
              </PopoverItem>
            </>
          ) : null}
        </OverflowMenu>
      </span>
    </li>
  );
}

function AutomationScheduleSection({
  title,
  items,
  failingCount,
  selectedId,
  familiarsById,
  lastRunById,
  onSelect,
}: {
  title: string;
  items: CodexAutomation[];
  /** Only the Active group carries one — a paused cron is off, not failing. */
  failingCount?: number;
  selectedId: string | null;
  familiarsById: Map<string, ResolvedFamiliar>;
  lastRunById: Map<string, AutomationRunRecord>;
  onSelect: (auto: CodexAutomation) => void;
}) {
  if (items.length === 0) return null;
  const headingId = `cron-section-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <section aria-labelledby={headingId}>
      <div className="rituals-crons-group">
        <h3 id={headingId} className="rituals-crons-group__title">
          {title} · {items.length}
        </h3>
        {failingCount ? (
          <span className="rituals-crons-group__failing">{failingCount} failing</span>
        ) : null}
        <span aria-hidden className="rituals-crons-group__rule" />
      </div>
      <ul className="rituals-crons-list">
        {items.map((auto) => (
          <AutomationScheduleRow
            key={auto.id}
            auto={auto}
            selected={selectedId === auto.id}
            familiarsById={familiarsById}
            lastRun={lastRunById.get(auto.id)}
            onSelect={onSelect}
          />
        ))}
      </ul>
    </section>
  );
}

export function AutomationsPanel({
  active,
  paused,
  unverified,
  inFlightNote = null,
  failingCount,
  selectedId,
  familiarsById,
  lastRunById,
  onSelect,
}: {
  active: CodexAutomation[];
  paused: CodexAutomation[];
  /** Automations whose lifecycle Coven has not confirmed: still checking, unreachable, or unreadable. */
  unverified: CodexAutomation[];
  /** Why rows cannot be trusted to show what is running (stale, failed or truncated read); null when they can. */
  inFlightNote?: string | null;
  failingCount: number;
  selectedId: string | null;
  familiarsById: Map<string, ResolvedFamiliar>;
  lastRunById: Map<string, AutomationRunRecord>;
  onSelect: (auto: CodexAutomation) => void;
}) {
  return (
    <>
      {inFlightNote ? (
        <p className="px-1 pb-2 text-[length:var(--text-xs)] [color:var(--text-muted)]!" role="note">{inFlightNote}</p>
      ) : null}
      <AutomationScheduleSection title="Active" items={active}
        failingCount={failingCount}
        selectedId={selectedId}
        familiarsById={familiarsById}
        lastRunById={lastRunById}
        onSelect={onSelect} />
      <AutomationScheduleSection title="Paused" items={paused}
        selectedId={selectedId}
        familiarsById={familiarsById}
        lastRunById={lastRunById}
        onSelect={onSelect} />
      <AutomationScheduleSection title="Not verified" items={unverified}
        selectedId={selectedId}
        familiarsById={familiarsById}
        lastRunById={lastRunById}
        onSelect={onSelect} />
    </>
  );
}
