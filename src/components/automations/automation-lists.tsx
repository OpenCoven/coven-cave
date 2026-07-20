import { Icon } from "@/lib/icon";
import type { IconName } from "@/lib/icon";
import type { FlowDoc } from "@/lib/flows";
import { flowTrigger, AUTOMATION_TYPE_META, type AutomationEntry, type AutomationType } from "@/lib/automations/automation-entry";
import { relativeTimeSigned } from "@/lib/relative-time";
import { RowActionButton } from "@/components/automations/schedule-list";

function relTime(iso: string | undefined | null): string {
  return iso ? relativeTimeSigned(iso) : "—";
}

function AutomationTypeChip({ type }: { type: AutomationType }) {
  const meta = AUTOMATION_TYPE_META[type];
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[length:var(--text-2xs)] font-medium"
      style={{ background: `color-mix(in oklch, ${meta.accent} 16%, transparent)`, color: meta.accent }}
    >
      <Icon name={meta.icon as IconName} width={10} aria-hidden />
      {meta.label}
    </span>
  );
}

function StateDot({ state }: { state: AutomationEntry["state"] }) {
  const color =
    state === "active" ? "var(--color-success)" : state === "draft" ? "var(--color-warning)" : "var(--text-muted)";
  const label = state === "active" ? "Active" : state === "draft" ? "Draft" : "Paused";
  return (
    <span className="inline-flex items-center gap-1 text-[length:var(--text-xs)] [color:var(--text-muted)]!">
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} aria-hidden />
      {label}
    </span>
  );
}

// A single unified row in the "All" list — type chip + name + trigger + state.
/** busyId encoding differs per native store: flows are `flow:<id>`, the rest use
 *  the bare native id. Mirror that here so the All row's Run button shows the
 *  spinner for the right entry. */
function entryBusyKey(entry: AutomationEntry): string {
  return entry.type === "flow" ? `flow:${entry.nativeId}` : entry.nativeId;
}

function AutomationEntryRow({
  entry,
  familiarLabel,
  busy,
  onRun,
  onOpen,
  onTogglePause,
}: {
  entry: AutomationEntry;
  familiarLabel: (id?: string | null) => string | null;
  busy: boolean;
  onRun: (entry: AutomationEntry) => void;
  onOpen: (entry: AutomationEntry) => void;
  onTogglePause?: (entry: AutomationEntry) => void;
}) {
  const fam = familiarLabel(entry.familiarId);
  const entryPaused = entry.state === "paused";
  // Next fire (reminders only, for now) as a friendly relative time alongside the
  // schedule string — so the unified list answers "when next?" at a glance.
  const nextFire = entry.state === "active" && entry.nextFireAt ? relTime(entry.nextFireAt) : null;
  return (
    <div
      className="automation-list-row flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-[color-mix(in_oklch,var(--foreground)_6%,transparent)] [border:1px_solid_var(--border-hairline)]!"
    >
      <AutomationTypeChip type={entry.type} />
      <span className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => onOpen(entry)}
          className="focus-ring-inset block w-full rounded-md text-left"
        >
          <span className="block truncate text-[length:var(--text-base)] font-medium [color:var(--text-primary)]!">
            {entry.name}
          </span>
          <span className="mt-0.5 flex items-center gap-2 text-[length:var(--text-xs)] [color:var(--text-muted)]!">
            <span className="inline-flex shrink-0 items-center gap-1">
              <Icon name={entry.scheduled ? "ph:clock" : "ph:play"} width={11} aria-hidden />
              {entry.trigger}
            </span>
            {nextFire && (
              <span className="shrink-0 whitespace-nowrap [color:var(--text-secondary)]!" title={`Next fire: ${entry.nextFireAt}`}>
                · {nextFire}
              </span>
            )}
            {fam && <span className="truncate">· {fam}</span>}
          </span>
        </button>
        <span className="mt-1.5 flex items-center gap-1">
          <RowActionButton
            icon="ph:play"
            label={`Run ${entry.name} now`}
            text={busy ? "…" : "Run"}
            onClick={() => onRun(entry)}
            disabled={busy}
          />
          {onTogglePause && (
            <RowActionButton
              icon={entryPaused ? "ph:play" : "ph:pause"}
              label={`${entryPaused ? "Resume" : "Pause"} ${entry.name}`}
              text={entryPaused ? "Resume" : "Pause"}
              onClick={() => onTogglePause(entry)}
              disabled={busy}
            />
          )}
        </span>
      </span>
      <StateDot state={entry.state} />
    </div>
  );
}

export function AutomationAllList({
  entries,
  busyId,
  familiarLabel,
  onRun,
  onOpen,
  onTogglePause,
  pausable,
}: {
  entries: AutomationEntry[];
  busyId: string | null;
  familiarLabel: (id?: string | null) => string | null;
  onRun: (entry: AutomationEntry) => void;
  onOpen: (entry: AutomationEntry) => void;
  onTogglePause: (entry: AutomationEntry) => void;
  pausable: (entry: AutomationEntry) => boolean;
}) {
  return (
    <div className="space-y-1.5 pt-1">
      {entries.map((entry) => (
        <AutomationEntryRow
          key={entry.key}
          entry={entry}
          familiarLabel={familiarLabel}
          busy={busyId === entryBusyKey(entry)}
          onRun={onRun}
          onOpen={onOpen}
          onTogglePause={pausable(entry) ? onTogglePause : undefined}
        />
      ))}
    </div>
  );
}

// Shared row shell for managed automation tabs: name, meta, Run + Open actions.
function ManagedAutomationRow({
  type,
  name,
  meta,
  busy,
  paused,
  onRun,
  onOpen,
  onTogglePause,
}: {
  type: AutomationType;
  name: string;
  meta: string;
  busy: boolean;
  paused?: boolean;
  onRun: () => void;
  onOpen: () => void;
  onTogglePause?: () => void;
}) {
  return (
    <div
      className="automation-list-row flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-[color-mix(in_oklch,var(--foreground)_6%,transparent)] [border:1px_solid_var(--border-hairline)]!"
    >
      <AutomationTypeChip type={type} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[length:var(--text-base)] font-medium [color:var(--text-primary)]!">{name}</span>
        <span className="mt-0.5 block truncate text-[length:var(--text-xs)] [color:var(--text-muted)]!">{meta}</span>
        <span className="mt-1.5 flex items-center gap-1">
          <RowActionButton
            icon="ph:play"
            label={`Run ${name} now`}
            text={busy ? "…" : "Run"}
            onClick={onRun}
            disabled={busy}
          />
          {onTogglePause && (
            <RowActionButton
              icon={paused ? "ph:play" : "ph:pause"}
              label={`${paused ? "Resume" : "Pause"} ${name}`}
              text={paused ? "Resume" : "Pause"}
              onClick={onTogglePause}
              disabled={busy}
            />
          )}
          <RowActionButton
            icon="ph:arrow-square-out"
            label={`Open ${name}`}
            text="Open"
            onClick={onOpen}
          />
        </span>
      </span>
    </div>
  );
}

export function FlowList({
  flows,
  query,
  busyId,
  onRun,
  onOpen,
  onTogglePause,
}: {
  flows: FlowDoc[];
  query: string;
  busyId: string | null;
  onRun: (flow: FlowDoc) => void;
  onOpen: (flow: FlowDoc) => void;
  onTogglePause: (flow: FlowDoc) => void;
}) {
  const visible = flows.filter((f) => !query || (f.name || "").toLowerCase().includes(query));
  return (
    <div className="space-y-1.5 pt-1">
      {visible.map((flow) => {
        const { trigger } = flowTrigger(flow);
        const nodeCount = flow.nodes.filter((n) => n.type !== "sticky").length;
        return (
          <ManagedAutomationRow
            key={flow.id}
            type="flow"
            name={flow.name || "Untitled flow"}
            meta={`${trigger} · ${nodeCount} node${nodeCount === 1 ? "" : "s"}${flow.active ? "" : " · paused"}`}
            busy={busyId === `flow:${flow.id}`}
            paused={!flow.active}
            onRun={() => onRun(flow)}
            onOpen={() => onOpen(flow)}
            onTogglePause={() => onTogglePause(flow)}
          />
        );
      })}
    </div>
  );
}
