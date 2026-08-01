import { NextResponse } from "next/server";
import { rejectNonLocalRequest } from "@/lib/server/api-security";
import { listRuntimeModelInventory } from "@/lib/server/runtime-model-options";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;
  const familiarId = new URL(req.url).searchParams.get("familiarId");
  const inventory = await listRuntimeModelInventory(
    "opencode",
    familiarId,
    { allowOpenCodeInventory: true },
  );
  return NextResponse.json({ ok: true, ...inventory });
}
