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
  /** Aliases are data-envelope keys, never user content or tool payloads. */
  fields: {
    data: string[];
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

type Semver = { major: number; minor: number; patch: number; prerelease: string | null };

/** Parse only a complete, documented Copilot version line. */
export function parseRuntimeClientVersion(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length !== 1) return null;
  const match = /^(?:copilot(?: cli)?(?: version)?\s+v?|v)?(\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?)$/i.exec(lines[0]!);
  if (!match) return null;
  return match[1]!;
}

function semver(value: string): Semver | null {
  const match = value.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
  };
}

/** Positive when `a` is newer than `b`; release versions sort after prereleases. */
export function compareRuntimeClientVersions(a: string, b: string): number | null {
  const pa = semver(a);
  const pb = semver(b);
  if (!pa || !pb) return null;
  for (const key of ["major", "minor", "patch"] as const) {
    if (pa[key] !== pb[key]) return pa[key] - pb[key];
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
    if (numericA && numericB) return Number(a) - Number(b);
    if (numericA !== numericB) return numericA ? -1 : 1;
    return a.localeCompare(b);
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
const FIELD_KEYS = ["data", "messageId", "deltaContent", "content", "model", "toolRequests", "toolCallId", "toolName", "arguments", "success", "result", "resultContent", "sessionId", "exitCode", "usage", "durationMs"] as const;

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
  const eventTypes = record(candidate.eventTypes);
  const fields = record(candidate.fields);
  if (!eventTypes || !fields) return null;
  const normalizedEventTypes = {} as RuntimeEventProtocolSchema["eventTypes"];
  for (const key of EVENT_TYPE_KEYS) {
    const aliases = stringArray(eventTypes[key]);
    if (!aliases?.length || aliases.some((alias) => !alias)) return null;
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
  return { id: candidate.id, runtime: "copilot", minClientVersion, maxClientVersionExclusive, eventTypes: normalizedEventTypes, ignoredEventTypes, fields: normalizedFields };
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

/** Direct-spawn argv for a copilot JSONL stream turn. Options ride ahead of
 *  the prefix args; the prompt trails the prefix's `-p` flag. */
export function buildCopilotStreamArgs(launch: CopilotStreamLaunch): string[] {
  const { spec } = launch;
  const args: string[] = [];
  if (launch.resumeSessionId && spec.resumeFlag) {
    args.push(spec.resumeFlag, launch.resumeSessionId);
  } else if (launch.newSessionId && spec.sessionIdFlag) {
    args.push(spec.sessionIdFlag, launch.newSessionId);
  }
  if (launch.model && spec.modelFlag) {
    // Cave model ids may be namespaced (`openai/gpt-5.5`); copilot expects
    // the bare id, matching how coven strips the provider prefix.
    const bare = launch.model.includes("/")
      ? launch.model.slice(launch.model.lastIndexOf("/") + 1)
      : launch.model;
    if (bare) args.push(spec.modelFlag, bare);
  }
  // Trust each granted root at the harness level; repeatable native flag.
  // Emitted for read AND full turns so the grant list stays the declared
  // boundary regardless of sandbox mode.
  for (const dir of launch.addDirs) {
    if (dir) args.push(spec.addDirFlag, dir);
  }
  // Sandbox mapping from the manifest. Read-only is enforced explicitly;
  // full access stays implicit so the direct Copilot stream path does not widen
  // the local harness sandbox with manifest full_args such as `--allow-all`.
  // Unattended one-shots pre-approve tools/URLs (auto-deny otherwise) while
  // path verification keeps the cwd + --add-dir write boundary.
  if (launch.permissionMode === "read") {
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
  | { kind: "text_delta"; messageId: string; text: string; model?: string }
  | {
      kind: "message";
      messageId: string;
      content: string;
      toolRequests: CopilotToolRequest[];
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
  const type = typeof ev?.type === "string" ? ev.type : null;
  if (!type) return null;
  const allKnown = Object.values(protocol.eventTypes).flat();
  if (protocol.ignoredEventTypes.includes(type)) return null;
  if (allKnown.includes(type) && parseCopilotChatEvent(raw, protocol) === null) {
    return {
      code: "malformed-tool-event",
      message: "Copilot CLI emitted a malformed tool-activity event; assistant chat continues but tool details may be incomplete. Update the Copilot runtime schema or CLI.",
    };
  }
  if (/^(?:tool\.|assistant\.tool(?:[_\.]))/.test(type) && !allKnown.includes(type)) {
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
  const type = typeof ev?.type === "string" ? ev.type : null;
  if (!type) return null;
  const data = record(field(ev, protocol.fields.data));
  if (typeIs(type, protocol.eventTypes.textDelta)) {
    const messageId = textField(data, protocol.fields.messageId);
    const text = textField(data, protocol.fields.deltaContent);
    if (!messageId || text === undefined) return null;
    return {
      kind: "text_delta",
      messageId,
      text,
      model: asModel(field(data, protocol.fields.model)),
    };
  }
  if (typeIs(type, protocol.eventTypes.message)) {
      const messageId = textField(data, protocol.fields.messageId);
      if (!messageId) return null;
      const toolRequests: CopilotToolRequest[] = [];
      const requests = field(data, protocol.fields.toolRequests);
      if (requests !== undefined && !Array.isArray(requests)) return null;
      if (Array.isArray(requests)) {
        for (const req of requests) {
          const r = record(req);
          const toolCallId = textField(r, protocol.fields.toolCallId);
          const name = textField(r, protocol.fields.toolName);
          if (!toolCallId || !name) return null;
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
        content: textField(data, protocol.fields.content) ?? "",
        toolRequests,
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
      const result = record(field(data, protocol.fields.result));
      const output = textField(result, protocol.fields.resultContent);
      return {
        kind: "tool_end",
        toolCallId,
        output,
        isError: success === false,
        model: asModel(field(data, protocol.fields.model)),
      };
  }
  if (typeIs(type, protocol.eventTypes.result)) {
      const usage = record(field(ev, protocol.fields.usage));
      const duration = field(usage, protocol.fields.durationMs);
      const durationMs = typeof duration === "number" ? duration : undefined;
      return {
        kind: "result",
        sessionId: textField(ev, protocol.fields.sessionId),
        isError: typeof field(ev, protocol.fields.exitCode) === "number" && field(ev, protocol.fields.exitCode) !== 0,
        durationMs,
      };
  }
  return null;
}

/**
 * Assembles assistant text from copilot's dual sources without duplication:
 * `assistant.message_delta` frames stream live text, and the follow-up
 * `assistant.message` frame repeats the full content (and is the ONLY text
 * source when the CLI skips deltas, e.g. tool-request-only messages). Both
 * feed through here; the return value is exactly the new text to append.
 */
export class CopilotTextAssembler {
  private messages = new Map<string, { deltaText: string; fullText: string | null }>();

  delta(messageId: string, text: string): string {
    const state = this.messages.get(messageId) ?? { deltaText: "", fullText: null };
    if (state.fullText !== null || !text) return "";
    let append = text;
    if (state.deltaText.endsWith(text) || state.deltaText.includes(text)) append = "";
    else if (text.startsWith(state.deltaText)) append = text.slice(state.deltaText.length);
    state.deltaText += append;
    this.messages.set(messageId, state);
    return append;
  }

  message(messageId: string, content: string): string {
    const state = this.messages.get(messageId) ?? { deltaText: "", fullText: null };
    if (state.fullText !== null) return "";
    state.fullText = content;
    this.messages.set(messageId, state);
    return content.startsWith(state.deltaText) ? content.slice(state.deltaText.length) : content;
  }

  reset(): void {
    this.messages.clear();
  }
}
