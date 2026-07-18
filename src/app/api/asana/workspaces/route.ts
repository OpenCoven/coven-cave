/**
 * /api/asana/workspaces
 *
 * Lists the connected user's Asana workspaces — the options for a familiar's
 * per-agent workspace scope (Familiar Studio → Brain → Asana). Reads the same
 * app-wide PAT as /api/asana/assigned; `configured:false` when none is stored.
 */

import { NextResponse } from "next/server";
import type { AsanaWorkspace } from "@/lib/asana-tasks";
import { resolveSecret } from "@/lib/vault";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const API = "https://app.asana.com/api/1.0";

function resolveAsanaToken(): string | undefined {
  return (
    resolveSecret("ASANA_PAT") ??
    process.env.ASANA_PAT?.trim() ??
    process.env.ASANA_ACCESS_TOKEN?.trim()
  );
}

export async function GET() {
  const token = resolveAsanaToken();
  if (!token) {
    return NextResponse.json({ ok: true, configured: false, workspaces: [] });
  }

  try {
    const res = await fetch(`${API}/users/me?opt_fields=workspaces.name`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, configured: true, workspaces: [], error: `Asana API error: HTTP ${res.status}` },
        { status: 502 },
      );
    }
    const data = (await res.json().catch(() => null)) as {
      data?: { workspaces?: Array<{ gid: string; name?: string }> };
    } | null;
    const workspaces: AsanaWorkspace[] = (data?.data?.workspaces ?? []).map((ws) => ({
      gid: ws.gid,
      name: ws.name?.trim() || ws.gid,
    }));
    return NextResponse.json({ ok: true, configured: true, workspaces });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, configured: true, workspaces: [], error: message }, { status: 502 });
  }
}
