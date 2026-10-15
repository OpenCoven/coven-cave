import type { GithubRepoSnapshotInput, GithubRepoSnapshotResult } from "../research-github-snapshot-contract.ts";
export const researchHostContractVersion: number = 1;
export async function dispatchResearchRequest(
  _route: string,
  _method: string,
  _request: Request,
  _context?: unknown,
): Promise<Response> {
  return Response.json({ ok: false, code: 'research-not-installed', error: 'Research is not installed' }, { status: 503 });
}
export async function startResearchRuntime(): Promise<void> {}

export async function fetchGithubRepoSnapshot(_input: GithubRepoSnapshotInput): Promise<GithubRepoSnapshotResult> {
  return { ok: false };
}
