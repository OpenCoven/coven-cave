export type OpenCodeRunEvent =
  | { kind: "text"; sessionId?: string; text: string }
  | { kind: "tool"; sessionId?: string; id: string; name: string; input: unknown; output: unknown; isError: boolean }
  | { kind: "error"; sessionId?: string; message: string }
  | { kind: "other"; sessionId?: string };

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** Decode OpenCode's `run --format json` envelope without trusting its fields. */
export function parseOpenCodeRunEvent(value: unknown): OpenCodeRunEvent | null {
  const event = record(value);
  if (!event || typeof event.type !== "string") return null;
  const sessionId = typeof event.sessionID === "string" ? event.sessionID : undefined;
  if (event.type === "error") {
    const error = record(event.error);
    return { kind: "error", sessionId, message: String(error?.message ?? event.error ?? "OpenCode failed") };
  }
  const part = record(event.part);
  if (event.type === "text" && typeof part?.text === "string") {
    return { kind: "text", sessionId, text: part.text };
  }
  if (event.type === "tool_use" && part) {
    const state = record(part.state);
    return {
      kind: "tool",
      sessionId,
      id: typeof part.id === "string" ? part.id : crypto.randomUUID(),
      name: typeof part.tool === "string" ? part.tool : "tool",
      input: state?.input ?? {},
      output: state?.output ?? state?.error ?? "",
      isError: state?.status === "error",
    };
  }
  return { kind: "other", sessionId };
}
