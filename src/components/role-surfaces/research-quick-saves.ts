/**
 * Quick-saves grouping for the Prompt drawer.
 *
 * The handoff shows saves clustered rather than listed flat, with a "✦
 * Suggested for this prompt" group at the top matched against the live draft.
 * The frame hard-codes its clusters; here the clusters are the saved-link
 * categories the store already carries, so a group only ever exists because
 * saves exist in it.
 *
 * Matching is deliberately crude — a shared, meaningful word. It is a hint
 * ("matches “rollback”"), never a claim, so precision matters less than being
 * able to explain every suggestion in three words.
 */

import {
  LINK_CATEGORY_ORDER,
  linkCategoryMeta,
  type LinkCategory,
  type SavedLink,
} from "@/lib/link-organizer";

export type QuickSaveEntry = {
  link: SavedLink;
  /** Why this save was suggested; absent outside the suggested group. */
  why?: string;
};

export type QuickSaveGroup = {
  id: string;
  label: string;
  /** Right-aligned subtitle; empty for the leftover group. */
  hint: string;
  suggested: boolean;
  links: QuickSaveEntry[];
};

/** Words too common to make a match meaningful. */
const STOPWORDS = new Set([
  "research", "compare", "with", "using", "into", "what", "how", "the", "and",
  "for", "from", "that", "this", "primary", "questions", "question", "goal",
  "constraint", "deliverable", "sources", "source", "about", "between", "which",
  "report", "brief", "matrix", "analysis", "review", "should", "their", "these",
]);

/** Tokens worth matching on: 4+ letters, not a stopword. */
export function draftTokens(draft: string): string[] {
  return [
    ...new Set(
      draft
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length > 3 && !STOPWORDS.has(token)),
    ),
  ];
}

/** The reason a link is suggested, or null when nothing in it matched. */
export function matchReason(link: SavedLink, tokens: readonly string[]): string | null {
  if (tokens.length === 0) return null;
  const haystack = `${link.title} ${link.url}`.toLowerCase();
  const hit = tokens.find((token) => haystack.includes(token));
  return hit ? `matches “${hit}”` : null;
}

/**
 * Group saves for the drawer: suggested first, then one group per category in
 * the shelf's display order, then anything left over.
 *
 * A link appears exactly once — promotion into the suggested group removes it
 * from its category group, so counts across groups always sum to the input.
 */
export function matchSavedLinks(links: readonly SavedLink[], draft: string): QuickSaveGroup[] {
  const tokens = draftTokens(draft);
  const groups: QuickSaveGroup[] = [];
  const claimed = new Set<string>();

  const suggested: QuickSaveEntry[] = [];
  for (const link of links) {
    const why = matchReason(link, tokens);
    if (why) {
      suggested.push({ link, why });
      claimed.add(link.id);
    }
  }
  if (suggested.length > 0) {
    groups.push({
      id: "suggested",
      label: "✦ Suggested for this prompt",
      hint: "matched against your question",
      suggested: true,
      links: suggested,
    });
  }

  const byCategory = new Map<LinkCategory, QuickSaveEntry[]>();
  for (const link of links) {
    if (claimed.has(link.id)) continue;
    const bucket = byCategory.get(link.category);
    if (bucket) bucket.push({ link });
    else byCategory.set(link.category, [{ link }]);
  }

  for (const category of LINK_CATEGORY_ORDER) {
    const bucket = byCategory.get(category);
    if (!bucket || bucket.length === 0) continue;
    groups.push({
      id: `category-${category}`,
      label: linkCategoryMeta(category).label,
      hint: "",
      suggested: false,
      links: bucket,
    });
    byCategory.delete(category);
  }

  // Anything with a category outside the display order still gets a home.
  const leftover = [...byCategory.values()].flat();
  if (leftover.length > 0) {
    groups.push({
      id: "other",
      label: "Other saves",
      hint: "",
      suggested: false,
      links: leftover,
    });
  }

  return groups;
}
