import { createHash } from "node:crypto";

import { AgentEventSchema, HelloOkSchema } from "@openclaw/gateway-protocol";
import { Value } from "typebox/value";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

export const OPENCLAW_AGENT_EVENT_SCHEMA_HASH = createHash("sha256")
  .update(JSON.stringify(canonicalize(AgentEventSchema)))
  .digest("hex");

export type OpenClawGatewayDiscovery = {
  serverVersion: string;
  protocol: number;
  methods: string[];
  events: string[];
  serverCapabilities: string[];
  agentEventSchemaHash: string;
};

export function openClawDiscoveryFromHello(value: unknown): OpenClawGatewayDiscovery {
  if (!Value.Check(HelloOkSchema, value)) {
    throw new TypeError("Invalid OpenClaw HelloOk payload");
  }
  return {
    serverVersion: value.server.version,
    protocol: value.protocol,
    methods: [...value.features.methods],
    events: [...value.features.events],
    serverCapabilities: [...(value.features.capabilities ?? [])],
    agentEventSchemaHash: OPENCLAW_AGENT_EVENT_SCHEMA_HASH,
  };
}
