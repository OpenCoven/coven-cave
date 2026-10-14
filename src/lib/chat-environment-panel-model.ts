// Pure model for the chat Environment popover (cave-68vv, #5958) — anchored
// to the composer's branch chip, it abbreviates the code rail: change totals,
// execution environment, branch, and outbound actions (commit / pull request).
// The file keeps its name: use-changes-summary.ts imports sumFileTotals.
//
// Framework-free on purpose (same split as code-rail.ts / use-code-rail.ts):
// environment labelling, PR-row shape, and diffstat summing are all testable
// under plain `node --test` without React.

import { parseConversationRuntime } from "./chat-hosts.ts";

/**
 * Execution-environment label for the panel's "where does this chat run" row:
 * the ssh host for remote runtimes, "Local" for local/unknown/absent ones
 * (a chat with no recorded runtime executes locally).
 */
export function environmentLabel(runtime: string | null | undefined): string {
  const parsed = parseConversationRuntime(runtime);
  return parsed?.kind === "ssh" ? parsed.host : "Local";
}

/** The branch-PR shape the popover consumes (mirrors composer-git-chip's BranchPr). */
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
 * Sum per-file numstat counts from the /api/changes summary into the popover's
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
