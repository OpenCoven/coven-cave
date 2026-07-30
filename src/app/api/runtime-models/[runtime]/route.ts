import { NextResponse } from "next/server";
import { canonicalHarnessId } from "@/lib/harness-adapters";
import { catalogForRuntime } from "@/lib/runtime-models";
import { rejectNonLocalRequest } from "@/lib/server/api-security";
import { listRuntimeModelInventory } from "@/lib/server/runtime-model-options";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function cleanFamiliarId(value: string | null): string | null {
  const familiarId = value?.trim() ?? "";
  if (
    !familiarId ||
    familiarId.length > 200 ||
    /[\u0000-\u001f\u007f]/.test(familiarId)
  ) {
    return null;
  }
  return familiarId;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ runtime: string }> },
) {
  const rawRuntime = (await params).runtime;
  const runtime = canonicalHarnessId(rawRuntime);
  const catalog = catalogForRuntime(runtime);
  if (!catalog) {
    return NextResponse.json(
      { ok: false, error: "runtime not found" },
      { status: 404 },
    );
  }
  if (runtime === "opencode") {
    const forbidden = rejectNonLocalRequest(req);
    if (forbidden) return forbidden;
  }
  const rawFamiliarId = new URL(req.url).searchParams.get("familiarId");
  const familiarId = cleanFamiliarId(rawFamiliarId);
  if (rawFamiliarId !== null && !familiarId) {
    return NextResponse.json(
      { ok: false, error: "invalid familiar id" },
      { status: 400 },
    );
  }
  const inventory = await listRuntimeModelInventory(runtime, familiarId, {
    allowOpenCodeInventory: runtime === "opencode",
  });
  return NextResponse.json({
    ok: true,
    ...inventory,
  });
}
