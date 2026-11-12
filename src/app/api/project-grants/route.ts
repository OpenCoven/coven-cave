import { NextResponse } from "next/server";

import { resolveProjectGrantTarget } from "@/lib/server/project-grant-targets";
import {
  isVerifiedMobileRequest,
  requireTrustedHumanGrantMutation,
} from "@/lib/server/trusted-grant-mutation";

import {
  grantProjectToFamiliar,
  listAccessGroups,
  listProjectGrants,
  listRecentGrantChanges,
  listRecentPermissionAudit,
  loadHumanPermissionConfig,
  inspectProjectPermissionIntegrity,
  repairOrphanProjectPermissions,
  revokeProjectFromFamiliar,
  StaleGrantError,
} from "@/lib/project-permissions";

export const dynamic = "force-dynamic";

function rejectRelayedApproval(payload: Record<string, unknown>): Response | null {
  if (
    payload.familiarId != null ||
    payload.proposedBy != null ||
    payload.claimedHumanApproval === true
  ) {
    return NextResponse.json(
      { ok: false, error: "grant changes must be confirmed directly by the human" },
      { status: 403 },
    );
  }
  return null;
}

async function readPayload(req: Request): Promise<Record<string, unknown> | Response> {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }
}

function grantInput(payload: Record<string, unknown>) {
  const targetFamiliarId = typeof payload.targetFamiliarId === "string"
    ? payload.targetFamiliarId.trim()
    : "";
  const projectId = typeof payload.projectId === "string" ? payload.projectId.trim() : "";
  if (!targetFamiliarId || !projectId) return null;
  return { familiarId: targetFamiliarId, projectId };
}

function accessInput(payload: Record<string, unknown>): "read" | "write" | null {
  if (payload.access === undefined) return "write";
  if (payload.access === "read" || payload.access === "write") return payload.access;
  return null;
}

/**
 * Optional compare-and-set precondition (#6445): the direct grant the caller
 * saw, or null for none. Absent means no precondition (unchanged behavior);
 * anything other than read, write or null is malformed.
 */
function expectedAccessInput(
  payload: Record<string, unknown>,
): { expectedAccess?: "read" | "write" | null } | null {
  if (!Object.prototype.hasOwnProperty.call(payload, "expectedAccess")) return {};
  const value = payload.expectedAccess;
  if (value === null || value === "read" || value === "write") return { expectedAccess: value };
  return null;
}

function invalidExpectedAccess(): Response {
  return NextResponse.json(
    { ok: false, error: "expectedAccess must be \"read\", \"write\" or null" },
    { status: 400 },
  );
}

function staleGrantResponse(error: StaleGrantError): Response {
  return NextResponse.json(
    {
      ok: false,
      code: "grant_changed",
      error: "This familiar's access to the project changed after it was shown. Review it in Projects, then try again.",
      current: error.current,
    },
    { status: 409 },
  );
}

export async function GET() {
  const [grants, config, audit, grantChanges, accessGroups, integrity] = await Promise.all([
    listProjectGrants(),
    loadHumanPermissionConfig(),
    listRecentPermissionAudit(),
    listRecentGrantChanges(),
    listAccessGroups(),
    inspectProjectPermissionIntegrity(),
  ]);
  // `supremeFamiliarId` has access to every project regardless of grants — the
  // Permissions UI marks it as all-access and locks its toggles on. `audit` is a
  // bounded recent window of access decisions for the console's audit log.
  // `accessGroups` ride along so one fetch can render effective (direct + group)
  // access. `mobileMutationsAllowed` lets the iOS console render editable vs
  // read-only without a failed mutation probe.
  return NextResponse.json({
    ok: true,
    grants,
    accessGroups,
    supremeFamiliarId: config.supremeFamiliarId,
    mobileMutationsAllowed: config.allowMobileGrantMutations,
    audit,
    integrity,
    // Access CHANGES — who widened or narrowed a grant. Distinct from
    // `audit`, which is the access-CHECK decision log.
    grantChanges,
  });
}

export async function POST(req: Request) {
  // Local desktop always; the paired phone only behind the desktop opt-in.
  const blocked = await requireTrustedHumanGrantMutation(req);
  if (blocked) return blocked;
  const payload = await readPayload(req);
  if (payload instanceof Response) return payload;
  const rejected = rejectRelayedApproval(payload);
  if (rejected) return rejected;
  if (payload.repairOrphans === true) {
    const integrity = await repairOrphanProjectPermissions();
    return NextResponse.json({ ok: true, repaired: integrity });
  }
  const input = grantInput(payload);
  if (!input) {
    return NextResponse.json(
      { ok: false, error: "targetFamiliarId and projectId are required" },
      { status: 400 },
    );
  }
  const access = accessInput(payload);
  if (!access) {
    return NextResponse.json(
      { ok: false, error: "access must be \"read\" or \"write\"" },
      { status: 400 },
    );
  }
  const expected = expectedAccessInput(payload);
  if (!expected) return invalidExpectedAccess();
  const target = await resolveProjectGrantTarget(input);
  if (!target.ok) {
    return NextResponse.json(
      { ok: false, error: target.error },
      { status: target.status },
    );
  }
  try {
    await grantProjectToFamiliar({
      familiarId: target.familiarId,
      projectId: target.projectId,
      source: "human",
      access,
      actor: isVerifiedMobileRequest(req) ? "mobile" : "loopback",
      ...expected,
    });
  } catch (error) {
    if (error instanceof StaleGrantError) return staleGrantResponse(error);
    throw error;
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const blocked = await requireTrustedHumanGrantMutation(req);
  if (blocked) return blocked;
  const payload = await readPayload(req);
  if (payload instanceof Response) return payload;
  const rejected = rejectRelayedApproval(payload);
  if (rejected) return rejected;
  const input = grantInput(payload);
  if (!input) {
    return NextResponse.json(
      { ok: false, error: "targetFamiliarId and projectId are required" },
      { status: 400 },
    );
  }
  const expected = expectedAccessInput(payload);
  if (!expected) return invalidExpectedAccess();
  let revoked: boolean;
  try {
    revoked = await revokeProjectFromFamiliar({
      ...input,
      actor: isVerifiedMobileRequest(req) ? "mobile" : "loopback",
      ...expected,
    });
  } catch (error) {
    if (error instanceof StaleGrantError) return staleGrantResponse(error);
    throw error;
  }
  return NextResponse.json({ ok: true, revoked });
}
