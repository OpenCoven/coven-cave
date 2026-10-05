/** Availability of Cave's selected display adapter, not a provider execution
 * capability, authorization decision, or promise that a turn emits an event. */
export type RuntimeDetailAvailability = "supported" | "partial" | "unsupported" | "unknown" | "disabled";
export type ChatRuntimeActivity = {
  schemaVersion: 1;
  path: "direct" | "coven" | "ssh" | "api" | "gateway" | "cli" | "unknown";
  tools: RuntimeDetailAvailability;
  reasoning: RuntimeDetailAvailability;
};

const states = new Set(["supported", "partial", "unsupported", "unknown", "disabled"]);
const paths = new Set(["direct", "coven", "ssh", "api", "gateway", "cli", "unknown"]);

export function normalizeRuntimeActivity(value: unknown): ChatRuntimeActivity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const activity = value as Record<string, unknown>;
  if (activity.schemaVersion !== 1 || typeof activity.path !== "string" || !paths.has(activity.path) ||
    typeof activity.tools !== "string" || !states.has(activity.tools) ||
    typeof activity.reasoning !== "string" || !states.has(activity.reasoning)) return undefined;
  return { schemaVersion: 1, path: activity.path as ChatRuntimeActivity["path"],
    tools: activity.tools as RuntimeDetailAvailability, reasoning: activity.reasoning as RuntimeDetailAvailability };
}

const labels: Record<RuntimeDetailAvailability, string> = {
  supported: "supported on this path",
  partial: "partially supported on this path",
  unsupported: "not supported on this path",
  unknown: "support unverified on this path",
  disabled: "decoding disabled for this turn",
};
const pathLabels: Record<ChatRuntimeActivity["path"], string> = {
  direct: "Direct runtime", coven: "Coven relay", ssh: "SSH relay", api: "API",
  gateway: "Gateway", cli: "CLI bridge", unknown: "Not yet selected",
};

/** Only a selected schema that can introduce a named call supports tool
 * details. Text framing and orphan progress/end events cannot create a row. */
export function schemaSupportsToolCalls(schema?: {
  eventTypes: { toolStart: readonly string[]; toolComplete: readonly string[]; toolLifecycle?: readonly string[] };
}): boolean {
  return Boolean(schema && (schema.eventTypes.toolStart.length || schema.eventTypes.toolComplete.length || schema.eventTypes.toolLifecycle?.length));
}

/** Inputs come from the selected adapter/negotiation, never a model name or
 * provider payload. Undefined means no verified contract for this launch. */
export function runtimeActivityForAdapter(path: ChatRuntimeActivity["path"], tools?: boolean, reasoning?: boolean, localHooks = false): ChatRuntimeActivity {
  const state = (value: boolean | undefined): RuntimeDetailAvailability => value === true ? "supported" : value === false ? "unsupported" : "unknown";
  return { schemaVersion: 1, path, tools: tools !== true && localHooks ? "partial" : state(tools), reasoning: state(reasoning) };
}

export function runtimeActivityStatusLines(value: unknown): string[] {
  const activity = normalizeRuntimeActivity(value);
  if (!activity) return ["Activity support: not recorded"];
  return [`Runtime path: ${pathLabels[activity.path]}`, `Tool details: ${labels[activity.tools]}`,
    `Reasoning summaries: ${labels[activity.reasoning]}`];
}
