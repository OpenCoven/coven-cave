import type { RuntimeCompatibilityProfile } from "./runtime-compatibility.ts";

export type ClaudeMessageEvent =
  | { kind: "text"; text: string }
  | { kind: "tool-use"; id: string; name: string; input: unknown }
  | { kind: "tool-result"; toolUseId: string; content: unknown; isError: boolean };

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/**
 * Decode only the message envelope explicitly described by the selected
 * compatibility profile. This is intentionally a data parser, not a plugin:
 * profile changes can select known envelope labels, but cannot execute code or
 * introduce arbitrary fields into the chat stream.
 */
export function parseClaudeMessageEnvelope(
  value: unknown,
  profile: RuntimeCompatibilityProfile,
): ClaudeMessageEvent[] {
  const envelope = record(value);
  const message = record(envelope?.message);
  const content = message?.content;
  if (!envelope || !Array.isArray(content)) return [];

  const events: ClaudeMessageEvent[] = [];
  if (envelope.type === profile.eventTypes.assistant) {
    for (const value of content) {
      const block = record(value);
      if (!block) continue;
      if (block.type === "text" && typeof block.text === "string" && block.text) {
        events.push({ kind: "text", text: block.text });
      } else if (
        block.type === profile.eventTypes.toolUse &&
        typeof block.id === "string" &&
        typeof block.name === "string" &&
        block.id &&
        block.name
      ) {
        events.push({ kind: "tool-use", id: block.id, name: block.name, input: block.input });
      }
    }
  } else if (envelope.type === profile.eventTypes.user) {
    for (const value of content) {
      const block = record(value);
      if (
        block?.type === profile.eventTypes.toolResult &&
        typeof block.tool_use_id === "string" &&
        block.tool_use_id
      ) {
        events.push({
          kind: "tool-result",
          toolUseId: block.tool_use_id,
          content: block.content,
          isError: block.is_error === true,
        });
      }
    }
  }
  return events;
}
