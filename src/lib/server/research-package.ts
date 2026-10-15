import type { GithubRepoSnapshotInput, GithubRepoSnapshotResult } from "../research-github-snapshot-contract.ts";
import { researchCapability, type ResearchCapability } from '../research-capability.ts';
import { rejectNonLocalRequest, rejectResearchMediaRequest, rejectResearchRunStreamRequest } from './api-security.ts';

type Runtime = typeof import('./research-package-absent.ts');
type Loader = () => Promise<Runtime>;
const loadRuntime: Loader = () => import('@opencoven/research-runtime');

export function researchUnavailable(capability: ResearchCapability): Response {
  return Response.json({
    ok: false,
    code: capability.available ? 'research-disabled' : 'research-not-installed',
    error: capability.available ? 'Research is disabled' : 'Research is not installed',
  }, { status: 503 });
}

export async function dispatchResearchRequest(
  route: string,
  method: string,
  request: Request,
  context?: unknown,
  capability = researchCapability(),
  load: Loader = loadRuntime,
): Promise<Response> {
  // Preserve the existing narrow credentials for native media and SSE reads.
  // All other routes and methods retain the ordinary local-request guard.
  const forbidden = method === 'GET' && route === 'research/generations/media'
    ? await rejectResearchMediaRequest(request)
    : method === 'GET' && route === 'research/runs/[id]/stream'
      ? rejectResearchRunStreamRequest(request)
      : rejectNonLocalRequest(request);
  if (forbidden) return forbidden;
  if (!capability.enabled) return researchUnavailable(capability);
  const runtime = await load();
  if (runtime.researchHostContractVersion !== 1) throw new Error('Unsupported Research host contract');
  return runtime.dispatchResearchRequest(route, method, request, context);
}

export async function startOptionalResearch(
  capability = researchCapability(),
  load: Loader = loadRuntime,
): Promise<void> {
  if (!capability.enabled) return;
  const runtime = await load();
  if (runtime.researchHostContractVersion !== 1) throw new Error('Unsupported Research host contract');
  await runtime.startResearchRuntime();
}

export async function fetchOptionalGithubRepoView(
  input: GithubRepoSnapshotInput,
  capability = researchCapability(),
  load: Loader = loadRuntime,
): Promise<GithubRepoSnapshotResult> {
  if (!capability.enabled) return { ok: false };
  const runtime = await load();
  if (runtime.researchHostContractVersion !== 1) throw new Error('Unsupported Research host contract');
  return runtime.fetchGithubRepoSnapshot(input);
}
