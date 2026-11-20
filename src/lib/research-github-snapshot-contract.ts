import type { GithubRepoView } from "./research-github-repo.ts";

export type GithubRepoSnapshotInput = {
  owner: string;
  repo: string;
  ref?: string;
  token: string | null;
};
export type GithubRepoSnapshotResult = { ok: true; view: GithubRepoView } | { ok: false };
