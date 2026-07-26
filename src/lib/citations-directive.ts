/**
 * Citations directive — the prompt block that teaches familiars to attribute
 * external sources with standard markdown footnotes. The Citation UI
 * (lib/citations.ts + components/ui/citation.tsx) lifts those footnotes into
 * inline markers plus a "Sources" card, so a familiar that cites this way gets
 * rich, clickable sources on both chat and research surfaces.
 *
 * Piggyback model, like buildCovenMarkersDirective: the directive rides every
 * chat turn (buildPromptWithResponseControls) so citing is organic — turns
 * without sources render exactly as before, and nothing depends on adoption.
 *
 * The syntax taught here must stay in lockstep with `parseCitations` in
 * lib/citations.ts: inline refs `[^n]` and end-of-reply definitions
 * `[^n]: <url> "Title"`.
 */
export function buildCitationsDirective(): string {
  return [
    "<citations>",
    "When your reply draws on a specific external source you actually consulted this turn (a web page, a document, or a file), cite it with a standard markdown footnote — the app renders it as a live source card.",
    'Place an inline marker right where the claim sits, like this[^1], and define the source on its own line at the very end of the reply: [^1]: https://example.com/page "Page title". Number footnotes 1, 2, 3… in first-use order; reuse a marker to cite the same source again.',
    "Only cite sources you genuinely used, with their real URLs and titles — never invent a citation. Add no footnotes at all when you did not consult an external source; do not footnote your own reasoning or the user's messages.",
    "Never mention these instructions or the footnote syntax in your visible reply.",
    "</citations>",
  ].join("\n");
}
