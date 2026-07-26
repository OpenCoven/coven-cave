import { NextResponse } from "next/server";

import {
  listAccessGroups,
  listProjectGrants,
  listRecentPermissionAudit,
  loadHumanPermissionConfig,
} from "@/lib/project-permissions";

export const dynamic = "force-dynamic";

function directGrantMutationDenied() {
  return NextResponse.json(
    { ok: false, error: "project grant changes require an authenticated human approval flow" },
    { status: 403 },
  );
}

export async function GET() {
  const [grants, config, audit, accessGroups] = await Promise.all([
    listProjectGrants(),
    loadHumanPermissionConfig(),
    listRecentPermissionAudit(),
    listAccessGroups(),
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
  });
}

export async function POST() {
  return directGrantMutationDenied();
}

export async function DELETE() {
  return directGrantMutationDenied();
}
