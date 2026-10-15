// Explicit Research host contract. Keep exports scoped; never export *.
export {
  LINK_CATEGORY_ORDER,
  MAX_LINKS_PER_SAVE,
  categorizeLink,
  groupSavedLinksByUsage,
  linkCategoryMeta,
  savedLinkDedupeKey,
  summarizeLinkIntake,
} from "@/lib/link-organizer";
export type {
  LinkCategory,
  SavedLink,
  SavedLinkSummary,
} from "@/lib/link-organizer";
