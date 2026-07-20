"use client";

import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import { FamiliarAvatar } from "@/components/familiar-avatar";
import { Button } from "@/components/ui/button";
import type { AutomationRunRecord } from "@/lib/automation-runs";
import type { CodexAutomation } from "@/lib/codex-automations-types";
import { formatTimestamp, readDateTimePrefs } from "@/lib/datetime-format";
import { Icon } from "@/lib/icon";
import type { IconName } from "@/lib/icon";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";
import { relativeTimeSigned } from "@/lib/relative-time";
import { runStatusColor } from "@/lib/automations/run-status";

function relTime(iso: string | undefined | null): string {
  return iso ? relativeTimeSigned(iso) : "—";
}

export type ScheduleActions = {
  runAutomation: (auto: CodexAutomation) => void;
  togglePauseAutomation: (auto: CodexAutomation) => void;
};
export const ScheduleActionsContext = createContext<ScheduleActions | null>(null);

// Always-visible labeled row action — the same affordance the All/Flows rows
// use, so every tab exposes identical controls. Rendered as a sibling of the
// row's own button (never nested), so a click can't also open the detail panel.
export function RowActionButton({ icon, label, text, onClick, disabled }: { icon: IconName; label: string; text: string; onClick: () => void; disabled?: boolean }) {
  return (
    <Button
      variant="ghost"
      size="xs"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="shrink-0 rounded-[var(--radius-control)] px-2 py-1 text-[length:var(--text-xs)] font-medium transition-colors hover:bg-[color-mix(in_oklch,var(--foreground)_10%,transparent)] [color:var(--text-secondary)]!"
      leadingIcon={icon}
    >
      {/* Icon-only when the hosting pane runs narrow (e.g. the md split while a
          detail rail is open) — the aria-label keeps the full action name. */}
      <span className="@max-[520px]:hidden">{text}</span>
    </Button>
  );
}

function RowActions({ children }: { children: ReactNode }) {
  return <span className="flex shrink-0 items-center gap-0.5 pl-1">{children}</span>;
}

// ── Codex automation detail panel ────────────────────────────────────────────

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
  const isActive = auto.status === "ACTIVE";
  const actions = useContext(ScheduleActionsContext);
  return (
    <li className="flex items-center">
      <button
        type="button"
        onClick={() => onSelect(auto)}
        aria-current={selected ? "true" : undefined}
        className={`focus-ring-inset automation-list-row group flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors ${selected ? "bg-[color-mix(in_oklch,var(--foreground)_6%,transparent)]" : "hover:bg-[color-mix(in_oklch,var(--foreground)_6%,transparent)]"}`}
      >
        {/* Status dot */}
        {isActive ? (
          <span role="img" aria-label="Active" className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full [background:var(--accent-presence)]!" />
        ) : (
          <span role="img" aria-label="Paused" className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border [border-color:rgba(255,255,255,0.18)]! [color:rgba(255,255,255,0.35)]!">
            <Icon name="ph:minus" width={8} />
          </span>
        )}
        <span className="flex-1 min-w-0 flex items-baseline gap-2">
          <span className="text-[length:var(--text-base)] truncate [color:var(--text-primary)]!">
            {auto.name}
          </span>
          {auto.tags.includes("coven") && (
            <span className="shrink-0 text-[length:var(--text-xs)] [color:var(--text-muted)]!">coven</span>
          )}
        </span>
        {auto.familiars.length > 0 && (
          <span className="flex shrink-0 -space-x-1.5">
            {auto.familiars.slice(0, 3).map((fid) => {
              const f = familiarsById.get(fid);
              return f ? (
                <FamiliarAvatar key={fid} familiar={f} size="sm" title={f.display_name} className="rounded-full ring-1 ring-[var(--bg-base)]" />
              ) : null;
            })}
            {auto.familiars.length > 3 && (
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[var(--bg-raised)] text-[length:var(--text-2xs)] text-[var(--text-muted)] ring-1 ring-[var(--bg-base)]">
                +{auto.familiars.length - 3}
              </span>
            )}
          </span>
        )}
        {lastRun && (
          <span className="shrink-0 text-[length:var(--text-xs)] @max-[600px]:hidden" title={lastRun.startedAt ? formatTimestamp(lastRun.startedAt, readDateTimePrefs()) : undefined} style={{ color: runStatusColor(lastRun.status, { quietSuccess: true }) }}>
            Run {relTime(lastRun.startedAt)}
          </span>
        )}
        <span className="cron-schedule-chip shrink-0 @max-[440px]:hidden" title={`Runs ${auto.scheduleHuman}`}>
          <Icon name="ph:clock" width={11} aria-hidden className="cron-schedule-chip__icon" />
          <span className="tabular-nums">{auto.scheduleHuman}</span>
        </span>
      </button>
      {actions && (
        <RowActions>
          <RowActionButton icon="ph:play" label={`Run ${auto.name} now`} text="Run" onClick={() => actions.runAutomation(auto)} />
          <RowActionButton
            icon={isActive ? "ph:pause" : "ph:play"}
            label={`${isActive ? "Pause" : "Resume"} ${auto.name}`}
            text={isActive ? "Pause" : "Resume"}
            onClick={() => actions.togglePauseAutomation(auto)}
          />
        </RowActions>
      )}
    </li>
  );
}

function AutomationScheduleSection({
  title,
  items,
  selectedId,
  familiarsById,
  lastRunById,
  onSelect,
}: {
  title: string;
  items: CodexAutomation[];
  selectedId: string | null;
  familiarsById: Map<string, ResolvedFamiliar>;
  lastRunById: Map<string, AutomationRunRecord>;
  onSelect: (auto: CodexAutomation) => void;
}) {
  if (items.length === 0) return null;
  const headingId = `cron-section-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <section aria-labelledby={headingId} className="mb-6">
      <div className="flex items-center gap-3 mb-1 rounded-md px-3 py-1.5 [background:color-mix(in_oklch,_var(--bg-base)_86%,_var(--foreground)_14%)]! [border-bottom:1px_solid_var(--border-hairline)]!">
        <h3 id={headingId} className="text-[length:var(--text-sm)] font-bold [color:var(--text-primary)]!">
          {title}
        </h3>
        <span className="text-[length:var(--text-2xs)] px-1.5 py-0.5 rounded [background:var(--bg-raised)]! [color:var(--text-muted)]!">
          Codex
        </span>
      </div>
      <ul>
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
  selectedId,
  familiarsById,
  lastRunById,
  onSelect,
}: {
  active: CodexAutomation[];
  paused: CodexAutomation[];
  selectedId: string | null;
  familiarsById: Map<string, ResolvedFamiliar>;
  lastRunById: Map<string, AutomationRunRecord>;
  onSelect: (auto: CodexAutomation) => void;
}) {
  return (
    <>
      <AutomationScheduleSection title="Active" items={active}
        selectedId={selectedId}
        familiarsById={familiarsById}
        lastRunById={lastRunById}
        onSelect={onSelect} />
      <AutomationScheduleSection title="Paused" items={paused}
        selectedId={selectedId}
        familiarsById={familiarsById}
        lastRunById={lastRunById}
        onSelect={onSelect} />
    </>
  );
}

// ── Typed "New" menu item ───────────────────────────────────────────────────
