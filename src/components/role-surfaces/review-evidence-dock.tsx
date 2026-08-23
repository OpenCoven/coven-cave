"use client";

import type { RefObject } from "react";
import { Icon } from "@/lib/icon";
import type {
  Blocker,
  ChecksMeta,
  PrFacts,
  ReadinessBanner,
} from "./review-readiness";

export type ReviewEvidenceTab =
  | "overview"
  | "comments"
  | "merge"
  | "session";

const TABS: readonly {
  id: ReviewEvidenceTab;
  label: string;
}[] = [
  { id: "overview", label: "Overview" },
  { id: "comments", label: "Comments" },
  { id: "merge", label: "Merge status" },
  { id: "session", label: "Session" },
];

export function ReviewEvidenceDock({
  open,
  tab,
  selected,
  isPr,
  readinessPhase,
  readinessError,
  refreshing,
  checkedLabel,
  facts,
  blockers,
  banner,
  checks,
  sourceLabel,
  sourceExplain,
  branch,
  pullRequestLabel,
  updatedLabel,
  focusRef,
  onTab,
  onClose,
  onRefresh,
  onOpenSession,
  onOpenPullRequest,
}: {
  open: boolean;
  tab: ReviewEvidenceTab;
  selected: boolean;
  isPr: boolean;
  readinessPhase: "idle" | "loading" | "ready" | "error";
  readinessError: string | null;
  refreshing: boolean;
  checkedLabel: string;
  facts: PrFacts | null;
  blockers: readonly Blocker[];
  banner: ReadinessBanner;
  checks: ChecksMeta;
  sourceLabel: string;
  sourceExplain: string;
  branch: string | null;
  pullRequestLabel: string | null;
  updatedLabel: string | null;
  focusRef: RefObject<HTMLElement | null>;
  onTab: (tab: ReviewEvidenceTab) => void;
  onClose: () => void;
  onRefresh: () => void;
  onOpenSession: () => void;
  onOpenPullRequest: () => void;
}) {
  if (!open) return null;

  return (
    <aside className="rd-panel rd-evidence" aria-label="Review evidence" ref={focusRef} tabIndex={-1}>
      <header className="rd-evidence-head">
        <span>
          <span className="rd-eyebrow">Evidence dock</span>
          <strong>{TABS.find((candidate) => candidate.id === tab)?.label}</strong>
        </span>
        <span className="rd-spacer" />
        <button
          type="button"
          className="rd-icon-btn focus-ring"
          aria-label="Refresh GitHub state"
          title="Refresh GitHub state"
          disabled={!isPr || refreshing}
          onClick={onRefresh}
        >
          <Icon name="ph:arrows-clockwise" width={13} height={13} aria-hidden />
        </button>
        <button
          type="button"
          className="rd-icon-btn focus-ring"
          aria-label="Close evidence dock"
          title="Close evidence dock"
          onClick={onClose}
        >
          <Icon name="ph:x" width={12} height={12} aria-hidden />
        </button>
      </header>

      <div className="rd-evidence-tabs" role="tablist" aria-label="Evidence views">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            className="rd-evidence-tab focus-ring"
            aria-selected={tab === item.id}
            onClick={() => onTab(item.id)}
          >
            {item.label}
            {item.id === "comments" && facts?.threads.unresolved ? (
              <span>{facts.threads.unresolved}</span>
            ) : null}
          </button>
        ))}
      </div>

      <div className="rd-evidence-body rd-scroll">
        {tab === "overview" ? (
          <section className="rd-evidence-section" aria-label="Review overview">
            {!selected ? (
              <div className="rd-readiness-none" role="status">
                <strong>Nothing selected</strong>
                <span>Pick a session to read its source and landing state.</span>
              </div>
            ) : !isPr || readinessPhase !== "ready" || !facts ? (
              <div className="rd-readiness-none" role="status">
                <strong>
                  {!isPr
                    ? "No pull request to check"
                    : readinessPhase === "loading"
                      ? "Reading GitHub…"
                      : "Readiness unavailable"}
                </strong>
                <span>
                  {!isPr
                    ? "This is a local working tree. GitHub review and merge evidence stays unavailable until a pull request is linked."
                    : readinessPhase === "loading"
                      ? "State, mergeability, reviews, checks, and threads arrive together."
                      : readinessError ?? "GitHub state could not be read. Nothing is inferred."}
                </span>
              </div>
            ) : (
              <>
                <div className="rd-tint" data-tone={banner.tone} role="status">
                  <Icon name={banner.icon} width={15} height={15} aria-hidden />
                  <span className="rd-tint-body">
                    <strong>{banner.headline}</strong>
                    <span>{banner.sub}</span>
                  </span>
                </div>
                {blockers.length > 0 ? (
                  <div className="rd-blockers">
                    {blockers.map((blocker) => (
                      <button
                        key={blocker.id}
                        type="button"
                        className="rd-blocker focus-ring-inset"
                        data-tone={blocker.tone}
                        onClick={() => {
                          if (blocker.reveal === "threads") onTab("comments");
                          else if (blocker.reveal === "checks") onTab("merge");
                        }}
                      >
                        <Icon name={blocker.icon} width={13} height={13} aria-hidden />
                        <span>
                          <strong>{blocker.title}</strong>
                          <small>{blocker.fix}</small>
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}
                <p className="rd-evidence-stamp">{checkedLabel}</p>
              </>
            )}
          </section>
        ) : null}

        {tab === "comments" ? (
          <section className="rd-evidence-section" aria-label="Review comments">
            {!facts ? (
              <div className="rd-readiness-none" role="status">
                <strong>No comments to show</strong>
                <span>Comments arrive with a linked pull request after GitHub state loads.</span>
              </div>
            ) : facts.threads.items.length === 0 ? (
              <div className="rd-readiness-none" role="status">
                <strong>No unresolved review threads</strong>
                <span>{facts.threads.total === 0 ? "Nobody has left a line comment." : "Every fetched thread is resolved or outdated."}</span>
              </div>
            ) : (
              <>
                <p className="rd-evidence-intro">
                  {facts.threads.unresolved} unresolved of {facts.threads.total}. The dock quotes the bounded thread evidence returned by GitHub.
                </p>
                <div className="rd-threads">
                  {facts.threads.items.map((thread) => (
                    <article key={thread.id} className="rd-thread">
                      <span className="rd-thread-where">{thread.where}</span>
                      <strong>@{thread.author}</strong>
                      <p>{thread.excerpt}</p>
                    </article>
                  ))}
                </div>
                <p className="rd-evidence-stamp">
                  {facts.threads.canResolve ? "Resolve on GitHub." : "Resolving threads needs a GitHub token; this dock is read-only."}
                </p>
              </>
            )}
          </section>
        ) : null}

        {tab === "merge" ? (
          <section className="rd-evidence-section" aria-label="Merge status">
            {!facts ? (
              <div className="rd-readiness-none" role="status">
                <strong>Merge status unavailable</strong>
                <span>GitHub landing evidence appears only for a linked pull request.</span>
              </div>
            ) : (
              <>
                <dl className="rd-landing-facts">
                  <div>
                    <dt>State</dt>
                    <dd>{facts.draft ? "draft" : facts.state}</dd>
                  </div>
                  <div>
                    <dt>Mergeability</dt>
                    <dd>{facts.mergeable == null ? "computing" : facts.mergeableState}</dd>
                  </div>
                  <div>
                    <dt>Reviews</dt>
                    <dd>{facts.reviews.approved} approving · {facts.reviews.changesRequested} requesting changes</dd>
                  </div>
                  <div>
                    <dt>Threads</dt>
                    <dd>{facts.threads.unresolved} unresolved</dd>
                  </div>
                  <div>
                    <dt>Checks</dt>
                    <dd>{checks.label}</dd>
                  </div>
                </dl>
                <div className="rd-check-runs">
                  {facts.checks.runs.length === 0 ? (
                    <p className="rd-evidence-intro">No checks have reported on this head.</p>
                  ) : (
                    facts.checks.runs.map((run) => (
                      <span key={`${run.name}-${run.detailsUrl ?? ""}`} className="rd-check-run">
                        <Icon
                          name={
                            run.status !== "completed"
                              ? "ph:hourglass"
                              : run.conclusion === "success"
                                ? "ph:check-circle-fill"
                                : "ph:x-circle-fill"
                          }
                          width={12}
                          height={12}
                          aria-hidden
                        />
                        <span>{run.name}</span>
                        <small>{run.conclusion ?? run.status}</small>
                      </span>
                    ))
                  )}
                </div>
              </>
            )}
          </section>
        ) : null}

        {tab === "session" ? (
          <section className="rd-evidence-section" aria-label="Session context">
            <dl className="rd-session-facts">
              <div>
                <dt>Review source</dt>
                <dd title={sourceExplain}>{sourceLabel}</dd>
              </div>
              <div>
                <dt>Branch</dt>
                <dd>{branch ?? "—"}</dd>
              </div>
              <div>
                <dt>Pull request</dt>
                <dd>{pullRequestLabel ?? "None"}</dd>
              </div>
              <div>
                <dt>Updated</dt>
                <dd>{updatedLabel ?? "—"}</dd>
              </div>
            </dl>
            <div className="rd-session-actions">
              <button type="button" className="rd-btn focus-ring" disabled={!selected} onClick={onOpenSession}>
                <Icon name="ph:play-fill" width={12} height={12} aria-hidden />
                Open session
              </button>
              <button type="button" className="rd-btn focus-ring" disabled={!pullRequestLabel} onClick={onOpenPullRequest}>
                <Icon name="ph:github-logo" width={13} height={13} aria-hidden />
                Pull request
              </button>
            </div>
          </section>
        ) : null}
      </div>
    </aside>
  );
}
