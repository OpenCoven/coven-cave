import { NextResponse } from "next/server";
import {
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

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

export async function GET(req: Request) {
  const url = new URL(req.url);
  const submissions = await loadOpenCovenSubmissions();
  const catalog = catalogEntriesFromSubmissions(submissions);
  return NextResponse.json({
    ok: true,
    choices: SUBMISSION_CHOICES,
    catalog,
    route: routeFor(catalog, url),
  });
}

export async function POST(req: Request) {
  let body: SubmissionBody;
  try {
    body = (await req.json()) as SubmissionBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }

  const packagePayload = body.package;
  if (!packagePayload || !("manifest" in packagePayload) || !Array.isArray(packagePayload.artifacts)) {
    return NextResponse.json(
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
  return NextResponse.json({
    ok: true,
    validation,
    published: body.publish === true && validation.status === "pass",
    choices: SUBMISSION_CHOICES,
    catalog,
  });
}
