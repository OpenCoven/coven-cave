import type { SessionInitiator } from "./types.ts";

type OpenClawMessageLike = {
  role?: string;
  senderName?: unknown;
  senderUsername?: unknown;
  sourceChannel?: unknown;
  content?: unknown;
};

const SYSTEM_CHANNELS = new Set(["cron", "heartbeat", "timer", "schedule"]);
const HUMAN_CHANNELS = new Set([
  "telegram",
  "discord",
  "signal",
  "whatsapp",
  "imessage",
  "webchat",
  "slack",
]);

function cleanLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return null;
  // Telegram display names sometimes carry decorative suffixes. Keep the
  // person-readable part and avoid exposing raw IDs or styling glyphs.
  return compact
    .replace(/\s*\([^)]*\)\s*$/u, "")
    .replace(/\s+id:\d+$/i, "")
    .trim() || null;
}

function cleanChannel(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  return /^[a-z][a-z0-9_-]{0,31}$/.test(normalized) ? normalized : undefined;
}

function cleanUsername(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const username = value.replace(/^@/, "").trim();
  return /^[A-Za-z0-9_]{1,32}$/.test(username) ? username : undefined;
}

export function labelFromAgentId(agentId: string): string {
  return agentId
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || "Familiar";
}

export function initiatorFromSessionKey(
  sessionKey: string,
  fallbackAgentId: string,
): SessionInitiator {
  const parts = sessionKey.split(":").filter(Boolean);
  const agentId = parts[0] === "agent" && parts[1] ? parts[1] : fallbackAgentId;
  const channel = cleanChannel(parts[2]);

  if (channel && SYSTEM_CHANNELS.has(channel)) {
    return { kind: "system", label: channel, channel };
  }

  if (channel && HUMAN_CHANNELS.has(channel)) {
    return { kind: "human", label: `Human via ${labelFromAgentId(channel)}`, channel };
  }

  return {
    kind: "familiar",
    label: labelFromAgentId(agentId),
    agentId,
  };
}

export function initiatorFromOpenClawMessages(
  messages: OpenClawMessageLike[],
  fallbackAgentId: string,
  sessionKey = "",
): SessionInitiator {
  const firstUser = messages.find((message) => message.role === "user");
  if (firstUser) {
    const senderName = cleanLabel(firstUser.senderName);
    const channel = cleanChannel(firstUser.sourceChannel);
    const username = cleanUsername(firstUser.senderUsername);
    if (senderName) {
      return {
        kind: "human",
        label: senderName,
        ...(channel ? { channel } : {}),
        ...(username ? { username } : {}),
      };
    }
  }

  return initiatorFromSessionKey(sessionKey, fallbackAgentId);
}

export function openClawMessagesFromJsonlLines(lines: string[]): OpenClawMessageLike[] {
  const messages: OpenClawMessageLike[] = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as { type?: string; message?: OpenClawMessageLike };
      if (parsed.type === "message" && parsed.message) messages.push(parsed.message);
    } catch {
      continue;
    }
  }
  return messages;
}

export function sessionInitiatorLabel(initiator?: SessionInitiator): string {
  if (!initiator) return "Unknown";
  if (initiator.kind === "human" && initiator.channel) return `${initiator.label} / ${labelFromAgentId(initiator.channel)}`;
  return initiator.label;
}
