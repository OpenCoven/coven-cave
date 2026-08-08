"use client";

/**
 * GitHubPrReader — the full-width pull-request reader (cave-l82dm).
 *
 * Frame: `Coven Pr.dc.html`. The Coding Room's review rail links here as
 * "Full PR view", which is the whole reason it exists: the rail is a sidebar,
 * and a conversation, a commit list and a unified diff are not sidebar shapes.
 *
 *   header    state · title · #n · author → base ← head
 *   hero      serif title, "wants to merge N commits into base from head"
 *   tabs      Conversation | Commits | Checks | Files   (+ diffstat)
 *   body      per tab
 *
 * Everything here is real: `/api/github/{item,checks,comments,commit,diff}`
 * behind the shared hooks in `use-github-pr.ts`, which the rail's compact panel
 * reads too — so the two can never disagree about whether a check failed.
 *
 * The one thing it will NOT do is imply permission it cannot verify. Gate state
 * comes from `prLandingGates`, which returns `unknown` when GitHub is still
 * computing mergeability or reported no checks, and `prMergeVerdict` refuses to
 * merge on anything short of a pass. "We could not tell" is not permission.
 */

import { useMemo, useState } from "react";
import "@/styles/globals/surface-pr-reader.css";
import { Icon } from "@/lib/icon";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { MarkdownBlock, SyntaxBlock } from "@/components/message-bubble";
import { relativeTime } from "@/lib/relative-time";
import { openExternalUrl } from "@/lib/open-external";
import {
  PR_READER_TABS,
  prChecksHeadline,
  prLandingGates,
  prMergeVerdict,
  prStatBlocks,
  summarizePrChecks,
  type PrReaderTab,
} from "@/lib/github-pr-reader";
import {
  useGitHubPrChecks,
  useGitHubPrCommits,
  useGitHubPrDetail,
  useGitHubPrFiles,
  useGitHubPrThreads,
} from "@/lib/use-github-pr";

const TAB_LABEL: Record<PrReaderTab, string> = {
  conversation: "Conversation",
  commits: "Commits",
  checks: "Checks",
  files: "Files",
};

function shortSha(sha: string): string {
  return sha.slice(0, 9);
}

function LoadingRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="pr-reader__loading" aria-busy="true">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} variant="text" width={`${88 - i * 9}%`} />
      ))}
    </div>
  );
}

// ── Checks card ──────────────────────────────────────────────────────────────

function ChecksCard({ repo, number, reviews, mergeable, mergeableState, compact }: {
  repo: string;
  number: number;
  reviews: { approved: number; changesRequested: number } | null;
  mergeable: boolean | null;
  mergeableState: string | null;
  compact?: boolean;
}) {
  const state = useGitHubPrChecks(repo, number);
  const [showPassing, setShowPassing] = useState(false);

  if (state.phase === "loading") return <LoadingRows rows={3} />;
  if (state.phase === "error") {
    return <ErrorState headline="Couldn’t load checks" subtitle="GitHub did not answer for this pull request." />;
  }

  const counts = summarizePrChecks(state.runs);
  const gates = prLandingGates({ counts, reviews, mergeable, mergeableState });
  const verdict = prMergeVerdict(gates);
  const failing = state.runs.filter(
    (run) => run.status === "completed" && run.conclusion !== "success" && run.conclusion !== "skipped" && run.conclusion !== "neutral",
  );
  const passing = state.runs.filter((run) => run.status === "completed" && run.conclusion === "success");
  const running = state.runs.filter((run) => run.status !== "completed");

  return (
    <section className="pr-reader__checks" aria-label="Checks">
      <div className="pr-reader__checks-head">
        <span className="pr-reader__checks-count" aria-hidden="true">
          {counts.failing || counts.pending || counts.total}
        </span>
        <span className="pr-reader__checks-headline">
          <strong>{prChecksHeadline(counts)}</strong>
          {/* Numbers, not just a ring — the rollup has to survive being read
              aloud, and skipped runs are named rather than counted as passes. */}
          <span className="pr-reader__checks-meta">
            {counts.failing} failing · {counts.passing} successful · {counts.pending} running
            {counts.neutral ? ` · ${counts.neutral} skipped` : ""}
          </span>
        </span>
      </div>

      {failing.length || running.length ? (
        <ul className="pr-reader__check-list">
          {[...failing, ...running].map((run) => (
            <li key={run.id} className="pr-reader__check-row">
              <span
                className="pr-reader__check-glyph"
                data-state={run.status !== "completed" ? "running" : "failing"}
                aria-hidden="true"
              >
                {run.status !== "completed" ? "●" : "✕"}
              </span>
              <span className="pr-reader__check-name">{run.name}</span>
              <span className="pr-reader__check-state">
                {run.status !== "completed" ? "running" : run.conclusion ?? "failed"}
              </span>
              {run.completedAt ? (
                <span className="pr-reader__check-time">{relativeTime(run.completedAt)}</span>
              ) : null}
              {run.detailsUrl ? (
                <a className="focus-ring pr-reader__check-link" href={run.detailsUrl} target="_blank" rel="noreferrer">
                  details
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {passing.length ? (
        <>
          <button
            type="button"
            className="focus-ring pr-reader__check-toggle"
            aria-expanded={showPassing}
            onClick={() => setShowPassing((open) => !open)}
          >
            <Icon name={showPassing ? "ph:caret-down" : "ph:caret-right"} width={10} height={10} aria-hidden />
            {passing.length} successful {passing.length === 1 ? "check" : "checks"}
          </button>
          {showPassing ? (
            <ul className="pr-reader__check-list">
              {passing.map((run) => (
                <li key={run.id} className="pr-reader__check-row">
                  <span className="pr-reader__check-glyph" data-state="passing" aria-hidden="true">
                    ✓
                  </span>
                  <span className="pr-reader__check-name">{run.name}</span>
                  {run.completedAt ? (
                    <span className="pr-reader__check-time">{relativeTime(run.completedAt)}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}

      {compact ? null : (
        <div className="pr-reader__gates">
          {gates.map((gate) => (
            <span key={gate.id} className="pr-reader__gate" data-state={gate.state}>
              <span className="pr-reader__gate-bar" aria-hidden="true" />
              <span className="pr-reader__gate-label">
                {gate.label}
                {/* The state word is the non-colour channel; the bar is decoration. */}
                <span className="pr-reader__gate-state"> — {gate.state}</span>
              </span>
              <span className="pr-reader__gate-detail">{gate.detail}</span>
            </span>
          ))}
          <p className="pr-reader__merge-reason">{verdict.reason}</p>
        </div>
      )}
    </section>
  );
}

// ── Reader ───────────────────────────────────────────────────────────────────

export type GitHubPrReaderProps = {
  repo: string;
  number: number;
  /** Back to the room. Rendered as the frame's "‹ back to files" bar. */
  onBack?: () => void;
};

export function GitHubPrReader({ repo, number, onBack }: GitHubPrReaderProps) {
  const [tab, setTab] = useState<PrReaderTab>("conversation");
  const detail = useGitHubPrDetail(repo, number);
  const threads = useGitHubPrThreads(repo, number);
  const commits = useGitHubPrCommits(repo, number, tab === "commits");
  const files = useGitHubPrFiles(repo, number, tab === "files");
  const [openCommit, setOpenCommit] = useState<string | null>(null);

  const pull = detail.phase === "ready" ? detail.detail.pull : null;
  const blocks = useMemo(
    () => prStatBlocks(pull?.additions ?? 0, pull?.deletions ?? 0),
    [pull?.additions, pull?.deletions],
  );

  const unresolvedThreads =
    threads.phase === "ready" ? threads.threads.filter((thread) => !thread.isResolved).length : 0;

  const tabCount: Record<PrReaderTab, number | null> = {
    conversation: threads.phase === "ready" ? threads.threads.length : null,
    commits: pull?.commits ?? null,
    checks: null,
    files: pull?.changedFiles ?? null,
  };

  return (
    <div className="pr-reader" data-testid="github-pr-reader">
      <div className="pr-reader__bar">
        {onBack ? (
          <button type="button" className="focus-ring pr-reader__back" onClick={onBack}>
            <Icon name="ph:caret-left" width={11} height={11} aria-hidden />
            Back to files
          </button>
        ) : null}
        <span className="pr-reader__repo">{repo}</span>
        <span className="pr-reader__number">#{number}</span>
        <span className="pr-reader__spacer" />
        {detail.phase === "ready" && detail.detail.htmlUrl ? (
          <button
            type="button"
            className="focus-ring pr-reader__external"
            onClick={() => openExternalUrl(detail.detail.htmlUrl as string)}
          >
            Open on GitHub
          </button>
        ) : null}
      </div>

      {detail.phase === "loading" ? (
        <div className="pr-reader__body">
          <LoadingRows rows={5} />
        </div>
      ) : detail.phase === "error" ? (
        <div className="pr-reader__body">
          <ErrorState
            headline="Couldn’t load this pull request"
            subtitle={`GitHub did not answer for ${repo}#${number}.`}
          />
        </div>
      ) : (
        <>
          <header className="pr-reader__hero">
            <h1 className="pr-reader__title">
              {detail.detail.title}
              <span className="pr-reader__title-number"> #{detail.detail.number}</span>
            </h1>
            <div className="pr-reader__facts">
              <span
                className="pr-reader__state"
                data-state={detail.detail.merged ? "merged" : detail.detail.state}
              >
                {detail.detail.merged ? "merged" : detail.detail.draft ? "draft" : detail.detail.state}
              </span>
              {pull ? (
                <span className="pr-reader__lineage">
                  <strong>{detail.detail.author?.login ?? "someone"}</strong> wants to merge{" "}
                  {pull.commits} {pull.commits === 1 ? "commit" : "commits"} into{" "}
                  <span className="pr-reader__ref">{pull.baseRef}</span> from{" "}
                  <span className="pr-reader__ref pr-reader__ref--head">{pull.headRef}</span>
                </span>
              ) : null}
              {detail.detail.createdAt ? (
                <span className="pr-reader__age">opened {relativeTime(detail.detail.createdAt)}</span>
              ) : null}
            </div>
          </header>

          <div role="tablist" aria-label="Pull request" className="pr-reader__tabs">
            {PR_READER_TABS.map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                data-selected={tab === id ? "true" : undefined}
                className="focus-ring pr-reader__tab"
                onClick={() => setTab(id)}
              >
                {TAB_LABEL[id]}
                {tabCount[id] != null ? <span className="pr-reader__tab-count">{tabCount[id]}</span> : null}
              </button>
            ))}
            <span className="pr-reader__spacer" />
            {pull ? (
              <span className="pr-reader__diffstat">
                <span className="pr-reader__add">+{pull.additions}</span>
                <span className="pr-reader__del">&minus;{pull.deletions}</span>
                <span className="pr-reader__blocks" aria-hidden="true">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <span key={i} className="pr-reader__block" data-added={i < blocks ? "true" : undefined} />
                  ))}
                </span>
              </span>
            ) : null}
          </div>

          <div className="pr-reader__body">
            {tab === "conversation" ? (
              <div className="pr-reader__conversation">
                {detail.detail.body ? (
                  <article className="pr-reader__card">
                    <header className="pr-reader__card-head">
                      <strong>{detail.detail.author?.login ?? "author"}</strong>
                      <span className="pr-reader__card-when">
                        opened this{detail.detail.createdAt ? ` · ${relativeTime(detail.detail.createdAt)}` : ""}
                      </span>
                    </header>
                    <div className="pr-reader__card-body">
                      <MarkdownBlock text={detail.detail.body} />
                    </div>
                  </article>
                ) : (
                  <EmptyState
                    icon="ph:chat-circle-dots"
                    headline="No description"
                    subtitle="This pull request was opened without a body."
                  />
                )}

                <ChecksCard
                  repo={repo}
                  number={number}
                  reviews={pull?.reviews ?? null}
                  mergeable={pull?.mergeable ?? null}
                  mergeableState={pull?.mergeableState ?? null}
                />

                <section className="pr-reader__threads" aria-label="Review threads">
                  <h2 className="pr-reader__section-title">
                    Review threads
                    {threads.phase === "ready" ? (
                      <span className="pr-reader__section-meta">
                        {threads.threads.length} total · {unresolvedThreads} unresolved
                      </span>
                    ) : null}
                  </h2>
                  {threads.phase === "loading" ? (
                    <LoadingRows rows={3} />
                  ) : threads.phase === "error" ? (
                    <ErrorState headline="Couldn’t load review threads" subtitle="GitHub did not answer." />
                  ) : threads.threads.length === 0 ? (
                    <EmptyState
                      icon="ph:check-circle"
                      headline="No review threads"
                      subtitle="Nobody has left a line comment on this pull request."
                    />
                  ) : (
                    <ul className="pr-reader__thread-list">
                      {threads.threads.map((thread) => (
                        <li key={thread.id} className="pr-reader__thread" data-resolved={thread.isResolved ? "true" : undefined}>
                          <div className="pr-reader__thread-head">
                            {thread.path ? <span className="pr-reader__thread-path">{thread.path}</span> : null}
                            <span className="pr-reader__thread-state">
                              {thread.isResolved ? "resolved" : "unresolved"}
                            </span>
                            {thread.isOutdated ? <span className="pr-reader__thread-state">outdated</span> : null}
                          </div>
                          {thread.comments.slice(0, 3).map((comment) => (
                            <div key={comment.id} className="pr-reader__comment">
                              <span className="pr-reader__comment-author">
                                {comment.author?.login ?? "someone"}
                              </span>
                              <span className="pr-reader__comment-body">{comment.body}</span>
                            </div>
                          ))}
                          {thread.comments.length > 3 ? (
                            <p className="pr-reader__comment-more">
                              {thread.comments.length - 3} more in this thread
                            </p>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>
            ) : null}

            {tab === "commits" ? (
              commits.phase === "loading" || commits.phase === "idle" ? (
                <LoadingRows rows={4} />
              ) : commits.phase === "error" ? (
                <ErrorState headline="Couldn’t load commits" subtitle="GitHub did not answer for this branch." />
              ) : commits.commits.length === 0 ? (
                <EmptyState icon="ph:git-commit" headline="No commits" subtitle="This pull request has no commits yet." />
              ) : (
                <>
                  {commits.truncated ? (
                    <p className="pr-reader__notice">
                      Showing the first 100 commits — this branch has more.
                    </p>
                  ) : null}
                  <ul className="pr-reader__commits">
                    {commits.commits.map((commit) => {
                      const open = openCommit === commit.sha;
                      return (
                        <li key={commit.sha} className="pr-reader__commit">
                          <button
                            type="button"
                            className="focus-ring pr-reader__commit-row"
                            aria-expanded={open}
                            onClick={() => setOpenCommit(open ? null : commit.sha)}
                          >
                            <Icon name={open ? "ph:caret-down" : "ph:caret-right"} width={10} height={10} aria-hidden />
                            <span className="pr-reader__commit-subject">{commit.subject}</span>
                            {/* GitHub's verification verdict — a local %G? check
                                is unusable here (no allowed-signers file). */}
                            <span className="pr-reader__commit-sig" data-verified={commit.verified ? "true" : undefined}>
                              {commit.verified ? "verified" : commit.verifiedReason ?? "unsigned"}
                            </span>
                            <span className="pr-reader__commit-sha">{shortSha(commit.sha)}</span>
                            {commit.date ? (
                              <span className="pr-reader__commit-when">{relativeTime(commit.date)}</span>
                            ) : null}
                          </button>
                          {open ? (
                            <div className="pr-reader__commit-detail">
                              {commit.body ? <pre className="pr-reader__commit-body">{commit.body}</pre> : null}
                              <span className="pr-reader__commit-author">
                                {commit.authorLogin ?? commit.authorName ?? "unknown author"}
                              </span>
                              {commit.htmlUrl ? (
                                <button
                                  type="button"
                                  className="focus-ring pr-reader__commit-link"
                                  onClick={() => openExternalUrl(commit.htmlUrl as string)}
                                >
                                  Open commit
                                </button>
                              ) : null}
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </>
              )
            ) : null}

            {tab === "checks" ? (
              <ChecksCard
                repo={repo}
                number={number}
                reviews={pull?.reviews ?? null}
                mergeable={pull?.mergeable ?? null}
                mergeableState={pull?.mergeableState ?? null}
              />
            ) : null}

            {tab === "files" ? (
              files.phase === "loading" || files.phase === "idle" ? (
                <LoadingRows rows={5} />
              ) : files.phase === "error" ? (
                <ErrorState headline="Couldn’t load the diff" subtitle="GitHub did not answer for this pull request." />
              ) : files.files.length === 0 ? (
                <EmptyState icon="ph:file" headline="No files changed" subtitle="This pull request changes nothing." />
              ) : (
                <>
                  {files.truncated ? (
                    <p className="pr-reader__notice">
                      The diff is capped — some patches are omitted, and every omitted file still
                      appears below with its stats.
                    </p>
                  ) : null}
                  <ul className="pr-reader__files">
                    {files.files.map((file) => (
                      <li key={file.filename} className="pr-reader__file">
                        <div className="pr-reader__file-head">
                          <span className="pr-reader__file-status" data-status={file.status}>
                            {file.status}
                          </span>
                          <span className="pr-reader__file-name">{file.filename}</span>
                          <span className="pr-reader__add">+{file.additions}</span>
                          <span className="pr-reader__del">&minus;{file.deletions}</span>
                        </div>
                        {file.patch ? (
                          <SyntaxBlock text={file.patch} lang="diff" className="pr-reader__patch" />
                        ) : (
                          <p className="pr-reader__file-nopatch">
                            {file.noPatchReason === "budget"
                              ? "Patch omitted — the diff budget was spent before this file."
                              : "GitHub did not return a patch for this file."}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              )
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

export default GitHubPrReader;
