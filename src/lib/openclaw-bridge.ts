import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { covenHome } from "./coven-paths.ts";

export type OpenClawAgentJson = {
  status?: string;
  summary?: string;
  sessionId?: string;
  result?: {
    payloads?: Array<{ text?: string; content?: unknown }>;
    sessionId?: string;
    meta?: { agentMeta?: { sessionId?: string } };
  };
  meta?: { agentMeta?: { sessionId?: string } };
};

export type OpenClawAgentSummary = {
  id?: string;
  name?: string;
  identityName?: string;
  isDefault?: boolean;
};

export function readTomlString(block: string, key: string): string | null {
  const quoted = block.match(new RegExp(`^\\s*${key}\\s*=\\s*(['"])(.*?)\\1\\s*(?:#.*)?$`, "m"));
  if (quoted) return quoted[2];
  const bare = block.match(new RegExp(`^\\s*${key}\\s*=\\s*([^\\s#]+)\\s*(?:#.*)?$`, "m"));
  return bare?.[1] ?? null;
}

export function slugifyOpenClawAgentName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function readOpenClawAgentBinding(familiarId: string): Promise<string | null> {
  try {
    const raw = await readFile(path.join(covenHome(), "familiars.toml"), "utf8");
    const blocks = raw.split(/^\s*\[\[familiar\]\]\s*$/m).slice(1);
    for (const block of blocks) {
      if (readTomlString(block, "id") !== familiarId) continue;
      return readTomlString(block, "openclaw_agent");
    }
  } catch {
    /* no familiar binding file */
  }
  return null;
}

export async function listOpenClawAgents(): Promise<OpenClawAgentSummary[]> {
  const {
    openClawBin,
    openClawNeedsShell,
    openClawSpawnArgs,
    openClawSpawnEnv,
  } = await import("./openclaw-bin.ts");
  return new Promise((resolve) => {
    const child = spawn(openClawBin(), openClawSpawnArgs(["agents", "list", "--json"]), {
      stdio: ["ignore", "pipe", "ignore"],
      env: openClawSpawnEnv(),
      shell: openClawNeedsShell(),
    });
    let stdout = "";
    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString("utf8");
    });
    child.on("error", () => resolve([]));
    child.on("close", () => {
      try {
        const parsed = JSON.parse(stdout.trim()) as OpenClawAgentSummary[];
        resolve(Array.isArray(parsed) ? parsed : []);
      } catch {
        resolve([]);
      }
    });
  });
}

export function resolveOpenClawAgentIdFromSources(
  familiarId: string,
  explicit: string | null,
  agents: OpenClawAgentSummary[],
): string {
  if (explicit) return explicit;

  const exact = agents.find((agent) => agent.id === familiarId)?.id;
  if (exact) return exact;

  const named = agents.find(
    (agent) =>
      (agent.name && slugifyOpenClawAgentName(agent.name) === familiarId) ||
      (agent.identityName && slugifyOpenClawAgentName(agent.identityName) === familiarId),
  )?.id;
  if (named) return named;

  return familiarId;
}

export async function resolveOpenClawAgentId(familiarId: string): Promise<string> {
  const explicit = await readOpenClawAgentBinding(familiarId);
  const agents = await listOpenClawAgents();
  return resolveOpenClawAgentIdFromSources(familiarId, explicit, agents);
}

export function extractOpenClawText(json: OpenClawAgentJson): string {
  const payloads = json.result?.payloads ?? [];
  const text = payloads
    .map((payload) => {
      if (typeof payload.text === "string") return payload.text;
      if (Array.isArray(payload.content)) {
        return payload.content
          .map((part) =>
            part &&
            typeof part === "object" &&
            "text" in part &&
            typeof part.text === "string"
              ? part.text
              : "",
          )
          .join("");
      }
      return "";
    })
    .filter(Boolean)
    .join("\n\n")
    .trim();
  return text || json.summary?.trim() || "";
}

export function extractOpenClawSessionId(
  json: OpenClawAgentJson,
  fallback?: string,
): string | null {
  return (
    json.sessionId ??
    json.result?.sessionId ??
    json.result?.meta?.agentMeta?.sessionId ??
    json.meta?.agentMeta?.sessionId ??
    fallback ??
    null
  );
}

/**
 * Conversation identity for the OpenClaw bridge is CAVE-owned. OpenClaw
 * sessions are persisted per session *key* (`agent:<id>:<key>`); the
 * `sessionId` inside an entry rotates on daily resets, `/new`, and
 * compaction. Pinning each Cave chat to its own `--session-key` keeps one
 * durable gateway session per conversation. Without a key, every turn lands
 * in the shared `agent:<id>:main` session — id rotation then forked each
 * Cave chat into a brand-new conversation, and concurrent chats with the
 * same familiar interleaved context.
 */
export function openClawSessionKey(conversationId: string): string {
  return `cave-${conversationId.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`;
}

export function openClawAgentArgs(
  harnessPrompt: string,
  agentId: string,
  conversationId: string,
): string[] {
  return [
    "agent",
    "--agent",
    agentId,
    "--message",
    harnessPrompt,
    "--json",
    "--session-key",
    openClawSessionKey(conversationId),
  ];
}
