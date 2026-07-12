"use client";

// ComposerGitChip — the chat composer's git context strip: when the chat's
// project root is a git repo, show the current branch, a dirty-file count, a
// linked-worktree marker, and (when one exists) the branch's pull request —
// the same at-a-glance context a modern coding CLI prints in its status line.
//
// Branch / worktree / dirty count ride the existing /api/changes status poll
// via useChangesSummary (5s, visibility-gated, single-flight). The PR lookup
// is network-bound (`gh pr view`), so it's fetched once per (root, branch)
// through the separate `?pr=1` query instead of riding the poll. Chats whose
// root isn't a repo (or have no project root at all) render nothing.

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import { useChangesSummary } from "@/lib/use-changes-summary";
import "@/styles/composer-git-chip.css";

type BranchPr = {
  number: number;
  url: string;
  /** gh's PR state: OPEN | MERGED | CLOSED. */
  state: string;
  isDraft: boolean;
};

type PrResponse = { ok?: boolean; pr?: BranchPr | null };

/** The branch's PR, fetched once per (projectRoot, branch) — null when the
 *  branch has no PR (or gh is unavailable), undefined while unresolved. */
function useBranchPr(projectRoot: string | undefined, branch: string | null): BranchPr | null {
  const [pr, setPr] = useState<BranchPr | null>(null);
  // One fetch per (root, branch) pair — a branch switch refetches, the 5s
  // status poll does not.
  const fetchedKey = useRef<string | null>(null);

  useEffect(() => {
    if (!projectRoot || !branch || branch === "HEAD") {
      fetchedKey.current = null;
      setPr(null);
      return;
    }
    const key = `${projectRoot}\n${branch}`;
    if (fetchedKey.current === key) return;
    fetchedKey.current = key;
    setPr(null);
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/changes?projectRoot=${encodeURIComponent(projectRoot)}&pr=1`,
          { cache: "no-store" },
        );
        const json = (await res.json()) as PrResponse;
        if (cancelled) return;
        const got = json.ok && json.pr && typeof json.pr.number === "number" ? json.pr : null;
        setPr(got);
      } catch {
        /* transient — leave as no-PR */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectRoot, branch]);

  return pr;
}

export function ComposerGitChip({
  projectRoot,
  onOpenUrl,
}: {
  /** The chat's active project root ("" / undefined when no project). */
  projectRoot: string | undefined;
  /** Opens the PR in the app's browser pane; falls back to window.open. */
  onOpenUrl?: (url: string) => void;
}) {
  const root = projectRoot?.trim() ? projectRoot : undefined;
  const { loaded, notARepo, branch, count, worktree } = useChangesSummary(root, Boolean(root));
  const pr = useBranchPr(root, branch);

  // Git-less chats (no project, or a non-repo root) show nothing — the chip
  // only appears once the repo status has actually loaded.
  if (!root || !loaded || notARepo || !branch) return null;

  const dirtyLabel = count > 0 ? `${count} uncommitted change${count === 1 ? "" : "s"}` : "clean";
  const title = [
    `Branch: ${branch}`,
    worktree ? `Worktree: ${worktree}` : null,
    dirtyLabel,
    pr ? `PR #${pr.number} (${pr.isDraft ? "draft" : pr.state.toLowerCase()})` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="cave-composer-git-chip" title={title} data-testid="composer-git-chip">
      <span className="cave-composer-git-chip__branch">
        <Icon name="ph:git-branch" width={12} aria-hidden />
        <span className="cave-composer-git-chip__label" aria-label={`Branch: ${branch}`}>
          {branch}
        </span>
        {count > 0 ? (
          <span className="cave-composer-git-chip__dirty" aria-label={dirtyLabel}>
            +{count}
          </span>
        ) : null}
      </span>
      {worktree ? (
        <span className="cave-composer-git-chip__worktree" aria-label={`Worktree: ${worktree}`}>
          <Icon name="ph:tree-structure" width={11} aria-hidden />
          <span className="cave-composer-git-chip__label">{worktree}</span>
        </span>
      ) : null}
      {pr ? (
        <button
          type="button"
          className="cave-composer-git-chip__pr"
          data-pr-state={pr.isDraft ? "draft" : pr.state.toLowerCase()}
          title={`Open PR #${pr.number} (${pr.isDraft ? "draft" : pr.state.toLowerCase()})`}
          aria-label={`Open pull request #${pr.number}`}
          onClick={() => {
            if (onOpenUrl) onOpenUrl(pr.url);
            else window.open(pr.url, "_blank", "noopener,noreferrer");
          }}
        >
          <Icon name="ph:git-pull-request" width={11} aria-hidden />
          <span>#{pr.number}</span>
        </button>
      ) : null}
    </div>
  );
}
