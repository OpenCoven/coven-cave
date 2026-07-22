// Native Grok Build headless integration.
//
// This deliberately does not read the coven-runtimes registry: Grok's
// proposed registry adapter is not merged, while Cave needs the CLI's real
// streaming/session contract to drive a local chat safely.

export type RuntimeModelOption = { id: string; label: string };
export type GrokSandboxProfile = "full" | "read";

export type GrokStreamEvent =
  | { kind: "text"; text: string }
  | {
      kind: "end";
      sessionId?: string;
      isError: boolean;
      usage?: unknown;
      totalCostUsd?: unknown;
    }
  | { kind: "error"; message: string; usage?: unknown; totalCostUsd?: unknown }
  | { kind: "ignore" };

/** Parse the public, human-readable output of `grok models` without retaining
 * authentication details. The CLI has no JSON model-list mode as of 0.2.106. */
export function parseGrokModels(output: string): {
  models: RuntimeModelOption[];
  defaultModel: string | null;
} {
  const defaultMatch = output.match(/^Default model:\s*(\S+)\s*$/im);
  const defaultModel = defaultMatch?.[1] ?? null;
  const models = new Map<string, RuntimeModelOption>();
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*\*\s+([^\s(]+)(?:\s+\((default)\))?\s*$/i);
    if (!match) continue;
    const id = match[1];
    models.set(id, { id, label: match[2] ? `${id} (default)` : id });
  }
  if (defaultModel && !models.has(defaultModel)) {
    models.set(defaultModel, { id: defaultModel, label: `${defaultModel} (default)` });
  }
  return { models: [...models.values()], defaultModel };
}

function bareModel(model: string | null): string | null {
  if (!model) return null;
  const slash = model.lastIndexOf("/");
  return slash >= 0 ? model.slice(slash + 1) || null : model;
}

/**
 * Cave's global default belongs to its own provider. When a Grok familiar
 * merely inherits that default, omit `--model` and let the installed CLI use
 * the authenticated account's current default instead of pinning a
 * compile-time Grok model name that may not be available on this install.
 */
export function grokShouldUseCliDefault(input: {
  modelSource: string;
  globalDefaultModel: string;
}): boolean {
  return (
    input.modelSource === "global-default" &&
    !/^(?:xai\/)?grok-/i.test(input.globalDefaultModel.trim())
  );
}

function readAllowRule(directory: string): string {
  // Grok's permission-rule grammar treats a bare Read prefix as every path;
  // use a recursive glob so Cave's project grant stays an actual native grant.
  const normalized = directory.replace(/\\/g, "/").replace(/\/+$/, "");
  return `Read(${normalized}/**)`;
}

export function grokSandboxProfileForPermission(permissionMode: unknown): GrokSandboxProfile {
  return permissionMode === "read" ? "read" : "full";
}

/**
 * Grok pins its OS sandbox to the session that created it. Starting a new
 * session is therefore required when Cave's requested access mode differs
 * from the saved one; otherwise a "read" turn could resume an unrestricted
 * session (or a "full" turn remain read-only).
 */
export function grokResumeNeedsNewSandboxSession(input: {
  resumeSessionId: string | null;
  savedProfile?: GrokSandboxProfile;
  requestedProfile: GrokSandboxProfile;
}): boolean {
  return !!input.resumeSessionId && input.savedProfile !== input.requestedProfile;
}

export function grokIdentityRules(
  familiarId: string,
  displayName?: string,
  role?: string,
): string {
  const name = displayName?.trim() || familiarId;
  const roleText = role?.trim() ? `, a ${role.trim()}` : "";
  return `You are ${name}${roleText}. Respond as ${name}, not as the underlying Grok Build CLI.`;
}

export function buildGrokBuildArgs(input: {
  prompt: string;
  resumeSessionId: string | null;
  /** UUID Cave assigns to a new native session so it can survive a mid-stream stop. */
  newSessionId?: string | null;
  model: string | null;
  permissionMode: "full" | "read";
  grantDirs: string[];
  identityRules: string;
}): string[] {
  const args = ["--no-auto-update", "--output-format", "streaming-json"];
  if (input.resumeSessionId) args.push("--resume", input.resumeSessionId);
  else if (input.newSessionId) args.push("--session-id", input.newSessionId);
  const model = bareModel(input.model);
  if (model) args.push("--model", model);
  // Headless runs cannot wait for an interactive approval prompt. Full access
  // is an explicit user selection; read uses Grok's native read-only sandbox
  // and removes its documented write/shell tools.
  if (input.permissionMode === "full") {
    args.push("--permission-mode", "bypassPermissions");
    // Grok persists a session's sandbox profile and refuses `--resume` when
    // an explicit profile differs from that saved profile. Omit the flag on
    // resumed turns so the CLI restores the session's original profile.
    if (!input.resumeSessionId) args.push("--sandbox", "off");
  } else {
    if (!input.resumeSessionId) args.push("--sandbox", "read-only");
    args.push("--disallowed-tools", "run_terminal_cmd,search_replace");
    for (const directory of input.grantDirs) {
      if (directory) args.push("--allow", readAllowRule(directory));
    }
  }
  if (input.identityRules) args.push("--rules", input.identityRules);
  args.push("--single", input.prompt);
  return args;
}

/** Map Grok Build's documented streaming-json JSONL frames to Cave events. */
export function parseGrokStreamEvent(raw: unknown): GrokStreamEvent {
  if (!raw || typeof raw !== "object") return { kind: "ignore" };
  const event = raw as {
    type?: unknown;
    data?: unknown;
    sessionId?: unknown;
    message?: unknown;
    usage?: unknown;
    total_cost_usd?: unknown;
  };
  if (event.type === "text" && typeof event.data === "string") {
    return { kind: "text", text: event.data };
  }
  if (event.type === "end") {
    return {
      kind: "end",
      sessionId: typeof event.sessionId === "string" ? event.sessionId : undefined,
      isError: false,
      usage: event.usage,
      totalCostUsd: event.total_cost_usd,
    };
  }
  if (event.type === "error") {
    return {
      kind: "error",
      message: typeof event.message === "string" ? event.message : "Grok Build returned an error.",
      usage: event.usage,
      totalCostUsd: event.total_cost_usd,
    };
  }
  return { kind: "ignore" };
}
