import type { ToolActivity } from "./chat-activity.ts";

/** A display projection, not hidden reasoning state or an execution receipt. */
export type ChatReasoningBlock = {
  schemaVersion: 1;
  id: string;
  representation: "provider-summary" | "provider-progress" | "application-activity" | "legacy-unverified";
  phase: "running" | "complete" | "unavailable";
  text?: string;
  /** UTF-16 answer position at first observation, projected before display. */
  textOffset?: number;
  disclosure: "display-safe" | "withheld";
  /** Only a native redacted-summary block establishes provider withholding. */
  unavailableReason?: "provider-withheld";
  observation: {
    runId: string;
    attemptId: string;
    source: "runtime-report" | "application";
    producer: ToolActivity["producer"];
    firstObservedAt: number;
    /** Cave's shared reasoning/tool observation order, not execution proof. */
    sequence?: number;
    updatedAt: number;
    completedAt: number | null;
    binding: "unavailable";
  };
};

const representations = new Set(["provider-summary", "provider-progress", "application-activity", "legacy-unverified"]);
export function normalizeReasoningBlock(value: unknown): ChatReasoningBlock | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const block = value as Record<string, unknown>;
  if (block.schemaVersion !== 1 || typeof block.id !== "string" || !block.id || block.id.length > 512 ||
    typeof block.representation !== "string" || !representations.has(block.representation) ||
    !["running", "complete", "unavailable"].includes(String(block.phase)) || typeof block.phase !== "string" ||
    (block.disclosure !== "display-safe" && block.disclosure !== "withheld")) return undefined;
  const phase = block.phase as ChatReasoningBlock["phase"];
  const observation = block.observation as ChatReasoningBlock["observation"] | undefined;
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  const token = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/;
  const time = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
  if (!observation || typeof observation.runId !== "string" || !uuid.test(observation.runId) ||
    typeof observation.attemptId !== "string" || !uuid.test(observation.attemptId) ||
    !block.id.startsWith(`${observation.attemptId}:`) ||
    (observation.source !== "runtime-report" && observation.source !== "application") || observation.binding !== "unavailable" ||
    !observation.producer || typeof observation.producer.harness !== "string" || !token.test(observation.producer.harness) ||
    !(observation.producer.version === null || typeof observation.producer.version === "string" && /^v?\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(observation.producer.version) && observation.producer.version.length <= 128) ||
    !(observation.producer.protocol === null || typeof observation.producer.protocol === "string" && token.test(observation.producer.protocol)) ||
    !time(observation.firstObservedAt) || !time(observation.updatedAt) || observation.updatedAt < observation.firstObservedAt ||
    (observation.sequence !== undefined && !time(observation.sequence)) ||
    (block.textOffset !== undefined && !time(block.textOffset)) ||
    (phase === "complete" ? !time(observation.completedAt) || observation.completedAt < observation.firstObservedAt || observation.completedAt > observation.updatedAt : observation.completedAt !== null) ||
    (phase !== "complete" && block.disclosure !== "withheld") ||
    (block.disclosure === "withheld" && block.text !== undefined) ||
    (block.disclosure === "display-safe" && (typeof block.text !== "string" || !block.text.trim() || block.text.length > 16_384))) return undefined;
  if (block.unavailableReason !== undefined && (block.unavailableReason !== "provider-withheld" ||
    phase !== "unavailable" || observation.source !== "runtime-report")) return undefined;
  return {
    schemaVersion: 1, id: block.id, representation: block.representation as ChatReasoningBlock["representation"],
    ...(block.textOffset !== undefined ? { textOffset: block.textOffset as number } : {}),
    ...(block.unavailableReason === "provider-withheld" ? { unavailableReason: "provider-withheld" as const } : {}),
    phase, disclosure: block.disclosure, observation: {
      runId: observation.runId, attemptId: observation.attemptId, source: observation.source,
      producer: { harness: observation.producer.harness, version: observation.producer.version, protocol: observation.producer.protocol },
      firstObservedAt: observation.firstObservedAt, updatedAt: observation.updatedAt, completedAt: observation.completedAt,
      ...(observation.sequence !== undefined ? { sequence: observation.sequence } : {}),
      binding: "unavailable",
    },
    ...(typeof block.text === "string" ? { text: block.text } : {}),
  };
}

export function normalizeReasoningBlocks(value: unknown): ChatReasoningBlock[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const blocks = value.slice(0, 64).flatMap((block) => normalizeReasoningBlock(block) ?? []);
  return blocks.length ? blocks : undefined;
}

export function mergeReasoningBlock(blocks: ChatReasoningBlock[] | undefined, incoming: ChatReasoningBlock): ChatReasoningBlock[] {
  const previous = blocks?.find((block) => block.id === incoming.id);
  if (previous?.phase === "complete" || previous?.phase === "unavailable" && incoming.phase === "running") return blocks!;
  if (previous) return blocks!.map((block) => block.id === incoming.id ? incoming : block);
  return [...(blocks ?? []), incoming].slice(0, 64);
}
