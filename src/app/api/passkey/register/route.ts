import { NextResponse, type NextRequest } from "next/server";

import { PRESENCE_COOKIE } from "@/lib/passkey-presence";
import {
  ceremonyContext,
  completeRegistration,
  resolvePeerIdentity,
  verifyPeerPresence,
} from "@/lib/server/passkey-ceremony";

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
  const context = ceremonyContext(req.headers, req.nextUrl.protocol);
  if (!context) {
    return NextResponse.json({ ok: false, error: "unusable host" }, { status: 400 });
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
  const clientDataJSON = stringField(body, "clientDataJSON");
  const attestationObject = stringField(body, "attestationObject");
  if (!challenge || !clientDataJSON || !attestationObject) {
    return NextResponse.json({ ok: false, error: "missing ceremony fields" }, { status: 400 });
  }

  const result = await completeRegistration({
    peer,
    context,
    challenge,
    clientDataJSON,
    attestationObject,
    label: stringField(body, "label") ?? undefined,
    presenceProven: await verifyPeerPresence(req.cookies.get(PRESENCE_COOKIE)?.value, peer),
  });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  const { credentialId, label, createdAt, attestationFormat } = result.credential;
  return NextResponse.json(
    { ok: true, credential: { credentialId, label, createdAt, attestationFormat } },
    { headers: { "cache-control": "no-store" } },
  );
}
