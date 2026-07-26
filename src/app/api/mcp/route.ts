/**
 * /api/mcp
 *
 * Lists the MCP servers available to attach to a workflow, read from the
 * marketplace registry (`marketplace/exports/mcp/mcp.json`). Each entry is the
 * server's id plus its transport and target (command or url) for display in the
 * attach picker. Read-only; never returns env/secret values.
 */

import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export type McpServerInfo = {
  id: string;
  transport: "stdio" | "http" | string;
  /** The command (stdio) or url (http), for a one-line subtitle. */
  target?: string;
};

const REGISTRY = path.join(process.cwd(), "marketplace", "exports", "mcp", "mcp.json");

export async function GET() {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(REGISTRY, "utf8"));
  } catch {
    return NextResponse.json({ ok: true, servers: [] as McpServerInfo[] });
  }
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const servers = (obj.mcpServers && typeof obj.mcpServers === "object" ? obj.mcpServers : {}) as Record<
    string,
    Record<string, unknown>
  >;
  const out: McpServerInfo[] = Object.entries(servers)
    .map(([id, entry]) => {
      const transport = typeof entry?.type === "string" ? entry.type : "stdio";
      const target =
        typeof entry?.url === "string"
          ? entry.url
          : typeof entry?.command === "string"
            ? [entry.command, ...(Array.isArray(entry.args) ? (entry.args as string[]) : [])].join(" ")
            : undefined;
      return { id, transport, target };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  return NextResponse.json({ ok: true, servers: out });
}
