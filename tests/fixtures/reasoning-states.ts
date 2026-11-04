import { readFileSync } from "node:fs";

// Shared golden-02 (#6057) reasoning-state fixtures. #6061 (golden-13) extends
// these sentinels instead of defining a second set. Every sentinel is private:
// a test fails if one reaches a display, copy, export, log or cache surface.

// The values live in the cross-language corpus so TypeScript, Swift and the
// server integration tests share one set.
const corpus = JSON.parse(readFileSync(new URL("../../apps/ios/CovenCave/CovenCaveTests/Fixtures/runtime-activity-v1.json", import.meta.url), "utf8")) as {
  reasoningPrivacySentinels: {
    private: { withheldSummary: string; opaqueState: string; legacyThought: string };
    tool: { argument: string; result: string; payloadSignature: string };
    continuationToken: string;
  };
};

export const REASONING_STATE_SENTINELS = corpus.reasoningPrivacySentinels.private;
/** Opaque continuation that must reach execution unchanged; not a display value. */
export const CONTINUATION_TOKEN = corpus.reasoningPrivacySentinels.continuationToken;

export const PRIVATE_REASONING_SENTINELS: readonly string[] = Object.values(REASONING_STATE_SENTINELS);

/** Split a value into `parts` contiguous chunks so no single chunk carries a
 * whole sentinel. Joining the chunks returns the input unchanged. */
export function splitAcross(value: string, parts = 3): string[] {
  const size = Math.max(1, Math.ceil(value.length / parts));
  const chunks: string[] = [];
  for (let start = 0; start < value.length; start += size) chunks.push(value.slice(start, start + size));
  return chunks;
}

export function privateSentinelsIn(text: string): string[] {
  return PRIVATE_REASONING_SENTINELS.filter((sentinel) => text.includes(sentinel));
}

/** golden-13 (#6061) tool payload sentinels. The argument and result may be
 * shown inside an authorized tool card only; the signature never. */
export const TOOL_PAYLOAD_SENTINELS = corpus.reasoningPrivacySentinels.tool;

export function toolSentinelsIn(text: string): string[] {
  return Object.values(TOOL_PAYLOAD_SENTINELS).filter((sentinel) => text.includes(sentinel));
}

type Producer = { harness: string; version: string | null; protocol: string | null };

/** Display-projected blocks for each no-text reasoning state. They satisfy
 * `normalizeReasoningBlock`; `withOpaqueFields` adds fields a leaking server
 * might attach, which the client must drop. */
export function reasoningStateBlocks({ runId, attemptId, producer = { harness: "claude", version: null, protocol: null }, withOpaqueFields = false }: {
  runId: string; attemptId: string; producer?: Producer; withOpaqueFields?: boolean;
}) {
  const opaque = withOpaqueFields
    ? { signature: REASONING_STATE_SENTINELS.opaqueState, encrypted_content: REASONING_STATE_SENTINELS.opaqueState, data: REASONING_STATE_SENTINELS.withheldSummary }
    : {};
  const observation = (sequence: number) => ({
    runId, attemptId, source: "runtime-report" as const, producer,
    firstObservedAt: 1, updatedAt: 2, completedAt: null, sequence, binding: "unavailable" as const,
  });
  return {
    providerWithheld: {
      schemaVersion: 1, id: `${attemptId}:withheld`, representation: "provider-summary", phase: "unavailable",
      disclosure: "withheld", unavailableReason: "provider-withheld", textOffset: 0, observation: observation(0), ...opaque,
    },
    unavailable: {
      schemaVersion: 1, id: `${attemptId}:unavailable`, representation: "provider-summary", phase: "unavailable",
      disclosure: "withheld", textOffset: 0, observation: observation(1), ...opaque,
    },
  };
}
