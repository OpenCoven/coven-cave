import canonicalize from "canonicalize";

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
import {
  StrictJsonSnapshotError,
  createStrictJsonSnapshot,
} from "./strict-json-snapshot.ts";

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
  let suppliedBriefSnapshot: unknown;
  let suppliedBriefInvalid = false;
  if (brief !== undefined) {
    try {
      suppliedBriefSnapshot = createStrictJsonSnapshot(brief);
    } catch (error) {
      if (error instanceof StrictJsonSnapshotError) {
        suppliedBriefInvalid = true;
      } else {
        throw error;
      }
    }
  }
  const briefMismatch = brief !== undefined
    && (
      suppliedBriefInvalid
      || !inspected.snapshot
      || typeof inspected.snapshot !== "object"
      || canonicalize((inspected.snapshot as Record<string, unknown>).brief)
        !== canonicalize(suppliedBriefSnapshot)
    );
  const result = validateThreadCandidateCore(
    inspected.snapshot,
    inspected.issues,
    briefMismatch
      ? suppliedBriefSnapshot ?? Object.freeze(Object.create(null))
      : undefined,
  );
  return {
    candidateSha256: result.candidateSha256,
    accepted: result.accepted,
    findings: result.findings as DeterministicFinding[],
    measurements: result.measurements as ThreadPostMeasurement[],
  };
}
