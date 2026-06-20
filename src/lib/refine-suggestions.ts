import type { ArtifactKind } from "@/lib/canvas-artifacts";

/**
 * Refine suggestions power the artifact "Refine" space: a couple of one-tap
 * starting points so the user never faces a blank box. There are two rows —
 *
 *   • DEFAULT_REFINE_SUGGESTIONS — always-useful optimizations that apply to
 *     any artifact (visual polish, accessibility, motion).
 *   • generateRefineSuggestions(code, kind) — context-aware ideas derived from
 *     what's actually in the artifact (buttons without hover states, a form
 *     with no validation, a fixed-width layout, etc.).
 *
 * Both return plain instruction strings; tapping one drops it into the refine
 * textarea so the user can run it as-is or edit first. Heuristics are cheap
 * string scans — no parsing, no familiar round-trip — so they're instant.
 */

export const DEFAULT_REFINE_SUGGESTIONS: readonly string[] = [
  "Polish the visual hierarchy, spacing, and alignment",
  "Improve accessibility — color contrast, labels, and focus states",
  "Add subtle motion and micro-interactions",
];

type Rule = {
  /** True when this idea is relevant to the artifact. */
  when: (code: string, kind: ArtifactKind) => boolean;
  /** The suggestion text shown on the chip and sent as the refine ask. */
  text: string;
};

// Ordered by usefulness; generateRefineSuggestions takes the first few matches.
const RULES: Rule[] = [
  {
    when: (c) => /<button|role=["']button["']|<a\s/i.test(c) && !/:hover|:active|transition/i.test(c),
    text: "Add hover, active, and focus states to the interactive elements",
  },
  {
    when: (c) => /<form|<input|<textarea|<select/i.test(c),
    text: "Add inline validation with clear empty, loading, and error states",
  },
  {
    when: (c, kind) => kind !== "react" && !/@media|clamp\(|minmax\(|flex-wrap|grid-template-columns:\s*repeat\([^)]*auto/i.test(c),
    text: "Make the layout responsive and fluid on small screens",
  },
  {
    when: (c, kind) => kind === "react" && /useState|useReducer/.test(c) && !/loading|isLoading|empty|skeleton/i.test(c),
    text: "Add loading and empty states for the dynamic content",
  },
  {
    when: (c) => /#0|#1|background:\s*#0|background:\s*#1|rgb\(\s*1?\d?\d?,?\s*1?\d/i.test(c) && !/prefers-color-scheme|data-theme|light/i.test(c),
    text: "Add a light-mode variant with a theme toggle",
  },
  {
    when: (c) => !/@keyframes|transition|animation:/i.test(c),
    text: "Animate the entrance with a gentle fade and rise",
  },
  {
    when: (c) => /<svg|<img|background-image/i.test(c),
    text: "Refine the imagery and iconography for a more cohesive look",
  },
];

const FALLBACKS: string[] = [
  "Tighten the color palette and add depth with shadows",
  "Add a clear header with a title and supporting subtitle",
  "Increase the contrast and make the primary action stand out",
];

/**
 * Up to `limit` context-aware suggestions for this artifact, de-duplicated
 * against the defaults so the two rows never repeat an idea. Always returns at
 * least one item by topping up from neutral fallbacks.
 */
export function generateRefineSuggestions(
  code: string,
  kind: ArtifactKind = "html",
  limit = 3,
): string[] {
  const src = code ?? "";
  const taken = new Set(DEFAULT_REFINE_SUGGESTIONS.map((s) => s.toLowerCase()));
  const out: string[] = [];

  const add = (text: string) => {
    const key = text.toLowerCase();
    if (taken.has(key) || out.length >= limit) return;
    taken.add(key);
    out.push(text);
  };

  for (const rule of RULES) {
    if (out.length >= limit) break;
    if (rule.when(src, kind)) add(rule.text);
  }
  for (const fb of FALLBACKS) {
    if (out.length >= limit) break;
    add(fb);
  }
  return out;
}
