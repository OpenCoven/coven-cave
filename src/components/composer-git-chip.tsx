"use client";

import "@/styles/cave-composer.css";

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
//
// The branch segment is also a menu: it lists the repo's local branches
// (?branches=1), switches the checkout with POST action=switch-branch, and can
// provision a `.worktrees/<branch>` checkout (action=create-worktree) that
// opens as a fresh chat rooted in the new worktree — the same
// `cave:agents-new-chat` hand-off the GitHub safe-merge flow uses.

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Icon } from "@/lib/icon";
import { useChangesSummary } from "@/lib/use-changes-summary";
import { isSafeBranchName } from "@/lib/issue-worktree";
import {
  Popover,
  PopoverBody,
  PopoverItem,
  PopoverLabel,
  PopoverSeparator,
  usePopoverEscapeLayer,
} from "@/components/ui/popover";
import { useAnnouncer } from "@/components/ui/live-region";
import "@/styles/composer-git-chip.css";

export type BranchPr = {
  number: number;
  url: string;
  /** gh's PR state: OPEN | MERGED | CLOSED. */
  state: string;
  isDraft: boolean;
};

type PrResponse = { ok?: boolean; pr?: BranchPr | null };

type BranchRow = {
  name: string;
  current: boolean;
  /** Checkout dir basename when some worktree has the branch checked out. */
  worktree: string | null;
  /** Absolute path of that worktree — jump target for "open a chat there". */
  worktreePath?: string | null;
};

/** The branch's PR, fetched once per (projectRoot, branch) — null when the
 *  branch has no PR (or gh is unavailable), undefined while unresolved. */
export function useBranchPr(projectRoot: string | undefined, branch: string | null): BranchPr | null {
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

/**
 * Controlled branch menu — the switch-branch / new-worktree popover half of the
 * git chip, anchored to any caller-owned trigger (the chip's branch button, or
 * the composer context pill). Owns its own list fetch and mutations.
 */
export function GitBranchMenuPopover({
  open,
  onOpenChange,
  anchorRef,
  projectRoot,
  onSwitched,
  pr,
  onOpenPr,
  onOpenChanges,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  /** Repo root the menu operates on (undefined disables everything). */
  projectRoot: string | undefined;
  /** Called after a successful branch switch (e.g. reload the status poll). */
  onSwitched?: () => void;
  /** Optional footer rows (post-hub grammar, cave-g21f): the branch's PR… */
  pr?: BranchPr | null;
  /** …opened via the host's URL handler… */
  onOpenPr?: (url: string) => void;
  /** …and the Git-changes drill-through. */
  onOpenChanges?: () => void;
}) {
  const root = projectRoot?.trim() ? projectRoot : undefined;
  const menuOpen = open;
  const [rows, setRows] = useState<BranchRow[] | null>(null);
  const [menuBusy, setMenuBusy] = useState(false);
  const [menuError, setMenuError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newBranch, setNewBranch] = useState("");
  const { announce } = useAnnouncer();

  // Escape while the inline new-branch form is open backs out to the menu
  // (deepest-first, like a submenu) instead of dismissing the whole popover.
  usePopoverEscapeLayer(menuOpen && creating, () => {
    setCreating(false);
    setNewBranch("");
    requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(".ui-popover")
        ?.querySelector<HTMLElement>("button:not(:disabled)")
        ?.focus();
    });
  });

  // One branch-list fetch per menu open — the list is only as fresh as the
  // moment the menu opened, which is exactly when it's read.
  useEffect(() => {
    if (!menuOpen || !root) return;
    let cancelled = false;
    setRows(null);
    setMenuError(null);
    void (async () => {
      try {
        const res = await fetch(
          `/api/changes?projectRoot=${encodeURIComponent(root)}&branches=1`,
          { cache: "no-store" },
        );
        const json = (await res.json()) as { ok?: boolean; error?: string; branches?: BranchRow[] };
        if (cancelled) return;
        if (!res.ok || !json.ok || !Array.isArray(json.branches)) {
          throw new Error(json.error ?? `branches HTTP ${res.status}`);
        }
        setRows(json.branches);
      } catch (err) {
        if (!cancelled) {
          setRows([]);
          setMenuError(err instanceof Error ? err.message : "couldn't list branches");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [menuOpen, root]);

  const closeMenu = () => {
    onOpenChange(false);
    setCreating(false);
    setNewBranch("");
    setMenuError(null);
  };

  const switchBranch = async (name: string) => {
    if (!root || menuBusy) return;
    setMenuBusy(true);
    setMenuError(null);
    try {
      const res = await fetch("/api/changes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectRoot: root, action: "switch-branch", branch: name }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string; branch?: string };
      if (!res.ok || !json.ok) throw new Error(json.error ?? `switch HTTP ${res.status}`);
      closeMenu();
      announce(`Switched to branch ${name}.`);
      onSwitched?.();
    } catch (err) {
      setMenuError(err instanceof Error ? err.message : "branch switch failed");
    } finally {
      setMenuBusy(false);
    }
  };

  const createWorktree = async () => {
    if (!root || menuBusy) return;
    const name = newBranch.trim();
    if (!isSafeBranchName(name)) {
      setMenuError("Branch names use letters, digits and . _ / - (no leading dash).");
      return;
    }
    setMenuBusy(true);
    setMenuError(null);
    try {
      const res = await fetch("/api/changes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectRoot: root, action: "create-worktree", branch: name }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        worktree?: string;
        branch?: string;
        created?: boolean;
      };
      if (!res.ok || !json.ok || !json.worktree) {
        throw new Error(json.error ?? `worktree HTTP ${res.status}`);
      }
      closeMenu();
      announce(
        `Worktree ${json.created === false ? "reused" : "created"} for ${json.branch ?? name} — opening a chat there.`,
      );
      // Hand off to a fresh chat rooted in the worktree — the same event the
      // GitHub safe-merge flow uses, so routing/familiar defaults match.
      window.dispatchEvent(
        new CustomEvent("cave:agents-new-chat", {
          detail: { projectRoot: json.worktree },
        }),
      );
    } catch (err) {
      setMenuError(err instanceof Error ? err.message : "worktree creation failed");
    } finally {
      setMenuBusy(false);
    }
  };

  const openWorktreeChat = (row: BranchRow) => {
    const target = row.worktreePath;
    if (!target) return;
    closeMenu();
    announce(`Opening a chat in worktree ${row.worktree ?? row.name}.`);
    window.dispatchEvent(
      new CustomEvent("cave:agents-new-chat", {
        detail: { projectRoot: target },
      }),
    );
  };

  return (
    <Popover
      open={menuOpen}
      onOpenChange={(next) => {
        if (!next) closeMenu();
        else onOpenChange(true);
      }}
      anchorRef={anchorRef}
      placement="top-start"
      minWidth={240}
      ariaLabel="Switch branch"
    >
      <PopoverBody role="menu" ariaLabel="Branches">
        <PopoverLabel>Switch branch</PopoverLabel>
        {rows === null ? (
          <div className="cave-composer-git-chip__menu-note">Loading branches…</div>
        ) : (
          <>
            {rows.map((row) => {
              // A branch living in another worktree can't be switched to here,
              // but it IS one click from useful: jump into a chat rooted there.
              const jumpable = !row.current && row.worktree !== null && !!row.worktreePath;
              return (
                <PopoverItem
                  key={row.name}
                  icon={jumpable ? "ph:tree-structure" : "ph:git-branch"}
                  checked={row.current}
                  disabled={menuBusy || row.current || (row.worktree !== null && !jumpable)}
                  title={
                    jumpable
                      ? `Open a chat in worktree ${row.worktree}`
                      : row.worktree && !row.current
                        ? `Checked out in worktree ${row.worktree}`
                        : row.current
                          ? "Current branch"
                          : `Switch to ${row.name}`
                  }
                  onSelect={() => {
                    if (jumpable) openWorktreeChat(row);
                    else void switchBranch(row.name);
                  }}
                >
                  {row.name}
                  {row.worktree && !row.current ? ` · ${row.worktree}` : ""}
                </PopoverItem>
              );
            })}
            {rows.length === 0 && !menuError ? (
              <div className="cave-composer-git-chip__menu-note">No local branches</div>
            ) : null}
          </>
        )}
        <PopoverSeparator />
        {creating ? (
          <form
            className="cave-composer-git-chip__worktree-form"
            onSubmit={(event) => {
              event.preventDefault();
              void createWorktree();
            }}
          >
            <input
              type="text"
              className="cave-composer-git-chip__worktree-input focus-ring"
              placeholder="feat/my-branch"
              aria-label="New worktree branch name"
              value={newBranch}
              onChange={(event) => setNewBranch(event.target.value)}
              disabled={menuBusy}
              autoFocus
            />
            <button
              type="submit"
              className="cave-composer-git-chip__worktree-create focus-ring"
              disabled={menuBusy || !newBranch.trim()}
            >
              {menuBusy ? "Creating…" : "Create"}
            </button>
          </form>
        ) : (
          <PopoverItem
            icon="ph:tree-structure"
            disabled={menuBusy}
            title="Create a .worktrees/<branch> checkout and open a chat rooted in it"
            onSelect={() => setCreating(true)}
          >
            New worktree…
          </PopoverItem>
        )}
        {pr || onOpenChanges ? <PopoverSeparator /> : null}
        {pr ? (
          <PopoverItem
            icon="ph:git-pull-request"
            title={`Open PR #${pr.number} (${pr.isDraft ? "draft" : pr.state.toLowerCase()})`}
            onSelect={() => {
              closeMenu();
              onOpenPr?.(pr.url);
            }}
          >
            Open PR #{pr.number}
          </PopoverItem>
        ) : null}
        {onOpenChanges ? (
          <PopoverItem
            icon="ph:git-diff"
            onSelect={() => {
              closeMenu();
              onOpenChanges();
            }}
          >
            Open Git changes
          </PopoverItem>
        ) : null}
        {menuError ? (
          <div className="cave-composer-git-chip__menu-error" role="alert">
            {menuError}
          </div>
        ) : null}
      </PopoverBody>
    </Popover>
  );
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
  const { loaded, notARepo, branch, count, worktree, reload } = useChangesSummary(root, Boolean(root));
  const pr = useBranchPr(root, branch);
  const branchButtonRef = useRef<HTMLButtonElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

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
  const openChanges = () => {
    window.dispatchEvent(new CustomEvent("cave:changes-open"));
  };
  const onChipKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openChanges();
  };

  return (
    <div
      className="cave-composer-git-chip focus-ring"
      title={`${title} · Open Git changes`}
      data-testid="composer-git-chip"
      role="button"
      tabIndex={0}
      aria-label="Open Git changes for this chat"
      onClick={() => openChanges()}
      onKeyDown={onChipKeyDown}
    >
      <span className="cave-composer-git-chip__branch">
        <Icon name="ph:git-branch" width={12} aria-hidden />
        <button
          type="button"
          ref={branchButtonRef}
          className="cave-composer-git-chip__branch-button focus-ring"
          aria-label={`Branch: ${branch} — switch branch or create a worktree`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title={`Branch: ${branch} · Switch branch / new worktree`}
          onClick={(event) => {
            event.stopPropagation();
            setMenuOpen((open) => !open);
          }}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <span className="cave-composer-git-chip__label">{branch}</span>
          <Icon name="ph:caret-down" width={9} aria-hidden />
        </button>
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
          onClick={(event) => {
            event.stopPropagation();
            if (onOpenUrl) onOpenUrl(pr.url);
            else window.open(pr.url, "_blank", "noopener,noreferrer");
          }}
        >
          <Icon name="ph:git-pull-request" width={11} aria-hidden />
          <span>#{pr.number}</span>
        </button>
      ) : null}
      <GitBranchMenuPopover
        open={menuOpen}
        onOpenChange={setMenuOpen}
        anchorRef={branchButtonRef}
        projectRoot={root}
        onSwitched={reload}
      />
    </div>
  );
}
