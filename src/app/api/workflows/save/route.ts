import { NextResponse } from "next/server";
import { saveLocalWorkflow } from "@/lib/workflow-source";

export const dynamic = "force-dynamic";

/**
 * Persist a CWF-01 manifest to the local workflows directory. The daemon has
 * no workflow engine yet; when it grows one, this route should prefer a
 * daemon save endpoint and keep the local write as the offline fallback.
 */
export async function POST(req: Request) {
  let body: { manifest?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }
  if (body.manifest === undefined || body.manifest === null || typeof body.manifest !== "object") {
    return NextResponse.json({ ok: false, error: "manifest object required" }, { status: 400 });
  }
  const result = await saveLocalWorkflow({ manifest: body.manifest });
  return NextResponse.json(result, { status: result.ok ? 200 : 422 });
}
