import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  BUILTIN_OPENCLAW_TOOL_PROFILES,
  selectOpenClawToolProfile,
  validateOpenClawToolProfiles,
  type OpenClawGatewayDiscovery,
  type OpenClawParsedToolEvent,
} from "./openclaw-compatibility.ts";

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
  /**
   * Bridge implementation support. Runtime activation remains compatibility-negotiated.
   * `negotiateOpenClawBridgeSession` below derives the streaming/toolEvents outcome per
   * conversation from the discovered gateway version and event-schema hash.
   */
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
  /**
   * Versioned gateway/bridge negotiation for one conversation. Optional while
   * runtimes migrate: an implementation that omits it stays at the
   * implementation-level `capabilities()` above, and conversations default to
   * plain chat rather than to structured tool activity.
   */
  negotiateSession?(input: OpenClawBridgeNegotiationInput): OpenClawBridgeNegotiation;
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
    streaming: true,
    toolEvents: true,
    stableSessionKey: true,
    localFileAttachments: false,
    sshRuntime: false,
    modelOverride: false,
    nativeMemory: true,
    nativeSkills: true,
    nativeMessaging: true,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Versioned gateway/bridge negotiation (issue #4892 slice).
//
// The flags above describe what this bridge implementation supports; whether a
// given OpenClaw runtime may actually use them is decided per conversation by
// negotiating the discovered gateway/runtime version, wire protocol, and
// AgentEventSchema hash against validated compatibility profiles
// (`OpenClawToolProfile.requires` from the source-trusted built-in profile or a
// verified registry bundle). Everything here is fixture-tested and fail-closed:
// an unsupported version, an unvalidated schema hash, or an unknown event
// degrades to plain chat with a visible, value-free diagnostic instead of
// silently dropping tool activity. No live OpenClaw calls, no stdout parsing.
// ─────────────────────────────────────────────────────────────────────────────

export type OpenClawBridgeNegotiationDiagnostic =
  | "gateway-discovery-unavailable"
  | "unsupported-gateway-version"
  | "unsupported-wire-protocol"
  | "schema-hash-unvalidated"
  | "tool-events-not-offered";

export type OpenClawBridgeNegotiatedCapabilities = {
  streaming: boolean;
  toolEvents: boolean;
};

export type OpenClawBridgeNegotiation =
  | {
      outcome: "structured";
      gatewayVersion: string;
      protocol: number;
      /** The only schema hash tool-event parsing may trust for this conversation. */
      schemaHash: string;
      profileId: string;
      capabilities: OpenClawBridgeNegotiatedCapabilities;
    }
  | {
      outcome: "degraded";
      diagnostic: OpenClawBridgeNegotiationDiagnostic;
      /** Value-free runtime facts safe for diagnostics; never adopted for parsing. */
      gatewayVersion: string | null;
      protocol: number | null;
      discoveredSchemaHash: string | null;
      capabilities: OpenClawBridgeNegotiatedCapabilities;
    };

export type OpenClawBridgeValidatedNegotiation = {
  gatewayVersion: string;
  protocol: number;
  schemaHash: string;
  profileId: string;
};

const OPENCLAW_BRIDGE_SCHEMA_HASH_PATTERN = /^[a-f0-9]{64}$/;
const OPENCLAW_BRIDGE_DISCOVERY_KEYS = [
  "serverVersion",
  "protocol",
  "methods",
  "events",
  "serverCapabilities",
  "clientCapabilities",
  "agentEventSchemaHash",
] as const;
/** Matches the bounded-string ceiling the compatibility registry applies to catalog entries. */
const OPENCLAW_BRIDGE_MAX_STRING_BYTES = 256;
const OPENCLAW_BRIDGE_NEGOTIATION_LEDGER_LIMIT = 128;
const OPENCLAW_BRIDGE_PROJECTOR_OPEN_CALL_LIMIT = 128;
const OPENCLAW_BRIDGE_EVENT_PAYLOAD_CHARS = 2048;
const OPENCLAW_BRIDGE_TOOL_PAUSED_OUTPUT = "[OpenClaw tool activity was paused: unrecognized event]";
const OPENCLAW_BRIDGE_TOOL_DIAGNOSTIC_ID = "openclaw-tool-compatibility";

const OPENCLAW_BRIDGE_PLAIN_CHAT_CAPABILITIES: OpenClawBridgeNegotiatedCapabilities = {
  streaming: false,
  toolEvents: false,
};
const OPENCLAW_BRIDGE_STRUCTURED_CAPABILITIES: OpenClawBridgeNegotiatedCapabilities = {
  streaming: true,
  toolEvents: true,
};

function isBridgeRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isBoundedBridgeString(value: unknown): value is string {
  return (
    typeof value === "string"
    && value.length > 0
    && new TextEncoder().encode(value).byteLength <= OPENCLAW_BRIDGE_MAX_STRING_BYTES
  );
}

function boundedBridgeStringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const entries: string[] = [];
  for (const entry of value) {
    if (!isBoundedBridgeString(entry) || entries.includes(entry)) return null;
    entries.push(entry);
  }
  return entries;
}

/**
 * Bridge-side discovery validation hook. Accepts only the Cave-owned
 * `OpenClawGatewayDiscovery` shape (as produced by
 * `openClawDiscoveryFromHello`) — extra, missing, or malformed fields fail
 * closed rather than partially trusting the record. The discovered schema hash
 * is format-checked here; trusting it for event parsing additionally requires
 * `validateOpenClawBridgeSchemaHash` to accept it against validated profiles.
 */
export function parseOpenClawBridgeDiscovery(value: unknown): OpenClawGatewayDiscovery | null {
  if (!isBridgeRecord(value)) return null;
  const keys = Object.keys(value);
  if (
    keys.length !== OPENCLAW_BRIDGE_DISCOVERY_KEYS.length
    || !keys.every((key) => (OPENCLAW_BRIDGE_DISCOVERY_KEYS as readonly string[]).includes(key))
  ) return null;
  if (!isBoundedBridgeString(value.serverVersion)) return null;
  if (typeof value.protocol !== "number" || !Number.isSafeInteger(value.protocol) || value.protocol < 1) return null;
  const methods = boundedBridgeStringList(value.methods);
  const events = boundedBridgeStringList(value.events);
  const serverCapabilities = boundedBridgeStringList(value.serverCapabilities);
  const clientCapabilities = boundedBridgeStringList(value.clientCapabilities);
  if (!methods || !events || !serverCapabilities || !clientCapabilities) return null;
  if (
    typeof value.agentEventSchemaHash !== "string"
    || !OPENCLAW_BRIDGE_SCHEMA_HASH_PATTERN.test(value.agentEventSchemaHash)
  ) return null;
  return {
    serverVersion: value.serverVersion,
    protocol: value.protocol,
    methods,
    events,
    serverCapabilities,
    clientCapabilities,
    agentEventSchemaHash: value.agentEventSchemaHash,
  };
}

/**
 * Schema-hash validation hook: a discovered hash may only back new event
 * shapes when a validated compatibility profile declares exactly that hash.
 * Returns the validated hash, or null when the discovery must not be trusted.
 */
export function validateOpenClawBridgeSchemaHash(
  discoveredSchemaHash: unknown,
  profiles: unknown = BUILTIN_OPENCLAW_TOOL_PROFILES,
): string | null {
  if (typeof discoveredSchemaHash !== "string" || !OPENCLAW_BRIDGE_SCHEMA_HASH_PATTERN.test(discoveredSchemaHash)) {
    return null;
  }
  const candidates = validateOpenClawToolProfiles(profiles);
  if (!candidates) return null;
  return candidates.some((profile) => profile.requires.agentEventSchemaHash === discoveredSchemaHash)
    ? discoveredSchemaHash
    : null;
}

/**
 * Per-conversation record of the last validated negotiation. Rollback
 * protection: only negotiated-and-validated outcomes are ever remembered, so a
 * degraded turn can never replace a conversation's validated schema with an
 * unvalidated discovery, and a later valid discovery restores structured mode.
 */
export class OpenClawBridgeNegotiationLedger {
  readonly #limit: number;
  readonly #validated = new Map<string, OpenClawBridgeValidatedNegotiation>();

  constructor(limit = OPENCLAW_BRIDGE_NEGOTIATION_LEDGER_LIMIT) {
    this.#limit = limit;
  }

  lastValidated(conversationId: string): OpenClawBridgeValidatedNegotiation | null {
    return this.#validated.get(conversationId) ?? null;
  }

  rememberValidated(conversationId: string, entry: OpenClawBridgeValidatedNegotiation): void {
    if (typeof conversationId !== "string" || conversationId.length === 0) return;
    this.#validated.delete(conversationId);
    this.#validated.set(conversationId, entry);
    while (this.#validated.size > this.#limit) {
      const oldest = this.#validated.keys().next();
      if (oldest.done) break;
      this.#validated.delete(oldest.value);
    }
  }
}

export type OpenClawBridgeNegotiationInput = {
  conversationId: string;
  /** Raw, untrusted discovery record; validated before any use. */
  discovery: unknown;
  /**
   * Candidate profiles — the built-in profile by default, or the profile list
   * of a verified registry bundle (which is how a compatible schema version
   * refresh reaches conversations without a Cave release).
   */
  profiles?: unknown;
  ledger?: OpenClawBridgeNegotiationLedger;
};

function degradeOpenClawBridgeNegotiation(
  discovery: OpenClawGatewayDiscovery | null,
  diagnostic: OpenClawBridgeNegotiationDiagnostic,
): OpenClawBridgeNegotiation {
  return {
    outcome: "degraded",
    diagnostic,
    gatewayVersion: discovery?.serverVersion ?? null,
    protocol: discovery?.protocol ?? null,
    discoveredSchemaHash: discovery?.agentEventSchemaHash ?? null,
    capabilities: OPENCLAW_BRIDGE_PLAIN_CHAT_CAPABILITIES,
  };
}

/**
 * Negotiate one conversation's bridge capabilities from a gateway discovery
 * record. Supported version + protocol + validated schema hash + required
 * event contract → structured capabilities; anything else degrades to plain
 * chat with a diagnostic. Degraded outcomes never touch the ledger.
 */
export function negotiateOpenClawBridgeSession(input: OpenClawBridgeNegotiationInput): OpenClawBridgeNegotiation {
  const discovery = parseOpenClawBridgeDiscovery(input.discovery);
  if (!discovery) return degradeOpenClawBridgeNegotiation(null, "gateway-discovery-unavailable");

  const candidates = input.profiles === undefined
    ? validateOpenClawToolProfiles(BUILTIN_OPENCLAW_TOOL_PROFILES) ?? []
    : validateOpenClawToolProfiles(input.profiles) ?? [];
  if (input.profiles !== undefined && candidates.length === 0) {
    return degradeOpenClawBridgeNegotiation(discovery, "schema-hash-unvalidated");
  }

  const profile = selectOpenClawToolProfile(candidates, discovery);
  if (profile) {
    const validated: OpenClawBridgeValidatedNegotiation = {
      gatewayVersion: discovery.serverVersion,
      protocol: discovery.protocol,
      schemaHash: discovery.agentEventSchemaHash,
      profileId: profile.id,
    };
    input.ledger?.rememberValidated(input.conversationId, validated);
    return {
      outcome: "structured",
      ...validated,
      capabilities: OPENCLAW_BRIDGE_STRUCTURED_CAPABILITIES,
    };
  }

  const versionKnown = candidates.some((candidate) =>
    candidate.requires.serverVersions.includes(discovery.serverVersion));
  if (!versionKnown) return degradeOpenClawBridgeNegotiation(discovery, "unsupported-gateway-version");

  const protocolKnown = candidates.some((candidate) =>
    candidate.requires.serverVersions.includes(discovery.serverVersion)
    && candidate.requires.protocol === discovery.protocol);
  if (!protocolKnown) return degradeOpenClawBridgeNegotiation(discovery, "unsupported-wire-protocol");

  const schemaKnown = candidates.some((candidate) =>
    candidate.requires.serverVersions.includes(discovery.serverVersion)
    && candidate.requires.protocol === discovery.protocol
    && candidate.requires.agentEventSchemaHash === discovery.agentEventSchemaHash);
  if (!schemaKnown) return degradeOpenClawBridgeNegotiation(discovery, "schema-hash-unvalidated");

  return degradeOpenClawBridgeNegotiation(discovery, "tool-events-not-offered");
}

/**
 * The user-visible diagnostic for a degraded negotiation. Messages are
 * value-free per the compatibility registry's diagnostics contract: they may
 * name the runtime version, wire protocol, and schema hash, and never contain
 * prompts, paths, credentials, tool inputs or outputs, or raw frames.
 */
export function openClawBridgeNegotiationDiagnostic(negotiation: OpenClawBridgeNegotiation): string | null {
  if (negotiation.outcome === "structured") return null;
  switch (negotiation.diagnostic) {
    case "gateway-discovery-unavailable":
      return "OpenClaw tool activity is unavailable: gateway discovery was missing or malformed; plain chat is retained.";
    case "unsupported-gateway-version":
      return `OpenClaw tool activity is unavailable: gateway version ${negotiation.gatewayVersion ?? "unknown"} has no validated compatibility profile; plain chat is retained.`;
    case "unsupported-wire-protocol":
      return `OpenClaw tool activity is unavailable: gateway wire protocol ${negotiation.protocol ?? "unknown"} for version ${negotiation.gatewayVersion ?? "unknown"} is not validated; plain chat is retained.`;
    case "schema-hash-unvalidated":
      return `OpenClaw tool activity is unavailable: discovered event schema ${negotiation.discoveredSchemaHash ?? "unknown"} is not a validated compatibility schema; plain chat is retained.`;
    case "tool-events-not-offered":
      return "OpenClaw tool activity is unavailable: the gateway did not offer the tool-event contract its compatibility profile requires; plain chat is retained.";
  }
}

/**
 * Bridge capabilities for a negotiated session: the negotiated
 * streaming/toolEvents outcome instead of the implementation-level defaults.
 */
export function openClawBridgeCapabilitiesFromNegotiation(
  negotiation: OpenClawBridgeNegotiation,
): OpenClawBridgeCapabilities {
  return {
    ...openClawBridgeCapabilities(),
    streaming: negotiation.outcome === "structured",
    toolEvents: negotiation.outcome === "structured",
  };
}

function boundedOpenClawBridgeEventPayload(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  let serialized: string;
  try {
    serialized = JSON.stringify(value) ?? "";
  } catch {
    return undefined;
  }
  return serialized.length > OPENCLAW_BRIDGE_EVENT_PAYLOAD_CHARS
    ? `${serialized.slice(0, OPENCLAW_BRIDGE_EVENT_PAYLOAD_CHARS)}…`
    : serialized;
}

export type OpenClawBridgeToolProjectorHints = {
  toolName?: string;
};

export type OpenClawBridgeToolProjector = {
  readonly negotiation: OpenClawBridgeNegotiation;
  /** True once an unknown event fail-closed the projector for this conversation. */
  readonly paused: boolean;
  project(parsed: OpenClawParsedToolEvent, hints?: OpenClawBridgeToolProjectorHints): OpenClawBridgeEvent[];
};

/**
 * Projects validated-profile tool events onto bridge events. Fail-closed on
 * unknown events: the first unrecognized event settles every open call with a
 * visible error, emits one value-free diagnostic (shape fingerprint only —
 * never payloads), and pauses projection so unvalidated shapes cannot leak
 * into tool activity. Degraded sessions project nothing (plain chat).
 */
export function createOpenClawBridgeToolProjector(
  negotiation: OpenClawBridgeNegotiation,
): OpenClawBridgeToolProjector {
  const openCalls = new Map<string, string>();
  let paused = false;
  let diagnosticSent = false;

  const rememberOpenCall = (id: string, name: string) => {
    openCalls.delete(id);
    openCalls.set(id, name);
    while (openCalls.size > OPENCLAW_BRIDGE_PROJECTOR_OPEN_CALL_LIMIT) {
      const oldest = openCalls.keys().next();
      if (oldest.done) break;
      openCalls.delete(oldest.value);
    }
  };

  return {
    negotiation,
    get paused() {
      return paused;
    },
    project(parsed, hints = {}) {
      if (negotiation.outcome !== "structured" || paused) return [];

      if (parsed.kind === "unknown") {
        paused = true;
        const events: OpenClawBridgeEvent[] = [];
        for (const [id, name] of openCalls) {
          events.push({
            kind: "tool_use",
            id,
            name,
            status: "error",
            output: OPENCLAW_BRIDGE_TOOL_PAUSED_OUTPUT,
          });
        }
        openCalls.clear();
        if (!diagnosticSent) {
          diagnosticSent = true;
          events.push({
            kind: "progress",
            id: OPENCLAW_BRIDGE_TOOL_DIAGNOSTIC_ID,
            label: "OpenClaw tool activity",
            status: "error",
            detail: `unknown tool event (fingerprint ${parsed.fingerprint}); plain chat retained`,
          });
        }
        return events;
      }

      if (parsed.kind === "tool_start") {
        rememberOpenCall(parsed.id, parsed.name);
        return [{
          kind: "tool_use",
          id: parsed.id,
          name: parsed.name,
          input: boundedOpenClawBridgeEventPayload(parsed.input),
          status: "running",
        }];
      }

      if (parsed.kind === "tool_progress") {
        const name = openCalls.get(parsed.id) ?? hints.toolName;
        const output = boundedOpenClawBridgeEventPayload(parsed.output);
        if (name) {
          return [{ kind: "tool_use", id: parsed.id, name, output, status: "running" }];
        }
        return [{
          kind: "progress",
          id: parsed.id,
          label: "OpenClaw tool",
          status: "running",
          detail: output,
        }];
      }

      const events: OpenClawBridgeEvent[] = [{
        kind: "tool_use",
        id: parsed.id,
        name: parsed.name,
        output: boundedOpenClawBridgeEventPayload(parsed.output),
        status: parsed.isError ? "error" : "done",
      }];
      openCalls.delete(parsed.id);
      return events;
    },
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
      windowsHide: true,
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
