/**
 * /api/marketplace/config
 *
 * GET  ?id=<plugin>   -> per-required-field resolution status (no secret values)
 * POST { id, key, value } -> save a NON-sensitive plain config value to .env.local
 * DELETE { id, key }      -> clear a NON-sensitive plain config value
 *
 * Sensitive fields are NOT handled here — they go through /api/vault as local
 * encrypted secrets or op:// refs. The env key written is always taken from the trusted plugin manifest
 * (allowlist-selected via the user's `key`), never built from request strings.
 */

import { NextResponse } from "next/server";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { canResolve, getVaultStatuses } from "@/lib/vault";
import { envLocalPath, readEnvLocalValue, upsertEnvContent } from "@/lib/env-file";
import { hasValidator } from "@/lib/secret-validators";
import { resolveCatalogName, requiredConfigFor } from "./catalog-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function writeEnvLocal(updates: Record<string, string | null>): void {
  const envPath = envLocalPath();
  mkdirSync(path.dirname(envPath), { recursive: true });
  const existing = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  writeFileSync(envPath, upsertEnvContent(existing, updates), "utf8");
}

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  const name = id ? await resolveCatalogName(id) : null;
  if (!name) {
    return NextResponse.json({ ok: false, error: `unknown plugin "${id}"` }, { status: 400 });
  }
  const fields = await requiredConfigFor(name);
  const vault = getVaultStatuses();
  const out = fields.map((f) => {
    const inEnv = readEnvLocalValue(f.env) !== undefined || !!process.env[f.env]?.trim();
    const vaultEntry = vault.find((v) => v.key === f.env) ?? null;
    const satisfied = inEnv || canResolve(f.env);
    const source = inEnv ? "env" : vaultEntry?.status === "encrypted" ? "encrypted" : satisfied ? "vault" : "none";
    return {
      key: f.key,
      env: f.env,
      title: f.title,
      description: f.description ?? null,
      sensitive: f.sensitive,
      default: f.default ?? null, // suggested pre-fill; never present for sensitive fields
      validatable: hasValidator(f.env),
      satisfied,
      source,
      ref: vaultEntry?.ref ?? null, // an op:// reference, never a secret value
    };
  });
  return NextResponse.json({ ok: true, fields: out });
}

export async function POST(req: Request) {
  let body: { id?: unknown; key?: unknown; value?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  const id = typeof body?.id === "string" ? body.id : "";
  const key = typeof body?.key === "string" ? body.key : "";
  const value = typeof body?.value === "string" ? body.value : "";
  const name = id ? await resolveCatalogName(id) : null;
  if (!name) {
    return NextResponse.json({ ok: false, error: `unknown plugin "${id}"` }, { status: 400 });
  }
  const field = (await requiredConfigFor(name)).find((f) => f.key === key);
  if (!field) {
    return NextResponse.json({ ok: false, error: `unknown config key "${key}"` }, { status: 400 });
  }
  if (field.sensitive) {
    return NextResponse.json(
      { ok: false, error: "sensitive fields are set via /api/vault (op:// ref)" },
      { status: 400 },
    );
  }
  if (!value.trim()) {
    return NextResponse.json({ ok: false, error: "value is required" }, { status: 400 });
  }
  writeEnvLocal({ [field.env]: value });
  process.env[field.env] = value;
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
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
  if (!field || field.sensitive) {
    return NextResponse.json({ ok: false, error: `unknown config key "${key}"` }, { status: 400 });
  }
  writeEnvLocal({ [field.env]: null });
  delete process.env[field.env];
  return NextResponse.json({ ok: true });
}
