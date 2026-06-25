"use client";

import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/lib/icon";
import type {
  BlockerImpact,
  CapabilityImportance,
  CapabilityState,
  ContextPressure,
  ThreadSelfReport,
} from "@/lib/thread-self-report";

type RankedBlocker = ThreadSelfReport["persistentBlockers"][number] & {
  frequency: number;
  rankScore: number;
  crit: boolean;
};

type ThreadSignalsAggregate = {
  averageConfidence: number;
  averageToolReliability: number;
  averageMemoryRecall: number;
  averageFileLocatability: number;
  contextCounts: Record<ContextPressure, number>;
  skillsUsedMost: { skillId: string; count: number }[];
  skillsNeedingClarity: ThreadSelfReport["skillsNeedingClarity"];
  skillsNeedingAccess: ThreadSelfReport["skillsNeedingAccess"];
  capabilitiesVital: ThreadSelfReport["capabilitiesVital"];
  capabilitiesLacking: ThreadSelfReport["capabilitiesLacking"];
  persistentBlockers: RankedBlocker[];
};

const IMPACT_WEIGHT: Record<BlockerImpact, number> = { low: 1, medium: 2, high: 3, blocking: 4 };
const IMPORTANCE_WEIGHT: Record<CapabilityImportance, number> = { "nice-to-have": 1, important: 2, blocking: 3 };
const STATE_WEIGHT: Record<CapabilityState, number> = { available: 1, degraded: 2, missing: 3 };
const CONTEXTS: ContextPressure[] = ["adequate", "tight", "excess", "critical"];

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function increment(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function newestReports(reports: ThreadSelfReport[]): ThreadSelfReport[] {
  return [...reports].sort((a, b) => new Date(b.reportedAt).getTime() - new Date(a.reportedAt).getTime());
}

export function aggregateThreadSignals(reports: ThreadSelfReport[]): ThreadSignalsAggregate {
  const contextCounts: Record<ContextPressure, number> = { adequate: 0, tight: 0, excess: 0, critical: 0 };
  const skillsUsed = new Map<string, number>();
  const clarity = new Map<string, { skillId: string; reason: string }>();
  const access = new Map<string, { skillId: string; reason: string }>();
  const vital = new Map<string, ThreadSelfReport["capabilitiesVital"][number]>();
  const lacking = new Map<string, ThreadSelfReport["capabilitiesLacking"][number]>();
  const blockers = new Map<string, RankedBlocker>();

  for (const report of reports) {
    contextCounts[report.contextPressure] += 1;
    for (const skill of report.skillsUsed) increment(skillsUsed, skill);
  }

  for (const report of newestReports(reports)) {
    for (const item of report.skillsNeedingClarity) if (!clarity.has(item.skillId)) clarity.set(item.skillId, item);
    for (const item of report.skillsNeedingAccess) if (!access.has(item.skillId)) access.set(item.skillId, item);
    for (const item of report.capabilitiesVital) {
      const previous = vital.get(item.name);
      if (!previous || STATE_WEIGHT[item.currentState] > STATE_WEIGHT[previous.currentState]) vital.set(item.name, item);
    }
    for (const item of report.capabilitiesLacking) {
      const previous = lacking.get(item.name);
      if (!previous || IMPORTANCE_WEIGHT[item.importance] > IMPORTANCE_WEIGHT[previous.importance]) lacking.set(item.name, item);
    }
    for (const blocker of report.persistentBlockers) {
      const previous = blockers.get(blocker.id);
      const impact = previous && IMPACT_WEIGHT[previous.impact] > IMPACT_WEIGHT[blocker.impact]
        ? previous.impact
        : blocker.impact;
      const frequency = (previous?.frequency ?? 0) + 1;
      blockers.set(blocker.id, {
        ...blocker,
        impact,
        frequency,
        rankScore: frequency * IMPACT_WEIGHT[impact],
        crit: frequency / reports.length > 0.5,
      });
    }
  }

  return {
    averageConfidence: avg(reports.map((report) => report.overallConfidence)),
    averageToolReliability: avg(reports.map((report) => report.toolReliability.score)),
    averageMemoryRecall: avg(reports.map((report) => report.memoryRecallScore)),
    averageFileLocatability: avg(reports.map((report) => report.fileLocatabilityScore)),
    contextCounts,
    skillsUsedMost: Array.from(skillsUsed, ([skillId, count]) => ({ skillId, count }))
      .sort((a, b) => b.count - a.count || a.skillId.localeCompare(b.skillId))
      .slice(0, 5),
    skillsNeedingClarity: Array.from(clarity.values()),
    skillsNeedingAccess: Array.from(access.values()),
    capabilitiesVital: Array.from(vital.values()),
    capabilitiesLacking: Array.from(lacking.values()),
    persistentBlockers: Array.from(blockers.values()).sort((a, b) => b.rankScore - a.rankScore || a.title.localeCompare(b.title)),
  };
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="fa-thread-score">
      <div>
        <span>{label}</span>
        <b>{value}</b>
      </div>
      <div className="fa-factor-bar" aria-label={`${label} ${value}`}>
        <span className="fa-factor-segment" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
    </div>
  );
}

function ListBlock<T>({
  title,
  items,
  empty,
  render,
}: {
  title: string;
  items: T[];
  empty: string;
  render: (item: T) => string;
}) {
  return (
    <div className="fa-thread-panel">
      <h3>{title}</h3>
      {items.length === 0 ? <p>{empty}</p> : (
        <ul>
          {items.map((item, index) => <li key={`${title}-${index}`}>{render(item)}</li>)}
        </ul>
      )}
    </div>
  );
}

export function ThreadSignalsSection({ familiarId, reports }: { familiarId: string; reports: ThreadSelfReport[] }) {
  if (reports.length === 0) {
    return (
      <div className="fa-thread-empty">
        <EmptyState compact icon="ph:brain-bold" headline="No thread reports yet. Use 'Reflect on this thread' to generate the first one." />
        <span className="sr-only">No thread reports yet. Use 'Reflect on this thread' to generate the first one.</span>
      </div>
    );
  }

  const aggregate = aggregateThreadSignals(reports);

  return (
    <div className="fa-thread-signals" data-familiar-id={familiarId}>
      <div className="fa-thread-score-grid">
        <ScoreBar label="Avg confidence" value={aggregate.averageConfidence} />
        <ScoreBar label="Avg tool reliability" value={aggregate.averageToolReliability} />
        <ScoreBar label="Avg memory recall" value={aggregate.averageMemoryRecall} />
        <ScoreBar label="Avg file locatability" value={aggregate.averageFileLocatability} />
      </div>
      <div className="fa-thread-contexts" aria-label="Context pressure distribution">
        {CONTEXTS.map((pressure) => (
          <span key={pressure} className={`fa-thread-pill fa-thread-pill--${pressure}`}>
            {pressure} <b>{aggregate.contextCounts[pressure]}</b>
          </span>
        ))}
      </div>
      <div className="fa-thread-grid">
        <ListBlock title="Skills used most" items={aggregate.skillsUsedMost} empty="No skills reported." render={(item) => `${item.skillId} (${item.count})`} />
        <ListBlock title="Skills needing clarity" items={aggregate.skillsNeedingClarity} empty="No clarity gaps." render={(item) => `${item.skillId}: ${item.reason}`} />
        <ListBlock title="Skills needing access" items={aggregate.skillsNeedingAccess} empty="No access gaps." render={(item) => `${item.skillId}: ${item.reason}`} />
        <ListBlock title="Capabilities vital" items={aggregate.capabilitiesVital} empty="No vital capabilities reported." render={(item) => `${item.name}: ${item.currentState}${item.notes ? ` - ${item.notes}` : ""}`} />
        <ListBlock title="Capabilities lacking" items={aggregate.capabilitiesLacking} empty="No lacking capabilities reported." render={(item) => `${item.name}: ${item.importance} - ${item.detail}`} />
        <div className="fa-thread-panel">
          <h3>Persistent blockers</h3>
          {aggregate.persistentBlockers.length === 0 ? <p>No persistent blockers.</p> : (
            <ul>
              {aggregate.persistentBlockers.map((blocker) => (
                <li key={blocker.id}>
                  <span>{blocker.title}: {blocker.frequency}x - {blocker.impact}</span>
                  {blocker.crit ? <b className="fa-thread-badge"><Icon name="ph:warning-circle" aria-hidden />crit</b> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
