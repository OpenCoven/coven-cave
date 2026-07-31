import { NextResponse } from "next/server";
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { summarizeOpenClawAgent } from "@/lib/openclaw-agents";
import { listOpenClawAgents } from "@/lib/openclaw-bridge";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function readIdentity(workspacePath: string): Promise<string | null> {
  try {
    return await readFile(path.join(workspacePath, "IDENTITY.md"), "utf8");
  } catch {
    return null;
  }
}

export async function GET() {
  const home = homedir();
  const agentsRoot = path.join(home, ".openclaw", "agents");
  const workspaceRoot = path.join(home, ".openclaw", "workspace");
  const registeredAgents = await listOpenClawAgents();

  const agents = await Promise.all(
    registeredAgents
      .map(async (agent) => {
        const id = agent.id;
        const workspacePath = agent.workspace?.trim() || path.join(workspaceRoot, id);
        const exists = await stat(workspacePath).then((s) => s.isDirectory()).catch(() => false);
        const identity = exists ? await readIdentity(workspacePath) : null;
        const summary = summarizeOpenClawAgent(id, identity, exists ? workspacePath : null);
        return {
          ...summary,
          displayName: agent.name?.trim() || agent.identityName?.trim() || summary.displayName,
          isDefault: agent.isDefault === true,
        };
      }),
  );

  agents.sort((a, b) => a.displayName.localeCompare(b.displayName));

  return NextResponse.json({ ok: true, agents, agentsRoot, workspaceRoot });
}
