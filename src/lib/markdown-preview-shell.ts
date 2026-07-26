/**
 * @create-markdown/preview's renderAsync wraps every document in
 * `<div class="cm-preview">…</div>`. Chat inserts that HTML into `.cave-md`,
 * whose ONLY block-rhythm rule is the owl selector `.cave-md > * + *` — with
 * the shell in between, paragraphs, lists and headings become grandchildren
 * and the spacing never applies (a bulleted list renders glued to the
 * paragraph introducing it). Stripping the shell puts the blocks back where
 * the stylesheet expects them; the table-cell path (markdown-table-cells.ts)
 * already does the same unwrap for cell fragments.
 *
 * Pure + framework-free so it's unit-testable in node.
 */
export function unwrapPreviewShell(html: string): string {
  const match = /^\s*<div class="cm-preview">([\s\S]*)<\/div>\s*$/.exec(html);
  return match ? match[1] : html;
}
