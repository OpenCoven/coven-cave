import { NextResponse } from "next/server";

import { hostCapabilityById, hostCapabilitiesForPlatform, grantHostCapability, listHostCapabilityAudit, listHostCapabilityGrants, revokeHostCapability } from "@/lib/host-capabilities";
import { isVerifiedMobileRequest, requireTrustedHumanGrantMutation } from "@/lib/server/trusted-grant-mutation";
import { isValidFamiliarId } from "@/lib/server/familiar-id";

export const dynamic = "force-dynamic";
function rejectRelayedApproval(payload: Record<string, unknown>) {
  return payload.claimedHumanApproval === true || payload.proposedBy != null || payload.familiarId != null
    ? NextResponse.json({ ok: false, error: "host capability changes must be confirmed directly by the human" }, { status: 403 })
    : null;
}
function input(payload: Record<string, unknown>) {
  const familiarId = typeof payload.targetFamiliarId === "string" ? payload.targetFamiliarId.trim() : "";
  const sessionId = typeof payload.sessionId === "string" ? payload.sessionId.trim() : "";
  const capability = hostCapabilityById(payload.capability)?.id ?? null;
  return familiarId && isValidFamiliarId(familiarId) && sessionId && capability ? { familiarId, sessionId, capability } : null;
}
export async function GET() {
  const [grants, audit] = await Promise.all([listHostCapabilityGrants(), listHostCapabilityAudit()]);
  return NextResponse.json({ ok: true, catalog: hostCapabilitiesForPlatform(), grants, audit });
}
export async function POST(req: Request) {
  const blocked = await requireTrustedHumanGrantMutation(req); if (blocked) return blocked;
  let payload: Record<string, unknown>; try { payload = await req.json(); } catch { return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 }); }
  const rejected = rejectRelayedApproval(payload); if (rejected) return rejected;
  const parsed = input(payload); if (!parsed) return NextResponse.json({ ok: false, error: "targetFamiliarId, sessionId, and a supported capability are required" }, { status: 400 });
  try { const grant = await grantHostCapability({ ...parsed, expiresAt: typeof payload.expiresAt === "string" ? payload.expiresAt : undefined, actor: isVerifiedMobileRequest(req) ? "mobile" : "loopback" }); return NextResponse.json({ ok: true, grant }); }
  catch (error) { return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "invalid host capability grant" }, { status: 400 }); }
}
export async function DELETE(req: Request) {
  const blocked = await requireTrustedHumanGrantMutation(req); if (blocked) return blocked;
  let payload: Record<string, unknown>; try { payload = await req.json(); } catch { return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 }); }
  const rejected = rejectRelayedApproval(payload); if (rejected) return rejected;
  const parsed = input(payload); if (!parsed) return NextResponse.json({ ok: false, error: "targetFamiliarId, sessionId, and a supported capability are required" }, { status: 400 });
  return NextResponse.json({ ok: true, revoked: await revokeHostCapability({ ...parsed, actor: isVerifiedMobileRequest(req) ? "mobile" : "loopback" }) });
}
