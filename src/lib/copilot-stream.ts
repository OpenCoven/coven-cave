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

export type CopilotStreamSpec = {
  executable: string;
  /** JSONL stream launch args; ends with the prompt flag (`-p`). */
  prefixArgs: string[];
  /** Pre-assign a fresh session id (`--session-id`). */
  sessionIdFlag: string | null;
  /** Resume an existing session (`--resume`). */
  resumeFlag: string | null;
  /** Native model flag (`--model`). */
  modelFlag: string | null;
  /** Full-access sandbox argv (`--allow-all`). */
  sandboxFullArgs: string[];
  /** Read-only sandbox argv (`--deny-tool write --deny-tool shell`). */
  sandboxReadOnlyArgs: string[];
};

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  if (!value.every((entry) => typeof entry === "string")) return null;
  return value as string[];
}

/**
 * Stream-launch material for the copilot adapter, sourced from the synced
 * coven-runtimes registry (the same conformance-tested document Cave
 * scaffolds into `$COVEN_HOME/adapters/copilot.json`). Returns null when the
 * registry entry stops declaring a stream mode — the chat route then falls
 * back to the `coven run` passthrough path instead of failing.
 */
export function copilotStreamSpec(): CopilotStreamSpec | null {
  const runtime = REGISTRY_RUNTIMES.find((entry) => entry.id === "copilot");
  if (!runtime || !runtime.capabilities.stream) return null;
  const manifest = runtime.adapterManifest as {
    adapters?: Array<{
      id?: unknown;
      executable?: unknown;
      model_flag?: unknown;
      sandbox?: { full_args?: unknown; read_only_args?: unknown };
      stream_args?: {
        prefix_args?: unknown;
        session_id_flag?: unknown;
        resume_flag?: unknown;
      };
    }>;
  } | null;
  const adapter = manifest?.adapters?.find((entry) => entry?.id === "copilot");
  if (!adapter || typeof adapter.executable !== "string") return null;
  const prefixArgs = stringArray(adapter.stream_args?.prefix_args);
  if (!prefixArgs || prefixArgs.length === 0) return null;
  return {
    executable: adapter.executable,
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
  permissionMode: "full" | "read";
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
  // Sandbox mapping from the manifest. Full access maps to the declared
  // full_args (`--allow-all`) — without it copilot's programmatic mode
  // auto-denies every tool, which is the tools:0 regression this path fixes.
  args.push(
    ...(launch.permissionMode === "read"
      ? spec.sandboxReadOnlyArgs
      : spec.sandboxFullArgs),
  );
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

/**
 * Map one parsed copilot JSONL frame to a chat-relevant event; returns null
 * for the stream's noise frames (session.*, turn markers, tool-input deltas,
 * partial tool output) so the route drops them without touching the bubble.
 */
export function parseCopilotChatEvent(raw: unknown): CopilotChatEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const ev = raw as {
    type?: unknown;
    sessionId?: unknown;
    exitCode?: unknown;
    usage?: { sessionDurationMs?: unknown };
    data?: {
      messageId?: unknown;
      deltaContent?: unknown;
      content?: unknown;
      model?: unknown;
      toolRequests?: unknown;
      toolCallId?: unknown;
      toolName?: unknown;
      arguments?: unknown;
      success?: unknown;
      result?: { content?: unknown };
    };
  };
  if (typeof ev.type !== "string") return null;
  const data = ev.data;
  switch (ev.type) {
    case "assistant.message_delta": {
      if (typeof data?.messageId !== "string" || typeof data.deltaContent !== "string") {
        return null;
      }
      return {
        kind: "text_delta",
        messageId: data.messageId,
        text: data.deltaContent,
        model: asModel(data.model),
      };
    }
    case "assistant.message": {
      if (typeof data?.messageId !== "string") return null;
      const toolRequests: CopilotToolRequest[] = [];
      if (Array.isArray(data.toolRequests)) {
        for (const req of data.toolRequests) {
          const r = req as { toolCallId?: unknown; name?: unknown; arguments?: unknown };
          if (typeof r?.toolCallId === "string" && typeof r.name === "string") {
            toolRequests.push({
              toolCallId: r.toolCallId,
              name: r.name,
              input: r.arguments,
            });
          }
        }
      }
      return {
        kind: "message",
        messageId: data.messageId,
        content: typeof data.content === "string" ? data.content : "",
        toolRequests,
        model: asModel(data.model),
      };
    }
    case "tool.execution_start": {
      if (typeof data?.toolCallId !== "string" || typeof data.toolName !== "string") {
        return null;
      }
      return {
        kind: "tool_start",
        toolCallId: data.toolCallId,
        toolName: data.toolName,
        input: data.arguments,
        model: asModel(data.model),
      };
    }
    case "tool.execution_complete": {
      if (typeof data?.toolCallId !== "string") return null;
      const output =
        typeof data.result?.content === "string" && data.result.content
          ? data.result.content
          : undefined;
      return {
        kind: "tool_end",
        toolCallId: data.toolCallId,
        output,
        isError: data.success === false,
        model: asModel(data.model),
      };
    }
    case "result": {
      const durationMs =
        typeof ev.usage?.sessionDurationMs === "number"
          ? ev.usage.sessionDurationMs
          : undefined;
      return {
        kind: "result",
        sessionId: typeof ev.sessionId === "string" ? ev.sessionId : undefined,
        isError: typeof ev.exitCode === "number" && ev.exitCode !== 0,
        durationMs,
      };
    }
    default:
      return null;
  }
}

/**
 * Assembles assistant text from copilot's dual sources without duplication:
 * `assistant.message_delta` frames stream live text, and the follow-up
 * `assistant.message` frame repeats the full content (and is the ONLY text
 * source when the CLI skips deltas, e.g. tool-request-only messages). Both
 * feed through here; the return value is exactly the new text to append.
 */
export class CopilotTextAssembler {
  private seen = new Map<string, number>();

  delta(messageId: string, text: string): string {
    this.seen.set(messageId, (this.seen.get(messageId) ?? 0) + text.length);
    return text;
  }

  message(messageId: string, content: string): string {
    const already = this.seen.get(messageId) ?? 0;
    this.seen.set(messageId, Math.max(already, content.length));
    return already >= content.length ? "" : content.slice(already);
  }

  reset(): void {
    this.seen.clear();
  }
}
