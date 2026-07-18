"use client";

/**
 * Reviewer Surface — the Review Deck.
 *
 * Change review over the familiar's real work. Left rail: the review queue —
 * this familiar's sessions that carry review material (a pull request, a
 * nonzero working-tree diff, or a named branch). Center: the selected
 * session's real working-tree changes (`/api/changes`), with per-file unified
 * diffs on demand (capped server-side; truncation shown honestly). Right
 * sidebar: session facts — branch, worktree, PR link, diff stat — and jumps
 * into the session or the PR. Bottom drawer: the deck's saved checkpoints for
 * the selected project root.
 *
 * Everything rendered is real git state read through the Cave's changes API;
 * the deck never mutates a working tree. Panels with nothing to show say so.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@/lib/icon";
import type { RoleSurfaceContext } from "@/lib/role-surfaces";
import { useRoleSurfaceState } from "@/lib/role-surface-state";
import { relativeTime } from "@/lib/relative-time";
import { diffStatLabel, prLabel, prUrl, reviewQueue } from "./review-deck";
import { RailSection, SurfaceCanvas, SurfaceEmpty, SurfaceRail, SurfaceRoom } from "./surface-room";
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

export function ReviewerSurface({ context }: { context: RoleSurfaceContext }) {
  const familiarId = context.activeFamiliar.id;
  const [state, patch] = useRoleSurfaceState<ReviewerState>(familiarId, REVIEWER_SURFACE_ID, REVIEWER_INITIAL_STATE);

  // ── The review queue: real sessions with review material ──────────────────
  const queue = useMemo(() => reviewQueue(context.runtimeState.sessions), [context.runtimeState.sessions]);
  useEffect(() => {
    const counts = {
      queue: queue.length,
      pullRequests: queue.filter((item) => item.reasons.includes("pull-request")).length,
    };
    if (state.lastCounts?.queue === counts.queue && state.lastCounts?.pullRequests === counts.pullRequests) return;
    patch({ lastCounts: counts });
  }, [queue, state.lastCounts, patch]);

  const selected = useMemo(
    () => queue.find((item) => item.session.id === state.selectedSessionId) ?? null,
    [queue, state.selectedSessionId],
  );
  const projectRoot = selected?.session.project_root ?? null;

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
  useEffect(() => {
    setOpenFile(null);
    setDiff(null);
  }, [projectRoot]);
  const showDiff = async (relPath: string) => {
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
  };

  // ── Saved checkpoints for the selected root (drawer) ───────────────────────
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

  const selectedPrUrl = prUrl(selected?.session.pullRequest);
  const repoFiles = changes?.ok && changes.repo ? changes.files : [];

  return (
    <SurfaceRoom
      accentHue={0}
      drawerTitle="Checkpoints"
      drawerOpen={state.drawerOpen}
      onToggleDrawer={() => patch({ drawerOpen: !state.drawerOpen })}
      drawer={
        <div className="role-surface-drawer-grid">
          <RailSection title="Saved checkpoints" iconName="ph:bookmark-simple">
            {!projectRoot ? (
              <SurfaceEmpty title="Select a session to see its project's checkpoints." />
            ) : checkpoints == null ? (
              <SurfaceEmpty title="Loading checkpoints…" />
            ) : checkpoints.length === 0 ? (
              <SurfaceEmpty
                title="No checkpoints saved."
                hint="Chat's change tools snapshot working trees here before risky edits."
              />
            ) : (
              <ul className="role-surface-list" aria-label="Saved checkpoints">
                {checkpoints.map((checkpoint) => (
                  <li key={checkpoint.name} className="role-surface-list-row">
                    <span className="role-surface-memory-path">{checkpoint.name}</span>
                    <span className="role-surface-tag">{relativeTime(checkpoint.savedAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </RailSection>
        </div>
      }
    >
      <SurfaceRail side="left" label="Review queue">
        <RailSection title="Review queue" iconName="ph:git-diff">
          {queue.length === 0 ? (
            <SurfaceEmpty
              title="Deck clear."
              hint="Sessions with a pull request, working changes, or a branch appear here."
            />
          ) : (
            <ul className="role-surface-list" aria-label="Sessions to review">
              {queue.slice(0, 30).map((item) => (
                <li key={item.session.id}>
                  <button
                    type="button"
                    className={`role-surface-row-btn focus-ring-inset${item.session.id === state.selectedSessionId ? " role-surface-row-btn--active" : ""}`}
                    aria-current={item.session.id === state.selectedSessionId ? "true" : undefined}
                    onClick={() => patch({ selectedSessionId: item.session.id })}
                  >
                    {item.session.title || item.session.id}
                    {item.reasons.includes("pull-request") && <span className="role-surface-tag">PR</span>}
                    <span className="role-surface-tag">{diffStatLabel(item.session.diff)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </RailSection>
      </SurfaceRail>

      <SurfaceCanvas label="Working-tree changes">
        <div className="role-surface-canvas-stack">
          {changesError ? (
            <div role="alert" className="role-surface-hint">
              {changesError}{" "}
              <button type="button" className="role-surface-chip focus-ring" onClick={() => void loadChanges()}>
                Try again
              </button>
            </div>
          ) : null}
          {!selected ? (
            <SurfaceEmpty
              iconName="ph:git-diff"
              title="Pick a session from the queue."
              hint="Its project's real working-tree changes are read on selection."
            />
          ) : changes == null && changesError == null ? (
            <SurfaceEmpty title="Reading the working tree…" />
          ) : changes?.ok && !changes.repo ? (
            <SurfaceEmpty title="Not a git repository." hint="This session's project root has no repo to review." />
          ) : changes?.ok && changes.repo && repoFiles.length === 0 ? (
            <SurfaceEmpty title="Working tree clean." hint="No uncommitted changes at this project root." />
          ) : changes?.ok && changes.repo ? (
            <>
              <ul className="role-surface-list" aria-label="Changed files">
                {repoFiles.slice(0, 80).map((file) => (
                  <li key={file.path}>
                    <button
                      type="button"
                      className={`role-surface-row-btn focus-ring-inset${openFile === file.path ? " role-surface-row-btn--active" : ""}`}
                      aria-expanded={openFile === file.path}
                      onClick={() => void showDiff(file.path)}
                    >
                      <span className="role-surface-memory-path">{file.path}</span>
                      <span className="role-surface-tag">{file.status}</span>
                      {(file.insertions != null || file.deletions != null) && (
                        <span className="role-surface-tag">
                          +{file.insertions ?? 0} −{file.deletions ?? 0}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
              {openFile != null && (
                <section aria-label={`Diff for ${openFile}`}>
                  {diffLoading ? (
                    <SurfaceEmpty title="Loading diff…" />
                  ) : diff && diff.text ? (
                    <>
                      {diff.truncated && (
                        <p className="role-surface-hint">Diff truncated server-side — showing the first part only.</p>
                      )}
                      <pre className="role-surface-content">{diff.text}</pre>
                    </>
                  ) : (
                    <SurfaceEmpty title="No diff to show." />
                  )}
                </section>
              )}
            </>
          ) : null}
        </div>
      </SurfaceCanvas>

      <SurfaceRail side="right" label="Session details">
        {!selected ? (
          <RailSection title="Details" iconName="ph:note">
            <SurfaceEmpty title="Select a session to review it." />
          </RailSection>
        ) : (
          <>
            <RailSection title="Under review" iconName="ph:note">
              <p className="role-surface-memory-path">{selected.session.title || selected.session.id}</p>
              <dl className="role-surface-facts">
                <dt>Branch</dt>
                <dd>{selected.session.git?.branch ?? (changes?.ok && changes.repo ? changes.branch : null) ?? "—"}</dd>
                {changes?.ok && changes.repo && changes.worktree && (
                  <>
                    <dt>Worktree</dt>
                    <dd>{changes.worktree}</dd>
                  </>
                )}
                <dt>Working changes</dt>
                <dd>{diffStatLabel(selected.session.diff)}</dd>
                <dt>Pull request</dt>
                <dd>{prLabel(selected.session.pullRequest) ?? "None"}</dd>
                <dt>Status</dt>
                <dd>{selected.session.status}</dd>
                <dt>Updated</dt>
                <dd>{relativeTime(selected.session.updated_at)}</dd>
              </dl>
            </RailSection>
            <RailSection title="Jump" iconName="ph:arrow-bend-up-right">
              <div className="role-surface-btn-row">
                <button
                  type="button"
                  className="role-surface-chip role-surface-chip--accent focus-ring"
                  onClick={() => context.openSession(selected.session.id, familiarId)}
                >
                  Open session
                </button>
                {selectedPrUrl && (
                  <button
                    type="button"
                    className="role-surface-chip focus-ring"
                    onClick={() => context.openUrl(selectedPrUrl)}
                  >
                    Open pull request
                    <Icon name="ph:arrow-square-out" width={12} height={12} aria-hidden />
                  </button>
                )}
              </div>
              <p className="role-surface-hint">The deck reads real git state; it never edits the working tree.</p>
            </RailSection>
          </>
        )}
      </SurfaceRail>
    </SurfaceRoom>
  );
}
