// Explicit Research host contract. Keep exports scoped; never export *.
export {
  AGENTIC_EVIDENCE_KINDS,
  contextFingerprint,
  parseAgenticRecommendationsOutput,
  rankAgenticRecommendations,
} from "@/lib/agentic-recommendations";
export type {
  AgenticEvidenceKind,
  AgenticEvidenceRef,
  AgenticPayload,
  AgenticRecommendation,
  AgenticVerificationCheckState,
  RankedAgenticRecommendation,
} from "@/lib/agentic-recommendations";
