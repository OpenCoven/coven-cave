// Explicit Research host contract. Keep exports scoped; never export *.
export {
  MAX_LINKS_PER_SAVE,
  getSavedLinkById,
  listSavedLinkSummaries,
  listSavedLinks,
  removeSavedLink,
  reserveXArticleCandidates,
  saveResearchLinks,
  toSavedLinkSummary,
} from "@/lib/server/research-links";
export type {
  ResearchLinkEnrichment,
  XArticleCandidateReservation,
} from "@/lib/server/research-links";
