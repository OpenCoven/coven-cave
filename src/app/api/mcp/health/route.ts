/**
 * /api/mcp/health
 *
 * Runs the MCP doctor over the marketplace registry
 * (`marketplace/exports/mcp/mcp.json`): remote (http/sse) entries get a real
 * JSON-RPC `initialize` probe, stdio entries get a launcher-on-PATH check, and
 * `${PLACEHOLDER}` requirements are surfaced by name. Read-only and advisory;
 * never returns env/secret values and never spawns server processes.
 */

import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { diagnoseRegistry, systemDoctorDeps, type McpServerHealth } from "@/lib/mcp-doctor";

export type { McpServerHealth } from "@/lib/mcp-doctor";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export type McpHealthResponse = {
  ok: boolean;
  checkedAt: string;
  servers: McpServerHealth[];
};

const REGISTRY = path.join(process.cwd(), "marketplace", "exports", "mcp", "mcp.json");

export async function GET() {
  const checkedAt = new Date().toISOString();
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(REGISTRY, "utf8"));
  } catch {
    return NextResponse.json({ ok: true, checkedAt, servers: [] as McpServerHealth[] });
  }
  const servers = await diagnoseRegistry(raw, systemDoctorDeps);
  return NextResponse.json({ ok: true, checkedAt, servers });
}
