import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { covenHome } from "./coven-paths.ts";
import type { ChatAttachment } from "./chat-attachments.ts";
import type { ChatResponseMetadata } from "./chat-response-metadata.ts";

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

type OpenClawBridgeRequest = {
  familiarId: string;
  prompt: string;
  conversationId?: string;
  projectRoot?: string;
  attachments?: ChatAttachment[];
  controls?: {
    reasoningEffort?: "low" | "medium" | "high";
    responseSpeed?: "fast" | "balanced" | "careful";
  };
};

export type OpenClawAgentBinding = {
  caveFamiliarId: string;
  openclawAgentId: string;
  source: "explicit" | "id-match" | "name-match" | "fallback";
};

export type OpenClawBridgeCapabilities = {
  streaming: boolean;
  toolEvents: boolean;
  stableSessionKey: boolean;
  localFileAttachments: false;
  sshRuntime: false;
  modelOverride: false | "agent-owned";
  nativeMemory: true;
  nativeSkills: true;
  nativeMessaging: true;
};

export type OpenClawBridgeEvent =
  | { kind: "session"; sessionId: string }
  | { kind: "user"; text: string }
  | { kind: "assistant_chunk"; text: string }
  | { kind: "tool_use"; id?: string; name: string; input?: string; output?: string; status?: string }
  | { kind: "progress"; id: string; label: string; status: "running" | "done" | "error"; detail?: string }
  | { kind: "done"; sessionId: string; durationMs: number; isError?: boolean; responseMetadata: ChatResponseMetadata }
  | { kind: "error"; message: string; code?: string };

export interface RuntimeBridge {
  id: "openclaw";
  resolveAgent(familiarId: string): Promise<OpenClawAgentBinding>;
  capabilities(): OpenClawBridgeCapabilities;
  send(request: OpenClawBridgeRequest): AsyncIterable<OpenClawBridgeEvent>;
}

export class OpenClawAgentResolutionError extends Error {
  readonly code = "OPENCLAW_AGENT_NOT_FOUND";
  readonly familiarId: string;

  constructor(familiarId: string) {
    super(
      `No OpenClaw agent is bound to Cave familiar "${familiarId}". Add familiar.openclaw_agent or create an OpenClaw agent with a matching id/name.`,
    );
    this.name = "OpenClawAgentResolutionError";
    this.familiarId = familiarId;
  }
}

export function openClawBridgeCapabilities(): OpenClawBridgeCapabilities {
  return {
    streaming: false,
    toolEvents: false,
    stableSessionKey: true,
    localFileAttachments: false,
    sshRuntime: false,
    modelOverride: false,
    nativeMemory: true,
    nativeSkills: true,
    nativeMessaging: true,
  };
}

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
  options: { allowFallback?: boolean } = {},
): string {
  return resolveOpenClawAgentBindingFromSources(familiarId, explicit, agents, options)
    .openclawAgentId;
}

export function resolveOpenClawAgentBindingFromSources(
  familiarId: string,
  explicit: string | null,
  agents: OpenClawAgentSummary[],
  options: { allowFallback?: boolean } = {},
): OpenClawAgentBinding {
  if (explicit) {
    return { caveFamiliarId: familiarId, openclawAgentId: explicit, source: "explicit" };
  }

  const exact = agents.find((agent) => agent.id === familiarId)?.id;
  if (exact) {
    return { caveFamiliarId: familiarId, openclawAgentId: exact, source: "id-match" };
  }

  const named = agents.find(
    (agent) =>
      (agent.name && slugifyOpenClawAgentName(agent.name) === familiarId) ||
      (agent.identityName && slugifyOpenClawAgentName(agent.identityName) === familiarId),
  )?.id;
  if (named) {
    return { caveFamiliarId: familiarId, openclawAgentId: named, source: "name-match" };
  }

  if (options.allowFallback) {
    return { caveFamiliarId: familiarId, openclawAgentId: familiarId, source: "fallback" };
  }

  throw new OpenClawAgentResolutionError(familiarId);
}

export async function resolveOpenClawAgentId(familiarId: string): Promise<string> {
  return (await resolveOpenClawAgentBinding(familiarId)).openclawAgentId;
}

export async function resolveOpenClawAgentBinding(familiarId: string): Promise<OpenClawAgentBinding> {
  const explicit = await readOpenClawAgentBinding(familiarId);
  if (explicit) {
    return { caveFamiliarId: familiarId, openclawAgentId: explicit, source: "explicit" };
  }

  const agents = await listOpenClawAgents();
  return resolveOpenClawAgentBindingFromSources(familiarId, null, agents);
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
 * sessions are persisted per explicit session id/key (`agent:<id>:explicit:<value>`); the
 * `sessionId` inside an entry rotates on daily resets, `/new`, and
 * compaction. Pinning each Cave chat to its own explicit `--session-id` value keeps one
 * durable gateway session per conversation. Without an explicit id/key, every turn lands
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
    "--session-id",
    openClawSessionKey(conversationId),
  ];
}
