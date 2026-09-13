import type { Card } from "@/lib/cave-board-types";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  }
  return value;
}

function withDefaults(value: unknown, defaults: Record<string, unknown>): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  return {
    ...record,
    ...Object.fromEntries(
      Object.entries(defaults).map(([key, fallback]) => [key, record[key] ?? fallback]),
    ),
  };
}

/** Client/server optimistic-concurrency token. Array order is dependency priority. */
export function orchestrationFingerprint(
  card: Pick<Card, "dependencies" | "primaryBlockerId" | "primaryBlockerPinned" | "nextStep">,
): string {
  return JSON.stringify(canonical({
    dependencies: Array.isArray(card.dependencies)
      ? card.dependencies.map((dependency) => withDefaults(dependency, {
        taskId: null, ref: null, url: null, resolvedAt: null, resolvedBy: null, evidence: null,
      }))
      : card.dependencies ?? [],
    primaryBlockerId: card.primaryBlockerId ?? null,
    primaryBlockerPinned: card.primaryBlockerPinned ?? false,
    nextStep: card.nextStep == null ? null : withDefaults(card.nextStep, {
      actorFamiliarId: null, capability: null, target: null, inputs: [],
    }),
  }));
}
