import { NextResponse } from "next/server";

import { hostCapabilityById, hostCapabilitiesForPlatform, grantHostCapability, listHostCapabilityAudit, listHostCapabilityGrants, revokeHostCapability } from "@/lib/host-capabilities";
import { isVerifiedMobileRequest, requireTrustedHumanGrantMutation } from "@/lib/server/trusted-grant-mutation";
import { isValidFamiliarId } from "@/lib/server/familiar-id";
import { listConversations, loadConversation } from "@/lib/cave-conversations";

export const dynamic = "force-dynamic";
function rejectRelayedApproval(payload: Record<string, unknown>) {
  return payload.claimedHumanApproval === true || payload.proposedBy != null || payload.familiarId != null
    ? NextResponse.json({ ok: false, error: "host capability changes must be confirmed directly by the human" }, { status: 403 })
    : null;
}
async function grantInput(payload: Record<string, unknown>) {
  const familiarId = typeof payload.targetFamiliarId === "string" ? payload.targetFamiliarId.trim() : "";
  const sessionId = typeof payload.sessionId === "string" ? payload.sessionId.trim() : "";
  const capability = hostCapabilityById(payload.capability)?.id ?? null;
  if (!familiarId || !isValidFamiliarId(familiarId) || !sessionId || !capability) return null;
  const conversation = await loadConversation(sessionId);
  // A capability is never attachable by a copied or invented session id. The
  // conversation file is Cave-owned evidence of the familiar/session pairing.
  if (!conversation || conversation.familiarId !== familiarId) return null;
  return { familiarId, sessionId, capability };
}
async function revokeInput(payload: Record<string, unknown>) {
  const familiarId = typeof payload.targetFamiliarId === "string" ? payload.targetFamiliarId.trim() : "";
  const sessionId = typeof payload.sessionId === "string" ? payload.sessionId.trim() : "";
  const capability = hostCapabilityById(payload.capability)?.id ?? null;
  if (!familiarId || !isValidFamiliarId(familiarId) || !sessionId || !capability) return null;
  const conversation = await loadConversation(sessionId);
  // A live conversation remains ownership-checked. A missing conversation is
  // intentionally revocable: otherwise its expired grant record could never
  // be removed after the human deletes or archives that chat.
  if (conversation && conversation.familiarId !== familiarId) return null;
  return { familiarId, sessionId, capability };
}
export async function GET(req: Request) {
  const familiarId = new URL(req.url).searchParams.get("familiarId")?.trim();
  // Never hand the browser a global capability ledger and filter it there:
  // another familiar's session ids and audit history are authority metadata.
  if (!familiarId || !isValidFamiliarId(familiarId)) {
    return NextResponse.json({ ok: true, catalog: hostCapabilitiesForPlatform(), grants: [], audit: [], sessions: [] });
  }
  const [allGrants, allAudit, conversations] = await Promise.all([listHostCapabilityGrants(), listHostCapabilityAudit(), listConversations()]);
  const grants = allGrants.filter((grant) => grant.familiarId === familiarId);
  const audit = allAudit.filter((entry) => entry.familiarId === familiarId);
  const sessions = conversations.filter((conversation) => conversation.familiarId === familiarId).map((conversation) => ({ id: conversation.sessionId, title: conversation.title ?? "Untitled chat" }));
  return NextResponse.json({ ok: true, catalog: hostCapabilitiesForPlatform(), grants, audit, sessions });
}
export async function POST(req: Request) {
  const blocked = await requireTrustedHumanGrantMutation(req); if (blocked) return blocked;
  let payload: Record<string, unknown>; try { payload = await req.json(); } catch { return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 }); }
  const rejected = rejectRelayedApproval(payload); if (rejected) return rejected;
  const parsed = await grantInput(payload); if (!parsed) return NextResponse.json({ ok: false, error: "choose a Cave session that belongs to this familiar" }, { status: 400 });
  try { const grant = await grantHostCapability({ ...parsed, expiresAt: typeof payload.expiresAt === "string" ? payload.expiresAt : undefined, actor: isVerifiedMobileRequest(req) ? "mobile" : "loopback" }); return NextResponse.json({ ok: true, grant }); }
  catch (error) { return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "invalid host capability grant" }, { status: 400 }); }
}
export async function DELETE(req: Request) {
  const blocked = await requireTrustedHumanGrantMutation(req); if (blocked) return blocked;
  let payload: Record<string, unknown>; try { payload = await req.json(); } catch { return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 }); }
  const rejected = rejectRelayedApproval(payload); if (rejected) return rejected;
  const parsed = await revokeInput(payload); if (!parsed) return NextResponse.json({ ok: false, error: "choose a Cave session that belongs to this familiar" }, { status: 400 });
  return NextResponse.json({ ok: true, revoked: await revokeHostCapability({ ...parsed, actor: isVerifiedMobileRequest(req) ? "mobile" : "loopback" }) });
}
