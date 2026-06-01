import { NextResponse } from "next/server";
import { loadCalls, recordCall, type CovenCallInput } from "@/lib/coven-calls";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const file = await loadCalls();
  // Newest first — graph view + recent-edge popover both want this.
  const sorted = [...file.calls].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  return NextResponse.json({ ok: true, calls: sorted });
}

export async function POST(req: Request) {
  let body: CovenCallInput;
  try {
    body = (await req.json()) as CovenCallInput;
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid json body" },
      { status: 400 },
    );
  }
  if (!body.callerFamiliarId || !body.calleeFamiliarId || !body.request?.trim()) {
    return NextResponse.json(
      {
        ok: false,
        error: "callerFamiliarId, calleeFamiliarId, and request are required",
      },
      { status: 400 },
    );
  }
  const call = await recordCall(body);
  return NextResponse.json({ ok: true, call });
}
