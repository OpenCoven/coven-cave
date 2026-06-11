import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { defaultChatTitleForSession } from "./cave-chat-titles.ts";
import type { ChatTurn, ConversationFile } from "./cave-conversations";

/**
 * OPENCLAW .jsonl message record format.
 * Each line is a JSON object; the ones we care about have type="message".
 */
type OpenclawRecord =
  | { type: "session"; id: string; version: number; timestamp: string; cwd?: string }
  | {
      type: "message";
      id: string;
      parentId: string | null;
      timestamp: string;
      message: OpenclawMessage;
    }
  | { type: string; [key: string]: unknown };

type OpenclawMessage = {
  role: "user" | "assistant" | "system" | "tool";
  content?: string | Array<{ type: string; text?: string; [key: string]: unknown }>;
  timestamp?: number;
  name?: string;
  toolName?: string;
  tool_call_id?: string;
  status?: string;
  /** Present on user messages from channel sources */
  senderName?: string;
  sourceChannel?: string;
};

function extractText(content: OpenclawMessage["content"]): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  return content
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text as string)
    .join("");
}

function stringifyUnknown(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function extractToolEvent(
  id: string,
  msg: OpenclawMessage & { role: "tool" },
): NonNullable<ChatTurn["tools"]>[number] {
  const content = msg.content;
  const arrayContent = Array.isArray(content) ? content : [];
  const firstStructured = arrayContent.find((item) => /tool|function/i.test(item.type));
  const output = extractText(content) || stringifyUnknown(firstStructured?.output ?? firstStructured?.result);
  const name =
    msg.name ??
    msg.toolName ??
    (typeof firstStructured?.name === "string" ? firstStructured.name : undefined) ??
    "tool";
  return {
    id: msg.tool_call_id ?? id,
    name,
    output,
    status: msg.status === "error" ? "error" : "ok",
  };
}

/**
 * Read an openclaw session transcript (.jsonl) and convert it to a
 * ConversationFile shape so the chat-view can render it.
 *
 * Returns null when the file does not exist or cannot be parsed.
 */
export async function loadConversationFromJsonl(
  sessionId: string,
  familiarId: string,
): Promise<ConversationFile | null> {
  // Guard against path traversal
  if (!/^[a-zA-Z0-9_-]+$/.test(sessionId) || !/^[a-zA-Z0-9_-]+$/.test(familiarId)) {
    return null;
  }

  const jsonlPath = path.join(
    process.env.OPENCLAW_HOME ?? path.join(homedir(), ".openclaw"),
    "agents",
    familiarId,
    "sessions",
    `${sessionId}.jsonl`,
  );

  let raw: string;
  try {
    raw = await readFile(jsonlPath, "utf8");
  } catch {
    return null;
  }

  const lines = raw.split("\n").filter((l) => l.trim());
  const turns: ChatTurn[] = [];
  let lastAssistant: ChatTurn | null = null;
  let createdAt: string | null = null;
  let updatedAt: string | null = null;

  for (const line of lines) {
    let record: OpenclawRecord;
    try {
      record = JSON.parse(line) as OpenclawRecord;
    } catch {
      continue;
    }

    if (record.type === "session") {
      createdAt = (record as { type: "session"; timestamp: string }).timestamp;
      continue;
    }

    if (record.type !== "message") continue;

    const msgRecord = record as {
      type: "message";
      id: string;
      timestamp: string;
      message: OpenclawMessage;
    };
    const msg = msgRecord.message;
    if (msg.role === "tool") {
      const tool = extractToolEvent(msgRecord.id, msg as OpenclawMessage & { role: "tool" });
      if (lastAssistant) {
        lastAssistant.tools = [...(lastAssistant.tools ?? []), tool];
      }
      updatedAt =
        typeof msg.timestamp === "number"
          ? new Date(msg.timestamp).toISOString()
          : msgRecord.timestamp;
      continue;
    }

    if (msg.role !== "user" && msg.role !== "assistant") continue;

    const text = extractText(msg.content);
    if (!text.trim()) continue;

    const iso =
      typeof msg.timestamp === "number"
        ? new Date(msg.timestamp).toISOString()
        : msgRecord.timestamp;

    const turn: ChatTurn = {
      id: msgRecord.id,
      role: msg.role as "user" | "assistant",
      text,
      createdAt: iso,
    };
    turns.push(turn);
    lastAssistant = msg.role === "assistant" ? turn : null;

    updatedAt = iso;
  }

  if (turns.length === 0) return null;

  const now = new Date().toISOString();
  const title = defaultChatTitleForSession(sessionId);

  return {
    sessionId,
    familiarId,
    harness: "openclaw",
    title,
    createdAt: createdAt ?? now,
    updatedAt: updatedAt ?? now,
    turns,
  };
}
