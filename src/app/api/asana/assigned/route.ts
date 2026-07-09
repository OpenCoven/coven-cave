/**
 * /api/asana/assigned
 *
 * Returns the incomplete Asana tasks assigned to the connected user, mirroring
 * /api/github/assigned. The Asana `/tasks` endpoint needs (assignee + workspace),
 * so we first read `users/me` for the workspace list, then fan out. `configured`
 * is false when no PAT is stored — the "Asana connected" signal the UI gates on.
 */

import { NextResponse } from "next/server";
import type { AsanaItem } from "@/lib/asana-tasks";
import { resolveSecret } from "@/lib/vault";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const API = "https://app.asana.com/api/1.0";
const TASK_FIELDS = "name,permalink_url,completed,due_on,modified_at,assignee.name,projects.name";
// Bound the fan-out — a user in many workspaces shouldn't spray dozens of calls.
const MAX_WORKSPACES = 5;
const PER_WORKSPACE = 50;

type AsanaMe = {
  gid: string;
  name?: string;
  email?: string;
  workspaces?: Array<{ gid: string; name?: string }>;
};

type RawAsanaTask = {
  gid: string;
  name?: string;
  permalink_url?: string;
  completed?: boolean;
  due_on?: string | null;
  modified_at?: string;
  assignee?: { name?: string } | null;
  projects?: Array<{ gid: string; name?: string }> | null;
};

function resolveAsanaToken(): string | undefined {
  return (
    resolveSecret("ASANA_PAT") ??
    process.env.ASANA_PAT?.trim() ??
    process.env.ASANA_ACCESS_TOKEN?.trim()
  );
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, Accept: "application/json" };
}

function permalinkFor(task: RawAsanaTask): string {
  if (task.permalink_url) return task.permalink_url;
  // Fallback permalink if the field was omitted — the my-tasks focus layout.
  return `https://app.asana.com/0/0/${task.gid}/f`;
}

function toItem(task: RawAsanaTask, workspaceGid: string): AsanaItem {
  const project = task.projects?.[0];
  return {
    kind: "task",
    id: task.gid,
    gid: task.gid,
    title: task.name?.trim() || `Asana task ${task.gid}`,
    url: permalinkFor(task),
    projectGid: project?.gid,
    projectName: project?.name,
    assignee: task.assignee?.name,
    completed: task.completed ?? false,
    dueOn: task.due_on ?? null,
    updatedAt: task.modified_at ?? new Date(0).toISOString(),
    workspaceGid,
  };
}

export async function GET() {
  const token = resolveAsanaToken();
  if (!token) {
    return NextResponse.json({ ok: true, items: [], configured: false });
  }

  const headers = authHeaders(token);

  try {
    const meRes = await fetch(`${API}/users/me?opt_fields=name,email,workspaces.name`, {
      headers,
      cache: "no-store",
    });
    if (!meRes.ok) {
      return NextResponse.json(
        { ok: false, error: `Asana API error: HTTP ${meRes.status}`, items: [] },
        { status: 502 },
      );
    }
    const meData = (await meRes.json().catch(() => null)) as { data?: AsanaMe } | null;
    const me = meData?.data;
    const workspaces = (me?.workspaces ?? []).slice(0, MAX_WORKSPACES);
    if (workspaces.length === 0) {
      return NextResponse.json({ ok: true, items: [], configured: true });
    }

    const perWorkspace = await Promise.all(
      workspaces.map(async (ws) => {
        // completed_since=now returns only tasks still incomplete.
        const url =
          `${API}/tasks?assignee=me&workspace=${encodeURIComponent(ws.gid)}` +
          `&completed_since=now&limit=${PER_WORKSPACE}&opt_fields=${encodeURIComponent(TASK_FIELDS)}`;
        const res = await fetch(url, { headers, cache: "no-store" });
        if (!res.ok) return [] as AsanaItem[];
        const data = (await res.json().catch(() => null)) as { data?: RawAsanaTask[] } | null;
        return (data?.data ?? []).filter((t) => !t.completed).map((t) => toItem(t, ws.gid));
      }),
    );

    const seen = new Set<string>();
    const items: AsanaItem[] = [];
    for (const item of perWorkspace.flat()) {
      if (seen.has(item.gid)) continue;
      seen.add(item.gid);
      items.push(item);
    }
    items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

    return NextResponse.json({ ok: true, items, configured: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message, items: [] }, { status: 502 });
  }
}
