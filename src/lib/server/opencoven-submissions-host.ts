/**
 * The admission boundary for optional OpenCoven Submissions (#6400).
 *
 * Every direct request passes here before any implementation loads. A disabled
 * host refuses without importing anything, and a load failure or contract
 * mismatch refuses with a named code rather than falling back or retrying.
 * Proxy authentication does not establish locality: the shared local guard
 * runs before even the build-availability check.
 *
 * There is no worker, timer or watcher to own. Admission is per request, a
 * publish is one atomic file write, and an execution request only returns a
 * plan, so disabling Cave has no job to drain. Saved data stays reachable through
 * opencoven-submissions-retained.ts in every state.
 */
import { rejectNonLocalRequest } from "./api-security.ts";

export type SubmissionsRoute = "submissions" | "executions";

export type SubmissionsRuntime = {
  submissionsContractVersion: number;
  handleSubmissionsRequest: (route: SubmissionsRoute, request: Request) => Promise<Response>;
};

export type SubmissionsActivation = {
  /** Build-selected metadata; reading it must not import the implementation. */
  available: boolean;
  load: () => Promise<SubmissionsRuntime>;
};

const SUPPORTED_CONTRACT_VERSION = 1;

function refuse(code: string, error: string): Response {
  return Response.json({ ok: false, code, error }, { status: 503 });
}

export function submissionsDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.COVEN_CAVE_SUBMISSIONS_DISABLED === "1";
}

export async function dispatchSubmissionsRequest(
  route: SubmissionsRoute,
  req: Request,
  activation: SubmissionsActivation,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Response> {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;
  if (!activation.available) {
    return refuse("submissions-not-installed", "Submissions isn't included in this build.");
  }
  if (submissionsDisabled(env)) {
    return refuse("submissions-disabled", "Submissions is turned off on this Cave.");
  }
  let runtime: SubmissionsRuntime;
  try {
    runtime = await activation.load();
  } catch (error) {
    console.warn("[submissions] implementation failed to load:", error);
    return refuse("submissions-load-failed", "Submissions couldn't load. Saved submissions are unchanged.");
  }
  if (runtime.submissionsContractVersion !== SUPPORTED_CONTRACT_VERSION) {
    return refuse("submissions-incompatible", "This Submissions build doesn't match this Cave.");
  }
  return runtime.handleSubmissionsRequest(route, req);
}
