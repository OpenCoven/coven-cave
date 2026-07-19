"use client";

import { Icon, type IconName } from "@/lib/icon";
import type { SessionPrStatus } from "@/lib/session-pr-status";

/**
 * StatusBar — the quiet bottom strip of the Home/Chat detail column
 * (chat-revamp phase D). Left: display-only context chips for the active
 * session (project · model · git branch · cwd). Right: the session's PR
 * status (accent dot + "PR #N · state", only when a PR is attached) and an
 * always-available Tasks chip with the live open-task count.
 *
 * Left chips are deliberately NON-interactive for now (no chevron, no
 * pointer — per the design rule that display-only chips must not pretend to
 * be pickers); the PR and Tasks chips are real buttons. Data flows in from
 * workspace.tsx (active session row + boardTaskCount); surfaces without a
 * session simply omit the session chips.
 */

export type StatusBarProps = {
  /** Registered-project display name for the active session's root, if any. */
  projectName?: string | null;
  model?: string | null;
  branch?: string | null;
  /** Active session working directory (project root). Shown shortened; the
   *  full path lives in the chip title. */
  cwd?: string | null;
  /** Derived PR badge (lib/session-pr-status) — omitted → no PR chip. */
  pr?: SessionPrStatus | null;
  taskCount: number;
  onViewTasks: () => void;
  onOpenPr?: (url: string) => void;
};

/** Compact tail of a filesystem path — "…/<basename>"; full path in title. */
export function shortCwd(root: string): string {
  const parts = root.replace(/\\/g, "/").replace(/\/+$/, "").split("/").filter(Boolean);
  if (parts.length <= 1) return root;
  return `…/${parts[parts.length - 1]}`;
}

function InfoChip({ icon, label, title }: { icon: IconName; label: string; title?: string }) {
  // Display-only: a span, not a button — no pointer cursor, no chevron.
  return (
    <span className="status-bar__chip" title={title ?? label}>
      <Icon name={icon} width="var(--icon-xs)" height="var(--icon-xs)" aria-hidden />
      <span className="status-bar__chip-label">{label}</span>
    </span>
  );
}

export function StatusBar({
  projectName,
  model,
  branch,
  cwd,
  pr,
  taskCount,
  onViewTasks,
  onOpenPr,
}: StatusBarProps) {
  const tasksLabel = taskCount > 0 ? `Open tasks — ${taskCount} open` : "Open tasks";
  const prBody = (
    <>
      <span className="status-bar__dot" aria-hidden />
      {pr?.label}
    </>
  );
  return (
    <footer className="status-bar" aria-label="Workspace status">
      <div className="status-bar__lead">
        {projectName ? <InfoChip icon="ph:folder" label={projectName} title={`Project — ${projectName}`} /> : null}
        {model ? <InfoChip icon="ph:sparkle" label={model} title={`Model — ${model}`} /> : null}
        {branch ? <InfoChip icon="ph:git-branch" label={branch} title={`Branch — ${branch}`} /> : null}
        {cwd ? <InfoChip icon="ph:folder-open" label={shortCwd(cwd)} title={`Working directory — ${cwd}`} /> : null}
      </div>
      <div className="status-bar__trail">
        {pr ? (
          onOpenPr ? (
            <button
              type="button"
              className="status-bar__chip status-bar__chip--pr status-bar__chip--action focus-ring"
              title={`${pr.label} — open on GitHub`}
              onClick={() => onOpenPr(pr.url)}
            >
              {prBody}
            </button>
          ) : (
            <span className="status-bar__chip status-bar__chip--pr" title={pr.label}>
              {prBody}
            </span>
          )
        ) : null}
        <button
          type="button"
          className="status-bar__chip status-bar__chip--action status-bar__chip--tasks focus-ring"
          onClick={onViewTasks}
          aria-label={tasksLabel}
          title={tasksLabel}
        >
          Tasks
          {taskCount > 0 ? (
            <span className="status-bar__count" aria-hidden>
              {taskCount > 99 ? "99+" : taskCount}
            </span>
          ) : null}
        </button>
      </div>
    </footer>
  );
}
