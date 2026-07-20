export type QuickChatThreadMessage = { id: string; role: "user" | "assistant"; local?: boolean };

/** Only the most recent non-local assistant reply can be regenerated. */
export function lastRegenerableQuickChatMessageId(messages: readonly QuickChatThreadMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "assistant" && !message.local) return message.id;
  }
  return null;
}
