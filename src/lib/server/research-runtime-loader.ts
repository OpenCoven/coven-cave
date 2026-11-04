import type { ResearchCapability } from '../research-capability.ts';

/**
 * The optional Research runtime as Cave sees it. The absent stub fixes the
 * shape that host contract 2 requires; `stopResearchRuntime` is the optional
 * teardown export the activation owner calls when the installed package
 * provides one (#6332). A package without it can still be hot-disabled at the
 * admission boundary, but its admitted workers run until the process ends.
 */
export type ResearchRuntime = typeof import('./research-package-absent.ts') & {
  stopResearchRuntime?: () => Promise<void>;
};
export type ResearchRuntimeLoader = () => Promise<ResearchRuntime>;
export const loadResearchRuntime: ResearchRuntimeLoader = () => import('@opencoven/research-runtime');

export type ResearchRuntimeResult = { ok: true; runtime: ResearchRuntime } | {
  ok: false;
  code: 'research-runtime-unavailable' | 'research-incompatible';
  error: string;
};

export async function loadCompatibleResearchRuntime(load: ResearchRuntimeLoader): Promise<ResearchRuntimeResult> {
  let runtime: ResearchRuntime;
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
