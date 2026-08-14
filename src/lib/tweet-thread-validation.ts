import { isDeepStrictEqual } from "node:util";

import {
  inspectThreadCandidateForValidation,
} from "./tweet-thread-protocol.ts";
import type {
  DeterministicFinding,
  ThreadBrief,
  ThreadPostMeasurement,
  ThreadValidationResult,
} from "./tweet-thread-protocol.ts";
import {
  createDeterministicFinding as createCoreDeterministicFinding,
  validateThreadCandidateCore,
} from "./tweet-thread-validation-core.ts";

export type {
  ThreadPostMeasurement,
  ThreadValidationResult,
} from "./tweet-thread-protocol.ts";

export function createDeterministicFinding(
  code: string,
  severity: DeterministicFinding["severity"],
  message: string,
  references: { postId?: string; claimId?: string } = {},
  identityParts?: readonly string[],
): DeterministicFinding {
  return createCoreDeterministicFinding(
    code,
    severity,
    message,
    references,
    identityParts,
  );
}

export function validateThreadCandidate(
  candidate: unknown,
  brief?: ThreadBrief,
): ThreadValidationResult {
  const inspected = inspectThreadCandidateForValidation(candidate);
  const briefMismatch = brief !== undefined
    && (
      !inspected.snapshot
      || typeof inspected.snapshot !== "object"
      || !isDeepStrictEqual(
        (inspected.snapshot as Record<string, unknown>).brief,
        brief,
      )
    );
  const result = validateThreadCandidateCore(
    inspected.snapshot,
    inspected.issues,
    briefMismatch ? brief : undefined,
  );
  return {
    candidateSha256: result.candidateSha256,
    accepted: result.accepted,
    findings: result.findings as DeterministicFinding[],
    measurements: result.measurements as ThreadPostMeasurement[],
  };
}
