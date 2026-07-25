import type { OpenCodeEventSchema } from "@/lib/opencode-compatibility";

export type OpenCodeRunEvent =
  | { kind: "text"; sessionId?: string; text: string }
  | { kind: "tool_start"; sessionId?: string; id: string; name: string; input: unknown }
  | { kind: "tool_end"; sessionId?: string; id: string; output: unknown; isError: boolean }
  | { kind: "tool"; sessionId?: string; id: string; name: string; input: unknown; output: unknown; isError: boolean }
  | { kind: "error"; sessionId?: string; message: string }
  | { kind: "other"; sessionId?: string; diagnostic?: "unknown-event" | "malformed-event"; text?: string };

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringAt(recordValue: Record<string, unknown> | null, ...keys: string[]): string | undefined {
  for (const key of keys) if (typeof recordValue?.[key] === "string") return recordValue[key] as string;
  return undefined;
}

function eventTypes(schema: OpenCodeEventSchema | undefined, kind: keyof OpenCodeEventSchema["eventTypes"], defaults: string[]): string[] {
  return schema?.eventTypes[kind]?.length ? schema.eventTypes[kind] : defaults;
}

function toolId(part: Record<string, unknown> | null): string | null {
  return stringAt(part, "id", "callID", "callId", "toolCallId", "tool_call_id") ?? null;
}

function terminalToolState(state: Record<string, unknown> | null): boolean {
  const status = stringAt(state, "status")?.toLowerCase();
  return status === "completed" || status === "complete" || status === "error" || status === "failed";
}

function toolStateIsError(state: Record<string, unknown> | null): boolean {
  const status = stringAt(state, "status")?.toLowerCase();
  return status === "error" || status === "failed" || Boolean(state?.error);
}

/** Decode OpenCode's `run --format json` envelope without trusting its fields. */
export function parseOpenCodeRunEvent(value: unknown, schema?: OpenCodeEventSchema): OpenCodeRunEvent {
  const event = record(value);
  if (!event || typeof event.type !== "string") {
    return { kind: "other", diagnostic: "malformed-event" };
  }
  const sessionId = stringAt(event, "sessionID", "sessionId", "session_id");
  if (eventTypes(schema, "error", ["error"]).includes(event.type)) {
    const error = record(event.error);
    const errorData = record(error?.data);
    const message =
      typeof error?.message === "string"
        ? error.message
        : typeof errorData?.message === "string"
          ? errorData.message
          : typeof event.error === "string"
            ? event.error
            : "OpenCode failed";
    return { kind: "error", sessionId, message };
  }
  // OpenCode has emitted both a nested `part` envelope and a root-level
  // `{ type: "tool", callID, state }` envelope. The selected schema decides
  // which event labels are trusted; this only reads either observed shape.
  const part = record(event.part) ?? record(event.data) ?? event;
  const text = stringAt(part, "text", "content") ?? stringAt(event, "text");
  if (eventTypes(schema, "text", ["text"]).includes(event.type) && text !== undefined) {
    return { kind: "text", sessionId, text };
  }
  const state = record(part?.state) ?? record(event.state);
  const id = toolId(part);
  const toolStartTypes = eventTypes(schema, "toolStart", ["tool_start"]);
  const toolEndTypes = eventTypes(schema, "toolEnd", ["tool_result"]);
  const toolCompleteTypes = eventTypes(schema, "toolComplete", ["tool_use"]);
  if (toolStartTypes.includes(event.type) && id && !terminalToolState(state)) {
    return { kind: "tool_start", sessionId, id, name: stringAt(part, "tool", "name") ?? "tool", input: state?.input ?? part?.input ?? {} };
  }
  if (toolEndTypes.includes(event.type) && id) {
    return { kind: "tool_end", sessionId, id, output: state?.output ?? state?.error ?? part?.output ?? "", isError: toolStateIsError(state) };
  }
  if (toolCompleteTypes.includes(event.type) && id && part) {
    if (!terminalToolState(state)) {
      return { kind: "tool_start", sessionId, id, name: stringAt(part, "tool", "name") ?? "tool", input: state?.input ?? part?.input ?? {} };
    }
    return {
      kind: "tool",
      sessionId,
      id,
      name: stringAt(part, "tool", "name") ?? "tool",
      input: state?.input ?? {},
      output: state?.output ?? state?.error ?? "",
      isError: toolStateIsError(state),
    };
  }
  const knownType = [
    ...eventTypes(schema, "text", ["text"]),
    ...toolStartTypes,
    ...toolEndTypes,
    ...toolCompleteTypes,
    ...eventTypes(schema, "error", ["error"]),
  ].includes(event.type);
  return {
    kind: "other",
    sessionId,
    diagnostic: knownType ? "malformed-event" : "unknown-event",
    ...(text === undefined ? {} : { text }),
  };
}
