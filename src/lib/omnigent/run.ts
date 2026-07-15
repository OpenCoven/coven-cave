/**
 * Shared Omnigent session create used by the chat host-chip, board, and home.
 * Resolves familiar defaults → global defaults → live catalog/first online host.
 * When familiarId is set: Ward preflight (fail closed) + SOUL/IDENTITY prompt injection.
 */

import { bindingFor, type CaveConfig, type FamiliarOmnigentBinding } from "@/lib/cave-config";
import {
  OmnigentClient,
  OmnigentError,
  pickDefaultAgentId,
  pickDefaultHostId,
} from "./client.ts";
import type { OmnigentSession } from "./types.ts";
import {
  composeOmnigentPrompt,
  runWardPreflight,
  WardPreflightError,
} from "./ward-preflight.ts";
import { resolveWorkspaceForHost } from "./workspace-resolve.ts";

export { WardPreflightError };
export { resolveWorkspaceForHost } from "./workspace-resolve.ts";

export type OmnigentRunRequest = {
  prompt: string;
  title?: string;
  familiarId?: string;
  agentId?: string;
  hostId?: string;
  workspace?: string;
  hostType?: "external" | "managed";
  /** Extra labels merged after coven.* defaults. */
  labels?: Record<string, string>;
  /** Provenance: cave-fleet | cave-chat | cave-board | cave-home */
  source?: string;
  jobId?: string;
  boardCardId?: string;
  sourceSha256?: string;
  /**
   * Skip Ward + identity injection (escape hatch for tests / emergency fleet).
   * Default false: familiar-bound runs always preflight.
   */
  skipWardPreflight?: boolean;
};

export type OmnigentRunResult = {
  session: OmnigentSession;
  webUrl: string;
  baseUrl: string;
  resolved: {
    agentId: string;
    hostId?: string;
    workspace?: string;
    hostType: "external" | "managed";
    familiarId?: string;
    identityFiles?: Array<"SOUL.md" | "IDENTITY.md" | "USER.md">;
  };
};

function familiarOmnigent(
  config: CaveConfig,
  familiarId: string | undefined,
): FamiliarOmnigentBinding {
  if (!familiarId) return {};
  const binding = bindingFor(config, familiarId);
  return binding.omnigent ?? {};
}

/** Map a Cave/SSH host name through omnigent.hostMap when present. */
export function resolveHostIdFromMap(
  config: CaveConfig,
  hostIdOrAlias: string | undefined,
): string | undefined {
  if (!hostIdOrAlias) return undefined;
  const map = config.omnigent.hostMap ?? {};
  return map[hostIdOrAlias] || hostIdOrAlias;
}

/**
 * Create an Omnigent session with full default resolution.
 * Throws OmnigentError or Error with a human-readable message.
 */
export async function createOmnigentRun(
  config: CaveConfig,
  request: OmnigentRunRequest,
): Promise<OmnigentRunResult> {
  const baseUrl = config.omnigent.baseUrl;
  if (!baseUrl) {
    throw new Error("omnigent.baseUrl is not configured — set the server URL in Settings → Omnigent fleet");
  }

  const prompt = request.prompt.trim();
  if (!prompt) throw new Error("prompt is required");

  const familiar = request.familiarId?.trim() || undefined;

  // Identity layer: Ward fail-closed + SOUL/IDENTITY prefix when a familiar is bound.
  let sessionPrompt = prompt;
  let identityFiles: Array<"SOUL.md" | "IDENTITY.md" | "USER.md"> | undefined;
  if (familiar && !request.skipWardPreflight) {
    const identity = await runWardPreflight(familiar);
    sessionPrompt = composeOmnigentPrompt(prompt, identity.promptPrefix);
    identityFiles = identity.included;
  }

  const hostType = request.hostType === "managed" ? "managed" : "external";
  const fam = familiarOmnigent(config, request.familiarId);
  // Auth is optional for local single-user Omnigent; multi-user servers enforce
  // themselves. Databricks pointer records mint a bearer inside the client.
  const client = await OmnigentClient.fromBaseUrl(baseUrl);

  const [agents, hosts] = await Promise.all([client.listAgents(), client.listHosts()]);

  const agentId =
    (request.agentId && request.agentId.trim()) ||
    (fam.agentId && fam.agentId.trim()) ||
    pickDefaultAgentId(agents, config.omnigent.defaultAgentId);
  if (!agentId) {
    throw new Error("No catalog agents available on Omnigent server");
  }

  let hostId: string | undefined;
  let workspace: string | undefined;

  if (hostType === "external") {
    const rawHost =
      (request.hostId && request.hostId.trim()) ||
      (fam.hostId && fam.hostId.trim()) ||
      config.omnigent.defaultHostId ||
      undefined;
    hostId = resolveHostIdFromMap(config, rawHost) || pickDefaultHostId(hosts) || undefined;
    if (!hostId) throw new Error("No online Omnigent host available");

    const hostMeta = hosts.find((h) => h.host_id === hostId);
    workspace =
      (request.workspace && request.workspace.trim()) ||
      (fam.workspace && fam.workspace.trim()) ||
      resolveWorkspaceForHost(config.omnigent, hostId, hostMeta?.name) ||
      config.omnigent.defaultWorkspace ||
      undefined;
    if (!workspace || !workspace.startsWith("/")) {
      throw new Error(
        "workspace must be an absolute path on the host (set hostWorkspaceMap or defaultWorkspace)",
      );
    }
  } else {
    workspace =
      (request.workspace && request.workspace.trim()) ||
      (fam.workspace && fam.workspace.trim()) ||
      undefined;
  }

  const source = request.source?.trim() || "cave-fleet";
  const labels: Record<string, string> = {
    "coven.source": source,
    ...(request.labels ?? {}),
  };
  if (familiar) labels["coven.familiar"] = familiar;
  if (identityFiles?.length) labels["coven.identity"] = identityFiles.join(",");
  if (request.jobId) labels["coven.job_id"] = request.jobId;
  if (request.boardCardId) labels["coven.board_card"] = request.boardCardId;
  if (request.sourceSha256) labels["coven.source_sha256"] = request.sourceSha256;

  const title =
    (request.title && request.title.trim()) ||
    (familiar ? `${familiar}: ${prompt.slice(0, 48)}` : undefined);

  try {
    const session = await client.createSession({
      agentId,
      hostId,
      workspace,
      hostType,
      prompt: sessionPrompt,
      familiar,
      title,
      sourceSha256: request.sourceSha256,
      labels,
    });
    return {
      session,
      webUrl: client.webSessionUrl(session.id),
      baseUrl: client.baseUrl,
      resolved: {
        agentId,
        hostId,
        workspace,
        hostType,
        familiarId: familiar,
        ...(identityFiles?.length ? { identityFiles } : {}),
      },
    };
  } catch (err) {
    if (err instanceof WardPreflightError) throw err;
    if (err instanceof OmnigentError) {
      throw new Error(
        `${err.message}${err.body ? `: ${err.body.slice(0, 300)}` : ""}`,
      );
    }
    throw err;
  }
}
