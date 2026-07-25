import type { OpenCodeEventSchema } from "@/lib/opencode-compatibility";

export type OpenCodeRunEvent =
  | { kind: "ignore"; sessionId?: string }
  | { kind: "text"; sessionId?: string; text: string }
  | { kind: "tool_start"; sessionId?: string; id: string; name: string; input: unknown }
  | { kind: "tool_end"; sessionId?: string; id: string; output: unknown; isError: boolean }
  | { kind: "tool"; sessionId?: string; id: string; name: string; input: unknown; output: unknown; isError: boolean }
  | { kind: "error"; sessionId?: string; message: string }
  | { kind: "other"; sessionId?: string; diagnostic?: "unknown-event" | "malformed-event" };

export type OpenCodeJsonLineHandlers = {
  onSession?: (sessionId: string) => void;
  onText?: (event: Extract<OpenCodeRunEvent, { kind: "text" }>) => void;
  onTool?: (event: Extract<OpenCodeRunEvent, { kind: "tool" }>) => void;
  onToolStart?: (event: Extract<OpenCodeRunEvent, { kind: "tool_start" }>) => void;
  onToolEnd?: (event: Extract<OpenCodeRunEvent, { kind: "tool_end" }>) => void;
  onError?: (event: Extract<OpenCodeRunEvent, { kind: "error" }>) => void;
  onOther?: (event: Extract<OpenCodeRunEvent, { kind: "other" }>, rawEvent: unknown) => void;
  onMalformedJson?: () => void;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringAt(recordValue: Record<string, unknown> | null, ...keys: string[]): string | undefined {
  for (const key of keys) if (typeof recordValue?.[key] === "string") return recordValue[key] as string;
  return undefined;
}

type ShapeAlias = Exclude<keyof NonNullable<OpenCodeEventSchema["shape"]>, "envelope" | "textEnvelope" | "discriminator">;

function shapeAliases(schema: OpenCodeEventSchema | undefined, key: ShapeAlias, defaults: string[]): string[] {
  const aliases = schema?.shape?.[key];
  return aliases?.length ? aliases : defaults;
}

function valueAt(recordValue: Record<string, unknown> | null, keys: string[]): unknown {
  for (const key of keys) if (recordValue && Object.hasOwn(recordValue, key)) return recordValue[key];
  return undefined;
}

function envelope(
  event: Record<string, unknown>,
  envelopes: Array<"part" | "data" | "payload" | "root">,
): Record<string, unknown> | null {
  for (const field of envelopes) {
    if (field === "root") return event;
    const candidate = record(event[field]);
    if (candidate) return candidate;
  }
  return null;
}

function textEnvelope(event: Record<string, unknown>, schema: OpenCodeEventSchema | undefined): Record<string, unknown> | null {
  // Root is deliberately excluded by default. A signed profile must opt in
  // with `textEnvelope: ["root"]` before provider-controlled root fields can
  // become assistant text; generic envelopes may still use root for tools.
  const envelopes = schema?.shape?.textEnvelope
    ?? schema?.shape?.envelope.filter((field) => field !== "root")
    ?? ["part", "data"];
  return envelope(event, envelopes);
}

function eventTypes(schema: OpenCodeEventSchema | undefined, kind: keyof OpenCodeEventSchema["eventTypes"], defaults: string[]): string[] {
  // Selected signed schemas are authoritative: the validator rejects empty
  // mappings, so falling back here could revive a label that a registry
  // deliberately retired. Defaults are only for legacy callers with no schema.
  return schema ? schema.eventTypes[kind] : defaults;
}

function toolId(part: Record<string, unknown> | null, schema?: OpenCodeEventSchema): string | null {
  return stringAt(part, ...shapeAliases(schema, "id", ["id", "callID", "callId", "toolCallId", "tool_call_id"])) ?? null;
}

function toolStatus(state: Record<string, unknown> | null, part: Record<string, unknown> | null, schema?: OpenCodeEventSchema): string | undefined {
  const aliases = shapeAliases(schema, "status", ["status"]);
  return stringAt(state, ...aliases) ?? stringAt(part, ...aliases);
}

function terminalToolState(state: Record<string, unknown> | null, part: Record<string, unknown> | null, schema?: OpenCodeEventSchema): boolean {
  const status = toolStatus(state, part, schema)?.toLowerCase();
  return (schema?.shape?.terminalStates ?? ["completed", "complete", "error", "failed", "cancelled", "canceled", "aborted", "interrupted", "timeout", "timed_out"])
    .some((terminal) => terminal.toLowerCase() === status);
}

function toolStateIsError(state: Record<string, unknown> | null, part: Record<string, unknown> | null, schema?: OpenCodeEventSchema): boolean {
  const status = toolStatus(state, part, schema)?.toLowerCase();
  const errorStates = schema?.shape?.errorStates ?? ["error", "failed", "cancelled", "canceled", "aborted", "interrupted", "timeout", "timed_out"];
  return errorStates.some((error) => error.toLowerCase() === status)
    || valueAt(state, shapeAliases(schema, "error", ["error"])) !== undefined
    || valueAt(part, shapeAliases(schema, "error", ["error"])) !== undefined;
}

/** Decode OpenCode's `run --format json` envelope without trusting its fields. */
export function parseOpenCodeRunEvent(value: unknown, schema?: OpenCodeEventSchema): OpenCodeRunEvent {
  const event = record(value);
  if (!event) {
    return { kind: "other", diagnostic: "malformed-event" };
  }
  const part = envelope(event, schema?.shape?.envelope ?? ["part", "data", "root"]);
  const sessionAliases = shapeAliases(schema, "sessionId", ["sessionID", "sessionId", "session_id"]);
  // Protocol revisions may keep the native session on the declared payload.
  // Prefer that envelope, then preserve the legacy root-level fallback.
  const sessionId = stringAt(part, ...sessionAliases) ?? stringAt(event, ...sessionAliases);
  const discriminator = schema?.shape?.discriminator ?? { envelope: "root" as const, field: "type" };
  const eventType = stringAt(envelope(event, [discriminator.envelope]), discriminator.field);
  if (!eventType) return { kind: "other", sessionId, diagnostic: "malformed-event" };
  if (eventTypes(schema, "ignored", ["step_start", "step_finish"]).includes(eventType)) {
    return { kind: "ignore", sessionId };
  }
  if (eventTypes(schema, "error", ["error"]).includes(eventType)) {
    const errorValue = valueAt(part, shapeAliases(schema, "error", ["error"])) ?? event.error;
    const error = record(errorValue);
    const errorData = record(error?.data);
    const message =
      typeof error?.message === "string"
        ? error.message
        : typeof errorData?.message === "string"
          ? errorData.message
          : typeof errorValue === "string"
            ? errorValue
            : "OpenCode failed";
    return { kind: "error", sessionId, message };
  }
  // OpenCode has emitted both a nested `part` envelope and a root-level
  // `{ type: "tool", callID, state }` envelope. The selected schema decides
  // which event labels are trusted; this only reads either observed shape.
  const textAliases = shapeAliases(schema, "text", ["text", "content"]);
  const text = stringAt(textEnvelope(event, schema), ...textAliases);
  if (eventTypes(schema, "text", ["text"]).includes(eventType) && text !== undefined) {
    return { kind: "text", sessionId, text };
  }
  const stateAliases = shapeAliases(schema, "state", ["state"]);
  const state = record(valueAt(part, stateAliases)) ?? record(valueAt(event, stateAliases));
  const id = toolId(part, schema);
  const toolStartTypes = eventTypes(schema, "toolStart", ["tool_start"]);
  const toolEndTypes = eventTypes(schema, "toolEnd", ["tool_result"]);
  const toolCompleteTypes = eventTypes(schema, "toolComplete", ["tool_use"]);
  if (toolStartTypes.includes(eventType) && id && !terminalToolState(state, part, schema)) {
    return { kind: "tool_start", sessionId, id, name: stringAt(part, ...shapeAliases(schema, "name", ["tool", "name"])) ?? "tool", input: valueAt(state, shapeAliases(schema, "input", ["input"])) ?? valueAt(part, shapeAliases(schema, "input", ["input"])) ?? {} };
  }
  if (toolEndTypes.includes(eventType) && id) {
    const output = shapeAliases(schema, "output", ["output"]);
    const error = shapeAliases(schema, "error", ["error"]);
    return { kind: "tool_end", sessionId, id, output: valueAt(state, output) ?? valueAt(state, error) ?? valueAt(part, output) ?? valueAt(part, error) ?? "", isError: toolStateIsError(state, part, schema) };
  }
  if (toolCompleteTypes.includes(eventType) && id && part) {
    // Legacy `tool_use` frames were terminal snapshots and some omit a
    // status entirely. Their output/error is the durable terminal signal.
    const output = shapeAliases(schema, "output", ["output"]);
    const error = shapeAliases(schema, "error", ["error"]);
    const hasTerminalPayload = valueAt(state, output) !== undefined || valueAt(state, error) !== undefined || valueAt(part, output) !== undefined || valueAt(part, error) !== undefined;
    if (!terminalToolState(state, part, schema) && !hasTerminalPayload) {
      return { kind: "tool_start", sessionId, id, name: stringAt(part, ...shapeAliases(schema, "name", ["tool", "name"])) ?? "tool", input: valueAt(state, shapeAliases(schema, "input", ["input"])) ?? valueAt(part, shapeAliases(schema, "input", ["input"])) ?? {} };
    }
    return {
      kind: "tool",
      sessionId,
      id,
      name: stringAt(part, ...shapeAliases(schema, "name", ["tool", "name"])) ?? "tool",
      input: valueAt(state, shapeAliases(schema, "input", ["input"])) ?? valueAt(part, shapeAliases(schema, "input", ["input"])) ?? {},
      output: valueAt(state, output) ?? valueAt(state, error) ?? valueAt(part, output) ?? valueAt(part, error) ?? "",
      isError: toolStateIsError(state, part, schema),
    };
  }
  const knownType = [
    ...eventTypes(schema, "text", ["text"]),
    ...toolStartTypes,
    ...toolEndTypes,
    ...toolCompleteTypes,
    ...eventTypes(schema, "error", ["error"]),
  ].includes(eventType);
  return {
    kind: "other",
    sessionId,
    diagnostic: knownType ? "malformed-event" : "unknown-event",
  };
}

/**
 * Parse and dispatch one JSONL frame using a selected compatibility schema.
 * Keeping this boundary independent of the HTTP route makes the same
 * session/payload safety contract executable in focused tests.
 */
export function handleOpenCodeJsonLine(
  line: string,
  schema: OpenCodeEventSchema | undefined,
  handlers: OpenCodeJsonLineHandlers,
): void {
  try {
    const rawEvent = JSON.parse(line) as unknown;
    const event = parseOpenCodeRunEvent(rawEvent, schema);
    if (event.sessionId) handlers.onSession?.(event.sessionId);
    switch (event.kind) {
      case "ignore": return;
      case "text": handlers.onText?.(event); return;
      case "tool": handlers.onTool?.(event); return;
      case "tool_start": handlers.onToolStart?.(event); return;
      case "tool_end": handlers.onToolEnd?.(event); return;
      case "error": handlers.onError?.(event); return;
      case "other": handlers.onOther?.(event, rawEvent); return;
    }
  } catch {
    handlers.onMalformedJson?.();
  }
}
