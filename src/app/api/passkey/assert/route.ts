import { NextResponse, type NextRequest } from "next/server";

import { PRESENCE_COOKIE } from "@/lib/passkey-presence";
import { completeAssertion, resolvePeerIdentity } from "@/lib/server/passkey-ceremony";

export const dynamic = "force-dynamic";

function stringField(body: Record<string, unknown>, name: string): string | null {
  const value = body[name];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export async function POST(req: NextRequest) {
  const peer = resolvePeerIdentity(req.headers);
  if (!peer) {
    return NextResponse.json({ ok: false, error: "unrecognized device" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "malformed body" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ ok: false, error: "malformed body" }, { status: 400 });
  }

  const challenge = stringField(body, "challenge");
  const credentialId = stringField(body, "credentialId");
  const clientDataJSON = stringField(body, "clientDataJSON");
  const authenticatorData = stringField(body, "authenticatorData");
  const signature = stringField(body, "signature");
  if (!challenge || !credentialId || !clientDataJSON || !authenticatorData || !signature) {
    return NextResponse.json({ ok: false, error: "missing ceremony fields" }, { status: 400 });
  }

  const result = await completeAssertion({
    peer,
    challenge,
    credentialId,
    clientDataJSON,
    authenticatorData,
    signature,
  });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  const res = NextResponse.json(
    { ok: true, expiresAt: result.expiresAt },
    { headers: { "cache-control": "no-store" } },
  );
  // httpOnly so script on the page cannot read the presence proof, and
  // sameSite=strict because — unlike the mobile access cookie, which has to
  // survive the top-level navigation that delivers a pairing link — nothing
  // ever needs this cookie to ride a cross-site request.
  res.cookies.set(PRESENCE_COOKIE, result.presenceToken, {
    httpOnly: true,
    sameSite: "strict",
    secure: req.nextUrl.protocol === "https:",
    path: "/",
    maxAge: Math.max(1, Math.floor((result.expiresAt - Date.now()) / 1000)),
  });
  return res;
}
