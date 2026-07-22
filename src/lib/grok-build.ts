// Native Grok Build headless integration.
//
// This deliberately does not read the coven-runtimes registry: Grok's
// proposed registry adapter is not merged, while Cave needs the CLI's real
// streaming/session contract to drive a local chat safely.

export type RuntimeModelOption = { id: string; label: string };

export type GrokStreamEvent =
  | { kind: "text"; text: string }
  | { kind: "end"; sessionId?: string; isError: boolean; usage?: unknown }
  | { kind: "error"; message: string; usage?: unknown }
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

function readAllowRule(directory: string): string {
  // Grok's permission-rule grammar treats a bare Read prefix as every path;
  // use a recursive glob so Cave's project grant stays an actual native grant.
  const normalized = directory.replace(/\\/g, "/").replace(/\/+$/, "");
  return `Read(${normalized}/**)`;
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
  model: string | null;
  permissionMode: "full" | "read";
  grantDirs: string[];
  identityRules: string;
}): string[] {
  const args = ["--no-auto-update", "--output-format", "streaming-json"];
  if (input.resumeSessionId) args.push("--resume", input.resumeSessionId);
  const model = bareModel(input.model);
  if (model) args.push("--model", model);
  // Headless runs cannot wait for an interactive approval prompt. Full access
  // is an explicit user selection; read uses Grok's native read-only sandbox
  // and removes its documented write/shell tools.
  if (input.permissionMode === "full") {
    args.push("--permission-mode", "bypassPermissions", "--sandbox", "off");
  } else {
    args.push("--sandbox", "read-only", "--disallowed-tools", "run_terminal_cmd,search_replace");
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
    };
  }
  if (event.type === "error") {
    return {
      kind: "error",
      message: typeof event.message === "string" ? event.message : "Grok Build returned an error.",
      usage: event.usage,
    };
  }
  return { kind: "ignore" };
}
