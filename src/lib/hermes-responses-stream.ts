// Hermes Agent Responses API stream compatibility.
//
// Hermes exposes a documented OpenAI-compatible Responses SSE endpoint.  The
// CLI's quiet mode intentionally suppresses its terminal tool previews, so a
// parser for terminal decoration would be both lossy and version-fragile.
// This module is deliberately small and defensive: it accepts the stable
// Responses event vocabulary plus Hermes's documented `hermes.tool.progress`
// extension, ignores unfamiliar frames, and never invents a tool call from
// incomplete data.  The normalised events are fed to ToolCallTracker by the
// chat route, retaining Cave's stable-id, persistence, and resume semantics.

export type HermesResponsesEvent =
  | { kind: "text"; text: string }
  | { kind: "tool_start"; id: string; name: string; input?: unknown }
  | { kind: "tool_end"; id: string; output?: unknown; isError: boolean }
  | { kind: "session"; id: string }
  | { kind: "done"; isError: boolean }
  | { kind: "error"; message: string }
  | { kind: "ignore" };

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as RecordValue
    : null;
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function responseId(value: unknown): string | undefined {
  const root = record(value);
  return string(root?.response_id) ?? string(record(root?.response)?.id) ?? string(root?.id);
}

function toolId(value: RecordValue): string | undefined {
  const item = record(value.item);
  return string(value.call_id) ?? string(value.tool_call_id) ?? string(item?.call_id) ?? string(item?.id);
}

function toolName(value: RecordValue): string | undefined {
  const item = record(value.item);
  return string(value.name) ?? string(value.tool_name) ?? string(item?.name) ?? string(item?.tool_name);
}

function toolInput(value: RecordValue): unknown {
  const item = record(value.item);
  return value.arguments ?? value.input ?? item?.arguments ?? item?.input;
}

function toolOutput(value: RecordValue): unknown {
  const item = record(value.item);
  return value.output ?? value.result ?? item?.output ?? item?.result;
}

/** Parse one complete SSE frame. Unknown/future frame types are safely ignored. */
export function parseHermesResponsesEvent(eventName: string, payload: unknown): HermesResponsesEvent {
  const value = record(payload);
  if (!value) return { kind: "ignore" };
  const type = eventName || string(value.type) || "";

  if (type === "response.output_text.delta" || type === "response.text.delta") {
    const text = string(value.delta) ?? string(value.text);
    return text ? { kind: "text", text } : { kind: "ignore" };
  }

  if (type === "response.created" || type === "response.in_progress") {
    const id = responseId(value);
    return id ? { kind: "session", id } : { kind: "ignore" };
  }

  // A function-call item is the canonical Responses announcement. Hermes can
  // also emit its progress extension before the item is finalised; both map to
  // the same native call id and ToolCallTracker deduplicates them.
  if (
    type === "response.output_item.added" ||
    type === "response.function_call_arguments.delta" ||
    type === "hermes.tool.progress"
  ) {
    const id = toolId(value);
    const name = toolName(value);
    const status = string(value.status);
    if (id && (status === "completed" || status === "complete" || status === "error" || status === "failed")) {
      return { kind: "tool_end", id, output: toolOutput(value), isError: status === "error" || status === "failed" };
    }
    return id && name ? { kind: "tool_start", id, name, input: toolInput(value) } : { kind: "ignore" };
  }

  if (
    type === "response.output_item.done" ||
    type === "response.function_call_output" ||
    type === "hermes.tool.completed"
  ) {
    const id = toolId(value);
    if (!id) return { kind: "ignore" };
    const item = record(value.item);
    // `output_item.done` with a function_call marks a completed model output,
    // not necessarily completed tool execution. Do not settle that bubble
    // until an output/progress completion arrives.
    if (
      type === "response.output_item.done" &&
      string(item?.type) === "function_call" &&
      toolOutput(value) === undefined
    ) {
      const name = toolName(value);
      return name ? { kind: "tool_start", id, name, input: toolInput(value) } : { kind: "ignore" };
    }
    const failed = value.error === true || string(value.status) === "error" || string(value.status) === "failed";
    return { kind: "tool_end", id, output: toolOutput(value), isError: failed };
  }

  if (type === "response.completed") return { kind: "done", isError: false };
  if (type === "response.failed" || type === "response.incomplete") return { kind: "done", isError: true };
  if (type === "error") {
    const error = record(value.error);
    return { kind: "error", message: string(error?.message) ?? string(value.message) ?? "Hermes API failed" };
  }
  return { kind: "ignore" };
}

/**
 * Incremental SSE decoder. Chunk boundaries are arbitrary and `data:` may be
 * split over lines, so callers must feed bytes rather than trying to split a
 * Fetch body on `\n\n` themselves.
 */
export class HermesSseDecoder {
  private buffer = "";
  private eventName = "";
  private data: string[] = [];

  push(chunk: string): Array<{ event: string; data: string }> {
    this.buffer += chunk.replace(/\r\n/g, "\n");
    const frames: Array<{ event: string; data: string }> = [];
    let next: number;
    while ((next = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, next);
      this.buffer = this.buffer.slice(next + 1);
      if (!line) {
        if (this.data.length) {
          frames.push({ event: this.eventName, data: this.data.join("\n") });
        }
        this.eventName = "";
        this.data = [];
      } else if (line.startsWith("event:")) {
        this.eventName = line.slice("event:".length).trim();
      } else if (line.startsWith("data:")) {
        this.data.push(line.slice("data:".length).replace(/^ /, ""));
      }
    }
    return frames;
  }

  finish(): Array<{ event: string; data: string }> {
    // SSE servers normally terminate frames with a blank line. Treat a final
    // unterminated data line as a frame too, because proxies sometimes omit it.
    if (this.buffer.startsWith("data:")) this.data.push(this.buffer.slice(5).replace(/^ /, ""));
    this.buffer = "";
    if (!this.data.length) return [];
    const frame = { event: this.eventName, data: this.data.join("\n") };
    this.eventName = "";
    this.data = [];
    return [frame];
  }
}

export type HermesApiConfig = { baseUrl: string; apiKey?: string };

/**
 * Opt in to the structured transport with a local/API-server endpoint. The
 * key is read from the familiar-scoped spawn environment by the caller, never
 * from a request body or persisted transcript. Invalid/non-HTTP values fall
 * back to the CLI, which remains functional but cannot promise tool bubbles.
 */
export function hermesApiConfig(
  env: Partial<Record<"HERMES_API_URL" | "HERMES_API_KEY", string | undefined>>,
): HermesApiConfig | null {
  const raw = env.HERMES_API_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return {
      baseUrl: url.toString().replace(/\/$/, ""),
      ...(env.HERMES_API_KEY?.trim() ? { apiKey: env.HERMES_API_KEY.trim() } : {}),
    };
  } catch {
    return null;
  }
}

/** Accept either the server origin or an already-versioned `/v1` base URL. */
export function hermesResponsesUrl(config: HermesApiConfig): string {
  return `${config.baseUrl.endsWith("/v1") ? config.baseUrl : `${config.baseUrl}/v1`}/responses`;
}
