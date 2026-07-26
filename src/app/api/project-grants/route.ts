import { NextResponse } from "next/server";

import { listProjectGrants } from "@/lib/project-permissions";

export const dynamic = "force-dynamic";

function directGrantMutationDenied() {
  return NextResponse.json(
    { ok: false, error: "project grant changes require an authenticated human approval flow" },
    { status: 403 },
  );
}

export async function GET() {
  return NextResponse.json({ ok: true, grants: await listProjectGrants() });
}

export async function POST() {
  return directGrantMutationDenied();
}

export async function DELETE() {
  return directGrantMutationDenied();
}
