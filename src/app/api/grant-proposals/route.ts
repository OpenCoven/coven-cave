import { NextResponse } from "next/server";

import { listGrantProposals } from "@/lib/project-permissions";

export const dynamic = "force-dynamic";

function proposalMutationDenied() {
  return NextResponse.json(
    { ok: false, error: "grant proposals require an authenticated Supreme approval flow" },
    { status: 403 },
  );
}

export async function GET() {
  return NextResponse.json({ ok: true, proposals: await listGrantProposals() });
}

export async function POST() {
  return proposalMutationDenied();
}
