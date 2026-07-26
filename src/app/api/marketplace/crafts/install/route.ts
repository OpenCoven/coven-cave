import { NextResponse } from "next/server";
import { readJsonBody, rejectNonLocalRequest } from "@/lib/server/api-security";
import {
  CraftTransactionError,
  craftTransactionStatus,
} from "@/lib/server/craft-install";
import { craftInstallService } from "@/lib/server/craft-install-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 4 * 1024;

export async function POST(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;
  const parsed = await readJsonBody<{ id?: unknown }>(req, MAX_BODY_BYTES);
  if (!parsed.ok) return parsed.response;
  const id = typeof parsed.body.id === "string" ? parsed.body.id.trim() : "";
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  try {
    return NextResponse.json(await craftInstallService.install(id));
  } catch (error) {
    if (error instanceof CraftTransactionError) {
      return NextResponse.json(
        { ok: false, error: error.message, code: error.code, diagnostic: error.diagnostic },
        { status: craftTransactionStatus(error.code) },
      );
    }
    return NextResponse.json({ ok: false, error: "Craft installation failed" }, { status: 500 });
  }
}
