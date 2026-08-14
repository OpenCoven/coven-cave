import { NextResponse, type NextRequest } from "next/server";

import { PRESENCE_COOKIE } from "@/lib/passkey-presence";
import { deleteCredential, listCredentials } from "@/lib/server/passkey-store";
import {
  passkeyPresenceRequired,
  resolvePeerIdentity,
  verifyPeerPresence,
} from "@/lib/server/passkey-ceremony";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const peer = resolvePeerIdentity(req.headers);
  if (!peer) {
    return NextResponse.json({ ok: false, error: "unrecognized device" }, { status: 403 });
  }
  // Scoped to the asking device. Enumerating every enrolled credential would
  // tell one device which OTHER devices are registered, which is exactly the
  // inventory an attacker who reached one device would want next.
  const credentials = await listCredentials(peer.nodeId);
  return NextResponse.json(
    {
      ok: true,
      credentials: credentials.map(({ credentialId, label, createdAt, lastUsedAt, attestationFormat }) => ({
        credentialId,
        label,
        createdAt,
        lastUsedAt,
        attestationFormat,
      })),
    },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function DELETE(req: NextRequest) {
  const peer = resolvePeerIdentity(req.headers);
  if (!peer) {
    return NextResponse.json({ ok: false, error: "unrecognized device" }, { status: 403 });
  }
  const credentialId = req.nextUrl.searchParams.get("credentialId");
  if (!credentialId) {
    return NextResponse.json({ ok: false, error: "missing credentialId" }, { status: 400 });
  }
  // Revoking a second factor is exactly as sensitive as enrolling one: without
  // this, whoever holds the device could delete the passkey and drop straight
  // back to device-identity-only access.
  if (
    passkeyPresenceRequired() &&
    !(await verifyPeerPresence(req.cookies.get(PRESENCE_COOKIE)?.value, peer))
  ) {
    return NextResponse.json({ ok: false, error: "passkey presence required" }, { status: 403 });
  }
  // A device may only unenroll its OWN credential. Without the ownership check
  // any enrolled device could revoke every other device's second factor.
  const owned = await listCredentials(peer.nodeId);
  if (!owned.some((credential) => credential.credentialId === credentialId)) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }
  const removed = await deleteCredential(credentialId);
  return NextResponse.json({ ok: removed }, { status: removed ? 200 : 404 });
}
