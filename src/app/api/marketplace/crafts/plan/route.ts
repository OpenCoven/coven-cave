import { NextResponse } from "next/server";
import {
  CraftTransactionError,
  craftTransactionStatus,
} from "@/lib/server/craft-install";
import { craftInstallService } from "@/lib/server/craft-install-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id")?.trim() ?? "";
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, plan: await craftInstallService.plan(id) });
  } catch (error) {
    if (error instanceof CraftTransactionError) {
      return NextResponse.json(
        { ok: false, error: error.message, code: error.code, diagnostic: error.diagnostic },
        { status: craftTransactionStatus(error.code) },
      );
    }
    return NextResponse.json({ ok: false, error: "install plan unavailable" }, { status: 500 });
  }
}
