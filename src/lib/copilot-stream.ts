// Copilot CLI JSONL stream wiring for native Cave chat (cave-yesg).
//
// Chats normally spawn `coven run <harness> --stream-json`, but for external
// manifest adapters coven launches ONE-SHOT (`copilot -s -p …`) and pipes raw
// prose — so tool calls never reach the chat as structured events and
// persistedTools stays empty. The copilot adapter manifest already declares a
// JSONL stream mode (`--output-format json --stream on -p` plus
// `--session-id`/`--resume`); this module turns that declaration into a direct
// spawn argv and parses the Copilot CLI's event stream into the shapes the
// chat route feeds ToolCallTracker with.
//
// Scope note: this is deliberately copilot-only. Other registry adapters that
// declare `stream_args` (e.g. coven-code) use a long-lived stdin-frame
// protocol where a positional prompt is ignored — direct-spawning them with
// these args would hang. Adapters without a Cave-known stream protocol keep
// the existing `coven run` passthrough fallback.
//
// Event schema (verified against copilot CLI 1.0.70 `--output-format json
// --stream on`):
//   {"type":"assistant.message_delta","data":{"messageId","deltaContent"}}
//   {"type":"assistant.message","data":{"messageId","content","toolRequests":
//       [{"toolCallId","name","arguments"}],"model"}}
//   {"type":"tool.execution_start","data":{"toolCallId","toolName","arguments"}}
//   {"type":"tool.execution_complete","data":{"toolCallId","success",
//       "result":{"content"}}}
//   {"type":"result","sessionId","exitCode","usage":{"sessionDurationMs",…}}
// plus session.* / assistant.turn_* / *_delta noise events that the chat
// ignores. The final `result` frame is top-level (no `data` envelope).

import { REGISTRY_RUNTIMES } from "./runtime-registry.gen.ts";

/**
 * A versioned description of a runtime event protocol.  Launch configuration
 * belongs to the accepted runtime manifest; this separate, deliberately
 * narrow contract describes how that runtime's JSONL becomes Cave's stable
 * internal tool lifecycle.  Future registry entries can supply a newer
 * schema without changing the chat route.
 */
export type RuntimeEventProtocolSchema = {
  id: string;
  runtime: "copilot";
  /** Top-level aliases containing the event discriminator (for example `type`). */
  eventTypeFields: string[];
  /** Prefixes whose unknown frames are surfaced as protocol-drift diagnostics. */
  diagnosticEventPrefixes: string[];
  /** Inclusive semver lower bound for this client protocol. */
  minClientVersion: string;
  /** Exclusive semver upper bound, or null for the current open-ended schema. */
  maxClientVersionExclusive: string | null;
  eventTypes: {
    textDelta: string[];
    message: string[];
    toolStart: string[];
    toolEnd: string[];
    result: string[];
  };
  /** Frames deliberately ignored by this schema (for example partial output). */
  ignoredEventTypes: string[];
  /** Aliases are frame/data-envelope keys, never user content or tool payloads. */
  fields: {
    data: string[];
    /** Stable event identity used to ignore replayed transport frames. */
    frameId: string[];
    messageId: string[];
    deltaContent: string[];
    content: string[];
    model: string[];
    toolRequests: string[];
    toolCallId: string[];
    toolName: string[];
    arguments: string[];
    success: string[];
    result: string[];
    resultContent: string[];
    sessionId: string[];
    exitCode: string[];
    usage: string[];
    durationMs: string[];
  };
};

/**
 * The documented JSONL protocol shipped by Copilot CLI 1.x.  The resolver is
 * intentionally data-driven: a registry refresh can add a later schema with
 * its own range and aliases, while older installed clients keep this one.
 */
export const COPILOT_EVENT_PROTOCOL_SCHEMAS: RuntimeEventProtocolSchema[] = [
  {
    id: "copilot-jsonl-v1",
    runtime: "copilot",
    eventTypeFields: ["type"],
    diagnosticEventPrefixes: ["tool.", "assistant.tool"],
    minClientVersion: "1.0.0",
    // A future major must opt in with a separately reviewed registry schema.
    // Never guess that an incompatible 2.x frame still has the 1.x shape.
    maxClientVersionExclusive: "2.0.0",
    eventTypes: {
      textDelta: ["assistant.message_delta"],
      message: ["assistant.message"],
      toolStart: ["tool.execution_start"],
      toolEnd: ["tool.execution_complete"],
      result: ["result"],
    },
    ignoredEventTypes: [
      "session.mcp_servers_loaded",
      "user.message",
      "assistant.turn_start",
      "assistant.turn_end",
      "assistant.idle",
      "assistant.message_start",
      "assistant.tool_call_delta",
      "tool.execution_partial_result",
    ],
    fields: {
      data: ["data"],
      frameId: ["id"],
      messageId: ["messageId"],
      deltaContent: ["deltaContent"],
      content: ["content"],
      model: ["model"],
      toolRequests: ["toolRequests"],
      toolCallId: ["toolCallId"],
      toolName: ["toolName", "name"],
      arguments: ["arguments", "input"],
      success: ["success"],
      result: ["result"],
      resultContent: ["content"],
      sessionId: ["sessionId"],
      exitCode: ["exitCode"],
      usage: ["usage"],
      durationMs: ["sessionDurationMs"],
    },
  },
];

type Semver = { major: string; minor: string; patch: string; prerelease: string | null };
const SEMVER_NUMBER = "(?:0|[1-9]\\d*)";
const SEMVER_TOKEN = `${SEMVER_NUMBER}\\.${SEMVER_NUMBER}\\.${SEMVER_NUMBER}`;

/** Parse only a complete, documented Copilot version line. */
export function parseRuntimeClientVersion(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const updateNotice = /^Run 'copilot update' to check for updates\.$/i;
  const versionLines = lines.filter((line) => !updateNotice.test(line));
  if (versionLines.length !== 1 || (lines.length !== 1 && lines.length !== 2)) return null;
  const match = new RegExp(`^(?:(?:github\\s+)?copilot(?: cli)?(?: version)?\\s+v?|v)?(${SEMVER_TOKEN}(?:-[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?)\\.?$`, "i").exec(versionLines[0]!);
  if (!match) return null;
  return match[1]!;
}

function semver(value: string): Semver | null {
  const match = new RegExp(`^(${SEMVER_NUMBER})\\.(${SEMVER_NUMBER})\\.(${SEMVER_NUMBER})(?:-([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`).exec(value);
  if (!match) return null;
  if (match[4]?.split(".").some((id) => /^0\d+$/.test(id))) return null;
  return {
    major: match[1]!,
    minor: match[2]!,
    patch: match[3]!,
    prerelease: match[4] ?? null,
  };
}

function compareNumericSemverIdentifier(a: string, b: string): number {
  if (a.length !== b.length) return a.length - b.length;
  return compareAscii(a, b);
}

/** SemVer identifiers are ASCII; locale collation is not SemVer ordering. */
function compareAscii(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Positive when `a` is newer than `b`; release versions sort after prereleases. */
export function compareRuntimeClientVersions(a: string, b: string): number | null {
  const pa = semver(a);
  const pb = semver(b);
  if (!pa || !pb) return null;
  for (const key of ["major", "minor", "patch"] as const) {
    if (pa[key] !== pb[key]) return compareNumericSemverIdentifier(pa[key], pb[key]);
  }
  if (pa.prerelease === pb.prerelease) return 0;
  if (!pa.prerelease) return 1;
  if (!pb.prerelease) return -1;
  const identifiers = (value: string) => value.split(".");
  const aIds = identifiers(pa.prerelease);
  const bIds = identifiers(pb.prerelease);
  for (let index = 0; index < Math.min(aIds.length, bIds.length); index += 1) {
    const a = aIds[index]!;
    const b = bIds[index]!;
    if (a === b) continue;
    const numericA = /^\d+$/.test(a);
    const numericB = /^\d+$/.test(b);
    if (numericA && numericB) return compareNumericSemverIdentifier(a, b);
    if (numericA !== numericB) return numericA ? -1 : 1;
    return compareAscii(a, b);
  }
  return aIds.length - bIds.length;
}

/**
 * Select the highest compatible protocol schema for an installed runtime.
 * A missing/unparseable version is deliberately unsupported: callers must
 * retain plain chat rather than silently parsing a potentially changed stream.
 */
export function selectRuntimeEventProtocol(
  clientVersion: string | null | undefined,
  schemas: RuntimeEventProtocolSchema[] = COPILOT_EVENT_PROTOCOL_SCHEMAS,
): RuntimeEventProtocolSchema | null {
  const normalized = parseRuntimeClientVersion(clientVersion);
  if (!normalized) return null;
  const parsedClient = semver(normalized);
  if (!parsedClient) return null;
  const candidates = schemas.filter((schema) => {
    if (schema.runtime !== "copilot") return false;
    // A release-bounded schema never guesses at prerelease behavior. A schema
    // can explicitly opt in by declaring a prerelease lower bound.
    if (parsedClient.prerelease && !semver(schema.minClientVersion)?.prerelease) return false;
    const lower = compareRuntimeClientVersions(normalized, schema.minClientVersion);
    if (lower === null || lower < 0) return false;
    if (!schema.maxClientVersionExclusive) return true;
    const upper = compareRuntimeClientVersions(normalized, schema.maxClientVersionExclusive);
    return upper !== null && upper < 0;
  });
  return candidates.sort((a, b) => {
    const compared = compareRuntimeClientVersions(a.minClientVersion, b.minClientVersion);
    return compared === null ? 0 : -compared;
  })[0] ?? null;
}

/** A redacted, user-safe diagnostic for a changed tool-event protocol. */
export type RuntimeProtocolDiagnostic = {
  code: "unsupported-client-version" | "unsupported-tool-event" | "malformed-tool-event";
  message: string;
};

export type CopilotStreamSpec = {
  executable: string;
  /** Resolved during the capability probe; direct spawns must reuse it. */
  launchCommand?: { command: string; fixedArgs: string[] };
  /** Selected, versioned JSONL event contract for this local CLI. */
  protocol: RuntimeEventProtocolSchema;
  /** JSONL stream launch args; ends with the prompt flag (`-p`). */
  prefixArgs: string[];
  /** Pre-assign a fresh session id (`--session-id`). */
  sessionIdFlag: string | null;
  /** Resume an existing session (`--resume`). */
  resumeFlag: string | null;
  /** Native model flag (`--model`). */
  modelFlag: string | null;
  /** Repeatable trusted-directory flag (`--add-dir`). */
  addDirFlag: string;
  /** Full-access sandbox argv (`--allow-all`). */
  sandboxFullArgs: string[];
  /** Read-only sandbox argv (`--deny-tool write --deny-tool shell`). */
  sandboxReadOnlyArgs: string[];
};

// Copilot CLI's native repeatable trusted-directory flag. Used when the
// registry manifest doesn't declare an `add_dir_flag` override — the flag has
// shipped in every CLI version this stream path supports (verified 1.0.70).
const COPILOT_ADD_DIR_FLAG = "--add-dir";

// Approval argv for unattended one-shot runs (flow sessions). A `-p` spawn
// cannot answer approval prompts, so without these the CLI auto-denies every
// tool — the "mission workspace was read-only all session" failure that left
// research missions without artifacts/primary.md. Deliberately narrower than
// the manifest's full_args (`--allow-all`): tools and URLs are approved, but
// file-path verification stays ON, confining writes to the spawn cwd plus the
// explicit `--add-dir` grants (native flags verified against CLI 1.0.73).
const COPILOT_UNATTENDED_ARGS = ["--allow-all-tools", "--allow-all-urls"];

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  if (!value.every((entry) => typeof entry === "string")) return null;
  return value as string[];
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

const EVENT_TYPE_KEYS = ["textDelta", "message", "toolStart", "toolEnd", "result"] as const;
const FIELD_KEYS = ["data", "frameId", "messageId", "deltaContent", "content", "model", "toolRequests", "toolCallId", "toolName", "arguments", "success", "result", "resultContent", "sessionId", "exitCode", "usage", "durationMs"] as const;

/** Validate registry data before allowing it to select a parser. */
function runtimeEventProtocolSchema(value: unknown): RuntimeEventProtocolSchema | null {
  const candidate = record(value);
  if (!candidate || candidate.runtime !== "copilot" || typeof candidate.id !== "string") return null;
  const minClientVersion = typeof candidate.minClientVersion === "string" ? candidate.minClientVersion : "";
  const maxClientVersionExclusive = candidate.maxClientVersionExclusive;
  if (!semver(minClientVersion)) return null;
  if (maxClientVersionExclusive !== null && typeof maxClientVersionExclusive !== "string") return null;
  if (typeof maxClientVersionExclusive === "string") {
    const order = compareRuntimeClientVersions(maxClientVersionExclusive, minClientVersion);
    if (order === null || order <= 0) return null;
  }
  const eventTypeFields = stringArray(candidate.eventTypeFields);
  if (!eventTypeFields?.length || eventTypeFields.some((alias) => !alias)) return null;
  const diagnosticEventPrefixes = stringArray(candidate.diagnosticEventPrefixes);
  if (!diagnosticEventPrefixes?.length || diagnosticEventPrefixes.some((prefix) => !prefix)) return null;
  const eventTypes = record(candidate.eventTypes);
  const fields = record(candidate.fields);
  if (!eventTypes || !fields) return null;
  const normalizedEventTypes = {} as RuntimeEventProtocolSchema["eventTypes"];
  const seenEventAliases = new Set<string>();
  for (const key of EVENT_TYPE_KEYS) {
    const aliases = stringArray(eventTypes[key]);
    if (!aliases?.length || aliases.some((alias) => !alias)) return null;
    for (const alias of aliases) {
      if (seenEventAliases.has(alias)) return null;
      seenEventAliases.add(alias);
    }
    normalizedEventTypes[key] = aliases;
  }
  const normalizedFields = {} as RuntimeEventProtocolSchema["fields"];
  for (const key of FIELD_KEYS) {
    const aliases = stringArray(fields[key]);
    if (!aliases?.length || aliases.some((alias) => !alias)) return null;
    normalizedFields[key] = aliases;
  }
  const ignoredEventTypes = stringArray(candidate.ignoredEventTypes);
  if (!ignoredEventTypes) return null;
  if (ignoredEventTypes.some((type) => seenEventAliases.has(type))) return null;
  return { id: candidate.id, runtime: "copilot", eventTypeFields, diagnosticEventPrefixes, minClientVersion, maxClientVersionExclusive, eventTypes: normalizedEventTypes, ignoredEventTypes, fields: normalizedFields };
}

/** Extract every safe Copilot protocol from an untrusted registry field. */
export function runtimeEventProtocolSchemas(value: unknown): RuntimeEventProtocolSchema[] {
  if (!Array.isArray(value)) return [];
  return value.map(runtimeEventProtocolSchema).filter((schema): schema is RuntimeEventProtocolSchema => schema !== null);
}

/**
 * Stream-launch material for the copilot adapter, sourced from the synced
 * coven-runtimes registry (the same conformance-tested document Cave
 * scaffolds into `$COVEN_HOME/adapters/copilot.json`). Returns null when the
 * registry entry stops declaring a stream mode — the chat route then falls
 * back to the `coven run` passthrough path instead of failing.
 */
export function copilotStreamSpec(
  clientVersion?: string | null,
  compatibleEventProtocols?: unknown,
  launchCommand?: { command: string; fixedArgs: string[] },
): CopilotStreamSpec | null {
  const runtime = REGISTRY_RUNTIMES.find((entry) => entry.id === "copilot");
  if (!runtime || !runtime.capabilities.stream) return null;
  const manifest = runtime.adapterManifest as {
    adapters?: Array<{
      id?: unknown;
      executable?: unknown;
      model_flag?: unknown;
      add_dir_flag?: unknown;
      sandbox?: { full_args?: unknown; read_only_args?: unknown };
      stream_args?: {
        prefix_args?: unknown;
        session_id_flag?: unknown;
        resume_flag?: unknown;
        event_protocols?: unknown;
      };
      event_protocols?: unknown;
    }>;
  } | null;
  const adapter = manifest?.adapters?.find((entry) => entry?.id === "copilot");
  if (!adapter || typeof adapter.executable !== "string") return null;
  const prefixArgs = stringArray(adapter.stream_args?.prefix_args);
  if (!prefixArgs || prefixArgs.length === 0) return null;
  // Existing callers that cannot yet probe a local version retain the
  // registry-pinned compatibility baseline. Callers that *have* a version
  // must select a matching schema; an unknown version then falls back to the
  // generic plain-chat route instead of guessing at tool frames.
  const availableProtocols = [
    ...runtimeEventProtocolSchemas(compatibleEventProtocols),
    ...runtimeEventProtocolSchemas(adapter.event_protocols),
    ...runtimeEventProtocolSchemas(adapter.stream_args?.event_protocols),
    ...COPILOT_EVENT_PROTOCOL_SCHEMAS,
  ];
  const protocol =
    clientVersion === undefined
      ? availableProtocols[0]!
      : selectRuntimeEventProtocol(clientVersion, availableProtocols);
  if (!protocol) return null;
  return {
    executable: adapter.executable,
    ...(launchCommand ? { launchCommand } : {}),
    protocol,
    prefixArgs,
    sessionIdFlag:
      typeof adapter.stream_args?.session_id_flag === "string"
        ? adapter.stream_args.session_id_flag
        : null,
    resumeFlag:
      typeof adapter.stream_args?.resume_flag === "string"
        ? adapter.stream_args.resume_flag
        : null,
    modelFlag: typeof adapter.model_flag === "string" ? adapter.model_flag : null,
    addDirFlag:
      typeof adapter.add_dir_flag === "string" && adapter.add_dir_flag
        ? adapter.add_dir_flag
        : COPILOT_ADD_DIR_FLAG,
    sandboxFullArgs: stringArray(adapter.sandbox?.full_args) ?? [],
    sandboxReadOnlyArgs: stringArray(adapter.sandbox?.read_only_args) ?? [],
  };
}

/**
 * Mirror of coven-cli's `FamiliarContext::identity_preamble`. The direct
 * copilot spawn bypasses `coven run --familiar`, which is what normally
 * injects this line — without it the familiar answers as the generic CLI.
 */
export function copilotIdentityPreamble(
  familiarId: string,
  displayName?: string,
  role?: string,
): string {
  const name =
    displayName?.trim() ||
    (familiarId ? familiarId.charAt(0).toUpperCase() + familiarId.slice(1) : "");
  if (!name) return "";
  const cleanRole = role?.trim();
  return cleanRole
    ? `[Identity: You are ${name}, a ${cleanRole}. Respond as ${name}, not as the underlying tool.]`
    : `[Identity: You are ${name}. Respond as ${name}, not as the underlying tool.]`;
}

export type CopilotStreamLaunch = {
  spec: CopilotStreamSpec;
  prompt: string;
  /** Resume this copilot-native session id; null starts a fresh session. */
  resumeSessionId: string | null;
  /** Pre-assigned id for a fresh session (ignored when resuming). */
  newSessionId: string | null;
  /** Cleaned model id; a `provider/` namespace is stripped for copilot. */
  model: string | null;
  /**
   * `full` — interactive chat turns: access stays implicit (no widening args;
   * #3297). `read` — manifest deny-tool sandbox. `unattended` — non-interactive
   * one-shots that can't answer approval prompts (flow sessions): tools and
   * URLs are pre-approved but path verification keeps writes inside the spawn
   * cwd + `addDirs`. Never expose `unattended` to request-supplied modes.
   */
  permissionMode: "full" | "read" | "unattended";
  /**
   * Granted directories to trust at the harness level (repeatable
   * `--add-dir`). Without these the runtime-scope preamble's grants are
   * prompt-text-only: read-only sessions deny every granted-root access, and
   * full sessions ride `--allow-all` instead of an explicit trust list
   * (cave-n1yc). The spawn cwd is already trusted and must not be included.
   */
  addDirs: string[];
};

/** A native resume id must be data, never a CLI option or control sequence. */
export function isSafeCopilotResumeSessionId(value: string | null | undefined): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    !value.startsWith("-") &&
    !/[\u0000-\u001f\u007f]/.test(value);
}

/** Direct-spawn argv for a copilot JSONL stream turn. Options ride ahead of
 *  the prefix args; the prompt trails the prefix's `-p` flag. */
export function buildCopilotStreamArgs(launch: CopilotStreamLaunch): string[] {
  const { spec } = launch;
  const args: string[] = [];
  // Resume ids are runtime data, never options. Reject control characters and
  // flag-shaped values before argv construction rather than relying on a
  // particular CLI parser's treatment of `--resume --flag`.
  const safeResumeSessionId = isSafeCopilotResumeSessionId(launch.resumeSessionId)
    ? launch.resumeSessionId
    : null;
  if (safeResumeSessionId && spec.resumeFlag) {
    args.push(spec.resumeFlag, safeResumeSessionId);
  } else if (launch.newSessionId && spec.sessionIdFlag) {
    args.push(spec.sessionIdFlag, launch.newSessionId);
  }
  if (launch.model && spec.modelFlag) {
    // Cave model ids may be namespaced (`openai/gpt-5.5`); copilot expects
    // the bare id, matching how coven strips the provider prefix.
    const bare = launch.model.includes("/")
      ? launch.model.slice(launch.model.lastIndexOf("/") + 1)
      : launch.model;
    // The provider-qualified id was already validated by the request path,
    // but stripping its namespace can expose a flag-shaped bare value such
    // as `openai/--allow-all-tools`. Validate the argv value itself.
    if (/^[A-Za-z0-9][A-Za-z0-9._:@+-]*$/.test(bare)) args.push(spec.modelFlag, bare);
  }
  // Trust each granted root at the harness level; repeatable native flag.
  // Emitted for read AND full turns so the grant list stays the declared
  // boundary regardless of sandbox mode.
  for (const dir of launch.addDirs) {
    if (dir) args.push(spec.addDirFlag, dir);
  }
  // Sandbox mapping from the manifest. A direct `-p` process has no stdin to
  // answer approval prompts, so full chats retain their existing manifest
  // approval contract instead of auto-denying every requested tool.
  // Unattended one-shots pre-approve tools/URLs (auto-deny otherwise) while
  // path verification keeps the cwd + --add-dir write boundary.
  if (launch.permissionMode === "full") {
    args.push(...spec.sandboxFullArgs);
  } else if (launch.permissionMode === "read") {
    args.push(...spec.sandboxReadOnlyArgs);
  } else if (launch.permissionMode === "unattended") {
    args.push(...COPILOT_UNATTENDED_ARGS);
  }
  args.push(...spec.prefixArgs, launch.prompt);
  return args;
}

export type CopilotToolRequest = {
  toolCallId: string;
  name: string;
  input?: unknown;
};

export type CopilotChatEvent =
  | { kind: "text_delta"; messageId: string; text: string; frameId?: string; model?: string }
  | {
      kind: "message";
      messageId: string;
      content: string;
      toolRequests: CopilotToolRequest[];
      /** The message content is usable, but one or more declared tool calls were not. */
      malformedToolRequests?: boolean;
      model?: string;
    }
  | {
      kind: "tool_start";
      toolCallId: string;
      toolName: string;
      input?: unknown;
      model?: string;
    }
  | {
      kind: "tool_end";
      toolCallId: string;
      output?: string;
      isError: boolean;
      model?: string;
    }
  | { kind: "result"; sessionId?: string; isError: boolean; durationMs?: number };

function asModel(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function field(source: Record<string, unknown> | null, aliases: string[]): unknown {
  if (!source) return undefined;
  for (const alias of aliases) {
    if (alias in source) return source[alias];
  }
  return undefined;
}

function textField(source: Record<string, unknown> | null, aliases: string[]): string | undefined {
  const value = field(source, aliases);
  return typeof value === "string" && value ? value : undefined;
}

function typeIs(type: string, aliases: string[]): boolean {
  return aliases.includes(type);
}

function eventType(source: Record<string, unknown> | null, protocol: RuntimeEventProtocolSchema): string | null {
  const value = field(source, protocol.eventTypeFields);
  return typeof value === "string" && value ? value : null;
}

/** Undefined is absent; null is present but malformed; an empty string is valid content. */
function declaredTextField(source: Record<string, unknown> | null, aliases: string[]): string | null | undefined {
  const value = field(source, aliases);
  if (value === undefined) return undefined;
  return typeof value === "string" ? value : null;
}

/**
 * Return a safe diagnostic only for frames that claim to describe a tool or
 * assistant event but cannot be understood by the selected schema.  Normal
 * session/turn noise remains intentionally silent.  The raw event and its
 * payload are never returned, logged, or shown to the user.
 */
export function copilotProtocolDiagnostic(
  raw: unknown,
  protocol: RuntimeEventProtocolSchema,
): RuntimeProtocolDiagnostic | null {
  const ev = record(raw);
  const type = eventType(ev, protocol);
  if (!type) return null;
  const allKnown = Object.values(protocol.eventTypes).flat();
  if (protocol.ignoredEventTypes.includes(type)) return null;
  if (allKnown.includes(type) && parseCopilotChatEvent(raw, protocol) === null) {
    return {
      code: "malformed-tool-event",
      message: "Copilot CLI emitted a malformed tool-activity event; assistant chat continues but tool details may be incomplete. Update the Copilot runtime schema or CLI.",
    };
  }
  if (protocol.diagnosticEventPrefixes.some((prefix) => type.startsWith(prefix)) && !allKnown.includes(type)) {
    return {
      code: "unsupported-tool-event",
      message: "Copilot CLI emitted an unsupported tool-activity event; assistant chat continues but tool details may be incomplete. Update the Copilot runtime schema or CLI.",
    };
  }
  return null;
}

/**
 * Map one parsed copilot JSONL frame to a chat-relevant event; returns null
 * for the stream's noise frames (session.*, turn markers, tool-input deltas,
 * partial tool output) so the route drops them without touching the bubble.
 */
export function parseCopilotChatEvent(
  raw: unknown,
  protocol: RuntimeEventProtocolSchema = COPILOT_EVENT_PROTOCOL_SCHEMAS[0]!,
): CopilotChatEvent | null {
  const ev = record(raw);
  const type = eventType(ev, protocol);
  if (!type) return null;
  const data = record(field(ev, protocol.fields.data));
  if (typeIs(type, protocol.eventTypes.textDelta)) {
    const messageId = textField(data, protocol.fields.messageId);
    const text = declaredTextField(data, protocol.fields.deltaContent);
    if (!messageId || text === null || text === undefined) return null;
    const frameId = textField(ev, protocol.fields.frameId) ?? textField(data, protocol.fields.frameId);
    return {
      kind: "text_delta",
      messageId,
      text,
      ...(frameId ? { frameId } : {}),
      model: asModel(field(data, protocol.fields.model)),
    };
  }
  if (typeIs(type, protocol.eventTypes.message)) {
      const messageId = textField(data, protocol.fields.messageId);
      if (!messageId) return null;
      const content = declaredTextField(data, protocol.fields.content);
      if (content === null) return null;
      const toolRequests: CopilotToolRequest[] = [];
      const requests = field(data, protocol.fields.toolRequests);
      let malformedToolRequests = requests !== undefined && !Array.isArray(requests);
      if (Array.isArray(requests)) {
        for (const req of requests) {
          const r = record(req);
          const toolCallId = textField(r, protocol.fields.toolCallId);
          const name = textField(r, protocol.fields.toolName);
          if (!toolCallId || !name) {
            malformedToolRequests = true;
            continue;
          }
          toolRequests.push({
            toolCallId,
            name,
            input: field(r, protocol.fields.arguments),
          });
        }
      }
      return {
        kind: "message",
        messageId,
        content: content ?? "",
        toolRequests,
        ...(malformedToolRequests ? { malformedToolRequests: true } : {}),
        model: asModel(field(data, protocol.fields.model)),
      };
  }
  if (typeIs(type, protocol.eventTypes.toolStart)) {
      const toolCallId = textField(data, protocol.fields.toolCallId);
      const toolName = textField(data, protocol.fields.toolName);
      if (!toolCallId || !toolName) return null;
      return {
        kind: "tool_start",
        toolCallId,
        toolName,
        input: field(data, protocol.fields.arguments),
        model: asModel(field(data, protocol.fields.model)),
      };
  }
  if (typeIs(type, protocol.eventTypes.toolEnd)) {
      const toolCallId = textField(data, protocol.fields.toolCallId);
      const success = field(data, protocol.fields.success);
      if (!toolCallId || typeof success !== "boolean") return null;
      const rawResult = field(data, protocol.fields.result);
      if (rawResult !== undefined && record(rawResult) === null) return null;
      const result = record(rawResult);
      const output = declaredTextField(result, protocol.fields.resultContent);
      if (output === null) return null;
      return {
        kind: "tool_end",
        toolCallId,
        output,
        isError: success === false,
        model: asModel(field(data, protocol.fields.model)),
      };
  }
  if (typeIs(type, protocol.eventTypes.result)) {
      // Legacy v1 result fields are top-level. A declared-but-malformed
      // envelope is protocol drift, not permission to reinterpret top-level
      // aliases as a successful legacy result.
      const rawEnvelope = field(ev, protocol.fields.data);
      const resultSource = rawEnvelope === undefined ? ev : record(rawEnvelope);
      if (!resultSource) return null;
      const exitCode = field(resultSource, protocol.fields.exitCode);
      if (typeof exitCode !== "number" || !Number.isSafeInteger(exitCode)) return null;
      const usage = record(field(resultSource, protocol.fields.usage));
      const duration = field(usage, protocol.fields.durationMs);
      const durationMs = typeof duration === "number" ? duration : undefined;
      return {
        kind: "result",
        sessionId: textField(resultSource, protocol.fields.sessionId),
        isError: exitCode !== 0,
        durationMs,
      };
  }
  return null;
}

/**
 * Assembles assistant text from copilot's dual sources without duplication:
 * `assistant.message_delta` frames stream live text, and the follow-up
 * `assistant.message` frame repeats the full content (and is the ONLY text
 * source when the CLI skips deltas, e.g. tool-request-only messages). Deltas
 * are emitted immediately; the final full frame contributes only its unseen
 * suffix, preserving live streaming without duplicating normal frames.
 */
export class CopilotTextAssembler {
  private messages = new Map<string, {
    deltaText: string;
    fullText: string | null;
    seenFrameIds: Set<string>;
    replacement: { previous: string; content: string } | null;
  }>();

  delta(messageId: string, text: string, frameId?: string): string {
    const state = this.messages.get(messageId) ?? { deltaText: "", fullText: null, seenFrameIds: new Set<string>(), replacement: null };
    if (state.fullText !== null || !text) return "";
    // Deltas are incremental chunks, so equal neighboring chunks are valid
    // text. Only a stable frame id proves that a chunk is a transport replay.
    if (frameId && state.seenFrameIds.has(frameId)) return "";
    if (frameId) state.seenFrameIds.add(frameId);
    state.deltaText += text;
    this.messages.set(messageId, state);
    return text;
  }

  message(messageId: string, content: string): string {
    const state = this.messages.get(messageId) ?? { deltaText: "", fullText: null, seenFrameIds: new Set<string>(), replacement: null };
    if (state.fullText !== null) {
      if (state.fullText !== content) {
        state.replacement = { previous: state.fullText, content };
        state.fullText = content;
        this.messages.set(messageId, state);
      }
      return "";
    }
    state.fullText = content;
    this.messages.set(messageId, state);
    // Normal streams have a full frame that starts with all already-emitted
    // deltas. Append only what it adds. A divergent full frame is authoritative
    // and must replace the live bubble rather than leave stale delta text.
    if (content.startsWith(state.deltaText)) return content.slice(state.deltaText.length);
    if (state.deltaText) state.replacement = { previous: state.deltaText, content };
    return state.deltaText ? "" : content;
  }

  /** Consume one authoritative correction after divergent streamed deltas. */
  takeReplacement(messageId: string): { previous: string; content: string } | null {
    const state = this.messages.get(messageId);
    if (!state?.replacement) return null;
    const replacement = state.replacement;
    state.replacement = null;
    return replacement;
  }

  /** Preserve partial text only when the CLI exits before its full message. */
  flushUnconfirmed(): Array<{ messageId: string; text: string }> {
    return Array.from(this.messages, ([messageId, state]) => ({ messageId, state }))
      .filter(({ state }) => state.fullText === null && state.deltaText)
      .map(({ messageId, state }) => ({ messageId, text: state.deltaText }));
  }

  reset(): void {
    this.messages.clear();
  }
}

/**
 * Owns the aggregate transcript for interleaved Copilot message IDs. A final
 * full frame can correct one message without dropping another message that
 * arrived later on the wire. Order is fixed at each message's first frame;
 * content is always replaced by the authoritative full frame when present.
 */
export class CopilotMessageTranscript {
  private order: string[] = [];
  private content = new Map<string, string>();

  appendDelta(messageId: string, text: string): string {
    this.ensure(messageId);
    this.content.set(messageId, `${this.content.get(messageId) ?? ""}${text}`);
    return this.text;
  }

  setMessage(messageId: string, text: string): string {
    this.ensure(messageId);
    this.content.set(messageId, text);
    return this.text;
  }

  offset(messageId: string): number {
    const index = this.order.indexOf(messageId);
    return index < 0 ? this.text.length : this.order.slice(0, index).reduce((sum, id) => sum + (this.content.get(id) ?? "").length, 0);
  }

  messageLength(messageId: string): number {
    return this.content.get(messageId)?.length ?? 0;
  }

  get text(): string {
    return this.order.map((messageId) => this.content.get(messageId) ?? "").join("");
  }

  reset(): void {
    this.order = [];
    this.content.clear();
  }

  private ensure(messageId: string): void {
    if (this.content.has(messageId)) return;
    this.order.push(messageId);
    this.content.set(messageId, "");
  }
}
