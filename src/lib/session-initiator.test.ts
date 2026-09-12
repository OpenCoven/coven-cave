import assert from "node:assert/strict";
import { initiatorFromSessionKey } from "./session-initiator.ts";

for (const channel of ["cron", "heartbeat", "timer", "schedule"]) {
  assert.deepEqual(
    initiatorFromSessionKey(`agent:sage:${channel}:daily-brief`, "kitty"),
    { kind: "system", label: channel, channel },
    `${channel} sessions should be system-originated`,
  );
}

for (const channel of [
  "telegram", "discord", "signal", "whatsapp", "imessage", "webchat", "slack",
]) {
  assert.deepEqual(
    initiatorFromSessionKey(`agent:kitty:${channel}:group:example:topic:1`, "sage"),
    {
      kind: "human",
      label: `Human via ${channel.charAt(0).toUpperCase()}${channel.slice(1)}`,
      channel,
    },
    `${channel} sessions should retain human provenance with group/topic suffixes`,
  );
}

assert.deepEqual(
  initiatorFromSessionKey("agent:kitty: TELEGRAM :direct:example", "sage"),
  { kind: "human", label: "Human via Telegram", channel: "telegram" },
  "channel recognition should trim whitespace and normalize case",
);
assert.deepEqual(
  initiatorFromSessionKey("agent:sage: CRON :daily-brief", "kitty"),
  { kind: "system", label: "cron", channel: "cron" },
  "system channels should also be normalized",
);

for (const channel of [
  "cave-test-persist-1", "unknown", "@telegram", "telegram/path", "tele gram",
  "1telegram", "telegram\ninjected", "a".repeat(33),
]) {
  assert.deepEqual(
    initiatorFromSessionKey(`agent:kitty:${channel}:example`, "sage"),
    { kind: "familiar", label: "Kitty", agentId: "kitty" },
    "unrecognized or invalid channels should fall back to the keyed familiar",
  );
}

for (const [agentId, label] of [
  ["kitty", "Kitty"],
  ["coven-code", "Coven Code"],
  ["__coven--code__", "Coven Code"],
  ["", "Familiar"],
  ["_-", "Familiar"],
]) {
  assert.deepEqual(
    initiatorFromSessionKey("", agentId),
    { kind: "familiar", label, agentId },
    "missing keys should preserve fallback agent IDs and format their labels",
  );
}

assert.deepEqual(
  initiatorFromSessionKey("agent:coven-code", "kitty"),
  { kind: "familiar", label: "Coven Code", agentId: "coven-code" },
  "the keyed agent should take precedence over the fallback without a channel",
);
for (const sessionKey of ["agent", "unscoped-session", "other:kitty:unknown"]) {
  assert.deepEqual(
    initiatorFromSessionKey(sessionKey, "cody"),
    { kind: "familiar", label: "Cody", agentId: "cody" },
    "keys without an agent identity should use the fallback",
  );
}

console.log("session-initiator.test.ts: ok");
