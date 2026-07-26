import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function PATCH() {
  return NextResponse.json(
    { ok: false, error: "proposal decisions require an authenticated human approval flow" },
    { status: 403 },
  );
}
