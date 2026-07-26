import { NextResponse } from "next/server";
import { readJsonBody, rejectNonLocalRequest } from "@/lib/server/api-security";
import {
  RoleCraftServiceError,
  roleCraftService,
  roleCraftServiceStatus,
} from "@/lib/server/role-crafts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 8 * 1024;

type RoleCraftBody = {
  roleId?: unknown;
  familiar?: unknown;
  craftId?: unknown;
  attach?: unknown;
};

export async function POST(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;
  const parsed = await readJsonBody<RoleCraftBody>(req, MAX_BODY_BYTES);
  if (!parsed.ok) return parsed.response;
  const roleId = typeof parsed.body.roleId === "string" ? parsed.body.roleId.trim() : "";
  const familiar = typeof parsed.body.familiar === "string" ? parsed.body.familiar.trim() : "";
  const craftId = typeof parsed.body.craftId === "string" ? parsed.body.craftId.trim() : "";
  const attach = parsed.body.attach;
  if (!roleId || !familiar || !craftId || typeof attach !== "boolean") {
    return NextResponse.json(
      { ok: false, error: "roleId, familiar, craftId, and attach required" },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json({
      ok: true,
      ...await roleCraftService.attach({ roleId, familiar, craftId, attach }),
    });
  } catch (error) {
    if (error instanceof RoleCraftServiceError) {
      return NextResponse.json(
        { ok: false, error: error.message, code: error.code },
        { status: roleCraftServiceStatus(error.code) },
      );
    }
    return NextResponse.json({ ok: false, error: "Role Craft update failed" }, { status: 500 });
  }
}
