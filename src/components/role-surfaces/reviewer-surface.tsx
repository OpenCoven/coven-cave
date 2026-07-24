"use client";

/**
 * Reviewer Surface — the Review Deck.
 *
 * Change review over the familiar's real work, laid out as a tri-pane deck.
 * A summary strip counts the deck at a glance. Left rail: the review queue —
 * this familiar's sessions that carry review material (a pull request, a
 * nonzero working-tree diff, or a named branch), filterable by kind and
 * collapsible to a spine. Center: the selected session's real working-tree
 * changes (`/api/changes`) as file tabs over a colored unified diff (capped
 * server-side; truncation shown honestly), with a verdict bar that dispatches
 * approve / request-changes / merge to the real GitHub review + merge routes.
 * Right rail: the familiar's identity, session facts, jumps, and a note for
 * the familiar. Footer: the deck's saved checkpoints for the selected root.
 *
 * Everything rendered is real git state read through the Cave's changes API;
 * the deck never edits the working tree — verdicts and merges go to GitHub.
 * Panels with nothing to show say so.
 */

import "@/styles/review-deck.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@/lib/icon";
import type { RoleSurfaceContext } from "@/lib/role-surfaces";
import { useRoleSurfaceState } from "@/lib/role-surface-state";
import { relativeTime } from "@/lib/relative-time";
import { LifecycleBadge } from "@/components/ui/lifecycle-badge";
import { Segmented } from "@/components/ui/settings-controls";
import {
  diffStatLabel,
  needsHuman,
  parseDiffLines,
  prLabel,
  prUrl,
  reviewQueue,
  reviewSummary,
  reviewTypeMeta,
  sessionLifecycle,
  verdictMeta,
  type ReviewReason,
  type Verdict,
} from "./review-deck";
import { SurfaceEmpty } from "./surface-room";
import { REVIEWER_SURFACE_ID } from "./ids";

export type ReviewerState = {
  selectedSessionId: string | null;
  drawerOpen: boolean;
  /** Latest queue counts — read by the registration manifest's status chip. */
  lastCounts: { queue: number; pullRequests: number } | null;
};

export const REVIEWER_INITIAL_STATE: ReviewerState = {
  selectedSessionId: null,
  drawerOpen: false,
  lastCounts: null,
};

type ChangedFileWire = {
  path: string;
  status: "modified" | "added" | "deleted" | "renamed" | "untracked";
  renamedFrom?: string;
  insertions?: number;
  deletions?: number;
};

type ChangesWire =
  | { ok: true; repo: true; repoRoot: string; branch: string | null; worktree: string | null; files: ChangedFileWire[] }
  | { ok: true; repo: false; error?: string };

type CheckpointWire = { name: string; savedAt: string; bytes: number };

type QueueFilter = "all" | ReviewReason;

const FILTER_OPTIONS: readonly QueueFilter[] = ["all", "pull-request", "working-changes", "branch"];
const FILTER_LABELS: Record<QueueFilter, string> = {
  all: "All",
  "pull-request": "PRs",
  "working-changes": "Changes",
  branch: "Branch",
};

/** Two-letter monogram for the familiar's queue/identity avatar. */
function initials(name: string): string {
  const clean = name.trim();
  if (!clean) return "··";
  const parts = clean.split(/\s+/);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : clean.slice(0, 2);
  return letters.toUpperCase();
}

export function ReviewerSurface({ context }: { context: RoleSurfaceContext }) {
  const familiar = context.activeFamiliar;
  const familiarId = familiar.id;
  const [state, patch] = useRoleSurfaceState<ReviewerState>(familiarId, REVIEWER_SURFACE_ID, REVIEWER_INITIAL_STATE);

  // Ephemeral view state — collapse, filter, verdicts, and the reviewer's note
  // live for the visit; only the selection and the checkpoints drawer persist.
  const [filter, setFilter] = useState<QueueFilter>("all");
  const [queueCollapsed, setQueueCollapsed] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [verdicts, setVerdicts] = useState<Record<string, Verdict>>({});
  const [note, setNote] = useState("");
  const [dispatching, setDispatching] = useState<Verdict | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // ── The review queue: real sessions with review material ──────────────────
  const fullQueue = useMemo(() => reviewQueue(context.runtimeState.sessions), [context.runtimeState.sessions]);
  const queue = useMemo(
    () => (filter === "all" ? fullQueue : fullQueue.filter((item) => item.reasons.includes(filter))),
    [fullQueue, filter],
  );
  useEffect(() => {
    const counts = {
      queue: fullQueue.length,
      pullRequests: fullQueue.filter((item) => item.reasons.includes("pull-request")).length,
    };
    if (state.lastCounts?.queue === counts.queue && state.lastCounts?.pullRequests === counts.pullRequests) return;
    patch({ lastCounts: counts });
  }, [fullQueue, state.lastCounts, patch]);

  const selected = useMemo(
    () => fullQueue.find((item) => item.session.id === state.selectedSessionId) ?? null,
    [fullQueue, state.selectedSessionId],
  );
  const projectRoot = selected?.session.project_root ?? null;
  const selectedVerdict = selected ? verdicts[selected.session.id] ?? null : null;

  // ── Working-tree changes for the selected session's project root ──────────
  const [changes, setChanges] = useState<ChangesWire | null>(null);
  const [changesError, setChangesError] = useState<string | null>(null);
  const loadChanges = useCallback(async () => {
    setChangesError(null);
    setChanges(null);
    if (!projectRoot) return;
    try {
      const res = await fetch(`/api/changes?projectRoot=${encodeURIComponent(projectRoot)}`, { cache: "no-store" });
      const json = res.ok ? ((await res.json()) as ChangesWire) : null;
      if (!json?.ok) throw new Error("bad response");
      setChanges(json);
    } catch {
      setChangesError("Couldn't read the working tree.");
      setChanges(null);
    }
  }, [projectRoot]);
  useEffect(() => {
    void loadChanges();
  }, [loadChanges]);

  // ── One file's unified diff, on demand ─────────────────────────────────────
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [diff, setDiff] = useState<{ text: string; truncated: boolean } | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const showDiff = useCallback(
    async (relPath: string) => {
      if (!projectRoot) return;
      setOpenFile(relPath);
      setDiff(null);
      setDiffLoading(true);
      try {
        const res = await fetch(
          `/api/changes?projectRoot=${encodeURIComponent(projectRoot)}&path=${encodeURIComponent(relPath)}`,
          { cache: "no-store" },
        );
        const json = res.ok
          ? ((await res.json()) as { ok?: boolean; diff?: string; truncated?: boolean })
          : null;
        if (!json?.ok || typeof json.diff !== "string") throw new Error("bad response");
        setDiff({ text: json.diff, truncated: json.truncated === true });
      } catch {
        setDiff({ text: "", truncated: false });
        setChangesError(`Couldn't load the diff for ${relPath}.`);
      } finally {
        setDiffLoading(false);
      }
    },
    [projectRoot],
  );

  const repoFiles = changes?.ok && changes.repo ? changes.files : [];
  // Reset the open file whenever the project root changes, then auto-open the
  // first changed file so the center pane is never awkwardly blank.
  useEffect(() => {
    setOpenFile(null);
    setDiff(null);
  }, [projectRoot]);
  useEffect(() => {
    if (openFile == null && repoFiles.length > 0) void showDiff(repoFiles[0].path);
  }, [openFile, repoFiles, showDiff]);

  // ── Saved checkpoints for the selected root (footer) ───────────────────────
  const [checkpoints, setCheckpoints] = useState<CheckpointWire[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    setCheckpoints(null);
    if (!projectRoot || !state.drawerOpen) return;
    (async () => {
      try {
        const res = await fetch(
          `/api/changes?projectRoot=${encodeURIComponent(projectRoot)}&checkpoints=1`,
          { cache: "no-store" },
        );
        const json = res.ok ? ((await res.json()) as { ok?: boolean; checkpoints?: CheckpointWire[] }) : null;
        if (!cancelled) setCheckpoints(json?.checkpoints ?? []);
      } catch {
        if (!cancelled) setCheckpoints([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectRoot, state.drawerOpen]);

  // ── Verdict dispatch — real GitHub review + merge routes ───────────────────
  const selectedPr = selected?.session.pullRequest ?? null;
  const selectedPrUrl = prUrl(selectedPr);
  const canDispatch = selectedPr?.number != null;

  const dispatchVerdict = useCallback(
    async (verdict: Verdict) => {
      if (!selected || !selectedPr?.number) return;
      setActionError(null);
      setDispatching(verdict);
      try {
        const body = note.trim();
        if (verdict === "merged") {
          const res = await fetch("/api/github/merge", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ repo: selectedPr.repo, number: selectedPr.number, method: "squash" }),
          });
          const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
          if (!json?.ok) throw new Error(json?.error || "merge failed");
        } else {
          const event = verdict === "approved" ? "APPROVE" : "REQUEST_CHANGES";
          if (event === "REQUEST_CHANGES" && !body) {
            setActionError("Add a note for the familiar before requesting changes.");
            setDispatching(null);
            return;
          }
          const res = await fetch("/api/github/review", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ repo: selectedPr.repo, number: selectedPr.number, event, body }),
          });
          const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
          if (!json?.ok) throw new Error(json?.error || "review failed");
        }
        setVerdicts((prev) => ({ ...prev, [selected.session.id]: verdict }));
      } catch (e) {
        setActionError(e instanceof Error ? e.message : "Couldn't reach GitHub.");
      } finally {
        setDispatching(null);
      }
    },
    [selected, selectedPr, note],
  );

  // ── Derived view models ────────────────────────────────────────────────────
  const summary = useMemo(
    () =>
      reviewSummary(
        fullQueue.map((item) => ({
          diff: item.session.diff,
          lifecycle: sessionLifecycle(item.session.status),
          verdict: verdicts[item.session.id] ?? null,
        })),
      ),
    [fullQueue, verdicts],
  );
  const stats: Array<{ value: number; label: string; tone: "accent" | "success" | "warning" | "muted" }> = [
    { value: summary.awaiting, label: "Awaiting verdict", tone: "accent" },
    { value: summary.approved, label: "Approved", tone: "success" },
    { value: summary.changes, label: "Changes requested", tone: "warning" },
    { value: summary.landedClean, label: "Landed clean", tone: "muted" },
  ];

  const diffLines = useMemo(() => (diff?.text ? parseDiffLines(diff.text) : []), [diff]);
  const famMonogram = initials(familiar.display_name);
  const selectedLifecycle = selected ? sessionLifecycle(selected.session.status) : null;
  const selectedVerdictMeta = selectedVerdict ? verdictMeta(selectedVerdict) : null;

  return (
    <div className="rd-stage">
      {/* ── Summary strip ── */}
      <div className="rd-summary">
        {stats.map((stat) => (
          <div key={stat.label} className="rd-stat">
            <span className="rd-stat-dot" data-tone={stat.tone} aria-hidden />
            <span className="rd-stat-body">
              <span className="rd-stat-value">{stat.value}</span>
              <span className="rd-stat-label">{stat.label}</span>
            </span>
          </div>
        ))}
      </div>

      {/* ── Tri-pane ── */}
      <div
        className="rd-grid"
        data-left={queueCollapsed ? "collapsed" : undefined}
        data-right={railCollapsed ? "collapsed" : undefined}
      >
        {/* ── Left: review queue ── */}
        {queueCollapsed ? (
          <button
            type="button"
            className="rd-panel rd-collapsed focus-ring-inset"
            title="Expand review queue"
            onClick={() => setQueueCollapsed(false)}
          >
            <span className="rd-collapsed-icon">
              <Icon name="ph:sidebar-simple" width={16} height={16} aria-hidden />
            </span>
            <span className="rd-collapsed-badge">{fullQueue.length}</span>
            <span className="rd-collapsed-label">Review queue</span>
          </button>
        ) : (
          <section className="rd-panel rd-queue" aria-label="Review queue">
            <div className="rd-queue-head">
              <div className="rd-queue-head-row">
                <span className="rd-eyebrow">Review queue</span>
                <span className="rd-count">{queue.length}</span>
                <span className="rd-spacer" />
                <button
                  type="button"
                  className="rd-icon-btn focus-ring"
                  title="Collapse queue"
                  onClick={() => setQueueCollapsed(true)}
                >
                  <Icon name="ph:sidebar-simple" width={14} height={14} aria-hidden />
                </button>
              </div>
              <Segmented
                options={FILTER_OPTIONS}
                value={filter}
                onChange={setFilter}
                getLabel={(o) => FILTER_LABELS[o]}
                ariaLabel="Filter review queue"
              />
            </div>
            <div className="rd-queue-list rd-scroll">
              {queue.length === 0 ? (
                <SurfaceEmpty
                  title={filter === "all" ? "Deck clear." : "Nothing matches this filter."}
                  hint="Sessions with a pull request, working changes, or a branch appear here."
                />
              ) : (
                <ul className="role-surface-list" aria-label="Sessions to review">
                  {queue.slice(0, 40).map((item) => {
                    const tm = reviewTypeMeta(item.reasons);
                    const life = sessionLifecycle(item.session.status);
                    const v = verdicts[item.session.id] ?? null;
                    const vm = v ? verdictMeta(v) : null;
                    return (
                      <li key={item.session.id}>
                        <button
                          type="button"
                          className={`rd-row focus-ring-inset${item.session.id === state.selectedSessionId ? " rd-row--active" : ""}`}
                          aria-current={item.session.id === state.selectedSessionId ? "true" : undefined}
                          onClick={() => patch({ selectedSessionId: item.session.id })}
                        >
                          <span className="rd-row-top">
                            <span className="rd-avatar" title={`${familiar.display_name} · familiar`}>
                              {famMonogram}
                            </span>
                            <span className="rd-type-pill" title={tm.title}>
                              <Icon name={tm.icon} width={11} height={11} aria-hidden />
                              {tm.label}
                            </span>
                            <span className="rd-spacer" />
                            {vm ? (
                              <span className="rd-verdict-pill" data-tone={vm.tone}>
                                <Icon name={vm.icon} width={11} height={11} aria-hidden />
                                {vm.label}
                              </span>
                            ) : (
                              <LifecycleBadge lifecycle={life} needsHuman={needsHuman(life, null)} />
                            )}
                          </span>
                          <span className="rd-row-title">{item.session.title || item.session.id}</span>
                          <span className="rd-row-meta">
                            <span>{familiar.display_name}</span>
                            <span className="rd-row-meta-dot">·</span>
                            <span>{diffStatLabel(item.session.diff)}</span>
                            <span className="rd-spacer" />
                            <span className="rd-row-review" aria-hidden>
                              Review →
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>
        )}

        {/* ── Center: change viewer ── */}
        <section className="rd-panel rd-viewer" aria-label="Working-tree changes">
          <div className="rd-viewer-head">
            <div className="rd-viewer-head-row">
              <div className="rd-viewer-head-title">
                <div className="rd-eyebrow rd-viewer-eyebrow">Under review</div>
                <div className="rd-viewer-title">
                  {selected ? selected.session.title || selected.session.id : "No session selected"}
                </div>
              </div>
              <span className="rd-spacer" />
              {selected && <span className="rd-viewer-sub">{diffStatLabel(selected.session.diff)}</span>}
            </div>
            {repoFiles.length > 0 && (
              <div className="rd-tabs rd-scroll">
                {repoFiles.slice(0, 40).map((file) => {
                  const name = file.path.split("/").pop() || file.path;
                  return (
                    <button
                      key={file.path}
                      type="button"
                      className={`rd-tab focus-ring-inset${openFile === file.path ? " rd-tab--active" : ""}`}
                      aria-expanded={openFile === file.path}
                      onClick={() => void showDiff(file.path)}
                    >
                      <span>{name}</span>
                      <span className="rd-tab-badge" data-status={file.status}>
                        {file.status}
                      </span>
                      <span className="rd-tab-add">+{file.insertions ?? 0}</span>
                      <span className="rd-tab-del">−{file.deletions ?? 0}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* diff body / empty state */}
          {changesError ? (
            <div className="rd-fill">
              <div role="alert" className="role-surface-hint rd-error">
                {changesError}{" "}
                <button type="button" className="role-surface-chip focus-ring" onClick={() => void loadChanges()}>
                  Try again
                </button>
              </div>
            </div>
          ) : !selected ? (
            <div className="rd-fill">
              <SurfaceEmpty
                iconName="ph:git-diff"
                title="Pick a session from the queue."
                hint="Its project's real working-tree changes are read on selection."
              />
            </div>
          ) : changes == null ? (
            <div className="rd-fill">
              <SurfaceEmpty title="Reading the working tree…" />
            </div>
          ) : changes.ok && !changes.repo ? (
            <div className="rd-fill">
              <SurfaceEmpty title="Not a git repository." hint="This session's project root has no repo to review." />
            </div>
          ) : repoFiles.length === 0 ? (
            <div className="rd-fill">
              <SurfaceEmpty
                iconName="ph:check"
                title="No working changes"
                hint="This workload landed clean — nothing left in the working tree to diff. Jump to its session or pull request to see the shipped work."
              />
            </div>
          ) : (
            <div className="rd-diff rd-scroll">
              <div className="rd-diff-path">{openFile ?? ""}</div>
              {diffLoading ? (
                <SurfaceEmpty title="Loading diff…" />
              ) : diff && diff.text ? (
                <>
                  {diff.truncated && (
                    <p className="rd-diff-path" role="status">
                      Diff truncated server-side — showing the first part only.
                    </p>
                  )}
                  {diffLines.map((ln, i) => (
                    <div key={i} className="rd-diff-line" data-kind={ln.kind}>
                      <span className="rd-diff-mark" data-kind={ln.kind} aria-hidden>
                        {ln.mark}
                      </span>
                      <span className="rd-diff-text">{ln.text}</span>
                    </div>
                  ))}
                </>
              ) : (
                <SurfaceEmpty title="No diff to show." />
              )}
            </div>
          )}

          {/* verdict bar */}
          <div className="rd-verdict-bar">
            <div className="rd-verdict-lead">
              <span className="rd-eyebrow">Verdict</span>
              {selectedVerdictMeta ? (
                <span className="rd-verdict-pill rd-verdict-pill--lg" data-tone={selectedVerdictMeta.tone}>
                  <Icon name={selectedVerdictMeta.icon} width={13} height={13} aria-hidden />
                  {selectedVerdictMeta.label}
                </span>
              ) : (
                <span className="rd-verdict-pending">{canDispatch ? "pending — your call" : "no linked PR"}</span>
              )}
              {actionError && (
                <span role="alert" className="rd-verdict-pending rd-error">
                  {actionError}
                </span>
              )}
            </div>
            <span className="rd-spacer" />
            <button
              type="button"
              className="rd-btn rd-btn--changes"
              disabled={!canDispatch || dispatching != null}
              title={canDispatch ? "Send back to the familiar with notes" : "Needs a linked pull request"}
              onClick={() => void dispatchVerdict("changes")}
            >
              <Icon name="ph:arrow-bend-up-left" width={14} height={14} aria-hidden />
              Request changes
            </button>
            <button
              type="button"
              className="rd-btn rd-btn--approve"
              disabled={!canDispatch || dispatching != null}
              title={canDispatch ? "Approve — clears the change to merge" : "Needs a linked pull request"}
              onClick={() => void dispatchVerdict("approved")}
            >
              <Icon name="ph:seal-check" width={14} height={14} aria-hidden />
              Approve
            </button>
            <button
              type="button"
              className="rd-btn rd-btn--merge"
              disabled={!canDispatch || dispatching != null}
              title={canDispatch ? "Squash-merge and prune the branch" : "Needs a linked pull request"}
              onClick={() => void dispatchVerdict("merged")}
            >
              <Icon name="ph:git-merge" width={14} height={14} aria-hidden />
              Merge &amp; clean up
            </button>
          </div>
        </section>

        {/* ── Right: context rail ── */}
        {railCollapsed ? (
          <button
            type="button"
            className="rd-panel rd-collapsed focus-ring-inset"
            title="Expand context"
            onClick={() => setRailCollapsed(false)}
          >
            <span className="rd-collapsed-icon">
              <Icon name="ph:sidebar-simple" width={16} height={16} aria-hidden />
            </span>
            <span className="rd-collapsed-badge">{famMonogram}</span>
            <span className="rd-collapsed-label">Context</span>
          </button>
        ) : (
          <div className="rd-context rd-scroll">
            {/* familiar identity */}
            <section className="rd-panel rd-card rd-identity">
              <button
                type="button"
                className="rd-icon-btn focus-ring"
                title="Collapse context"
                onClick={() => setRailCollapsed(true)}
              >
                <Icon name="ph:sidebar-simple" width={15} height={15} aria-hidden />
              </button>
              <div className="rd-identity-body">
                <div className="rd-identity-name-row">
                  <span className="rd-identity-name">{familiar.display_name}</span>
                  <span className="rd-presence" aria-hidden />
                </div>
                <div className="rd-identity-role">{familiar.role || "familiar"}</div>
              </div>
            </section>

            {!selected ? (
              <section className="rd-panel rd-card">
                <div className="rd-card-title">Details</div>
                <SurfaceEmpty title="Select a session to review it." />
              </section>
            ) : (
              <>
                {/* under-review meta */}
                <section className="rd-panel rd-card">
                  <div className="rd-card-title">Details</div>
                  <div className="rd-facts">
                    <div className="rd-fact">
                      <span className="rd-fact-key">
                        <Icon name="ph:git-branch" width={13} height={13} aria-hidden />
                        Branch
                      </span>
                      <span className="rd-fact-val rd-fact-val--mono">
                        {selected.session.git?.branch ?? (changes?.ok && changes.repo ? changes.branch : null) ?? "—"}
                      </span>
                    </div>
                    <div className="rd-fact">
                      <span className="rd-fact-key">
                        <Icon name="ph:git-diff" width={13} height={13} aria-hidden />
                        Working changes
                      </span>
                      <span className="rd-fact-val">{diffStatLabel(selected.session.diff)}</span>
                    </div>
                    <div className="rd-fact">
                      <span className="rd-fact-key">
                        <Icon name="ph:git-pull-request" width={13} height={13} aria-hidden />
                        PR
                      </span>
                      <span className="rd-fact-val rd-fact-val--mono">
                        {selectedPrUrl ? (
                          <a
                            href={selectedPrUrl}
                            onClick={(e) => {
                              e.preventDefault();
                              context.openUrl(selectedPrUrl);
                            }}
                          >
                            {prLabel(selectedPr)}
                          </a>
                        ) : (
                          prLabel(selectedPr) ?? "None"
                        )}
                      </span>
                    </div>
                    <div className="rd-fact">
                      <span className="rd-fact-key">
                        <Icon name="ph:flag-checkered" width={13} height={13} aria-hidden />
                        Status
                      </span>
                      {selectedLifecycle && (
                        <LifecycleBadge
                          lifecycle={selectedLifecycle}
                          needsHuman={needsHuman(selectedLifecycle, selectedVerdict)}
                        />
                      )}
                    </div>
                    {selectedVerdictMeta && (
                      <div className="rd-fact">
                        <span className="rd-fact-key">
                          <Icon name="ph:check-square" width={13} height={13} aria-hidden />
                          Verdict
                        </span>
                        <span className="rd-verdict-pill" data-tone={selectedVerdictMeta.tone}>
                          <Icon name={selectedVerdictMeta.icon} width={11} height={11} aria-hidden />
                          {selectedVerdictMeta.label}
                        </span>
                      </div>
                    )}
                    <div className="rd-fact">
                      <span className="rd-fact-key">
                        <Icon name="ph:clock-counter-clockwise" width={13} height={13} aria-hidden />
                        Updated
                      </span>
                      <span className="rd-fact-val">{relativeTime(selected.session.updated_at)}</span>
                    </div>
                  </div>
                </section>

                {/* jump */}
                <section className="rd-panel rd-card">
                  <div className="rd-card-title">Jump</div>
                  <div className="rd-jump-row">
                    <button
                      type="button"
                      className="rd-jump-btn rd-jump-btn--primary focus-ring"
                      onClick={() => context.openSession(selected.session.id, familiarId)}
                    >
                      <Icon name="ph:play-fill" width={12} height={12} aria-hidden />
                      Open session
                    </button>
                    <button
                      type="button"
                      className="rd-jump-btn rd-jump-btn--ghost focus-ring"
                      disabled={!selectedPrUrl}
                      onClick={() => selectedPrUrl && context.openUrl(selectedPrUrl)}
                    >
                      <Icon name="ph:github-logo" width={13} height={13} aria-hidden />
                      Pull request
                    </button>
                  </div>
                  <p className="rd-hint">
                    The deck reads real git state. It never edits the working tree — verdicts and merges are dispatched
                    to the familiar.
                  </p>
                </section>

                {/* reviewer note */}
                <section className="rd-panel rd-card rd-note-card">
                  <div className="rd-card-title">Reviewer note</div>
                  <textarea
                    className="rd-note"
                    placeholder="Add a note for the familiar…"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    aria-label="Reviewer note for the familiar"
                  />
                </section>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Checkpoints footer ── */}
      <section className="rd-panel rd-checkpoints" aria-label="Checkpoints">
        <button
          type="button"
          className="rd-cp-toggle focus-ring"
          title={state.drawerOpen ? "Collapse checkpoints" : "Expand checkpoints"}
          aria-expanded={state.drawerOpen}
          onClick={() => patch({ drawerOpen: !state.drawerOpen })}
        >
          <span className="rd-cp-caret" data-open={state.drawerOpen ? "true" : "false"}>
            <Icon name="ph:caret-up" width={13} height={13} aria-hidden />
          </span>
          <Icon name="ph:clock-counter-clockwise" width={14} height={14} aria-hidden />
          <span className="rd-eyebrow">Checkpoints</span>
        </button>
        {state.drawerOpen ? (
          <>
            <span className="rd-cp-divider" aria-hidden />
            <div className="rd-cp-list rd-scroll">
              {!projectRoot ? (
                <span className="rd-cp-summary">Select a session to see its project's checkpoints.</span>
              ) : checkpoints == null ? (
                <span className="rd-cp-summary">Loading checkpoints…</span>
              ) : checkpoints.length === 0 ? (
                <span className="rd-cp-summary">
                  No checkpoints saved. Chat's change tools snapshot working trees here before risky edits.
                </span>
              ) : (
                checkpoints.map((checkpoint) => (
                  <span key={checkpoint.name} className="rd-cp-pill" title={checkpoint.name}>
                    <span className="rd-cp-name">{checkpoint.name.replace(/\.patch$/, "")}</span>
                    <span className="rd-cp-date">{relativeTime(checkpoint.savedAt)}</span>
                  </span>
                ))
              )}
            </div>
          </>
        ) : (
          <button type="button" className="rd-cp-summary" onClick={() => patch({ drawerOpen: true })}>
            Saved patches for the selected project — click to browse.
          </button>
        )}
      </section>
    </div>
  );
}
