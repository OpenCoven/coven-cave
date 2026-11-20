import { computeDefinitionDigest, CovenClientError, normalizeCovenError } from "@opencoven/coven-client";
import type { CovenAutomationDefinitionDocument, CovenAutomationRoutine } from "@opencoven/coven-client";
import { callDaemonBytes } from "../coven-daemon.ts";
import { createAutomationReadClient } from "./coven-automations-sdk.ts";
import { isDeepStrictEqual } from "node:util";

export type AutomationDefinitionSnapshot =
  | { routine: null; revision?: never; definition?: never; tombstonedAt?: never }
  | { routine: CovenAutomationRoutine; revision: number; tombstonedAt: string | null; definition?: CovenAutomationDefinitionDocument };

/** Coven 0.4.10 returns the optional rich document in the same transaction as
 * its compatibility projection. The SDK currently omits that document from
 * get(), so retain the exact bounded bytes it validated, without a second read.
 * A matching digest establishes consistency, not authenticated authority.
 */
export async function readAutomationDefinitionSnapshot(
  id: string,
  transport: typeof callDaemonBytes = callDaemonBytes,
): Promise<AutomationDefinitionSnapshot> {
  const captured: { bytes?: Uint8Array } = {};
  const client = createAutomationReadClient(async request => {
    const response = await transport(request);
    if (typeof request.body === "object" && request.body !== null && "action" in request.body
      && request.body.action === "coven.automations.definition.get.v1" && response.data) {
      captured.bytes = response.data.slice();
    }
    return response;
  });
  // This validates the complete JSON envelope (including duplicate keys) and
  // the requested ID before we inspect the optional document in those bytes.
  const snapshot = await client.get(id);
  const invalid = () => new CovenClientError(normalizeCovenError({ code: "invalid_response" }, "automations.get"));
  if (!captured.bytes) throw invalid();
  const payload = JSON.parse(Buffer.from(captured.bytes).toString("utf8")).event.payload;
  if (!Object.hasOwn(payload, "definition")) return snapshot;
  if (snapshot.routine === null) throw invalid();

  let digest;
  try {
    digest = computeDefinitionDigest(payload.definition);
  } catch {
    throw invalid();
  }
  if (digest.status !== "computed") throw invalid();
  // computeDefinitionDigest performs the SDK's full structural validation.
  const definition = payload.definition as CovenAutomationDefinitionDocument;
  if (definition.automationId !== snapshot.routine.id || definition.revision !== snapshot.revision
    || definition.integrity.value !== digest.digest.value) throw invalid();
  if (definitionProjectionMismatch(snapshot.routine, definition)) throw invalid();
  return { ...snapshot, definition };
}

/** A reviewed compatibility view must describe the same executable fields as its rich document. */
export function definitionProjectionMismatch(value: object, definition: CovenAutomationDefinitionDocument): string | null {
  // Compare the fields Coven 0.4.10 projects into its executable routine.
  // A valid digest alone must not let the UI review one prompt and revise a
  // different one. Rich-only policies/extensions remain in the document.
  const field = (...keys: string[]): unknown => keys.reduce<unknown>((value, key) =>
    value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined, definition);
  const projected: Record<string, unknown> = {
    name: definition.display.name,
    status: definition.lifecycleState === "active" ? "ACTIVE" : definition.lifecycleState === "disabled" ? "DISABLED" : "PAUSED",
    rrule: field("trigger", "schedule", "rrule"), timezone: field("trigger", "schedule", "timezone"),
    prompt: field("action", "prompt"), cwd: field("action", "cwd"),
    outputTarget: field("policies", "delivery", "outputTarget"),
    runtime: definition.runtimeRequirements?.runtimeId ?? "coven-code", model: definition.runtimeRequirements?.model,
    familiarId: definition.binding.familiarId, tags: definition.display.tags ?? [],
    timeoutMinutes: definition.policies.timeout.perRunMinutes,
    misfire: "latest", overlap: "forbid", retry: definition.policies.retry,
  };
  const routine = value as Record<string, unknown>;
  for (const [key, expected] of Object.entries(projected)) {
    const actual = key === "tags" ? routine[key] ?? []
      : key === "retry" ? routine[key] ?? { maxAttempts: 1, backoffPolicy: "none" } : routine[key] ?? undefined;
    if (!isDeepStrictEqual(actual, expected ?? undefined)) return key;
  }
  return null;
}
