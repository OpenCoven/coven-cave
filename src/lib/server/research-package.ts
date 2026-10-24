import type { GithubRepoSnapshotInput, GithubRepoSnapshotResult } from "../research-github-snapshot-contract.ts";
import { researchCapability, type ResearchCapability } from '../research-capability.ts';
import { rejectNonLocalRequest, rejectResearchMediaRequest, rejectResearchRunStreamRequest } from './api-security.ts';

type Runtime = typeof import('./research-package-absent.ts');
type Loader = () => Promise<Runtime>;
const loadRuntime: Loader = () => import('@opencoven/research-runtime');

type RuntimeResult = { ok: true; runtime: Runtime } | {
  ok: false;
  code: 'research-runtime-unavailable' | 'research-incompatible';
  error: string;
};

async function loadCompatibleRuntime(load: Loader): Promise<RuntimeResult> {
  let runtime: Runtime;
  try {
    runtime = await load();
  } catch {
    return {
      ok: false,
      code: 'research-runtime-unavailable',
      error: 'Research could not be loaded. Repair or reinstall Research, then restart Cave.',
    };
  }
  // v2 requires mission correlation, stable adoption keys and revisions for
  // Coven-owned automations. A v1 package cannot safely issue those commands.
  if (runtime.researchHostContractVersion !== 2) {
    return {
      ok: false,
      code: 'research-incompatible',
      error: 'Research is incompatible with this version of Cave. Update Cave and Research together, then restart Cave.',
    };
  }
  return { ok: true, runtime };
}

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
  const result = await loadCompatibleRuntime(load);
  if (!result.ok) return Response.json(result, { status: 503 });
  // Handler failures may represent ambiguous mutations. Do not turn them into
  // a load failure or retry them at this boundary.
  return result.runtime.dispatchResearchRequest(route, method, request, context);
}

export async function startOptionalResearch(
  capability = researchCapability(),
  load: Loader = loadRuntime,
): Promise<void> {
  if (!capability.enabled) return;
  const result = await loadCompatibleRuntime(load);
  if (!result.ok) throw new Error(result.error);
  await result.runtime.startResearchRuntime();
}

export async function fetchOptionalGithubRepoView(
  input: GithubRepoSnapshotInput,
  capability = researchCapability(),
  load: Loader = loadRuntime,
): Promise<GithubRepoSnapshotResult> {
  if (!capability.enabled) return { ok: false };
  const result = await loadCompatibleRuntime(load);
  if (!result.ok) return { ok: false };
  return result.runtime.fetchGithubRepoSnapshot(input);
}
