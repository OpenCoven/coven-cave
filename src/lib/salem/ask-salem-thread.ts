// Salem history — pure helpers over the thread the retired Ask Salem surface
// saved (#6399). The storage key and shape stay unchanged so existing threads
// remain readable, exportable and deletable.

export type AskSalemRole = "user" | "salem";

export type AskSalemMessage = {
  role: AskSalemRole;
  text: string;
  /** Epoch ms when the turn was recorded; absent on legacy entries. */
  at?: number;
};

/** Versioned key — bump the suffix when the persisted shape changes. */
export const ASK_SALEM_THREAD_KEY = "cave:ask-salem:thread:v1";

/** Hard cap on persisted turns; oldest drop first. */
export const ASK_SALEM_THREAD_CAP = 50;

type StorageLike = Pick<Storage, "getItem" | "removeItem">;

function isAskSalemMessage(value: unknown): value is AskSalemMessage {
  if (!value || typeof value !== "object") return false;
  const entry = value as { role?: unknown; text?: unknown };
  return (
    (entry.role === "user" || entry.role === "salem") &&
    typeof entry.text === "string" &&
    entry.text.length > 0
  );
}

/** Restore the persisted thread. Corrupt or foreign payloads yield []. */
export function loadThread(storage: StorageLike): AskSalemMessage[] {
  try {
    const raw = storage.getItem(ASK_SALEM_THREAD_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isAskSalemMessage).slice(-ASK_SALEM_THREAD_CAP);
  } catch {
    return [];
  }
}

export function clearThread(storage: StorageLike): void {
  try {
    storage.removeItem(ASK_SALEM_THREAD_KEY);
  } catch {
    /* ignore */
  }
}

/** The saved thread as Markdown, oldest first, for the export action. */
export function threadToMarkdown(messages: readonly AskSalemMessage[]): string {
  const turns = messages.filter(isAskSalemMessage).map((message) => {
    const speaker = message.role === "salem" ? "Salem" : "You";
    const when = typeof message.at === "number" ? ` (${new Date(message.at).toISOString()})` : "";
    return `## ${speaker}${when}\n\n${message.text}`;
  });
  return `# Ask Salem history\n\n${turns.join("\n\n")}\n`;
}
