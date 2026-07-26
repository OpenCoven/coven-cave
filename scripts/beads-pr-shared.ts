// Shared plumbing for the Beads PR tooling (bridge + patrol): one source of
// truth for the gh field list the lane classifier depends on, and for how a
// PR's state is mirrored into its linked beads.
import { execFileSync } from "node:child_process";
import {
  prStateNote,
  type GitHubPullRequestInput,
  type PullRequestSummary,
} from "../src/lib/beads-pr-management.ts";

export type BeadUpdate = {
  id: string;
  pr: number;
  url: string;
  note: string;
  applied: boolean;
};

const GH_PR_FIELDS = [
  "number",
  "title",
  "url",
  "isDraft",
  "headRefName",
  "baseRefName",
  "mergeStateStatus",
  "reviewDecision",
  "statusCheckRollup",
  "updatedAt",
  "body",
  "labels",
].join(",");

export function ghPrList(repo: string, limit = "100"): GitHubPullRequestInput[] {
  const stdout = execFileSync(
    "gh",
    ["pr", "list", "--repo", repo, "--state", "open", "--limit", limit, "--json", GH_PR_FIELDS],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  const parsed = JSON.parse(stdout) as unknown;
  if (!Array.isArray(parsed)) throw new Error("gh pr list returned non-array JSON");
  return parsed as GitHubPullRequestInput[];
}

export function planBeadUpdates(summaries: PullRequestSummary[]): BeadUpdate[] {
  const updates: BeadUpdate[] = [];
  for (const summary of summaries) {
    const note = prStateNote(summary);
    for (const id of summary.beadIds) {
      updates.push({ id, pr: summary.number, url: summary.url, note, applied: false });
    }
  }
  return updates;
}

export function applyBeadUpdate(update: BeadUpdate): BeadUpdate {
  execFileSync("bd", ["update", update.id, "--external-ref", update.url, "--append-notes", update.note], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { ...update, applied: true };
}
