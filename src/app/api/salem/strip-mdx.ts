// Strip MDX/JSX leakage from the docs corpus served to Salem.
//
// llms-full.txt preserves Fumadocs component tags (<Mermaid>, <Cards>,
// <Card />, <DocsDataTable>, <GraphView />, <HubCards />, …) verbatim;
// without sanitization those tags render as broken markup in the chat panel —
// especially multi-line `chart="..."` attributes that dump raw flowchart
// syntax, and 800-char truncation that slices tags in half.
//
// Lives at the retrieval/corpus layer (not the client) so retrieval, scoring,
// and truncation all operate on plain markdown.

// A JSX attribute: name, optionally followed by =value where value is a
// "..."-quoted string (which may contain unescaped `>` — e.g. mermaid arrows
// like `-->` inside a chart attribute), a '...'-quoted string, a {…}
// expression, or a bare token. Multi-line attribute bodies are allowed
// because the quoted forms tolerate any char except the matching quote.
const ATTR = "\\s+[A-Za-z_$][\\w-]*(?:=(?:\"[^\"]*\"|'[^']*'|\\{[^}]*\\}|[^\\s>\"'{]+))?";
// Whole PascalCase JSX element openers, with quote-aware attribute matching.
const SELF_CLOSING_TAG = new RegExp(`<[A-Z][A-Za-z0-9]*(?:${ATTR})*\\s*/>`, "g");
const OPEN_TAG = new RegExp(`<[A-Z][A-Za-z0-9]*(?:${ATTR})*\\s*>`, "g");
const CLOSE_TAG = /<\/[A-Z][A-Za-z0-9]*\s*>/g;
// Dangling/truncated opener at end-of-text (retrieval cut mid-tag at 800
// chars before a closing `>` or `/>` arrived). Greedy `[\s\S]*` is safe
// because the `$` anchor pins us to the very end of the string.
const DANGLING_EOF = /<[A-Z][A-Za-z0-9]*\b[\s\S]*$/;

export function stripMdxLeakage(text: string): string {
  function cardToLink(attrs: string): string | null {
    const title = /\btitle="([^"]*)"/.exec(attrs)?.[1];
    const href = /\bhref="([^"]*)"/.exec(attrs)?.[1];
    const desc = /\bdescription="([^"]*)"/.exec(attrs)?.[1];
    if (!title || !href) return null;
    return `- [${title}](${href})${desc ? ` — ${desc}` : ""}`;
  }

  // <Cards>…</Cards> → markdown link list (extract every nested <Card />).
  text = text.replace(/<Cards>([\s\S]*?)<\/Cards>/g, (_match, inner: string) => {
    const links: string[] = [];
    const cardRe = /<Card\s+([^>]*?)\/?>/g;
    let m: RegExpExecArray | null;
    while ((m = cardRe.exec(inner)) !== null) {
      const link = cardToLink(m[1]);
      if (link) links.push(link);
    }
    return links.length ? links.join("\n") : "";
  });

  // Stray self-closing <Card .../> outside a <Cards> wrapper.
  text = text.replace(/<Card\s+([^>]*?)\/>/g, (_m, attrs: string) => cardToLink(attrs) ?? "");

  // MDX import/export lines and {/* … */} comments.
  text = text.replace(/^\s*(?:import|export)\s[^\n]*$/gm, "");
  text = text.replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

  text = text.replace(SELF_CLOSING_TAG, "");
  text = text.replace(OPEN_TAG, "");
  text = text.replace(CLOSE_TAG, "");
  text = text.replace(DANGLING_EOF, "");

  // Heading anchors like " [#docs-map]" after heading text.
  text = text.replace(/\s\[#[\w-]+\]/g, "");

  // Collapse runs of blank lines left behind by stripping.
  text = text.replace(/\n{3,}/g, "\n\n");

  return text.trim();
}
