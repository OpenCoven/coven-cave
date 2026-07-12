import { NextResponse } from "next/server";
import { upsertRoleConfig } from "@/lib/cave-config";
import { loadRoleEntries, type RoleEntry } from "@/lib/server/role-entries";

export const dynamic = "force-dynamic";

export type { RoleEntry };

export async function GET() {
  return NextResponse.json({ ok: true, roles: await loadRoleEntries() });
}

/** Toggle a role's active state in cave-config.json */
export async function POST(req: Request) {
  try {
    const { id, familiar, active } = await req.json() as {
      id: string;
      familiar: string;
      active: boolean;
    };
    if (!id || !familiar || typeof active !== "boolean") {
      return NextResponse.json({ ok: false, error: "missing id, familiar, or active" }, { status: 400 });
    }
    await upsertRoleConfig(id, familiar, active);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "unknown error" },
      { status: 500 },
    );
  }
}
