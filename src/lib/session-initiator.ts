import type { SessionInitiator } from "./types.ts";

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

function cleanChannel(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  return /^[a-z][a-z0-9_-]{0,31}$/.test(normalized) ? normalized : undefined;
}

function labelFromAgentId(agentId: string): string {
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
