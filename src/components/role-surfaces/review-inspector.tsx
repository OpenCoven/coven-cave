"use client";

/**
 * review-inspector — the cockpit's right pane: one decision, and its evidence.
 *
 * It replaces the tabbed evidence dock. Tabs made the reader choose a tab
 * before they could learn whether the item could land at all, and the answer
 * to that question is the whole reason the pane exists. So the pane now leads
 * with a single decision sentence and the blockers behind it, and demotes the
 * raw GitHub detail — checks, threads, session — to disclosures underneath.
 *
 * Nothing was deleted in the move: every fact the four tabs carried is still
 * reachable here, and a blocker's own reveal control opens the disclosure that
 * holds its evidence.
 */

import type { ReactNode, RefObject } from "react";
import { Icon } from "@/lib/icon";
import { GITHUB_REVIEW_BODY_MAX_LENGTH } from "@/lib/github-review";
import type { IconName } from "@/lib/icon";
import { COCKPIT_BUCKETS, type CockpitBucket, type ReviewDecision } from "./review-cockpit";
import type { TriagedBlocker } from "./review-cockpit";
import { mergeChecklistScore, type ChecksMeta, type MergeChecklistRow, type PrFacts } from "./review-readiness";

const STATE_ICON: Record<CockpitBucket, IconName> = {
  blocked: "ph:prohibit",
  changes: "ph:arrow-bend-up-left",
  awaiting: "ph:eye",
  ready: "ph:check-circle-fill",
  draft: "ph:pencil-simple",
};

export type InspectorDisclosure =
  | "local"
  | "checklist"
  | "checks"
  | "threads"
  | "session";

function Disclosure({
  id,
  icon,
  label,
  summary,
  summaryTone,
  open,
  onToggle,
  children,
}: {
  id: InspectorDisclosure;
  icon: IconName;
  label: string;
  summary: string;
  summaryTone?: "success" | "warning" | "danger" | "muted";
  open: boolean;
  onToggle: (id: InspectorDisclosure) => void;
  children: ReactNode;
}) {
  return (
    <section className="rd-disclosure">
      <button
        type="button"
        className="rd-disclosure-toggle focus-ring"
        aria-expanded={open}
        onClick={() => onToggle(id)}
      >
        <Icon
          name={open ? "ph:caret-down" : "ph:caret-right"}
          width={12}
          height={12}
          aria-hidden
        />
        <Icon name={icon} width={11} height={11} aria-hidden />
        <span className="rd-eyebrow">{label}</span>
        <span className="rd-spacer" />
        <span className="rd-disclosure-summary" data-rd-tone={summaryTone}>
          {summary}
        </span>
      </button>
      {open ? <div className="rd-disclosure-body">{children}</div> : null}
    </section>
  );
}

export function ReviewInspector({
  selected,
  isPr,
  bucket,
  decision,
  blockers,
  checklist,
  checks,
  facts,
  readinessPhase,
  readinessError,
  checkedLabel,
  branch,
  pullRequestLabel,
  updatedLabel,
  sourceLabel,
  sourceExplain,
  note,
  noteError,
  openDisclosures,
  focusRef,
  verdictDock,
  onToggleDisclosure,
  onRevealBlocker,
  onOpenBlockerUrl,
  onNote,
  onCollapse,
}: {
  selected: boolean;
  isPr: boolean;
  bucket: CockpitBucket | null;
  decision: ReviewDecision;
  blockers: readonly TriagedBlocker[];
  checklist: readonly MergeChecklistRow[];
  checks: ChecksMeta;
  facts: PrFacts | null;
  readinessPhase: "idle" | "loading" | "ready" | "error";
  readinessError: string | null;
  checkedLabel: string;
  branch: string | null;
  pullRequestLabel: string | null;
  updatedLabel: string | null;
  sourceLabel: string;
  sourceExplain: string;
  note: string;
  noteError: string | null;
  openDisclosures: ReadonlySet<InspectorDisclosure>;
  focusRef: RefObject<HTMLElement | null>;
  /** The sticky verdict footer; composed by the surface so mutations stay there. */
  verdictDock: ReactNode;
  onToggleDisclosure: (id: InspectorDisclosure) => void;
  onRevealBlocker: (reveal: "checks" | "threads") => void;
  onOpenBlockerUrl: (url: string) => void;
  onNote: (value: string) => void;
  onCollapse: () => void;
}) {
  const state = bucket ? COCKPIT_BUCKETS[bucket] : null;
  const score = mergeChecklistScore(checklist);
  const failingRunUrl =
    facts?.checks.runs.find(
      (run) => run.status === "completed" && run.conclusion !== "success" && run.detailsUrl,
    )?.detailsUrl ?? null;

  return (
    <aside className="rd-inspector" aria-label="Review inspector" ref={focusRef} tabIndex={-1}>
      <div className="rd-inspector-head">
        <button
          type="button"
          className="rd-pane-toggle focus-ring"
          title="Collapse inspector (e)"
          aria-label="Collapse the review inspector"
          onClick={onCollapse}
        >
          <Icon name="ph:sidebar-simple" width={14} height={14} aria-hidden />
        </button>
        <span className="rd-eyebrow">Inspector</span>
        <span className="rd-spacer" />
        {state && bucket ? (
          <span className="rd-inspector-state" data-rd-tone={state.tone}>
            <Icon name={STATE_ICON[bucket]} width={11} height={11} aria-hidden />
            {state.label}
          </span>
        ) : null}
      </div>

      <div className="rd-inspector-body rd-scroll">
        <section className="rd-decision" data-rd-tone={decision.tone} role="status">
          <div className="rd-decision-head">
            <i className="rd-decision-dot" data-rd-tone={decision.tone} aria-hidden />
            <strong>{decision.headline}</strong>
          </div>
          <p className="rd-decision-sub">{decision.sub}</p>
          <div className="rd-decision-next" data-rd-tone={decision.tone}>
            <Icon name="ph:caret-right" width={11} height={11} aria-hidden />
            <span className="rd-eyebrow">Next</span>
            <span>{decision.next}</span>
          </div>
        </section>

        {blockers.length > 0 ? (
          <section className="rd-blockers" aria-label="Blockers">
            <div className="rd-section-head">
              <Icon name="ph:warning" width={11} height={11} aria-hidden />
              <span className="rd-eyebrow">Blockers</span>
              <span className="rd-section-count">{blockers.length}</span>
            </div>
            {blockers.map((blocker) => {
              const url =
                blocker.id === "checks"
                  ? failingRunUrl
                  : blocker.id === "threads" && pullRequestLabel && facts
                    ? `https://github.com/${facts.repo}/pull/${facts.number}/files`
                    : facts
                      ? `https://github.com/${facts.repo}/pull/${facts.number}`
                      : null;
              return (
                <article key={blocker.id} className="rd-blocker" data-rd-tone={blocker.tone}>
                  <div className="rd-blocker-head">
                    <Icon name={blocker.icon} width={13} height={13} aria-hidden />
                    <span className="rd-blocker-severity">{blocker.severity}</span>
                    <span className="rd-spacer" />
                    <span
                      className="rd-blocker-owner"
                      title={
                        blocker.owner === "You"
                          ? "You can clear this from GitHub."
                          : blocker.owner === "Author"
                            ? "Only the author can clear this."
                            : "Either of you can clear this."
                      }
                    >
                      {blocker.owner}
                    </span>
                  </div>
                  <h4>{blocker.title}</h4>
                  {blocker.detail ? (
                    <p className="rd-blocker-detail">{blocker.detail}</p>
                  ) : null}
                  <p className="rd-blocker-fix">{blocker.fix}</p>
                  <div className="rd-blocker-actions">
                    {blocker.reveal && blocker.revealLabel ? (
                      <button
                        type="button"
                        className="rd-btn rd-btn--xs focus-ring"
                        onClick={() => onRevealBlocker(blocker.reveal!)}
                      >
                        {blocker.revealLabel}
                      </button>
                    ) : null}
                    {url && blocker.id !== "draft" && blocker.id !== "state" ? (
                      <button
                        type="button"
                        className="rd-btn rd-btn--xs focus-ring"
                        onClick={() => onOpenBlockerUrl(url)}
                      >
                        {blocker.id === "checks" ? "Open failing run" : "Open on GitHub"}
                        <Icon name="ph:arrow-up-right" width={10} height={10} aria-hidden />
                      </button>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </section>
        ) : null}

        {selected && !isPr ? (
          <Disclosure
            id="local"
            icon="ph:hard-drives"
            label="Still available here"
            summary="local only"
            summaryTone="muted"
            open={openDisclosures.has("local")}
            onToggle={onToggleDisclosure}
          >
            <p className="rd-hint">
              Read the diff, mark files reviewed, keep a note, and open the session.
              GitHub verdicts need a pull request.
            </p>
          </Disclosure>
        ) : null}

        {checklist.length > 0 ? (
          <Disclosure
            id="checklist"
            icon="ph:check"
            label="Merge checklist"
            summary={`${score.passed}/${score.total} passing`}
            summaryTone={score.passed === score.total ? "success" : "warning"}
            open={openDisclosures.has("checklist")}
            onToggle={onToggleDisclosure}
          >
            <ul className="rd-checklist">
              {checklist.map((row) => (
                <li key={row.label} data-ok={row.ok ? "true" : undefined} data-soft={row.soft ? "true" : undefined}>
                  <Icon
                    name={
                      row.ok
                        ? "ph:check-circle-fill"
                        : row.soft
                          ? "ph:eye"
                          : "ph:warning-circle-fill"
                    }
                    width={13}
                    height={13}
                    aria-hidden
                  />
                  <span>
                    <b>{row.label}</b> — {row.detail}
                  </span>
                </li>
              ))}
            </ul>
          </Disclosure>
        ) : null}

        {isPr ? (
          <Disclosure
            id="checks"
            icon="ph:list-checks"
            label="Checks"
            summary={checks.label}
            summaryTone={
              checks.tone === "success" || checks.tone === "warning" || checks.tone === "danger"
                ? checks.tone
                : "muted"
            }
            open={openDisclosures.has("checks")}
            onToggle={onToggleDisclosure}
          >
            {!facts ? (
              <p className="rd-hint">
                {readinessPhase === "loading"
                  ? "State, mergeability, reviews, checks and threads arrive together."
                  : readinessError ?? "GitHub state could not be read. Nothing is inferred."}
              </p>
            ) : facts.checks.runs.length === 0 ? (
              <p className="rd-hint">No checks have reported on this head.</p>
            ) : (
              <ul className="rd-check-runs">
                {facts.checks.runs.map((run) => (
                  <li key={`${run.name}-${run.detailsUrl ?? ""}`}>
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
                  </li>
                ))}
              </ul>
            )}
            <p className="rd-inspector-stamp">{checkedLabel}</p>
          </Disclosure>
        ) : null}

        {isPr ? (
          <Disclosure
            id="threads"
            icon="ph:chat-circle-dots"
            label="Review threads"
            summary={
              facts
                ? `${facts.threads.unresolved} unresolved of ${facts.threads.total}`
                : "not read"
            }
            summaryTone={facts && facts.threads.unresolved > 0 ? "warning" : "muted"}
            open={openDisclosures.has("threads")}
            onToggle={onToggleDisclosure}
          >
            {!facts || facts.threads.items.length === 0 ? (
              <p className="rd-hint">
                {!facts
                  ? "Threads arrive with the pull request's GitHub state."
                  : facts.threads.total === 0
                    ? "Nobody has left a line comment."
                    : "Every fetched thread is resolved or outdated."}
              </p>
            ) : (
              <>
                <ul className="rd-threads">
                  {facts.threads.items.map((thread) => (
                    <li key={thread.id}>
                      <span className="rd-thread-where">{thread.where}</span>
                      <b>@{thread.author}</b>
                      <p>{thread.excerpt}</p>
                    </li>
                  ))}
                </ul>
                <p className="rd-inspector-stamp">
                  {facts.threads.canResolve
                    ? "Resolve on GitHub."
                    : "Resolving threads needs a GitHub token; the deck is read-only here."}
                </p>
              </>
            )}
          </Disclosure>
        ) : null}

        <Disclosure
          id="session"
          icon="ph:terminal-window"
          label="Session"
          summary={sourceLabel}
          summaryTone="muted"
          open={openDisclosures.has("session")}
          onToggle={onToggleDisclosure}
        >
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
            {facts ? (
              <div>
                <dt>Mergeability</dt>
                <dd>{facts.mergeable == null ? "computing" : facts.mergeableState}</dd>
              </div>
            ) : null}
          </dl>
        </Disclosure>

        <section className="rd-note">
          <label className="rd-note-label" htmlFor="rd-inspector-note">
            <Icon name="ph:pencil-simple" width={11} height={11} aria-hidden />
            <span className="rd-eyebrow">Review note</span>
            <small>{isPr ? "· sent with your verdict" : "· kept with this session"}</small>
          </label>
          <textarea
            id="rd-inspector-note"
            className="rd-note-input"
            placeholder="Add a note…"
            value={note}
            maxLength={GITHUB_REVIEW_BODY_MAX_LENGTH}
            disabled={!selected}
            aria-invalid={noteError ? true : undefined}
            onChange={(event) =>
              onNote(event.target.value.slice(0, GITHUB_REVIEW_BODY_MAX_LENGTH))
            }
          />
          {noteError ? (
            <span className="rd-error" role="alert">
              {noteError}
            </span>
          ) : null}
        </section>
      </div>

      {verdictDock}
    </aside>
  );
}
