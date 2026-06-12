import { NextResponse } from "next/server";
import { deleteLocalWorkflow } from "@/lib/workflow-source";

export const dynamic = "force-dynamic";

/** Remove a locally-authored workflow manifest by id or source path. */
export async function POST(req: Request) {
  let body: { id?: string; path?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }
  if (!body.id && !body.path) {
    return NextResponse.json({ ok: false, error: "id or path required" }, { status: 400 });
  }
  const result = await deleteLocalWorkflow(body);
  return NextResponse.json(result, { status: result.ok ? 200 : 404 });
}
