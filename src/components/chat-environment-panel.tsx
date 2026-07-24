"use client";

// ChatEnvironmentPanel (cave-68vv) — a floating "Environment" HUD pinned to
// the top-right of the chat transcript on LARGER-WIDTH chat panes, emulating
// the environment card modern coding UIs float beside a wide conversation:
//
//   Environment                    ×
//   ⇄ Changes              +128 −42
//   🖥 Local                 · wt-name
//   ⎇ fix/some-branch              ▾
//   ◦ Commit or push
//   ⑂ Create pull request / PR #N
//
// Design constraints:
// - Data rides EXISTING pollers: the shared /api/changes summary gate
//   (useChangesSummary — one real request per root per 5s window) and the
//   one-shot per-(root, branch) PR probe (useBranchPr). No new endpoints.
// - Rows LAUNCH existing surfaces instead of duplicating them: Changes /
//   Commit / Create-PR dispatch "cave:changes-open" (the code rail's Changes
//   tab owns the diff list, commit composer, and PR form), and the branch row
//   anchors the shared GitBranchMenuPopover from the composer git chip.
// - The panel hides while the inline code rail is open
//   (cave:code-rail-visibility) — the rail is the full surface this HUD
//   abbreviates — and on panes narrower than ENV_PANEL_MIN_WIDTH (2xl), where
//   the card would overlap the conversation column instead of floating in the
//   spare margin (the composer git chip already carries the context there).
// - Width gating measures the panel's own sticky wrapper (which spans the
//   transcript content box), so split panes gate independently and no
//   ancestor needs container-type containment.

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import { useChangesSummary } from "@/lib/use-changes-summary";
import {
  GitBranchMenuPopover,
  useBranchPr,
} from "@/components/composer-git-chip";
import {
  environmentLabel,
  prRowAction,
  resolveEnvPanelVisible,
} from "@/lib/chat-environment-panel-model";

/** Versioned so a future shape change can't misread stale persisted state. */
export const ENV_PANEL_COLLAPSED_KEY = "cave:chat-env-panel:collapsed:v1";

const ROW_CLASS =
  "focus-ring flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[length:var(--text-xs)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]";

type Props = {
  /** The session's project root (session.project_root over the surface fallback, cave-r0gt). */
  projectRoot: string | null;
  /** The conversation's recorded runtime ("local:<cwd>" | "ssh:<host>:<cwd>"). */
  runtime?: string | null;
  hasTurns: boolean;
  onOpenUrl?: (url: string) => void;
};

export function ChatEnvironmentPanel({ projectRoot, runtime, hasTurns, onOpenUrl }: Props) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const branchBtnRef = useRef<HTMLButtonElement | null>(null);
  const [paneWidth, setPaneWidth] = useState<number | null>(null);
  const [railOpen, setRailOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [branchMenuOpen, setBranchMenuOpen] = useState(false);

  // Measure the sticky wrapper — it spans the transcript content box, so its
  // width IS the pane measure the visibility gate wants.
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const measure = () => setPaneWidth(el.offsetWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Inline code-rail visibility (chat-surface broadcasts on every change; the
  // panel mounts before the surface's dispatch effect runs, so the initial
  // state also arrives through this listener).
  useEffect(() => {
    const onVisibility = (event: Event) => {
      const detail = (event as CustomEvent<{ open?: boolean }>).detail;
      setRailOpen(Boolean(detail?.open));
    };
    window.addEventListener("cave:code-rail-visibility", onVisibility);
    return () => window.removeEventListener("cave:code-rail-visibility", onVisibility);
  }, []);

  // Hydrate the collapse preference after mount (SSR-safe).
  useEffect(() => {
    setCollapsed(window.localStorage.getItem(ENV_PANEL_COLLAPSED_KEY) === "true");
  }, []);

  const root = projectRoot?.trim() ? projectRoot : undefined;
  // The summary poll is `active`-gated: narrow panes, rail-open layouts and
  // turnless chats skip it entirely (the shared gate already serves the
  // composer chip's poll when both are live).
  const measured = paneWidth != null;
  const summaryActive = Boolean(root) && hasTurns && measured && !railOpen;
  const { totals, count, loaded, notARepo, branch, worktree, reload } = useChangesSummary(
    root,
    summaryActive,
  );

  const visible = resolveEnvPanelVisible({
    paneWidth,
    hasRepo: Boolean(root),
    loaded,
    notARepo,
    railOpen,
    hasTurns,
  });

  // One PR probe per (root, branch), and only once the panel actually shows.
  const pr = useBranchPr(visible ? root : undefined, branch);
  const prRow = prRowAction(pr);

  const setCollapsedPersist = (next: boolean) => {
    setCollapsed(next);
    try {
      window.localStorage.setItem(ENV_PANEL_COLLAPSED_KEY, String(next));
    } catch {
      /* storage unavailable — session-only collapse */
    }
  };

  const openChanges = () => {
    window.dispatchEvent(new CustomEvent("cave:changes-open"));
  };

  const openPrUrl = (url: string) => {
    if (onOpenUrl) onOpenUrl(url);
    else window.open(url, "_blank", "noopener,noreferrer");
  };

  const envLabel = environmentLabel(runtime);

  return (
    <div
      ref={wrapperRef}
      data-chat-env-panel
      className="pointer-events-none sticky top-0 z-30 flex h-0 w-full justify-end"
    >
      {!visible ? null : collapsed ? (
        <button
          type="button"
          className="focus-ring pointer-events-auto mt-0.5 flex items-center gap-1.5 rounded-full border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-2.5 py-1 text-[length:var(--text-2xs)] text-[var(--text-muted)] shadow-md backdrop-blur-md transition-colors hover:text-[var(--text-primary)]"
          aria-expanded={false}
          aria-label="Show environment panel"
          onClick={() => setCollapsedPersist(false)}
        >
          <Icon name="ph:stack" width={12} aria-hidden />
          Environment
        </button>
      ) : (
        <section
          aria-label="Environment"
          // Explicit card bg + blur: translucent themes / backdrop mode give
          // --bg-raised alpha, and a see-through HUD ghosts the transcript
          // underneath. The gradient pins an opaque --bg-base floor under the
          // raised tint; the blur keeps it frosted if even the floor carries
          // alpha.
          className="pointer-events-auto flex w-[240px] flex-col rounded-xl border border-[var(--border-hairline)] shadow-lg backdrop-blur-md [background:linear-gradient(var(--bg-raised),_var(--bg-raised)),_var(--bg-base)]!"
        >
          <header className="flex items-center justify-between px-3 pb-1 pt-2">
            <span className="text-[length:var(--text-2xs)] font-medium uppercase tracking-wide text-[var(--text-muted)]">
              Environment
            </span>
            <button
              type="button"
              className="focus-ring rounded p-0.5 text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
              aria-label="Collapse environment panel"
              title="Collapse environment panel"
              onClick={() => setCollapsedPersist(true)}
            >
              <Icon name="ph:x" width={11} aria-hidden />
            </button>
          </header>
          <div className="flex flex-col gap-px px-1.5 pb-1.5">
            <button
              type="button"
              className={`${ROW_CLASS} bg-[var(--bg-hover)]/60`}
              title={`${count} changed file${count === 1 ? "" : "s"} — open the Changes panel`}
              onClick={openChanges}
            >
              <Icon name="ph:git-diff" width={13} aria-hidden className="shrink-0" />
              <span className="min-w-0 flex-1 truncate">Changes</span>
              <span className="shrink-0 font-mono text-[length:var(--text-2xs)]">
                <span className="text-[var(--color-success)]">+{totals.additions.toLocaleString()}</span>{" "}
                <span className="text-[var(--color-danger)]">−{totals.deletions.toLocaleString()}</span>
              </span>
            </button>
            <div
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[length:var(--text-xs)] text-[var(--text-secondary)]"
              title={root}
            >
              <Icon name="ph:desktop" width={13} aria-hidden className="shrink-0" />
              <span className="min-w-0 flex-1 truncate">{envLabel}</span>
              {worktree ? (
                <span className="shrink-0 truncate font-mono text-[length:var(--text-2xs)] text-[var(--text-muted)]">
                  {worktree}
                </span>
              ) : null}
            </div>
            {branch ? (
              <button
                type="button"
                ref={branchBtnRef}
                className={ROW_CLASS}
                aria-haspopup="menu"
                aria-expanded={branchMenuOpen}
                title={`On ${branch} — switch branch or create a worktree`}
                onClick={() => setBranchMenuOpen((open) => !open)}
              >
                <Icon name="ph:git-branch" width={13} aria-hidden className="shrink-0" />
                <span className="min-w-0 flex-1 truncate font-mono">{branch}</span>
                <Icon name="ph:caret-down" width={11} aria-hidden className="shrink-0 text-[var(--text-muted)]" />
              </button>
            ) : null}
            <button
              type="button"
              className={ROW_CLASS}
              title="Open the Changes panel to commit or push"
              onClick={openChanges}
            >
              <Icon name="ph:git-commit" width={13} aria-hidden className="shrink-0" />
              <span className="min-w-0 flex-1 truncate">Commit or push</span>
            </button>
            <button
              type="button"
              className={ROW_CLASS}
              title={
                prRow.kind === "view"
                  ? `Open ${prRow.label}`
                  : "Open the Changes panel to create a pull request"
              }
              onClick={() => {
                if (prRow.kind === "view") openPrUrl(prRow.url);
                else openChanges();
              }}
            >
              <Icon name="ph:git-pull-request" width={13} aria-hidden className="shrink-0" />
              <span className="min-w-0 flex-1 truncate">{prRow.label}</span>
              {prRow.kind === "view" ? (
                <Icon name="ph:arrow-square-out" width={11} aria-hidden className="shrink-0 text-[var(--text-muted)]" />
              ) : null}
            </button>
          </div>
          <GitBranchMenuPopover
            open={branchMenuOpen}
            onOpenChange={setBranchMenuOpen}
            anchorRef={branchBtnRef}
            projectRoot={root}
            onSwitched={reload}
          />
        </section>
      )}
    </div>
  );
}
