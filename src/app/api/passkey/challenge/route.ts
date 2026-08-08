import { NextResponse, type NextRequest } from "next/server";

import {
  ceremonyContext,
  resolvePeerIdentity,
  startCeremony,
} from "@/lib/server/passkey-ceremony";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const peer = resolvePeerIdentity(req.headers);
  if (!peer) {
    // Enrolling or using a passkey is reachable only from a peer this server
    // already authenticated at the socket layer. The passkey is a SECOND
    // factor; it does not stand in for the first.
    return NextResponse.json({ ok: false, error: "unrecognized device" }, { status: 403 });
  }

  const context = ceremonyContext(req.headers, req.nextUrl.protocol);
  if (!context) {
    return NextResponse.json({ ok: false, error: "unusable host" }, { status: 400 });
  }

  let purpose: unknown;
  try {
    purpose = (await req.json())?.purpose;
  } catch {
    return NextResponse.json({ ok: false, error: "malformed body" }, { status: 400 });
  }
  if (purpose !== "register" && purpose !== "assert") {
    return NextResponse.json({ ok: false, error: "unknown purpose" }, { status: 400 });
  }

  const ceremony = await startCeremony(purpose, peer, context);
  return NextResponse.json(
    { ok: true, ...ceremony, peer: { kind: peer.kind } },
    { headers: { "cache-control": "no-store" } },
  );
}
