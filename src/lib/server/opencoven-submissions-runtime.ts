import {
  buildExecutionPlan,
  catalogEntriesFromSubmissions,
  coerceSubmissionManifest,
  resolveExecutionRoute,
  validateSubmissionPackage,
  type OpenCovenSubmissionPackage,
} from "@/lib/opencoven-submissions";
import {
  loadOpenCovenSubmissions,
  saveOpenCovenSubmission,
} from "@/lib/opencoven-submission-store";
import type { SubmissionsRoute } from "./opencoven-submissions-host.ts";

/**
 * The optional Submissions implementation (#6400). Reached only through
 * opencoven-submissions-host.ts, and excluded from a default build (#6401).
 */
export const submissionsContractVersion: number = 1;

const SUBMISSION_CHOICES = [
  { type: "runtime", label: "Runtime" },
  { type: "harness", label: "Harness" },
] as const;

type SubmissionBody = {
  package?: OpenCovenSubmissionPackage;
  publish?: boolean;
};

function routeFor(catalog: ReturnType<typeof catalogEntriesFromSubmissions>, url: URL) {
  const harnessId = url.searchParams.get("harness");
  if (!harnessId) return null;
  return resolveExecutionRoute({
    harnessId,
    runtimeId: url.searchParams.get("runtime") ?? undefined,
    catalog,
  });
}

async function getSubmissions(req: Request) {
  const url = new URL(req.url);
  const submissions = await loadOpenCovenSubmissions();
  const catalog = catalogEntriesFromSubmissions(submissions);
  return Response.json({
    ok: true,
    choices: SUBMISSION_CHOICES,
    catalog,
    route: routeFor(catalog, url),
  });
}

async function postSubmission(req: Request) {
  let body: SubmissionBody;
  try {
    body = (await req.json()) as SubmissionBody;
  } catch {
    return Response.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }

  const packagePayload = body.package;
  if (!packagePayload || !("manifest" in packagePayload) || !Array.isArray(packagePayload.artifacts)) {
    return Response.json(
      { ok: false, error: "submission package must include manifest and artifacts" },
      { status: 400 },
    );
  }

  const current = await loadOpenCovenSubmissions();
  const validation = validateSubmissionPackage(packagePayload, {
    runtimes: current.filter((item) => item.type === "runtime"),
  });
  let submissions = current;
  const manifest = coerceSubmissionManifest(packagePayload.manifest);

  if (body.publish === true && validation.status === "pass" && manifest) {
    submissions = await saveOpenCovenSubmission(manifest);
  }

  const catalog = catalogEntriesFromSubmissions(submissions);
  return Response.json({
    ok: true,
    validation,
    published: body.publish === true && validation.status === "pass",
    choices: SUBMISSION_CHOICES,
    catalog,
  });
}

type ExecutionBody = {
  harnessId?: unknown;
  runtimeId?: unknown;
  input?: unknown;
};

async function postExecution(req: Request) {
  let body: ExecutionBody;
  try {
    body = (await req.json()) as ExecutionBody;
  } catch {
    return Response.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }

  if (typeof body.harnessId !== "string" || body.harnessId.trim() === "") {
    return Response.json({ ok: false, error: "harnessId is required" }, { status: 400 });
  }
  const runtimeId = typeof body.runtimeId === "string" && body.runtimeId.trim() ? body.runtimeId.trim() : undefined;
  const catalog = catalogEntriesFromSubmissions(await loadOpenCovenSubmissions());
  const plan = buildExecutionPlan({
    harnessId: body.harnessId.trim(),
    runtimeId,
    catalog,
    input: body.input,
  });

  return Response.json({
    ok: plan.status === "ready",
    executionService: plan.status === "ready" ? "opencoven.execution.v1" : null,
    plan,
  });
}

export async function handleSubmissionsRequest(route: SubmissionsRoute, request: Request): Promise<Response> {
  if (route === "executions") {
    return request.method === "POST" ? postExecution(request) : new Response(null, { status: 405 });
  }
  if (request.method === "GET") return getSubmissions(request);
  return request.method === "POST" ? postSubmission(request) : new Response(null, { status: 405 });
}
