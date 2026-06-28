import { NextResponse } from "next/server";
import { readJsonBody, rejectNonLocalRequest } from "@/lib/server/api-security";
import { deleteSuite, listSuites, loadSuite, saveSuite } from "@/lib/server/eval-store";
import type { EvalSuite } from "@/lib/evals/eval-model";

export const dynamic = "force-dynamic";

const MAX_SUITE_JSON_BYTES = 1_000_000;

/** List all eval suites, or a single suite when `?id=` is given. */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (id) {
    const suite = await loadSuite(id);
    if (!suite) return NextResponse.json({ ok: false, error: "suite not found" }, { status: 404 });
    return NextResponse.json({ ok: true, suite });
  }
  const suites = await listSuites();
  return NextResponse.json({ ok: true, suites });
}

/** Create or replace an eval suite. */
export async function POST(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;

  const parsed = await readJsonBody<{ suite?: EvalSuite }>(req, MAX_SUITE_JSON_BYTES);
  if (!parsed.ok) return parsed.response;
  const suite = parsed.body.suite;
  if (!suite || typeof suite.id !== "string" || !suite.id.trim()) {
    return NextResponse.json({ ok: false, error: "suite.id required" }, { status: 400 });
  }
  try {
    const saved = await saveSuite(suite);
    return NextResponse.json({ ok: true, suite: saved });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "save failed" },
      { status: 400 },
    );
  }
}

/** Delete a suite by `?id=`. */
export async function DELETE(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  const ok = await deleteSuite(id);
  return NextResponse.json({ ok });
}
