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
  | { kind: "tool_start"; id: string; name: string; input?: unknown; itemId?: string }
  | { kind: "tool_input"; id?: string; itemId?: string; input: string; isFinal: boolean }
  | { kind: "tool_end"; id: string; output?: unknown; isError: boolean }
  | { kind: "session"; id: string }
  | { kind: "done"; isError: boolean; message?: string; invalidPreviousResponseId?: boolean }
  | { kind: "error"; message: string; invalidPreviousResponseId?: boolean }
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

function toolItemId(value: RecordValue): string | undefined {
  const item = record(value.item);
  return string(value.item_id) ?? string(item?.id);
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

/** A fresh retry is safe only when the API explicitly rejects the stored
 * Responses continuation token. Textual error matching would retry genuine
 * model/tool failures after users have already seen streamed side effects. */
export function isHermesInvalidPreviousResponseIdError(payload: unknown): boolean {
  const value = record(payload);
  if (!value) return false;
  const response = record(value.response);
  const error = record(response?.error) ?? record(value.error) ?? value;
  const param = string(error.param);
  const code = string(error.code);
  return param === "previous_response_id" ||
    code === "invalid_previous_response_id" ||
    code === "previous_response_not_found";
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
  if (type === "response.function_call_arguments.delta") {
    const delta = string(value.delta);
    const id = string(value.call_id);
    const itemId = toolItemId(value);
    return delta
      ? {
          kind: "tool_input",
          ...(id ? { id } : {}),
          ...(itemId ? { itemId } : {}),
          input: delta,
          isFinal: false,
        }
      : { kind: "ignore" };
  }

  if (type === "response.function_call_arguments.done") {
    const input = string(value.arguments) ?? string(value.delta);
    const id = string(value.call_id);
    const itemId = toolItemId(value);
    return input
      ? {
          kind: "tool_input",
          ...(id ? { id } : {}),
          ...(itemId ? { itemId } : {}),
          input,
          isFinal: true,
        }
      : { kind: "ignore" };
  }

  if (type === "response.output_item.added" || type === "hermes.tool.progress") {
    const id = toolId(value);
    const name = toolName(value);
    const status = string(value.status);
    if (id && (status === "completed" || status === "complete" || status === "error" || status === "failed")) {
      return { kind: "tool_end", id, output: toolOutput(value), isError: status === "error" || status === "failed" };
    }
    return id && name
      ? { kind: "tool_start", id, name, input: toolInput(value), ...(toolItemId(value) ? { itemId: toolItemId(value) } : {}) }
      : { kind: "ignore" };
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
      return name
        ? { kind: "tool_start", id, name, input: toolInput(value), ...(toolItemId(value) ? { itemId: toolItemId(value) } : {}) }
        : { kind: "ignore" };
    }
    const failed = value.error === true || string(value.status) === "error" || string(value.status) === "failed";
    return { kind: "tool_end", id, output: toolOutput(value), isError: failed };
  }

  if (type === "response.completed") return { kind: "done", isError: false };
  if (type === "response.failed" || type === "response.incomplete") {
    const response = record(value.response);
    const error = record(response?.error) ?? record(value.error);
    const message = string(error?.message) ?? string(value.message);
    return {
      kind: "done",
      isError: true,
      ...(message ? { message } : {}),
      ...(isHermesInvalidPreviousResponseIdError(value) ? { invalidPreviousResponseId: true } : {}),
    };
  }
  if (type === "error") {
    const error = record(value.error);
    return {
      kind: "error",
      message: string(error?.message) ?? string(value.message) ?? "Hermes API failed",
      ...(isHermesInvalidPreviousResponseIdError(value) ? { invalidPreviousResponseId: true } : {}),
    };
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

  private consumeLine(line: string, frames: Array<{ event: string; data: string }>) {
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

  /** Drain complete lines. A trailing CR remains buffered until the next chunk
   * proves whether it begins CRLF; at end-of-stream a lone CR is final. */
  private drain(final: boolean): Array<{ event: string; data: string }> {
    const frames: Array<{ event: string; data: string }> = [];
    let cursor = 0;
    while (cursor < this.buffer.length) {
      const lf = this.buffer.indexOf("\n", cursor);
      const cr = this.buffer.indexOf("\r", cursor);
      const next = lf < 0 ? cr : cr < 0 ? lf : Math.min(lf, cr);
      if (next < 0) break;
      const terminator = this.buffer[next];
      // CR at a chunk edge might still pair with a following LF.
      if (terminator === "\r" && next === this.buffer.length - 1 && !final) break;
      const line = this.buffer.slice(cursor, next);
      cursor = next + 1;
      if (terminator === "\r" && this.buffer[cursor] === "\n") cursor += 1;
      this.consumeLine(line, frames);
    }
    this.buffer = this.buffer.slice(cursor);
    return frames;
  }

  push(chunk: string): Array<{ event: string; data: string }> {
    this.buffer += chunk;
    return this.drain(false);
  }

  finish(): Array<{ event: string; data: string }> {
    const frames = this.drain(true);
    // SSE servers normally terminate frames with a blank line. Treat a final
    // unterminated data line as a frame too, because proxies sometimes omit it.
    if (this.buffer) {
      this.consumeLine(this.buffer, frames);
      this.buffer = "";
    }
    if (this.data.length) {
      frames.push({ event: this.eventName, data: this.data.join("\n") });
      this.eventName = "";
      this.data = [];
    }
    return frames;
  }
}

export type HermesApiConfig = { baseUrl: string; apiKey?: string };

/** Plain HTTP is only safe for a numeric loopback listener. Do not resolve
 * names here: a hostname such as `localhost` can be redirected by local DNS or
 * hosts-file policy, which would put prompts and bearer credentials on the
 * network. */
function isLiteralLoopbackHost(host: string): boolean {
  const normalized = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (normalized === "::1") return true;
  const octets = normalized.split(".");
  return octets.length === 4 &&
    octets[0] === "127" &&
    octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255);
}

/**
 * Opt in to the structured transport with a local/API-server endpoint. Remote
 * endpoints must use HTTPS; HTTP is limited to literal loopback listeners.
 * The key is read from the familiar-scoped spawn environment by the caller,
 * never from a request body or persisted transcript. Invalid values fall back
 * to the CLI, which remains functional but cannot promise tool bubbles.
 */
export function hermesApiConfig(
  env: Partial<Record<"HERMES_API_URL" | "HERMES_API_KEY", string | undefined>>,
): HermesApiConfig | null {
  const raw = env.HERMES_API_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.protocol === "http:" && !isLiteralLoopbackHost(url.hostname))
    ) return null;
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
