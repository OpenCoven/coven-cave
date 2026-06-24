/**
 * POST /api/marketplace/config/validate  { id, key }
 *
 * Resolves the field's secret server-side (vault op:// or .env.local) and runs
 * its registered validator (e.g. GitHub /user for the github token). Returns
 * pass/fail + login. The secret value is never returned or logged. Advisory —
 * does not change install/config state.
 */

import { NextResponse } from "next/server";
import { resolveSecret } from "@/lib/vault";
import { hasValidator, validateSecret } from "@/lib/secret-validators";
import { resolveCatalogName, requiredConfigFor } from "../catalog-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: { id?: unknown; key?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  const id = typeof body?.id === "string" ? body.id : "";
  const key = typeof body?.key === "string" ? body.key : "";

  const name = id ? await resolveCatalogName(id) : null;
  if (!name) {
    return NextResponse.json({ ok: false, error: `unknown plugin "${id}"` }, { status: 400 });
  }
  const field = (await requiredConfigFor(name)).find((f) => f.key === key);
  if (!field) {
    return NextResponse.json({ ok: false, error: `unknown config key "${key}"` }, { status: 400 });
  }
  if (!hasValidator(field.env)) {
    return NextResponse.json({ ok: false, error: "this field has no validator" }, { status: 400 });
  }

  const value = resolveSecret(field.env);
  if (!value) {
    return NextResponse.json({
      ok: true,
      valid: false,
      login: null,
      error: "secret is not set or could not be resolved",
    });
  }

  const result = await validateSecret(field.env, value);
  return NextResponse.json({
    ok: true,
    valid: result.ok,
    login: result.login ?? null,
    error: result.error ?? null,
  });
}
