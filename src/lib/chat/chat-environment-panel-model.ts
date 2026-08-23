// Pure model for the chat Environment panel (cave-68vv) — the floating
// top-right HUD that appears over the transcript on LARGER-WIDTH chat panes
// and abbreviates the code rail: change totals, execution environment,
// branch, and outbound actions (commit / pull request).
//
// Framework-free on purpose (same split as code-rail.ts / use-code-rail.ts):
// the visibility decision, environment labelling, PR-row shape, and diffstat
// summing are all testable under plain `node --test` without React.

import { parseConversationRuntime } from "./chat-hosts.ts";

/**
 * Minimum measured transcript content-box width (px) before the panel shows —
 * matches Tailwind's 2xl breakpoint. The reading column caps at
 * --cave-chat-measure (64rem = 1024px) and centers, so each side margin is
 * (paneWidth − 1024) / 2. The card is 240px wide: at 1536px+ the margin is
 * ≥256px and the panel sits ENTIRELY in the spare margin — it must never
 * overlap conversation content (suggestion chips reach the column edge).
 */
export const ENV_PANEL_MIN_WIDTH = 1536;

export type EnvPanelSignals = {
  /** Measured transcript content-box width; null before the first measure. */
  paneWidth: number | null;
  /** The chat is linked to a project root at all. */
  hasRepo: boolean;
  /** The /api/changes summary settled at least once for this root. */
  loaded: boolean;
  /** The root resolved but is not a git repository. */
  notARepo: boolean;
  /** The inline code rail is open — it's the full surface this HUD abbreviates. */
  railOpen: boolean;
  /** The conversation has visible turns (the empty-state hero stays clean). */
  hasTurns: boolean;
};

/** Single visibility decision for the panel — every gate in one place. */
export function resolveEnvPanelVisible(signals: EnvPanelSignals): boolean {
  const { paneWidth, hasRepo, loaded, notARepo, railOpen, hasTurns } = signals;
  if (!hasTurns || !hasRepo) return false;
  if (paneWidth == null || paneWidth < ENV_PANEL_MIN_WIDTH) return false;
  if (!loaded || notARepo) return false;
  if (railOpen) return false;
  return true;
}

/**
 * Execution-environment label for the panel's "where does this chat run" row:
 * the ssh host for remote runtimes, "Local" for local/unknown/absent ones
 * (a chat with no recorded runtime executes locally).
 */
export function environmentLabel(runtime: string | null | undefined): string {
  const parsed = parseConversationRuntime(runtime);
  return parsed?.kind === "ssh" ? parsed.host : "Local";
}

/** The branch-PR shape the panel consumes (mirrors composer-git-chip's BranchPr). */
export type EnvPanelPr = {
  number: number;
  url: string;
  /** gh's PR state: OPEN | MERGED | CLOSED. */
  state: string;
  isDraft: boolean;
};

export type PrRowAction =
  | { kind: "view"; label: string; url: string }
  | { kind: "create"; label: string };

/**
 * PR row resolution: an OPEN pull request turns the row into a "view" link;
 * anything else (no PR, merged, closed) offers "Create pull request" — a
 * merged/closed PR no longer represents the branch's outbound work.
 */
export function prRowAction(pr: EnvPanelPr | null): PrRowAction {
  if (pr && pr.url && pr.state === "OPEN") {
    return {
      kind: "view",
      label: `Pull request #${pr.number}${pr.isDraft ? " · draft" : ""}`,
      url: pr.url,
    };
  }
  return { kind: "create", label: "Create pull request" };
}

/**
 * Sum per-file numstat counts from the /api/changes summary into the panel's
 * `+N −N` totals. Untracked files carry no counts (git numstat can't see
 * them) and simply don't contribute; malformed entries are skipped.
 */
export function sumFileTotals(files: unknown): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  if (Array.isArray(files)) {
    for (const entry of files) {
      const file = entry as { insertions?: unknown; deletions?: unknown } | null;
      if (typeof file?.insertions === "number" && Number.isFinite(file.insertions)) {
        additions += file.insertions;
      }
      if (typeof file?.deletions === "number" && Number.isFinite(file.deletions)) {
        deletions += file.deletions;
      }
    }
  }
  return { additions, deletions };
}
