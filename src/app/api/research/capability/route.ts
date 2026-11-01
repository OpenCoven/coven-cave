import { researchCapability } from '@/lib/research-capability';
import { readJsonBody, rejectNonLocalRequest } from '@/lib/server/api-security';
import {
  researchActivation,
  startOptionalResearch,
  stopOptionalResearch,
  withResearchActivation,
} from '@/lib/server/research-activation';
import { researchUnavailable } from '@/lib/server/research-runtime-loader';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** The capability a client sees: build, environment, then the activation owner. */
export function GET(req: Request): Response {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;
  return Response.json({ ok: true, ...withResearchActivation(researchCapability()), activation: researchActivation() });
}

/**
 * Hot-disable or reactivate Research while the server runs (#6332).
 * `active: false` closes admission first and reports what became of the
 * package's workers; `active: true` starts one owner. Neither cancels or
 * replays admitted media jobs, and neither changes the build or environment
 * gates, which still refuse with their own codes.
 */
export async function POST(req: Request): Promise<Response> {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;
  const parsed = await readJsonBody<{ active?: unknown }>(req, 1024);
  if (!parsed.ok) return parsed.response;
  const active = parsed.body && typeof parsed.body === 'object' ? parsed.body.active : undefined;
  if (typeof active !== 'boolean') {
    return Response.json({ ok: false, error: 'active must be a boolean' }, { status: 400 });
  }
  const capability = researchCapability();
  if (!active) {
    const teardown = await stopOptionalResearch();
    return Response.json({ ok: true, ...withResearchActivation(capability), activation: researchActivation(), teardown });
  }
  if (!capability.enabled) return researchUnavailable(capability);
  try {
    await startOptionalResearch(capability);
  } catch (error) {
    // The fixed load/compatibility message, or the package's own startup
    // failure, which stays in the server log rather than the response.
    console.warn('[research] activation failed:', error);
    return Response.json({
      ok: false,
      code: 'research-runtime-unavailable',
      error: 'Research could not be started. Inspect the server log, then retry or restart Cave.',
    }, { status: 503 });
  }
  return Response.json({ ok: true, ...withResearchActivation(capability), activation: researchActivation() });
}
