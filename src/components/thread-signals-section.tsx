"use client";

import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/lib/icon";
import {
  aggregateThreadSignals,
  buildThreadSignalReviewQueue,
  buildThreadSignalDiscussionPrompt,
  THREAD_SIGNALS_EMPTY_STATE,
  type ThreadSignalsAggregate,
  type ThreadSignalReviewItem,
  type ThreadSelfReport,
} from "@/lib/thread-self-report";

const CONTEXTS = ["adequate", "tight", "excess", "critical"] as const;


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

function latestReportDate(reports: ThreadSelfReport[]): string {
  const latest = [...reports].sort((a, b) => new Date(b.reportedAt).getTime() - new Date(a.reportedAt).getTime())[0];
  return latest ? new Date(latest.reportedAt).toLocaleString() : "Unknown";
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

/** Open a new chat with this familiar, primed to discuss the selected topic. */
function discussReviewItem(familiarId: string, item: ThreadSignalReviewItem) {
  window.dispatchEvent(
    new CustomEvent("cave:agents-new-chat", {
      // origin "eval" routes this thread to the Evals page and hides it from the chat list.
      detail: { familiarId, initialPrompt: buildThreadSignalDiscussionPrompt(item), origin: "eval" as const },
    }),
  );
}

export function ThreadSignalsSection({ familiarId, reports }: { familiarId: string; reports: ThreadSelfReport[] }) {
  if (reports.length === 0) {
    return (
      <div className="fa-thread-empty">
        <EmptyState compact icon="ph:brain-bold" headline={THREAD_SIGNALS_EMPTY_STATE} />
        <span className="sr-only">{THREAD_SIGNALS_EMPTY_STATE}</span>
      </div>
    );
  }

  const aggregate = aggregateThreadSignals(reports);
  const reviewQueue = buildThreadSignalReviewQueue(aggregate);

  return (
    <div className="fa-thread-signals" data-familiar-id={familiarId}>
      <div className="fa-thread-review">
        <div className="fa-thread-review-head">
          <div>
            <h3>Review queue</h3>
            <p>{reports.length} reports · Latest report {latestReportDate(reports)}</p>
          </div>
          <span>{reviewQueue.length} items</span>
        </div>
        {reviewQueue.length === 0 ? (
          <p className="fa-thread-review-empty">No urgent review items in the current summary.</p>
        ) : (
          <ul className="fa-thread-review-list">
            {reviewQueue.map((item, index) => (
              <li key={`${item.kind}-${item.title}-${index}`} className={`is-${item.severity}`}>
                <button
                  type="button"
                  className="fa-thread-review-item"
                  onClick={() => discussReviewItem(familiarId, item)}
                  title={`Discuss "${item.title}" with this familiar`}
                  aria-label={`Discuss ${item.title}`}
                >
                  <Icon name={item.severity === "critical" ? "ph:warning-circle" : "ph:info"} aria-hidden />
                  <span>
                    <b>{item.title}</b>
                    {item.detail}
                  </span>
                  <Icon name="ph:chat-circle-dots" className="fa-thread-review-discuss" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
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
