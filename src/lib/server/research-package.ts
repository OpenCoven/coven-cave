import type { GithubRepoSnapshotInput, GithubRepoSnapshotResult } from "../research-github-snapshot-contract.ts";
import { researchCapability } from '../research-capability.ts';
import { rejectNonLocalRequest, rejectResearchMediaRequest, rejectResearchRunStreamRequest } from './api-security.ts';
import { withResearchActivation } from './research-activation.ts';
import {
  loadCompatibleResearchRuntime as loadCompatibleRuntime,
  loadResearchRuntime as loadRuntime,
  type ResearchRuntimeLoader as Loader,
} from './research-runtime-loader.ts';

export { startOptionalResearch, stopOptionalResearch, stopOptionalResearchForShutdown } from './research-activation.ts';
export { researchUnavailable } from './research-runtime-loader.ts';
import { researchUnavailable } from './research-runtime-loader.ts';

export async function dispatchResearchRequest(
  route: string,
  method: string,
  request: Request,
  context?: unknown,
  requested = researchCapability(),
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
  // Build and environment gates first, then the activation owner (#6332): a
  // hot-disabled Research refuses here, before any implementation loads.
  const capability = withResearchActivation(requested);
  if (!capability.enabled) return researchUnavailable(capability);
  const result = await loadCompatibleRuntime(load);
  if (!result.ok) return Response.json(result, { status: 503 });
  // Handler failures may represent ambiguous mutations. Do not turn them into
  // a load failure or retry them at this boundary.
  return result.runtime.dispatchResearchRequest(route, method, request, context);
}

export async function fetchOptionalGithubRepoView(
  input: GithubRepoSnapshotInput,
  requested = researchCapability(),
  load: Loader = loadRuntime,
): Promise<GithubRepoSnapshotResult> {
  const capability = withResearchActivation(requested);
  if (!capability.enabled) return { ok: false };
  const result = await loadCompatibleRuntime(load);
  if (!result.ok) return { ok: false };
  return result.runtime.fetchGithubRepoSnapshot(input);
}
