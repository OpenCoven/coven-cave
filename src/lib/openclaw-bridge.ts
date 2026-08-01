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
  // OpenClaw 2026.7 emits the completed agent result at the top level when
  // `openclaw agent --json --local` runs the embedded agent. Keep the legacy
  // nested shape below for older Gateway-backed releases.
  payloads?: Array<{ text?: string; content?: unknown }>;
  result?: {
    payloads?: Array<{ text?: string; content?: unknown }>;
    sessionId?: string;
    meta?: { agentMeta?: { sessionId?: string } };
  };
  meta?: { agentMeta?: { sessionId?: string } };
};

export type OpenClawCliExecutionMode = "gateway" | "local";

export type OpenClawAgentSummary = {
  id: string;
  name?: string | null;
  identityName?: string | null;
  isDefault?: boolean;
  workspace?: string | null;
};

const OPENCLAW_AGENT_CACHE_TTL_MS = 5_000;
let openClawAgentCache:
  | { expiresAt: number; agents: OpenClawAgentSummary[] }
  | null = null;
let openClawAgentListInFlight: Promise<OpenClawAgentSummary[]> | null = null;

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
  source: "explicit" | "id-match" | "name-match" | "default" | "fallback";
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

export function parseOpenClawAgentList(value: unknown): OpenClawAgentSummary[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const agents: OpenClawAgentSummary[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") return [];
    const row = candidate as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id.trim() : "";
    if (!id || seen.has(id)) return [];
    if (row.name != null && typeof row.name !== "string") return [];
    if (row.identityName != null && typeof row.identityName !== "string") return [];
    if (row.isDefault != null && typeof row.isDefault !== "boolean") return [];
    if (row.workspace != null && typeof row.workspace !== "string") return [];

    seen.add(id);
    agents.push({
      id,
      ...(typeof row.name === "string" ? { name: row.name } : {}),
      ...(typeof row.identityName === "string" ? { identityName: row.identityName } : {}),
      ...(typeof row.isDefault === "boolean" ? { isDefault: row.isDefault } : {}),
      ...(typeof row.workspace === "string" ? { workspace: row.workspace } : {}),
    });
  }
  return agents;
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

async function loadOpenClawAgents(): Promise<OpenClawAgentSummary[]> {
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
    let settled = false;
    const finish = (agents: OpenClawAgentSummary[]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(agents);
    };
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      finish([]);
    }, 15_000);
    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString("utf8");
    });
    child.on("error", () => finish([]));
    child.on("close", (code) => {
      if (code !== 0) {
        finish([]);
        return;
      }
      try {
        finish(parseOpenClawAgentList(JSON.parse(stdout.trim())));
      } catch {
        finish([]);
      }
    });
  });
}

export async function listOpenClawAgents(): Promise<OpenClawAgentSummary[]> {
  const now = Date.now();
  if (openClawAgentCache && openClawAgentCache.expiresAt > now) {
    return openClawAgentCache.agents;
  }
  if (openClawAgentListInFlight) return openClawAgentListInFlight;

  openClawAgentListInFlight = loadOpenClawAgents()
    .then((agents) => {
      openClawAgentCache = {
        expiresAt: Date.now() + OPENCLAW_AGENT_CACHE_TTL_MS,
        agents,
      };
      return agents;
    })
    .finally(() => {
      openClawAgentListInFlight = null;
    });
  return openClawAgentListInFlight;
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

  const defaults = agents.filter((agent) => agent.isDefault === true);
  if (defaults.length === 1) {
    return {
      caveFamiliarId: familiarId,
      openclawAgentId: defaults[0].id,
      source: "default",
    };
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasPayloads(value: object): boolean {
  return Object.prototype.hasOwnProperty.call(value, "payloads");
}

function validPayloadArray(value: unknown): value is Array<{ text?: string; content?: unknown }> {
  return Array.isArray(value) && value.every(isRecord);
}

/**
 * The CLI has shipped both top-level and nested result payload envelopes. A
 * syntactically valid JSON response is not enough: malformed payload shapes
 * must be rejected by the route's fixed diagnostic path rather than throwing
 * while the child close handler is finalizing the stream.
 */
export function hasValidOpenClawPayloadEnvelope(json: OpenClawAgentJson): boolean {
  if (!isRecord(json)) return false;
  if (hasPayloads(json) && !validPayloadArray(json.payloads)) return false;
  if (json.result && (!isRecord(json.result) || (hasPayloads(json.result) && !validPayloadArray(json.result.payloads)))) {
    return false;
  }
  return true;
}

export function extractOpenClawText(json: OpenClawAgentJson): string {
  const payloads = json.payloads ?? json.result?.payloads ?? [];
  if (!validPayloadArray(payloads)) return "";
  const text = payloads
    .map((payload) => {
      if (typeof payload.text === "string") return payload.text;
      if (typeof payload.content === "string") return payload.content;
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
      if (
        payload.content &&
        typeof payload.content === "object" &&
        "text" in payload.content &&
        typeof payload.content.text === "string"
      ) {
        return payload.content.text;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n\n")
    .trim();
  return text || (typeof json.summary === "string" ? json.summary.trim() : "");
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
  executionMode: OpenClawCliExecutionMode = "gateway",
): string[] {
  return [
    "agent",
    ...(executionMode === "local" ? ["--local"] : []),
    "--agent",
    agentId,
    "--message",
    harnessPrompt,
    "--json",
    "--session-id",
    openClawSessionKey(conversationId),
  ];
}

/**
 * Embedded execution is an explicit operator choice. Cave keeps the CLI's
 * Gateway-owned dispatch as the compatibility default so a paired remote
 * OpenClaw installation retains its session and agent ownership.
 */
export function openClawCliExecutionMode(env: NodeJS.ProcessEnv = process.env): OpenClawCliExecutionMode {
  const value = env.OPENCLAW_EMBEDDED_LOCAL?.trim().toLowerCase();
  return value === "1" || value === "true" ? "local" : "gateway";
}

/** A safe retry signal: the CLI reached no Gateway-owned turn because its own credential gate rejected it. */
export function isOpenClawGatewayCredentialFailure(stderr: string): boolean {
  return /(?:GatewayCredentialsRequiredError|gateway agent requires credentials before opening a websocket)/i.test(stderr);
}
