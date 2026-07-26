/**
 * POST /api/marketplace/validate-endpoint  { id }
 *
 * For a remote (URL-based) MCP plugin, probes whether its endpoint is reachable
 * and speaking MCP. Advisory connectivity check — not user authentication
 * (remote servers use in-client OAuth). The manifest path is built from the
 * trusted catalog name, never the request id.
 */

import { NextResponse } from "next/server";
import { checkMcpEndpoint } from "@/lib/endpoint-validators";
import { resolveCatalogName, remoteUrlFor } from "../config/catalog-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: { id?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  const id = typeof body?.id === "string" ? body.id : "";
  const name = id ? await resolveCatalogName(id) : null;
  if (!name) {
    return NextResponse.json({ ok: false, error: `unknown plugin "${id}"` }, { status: 400 });
  }
  const url = await remoteUrlFor(name);
  if (!url) {
    return NextResponse.json({ ok: false, error: "not a remote plugin" }, { status: 400 });
  }
  const result = await checkMcpEndpoint(url);
  return NextResponse.json({
    ok: true,
    reachable: result.reachable,
    detail: result.detail ?? null,
    error: result.error ?? null,
  });
}
