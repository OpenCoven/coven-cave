import { NextResponse } from "next/server";
import { XApiError } from "@/lib/x-api";
import { readJsonBody, rejectNonLocalRequest } from "@/lib/server/api-security";
import { xOAuthService } from "@/lib/server/x-oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 1024;
type XOAuthStartBody = { capability?: unknown };

export async function POST(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;
  const parsed = await readJsonBody<XOAuthStartBody>(req, MAX_BODY_BYTES);
  if (!parsed.ok) return parsed.response;
  const capability = parsed.body.capability;
  if (capability !== "research" && capability !== "publish") {
    return NextResponse.json({ ok: false, error: "capability must be research or publish" }, { status: 400 });
  }
  try {
    return NextResponse.json({ ok: true, ...await xOAuthService.start({ capability }) });
  } catch (error) {
    if (error instanceof XApiError) {
      return NextResponse.json({ ok: false, error: error.safeMessage, code: error.code }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: "X authorization could not be started" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;
  xOAuthService.cancel();
  return NextResponse.json({ ok: true });
}
