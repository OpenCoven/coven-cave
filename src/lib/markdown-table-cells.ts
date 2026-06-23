// Shared table-cell inline-markdown rendering for the @create-markdown/preview
// pipeline.
//
// The preview renderer emits table header/row cells as escaped plain text, so
// `**bold**`, `_em_`, `` `code` `` and `[links]` inside a cell render literally.
// We re-render each cell through the inline (paragraph) path and rebuild the
// <table>, then feed the result back via a `table` customRenderer that returns
// these positionally. Used by the desktop library doc preview and the native
// iOS WKWebView renderer; the chat message bubble carries its own inlined copy.

import { parse, type Block } from "@create-markdown/core";

// The helper only renders cells with a single argument, so it asks for the
// narrowest shape it needs — the real renderAsync (which takes extra optional
// options) is assignable to this.
type RenderAsync = (blocks: Block[]) => Promise<string>;

type TableBlock = Block & {
  type: "table";
  props: { headers?: string[]; rows?: string[][]; alignments?: Array<string | null> };
};

async function renderInlineMd(text: string, renderAsync: RenderAsync): Promise<string> {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return "";
  const html = (await renderAsync(parse(trimmed))).trim();
  // Single paragraph (the normal cell shape) → unwrap to its inline HTML.
  const para = /^<div class="cm-preview"><p[^>]*>([\s\S]*)<\/p><\/div>$/.exec(html);
  if (para) return para[1];
  // Anything else (cell parsed as heading/list/etc.) → keep block HTML, drop wrapper.
  return html.replace(/^<div class="cm-preview">/, "").replace(/<\/div>$/, "");
}

async function renderTableBlock(block: TableBlock, renderAsync: RenderAsync): Promise<string> {
  const headers = block.props.headers ?? [];
  const rows = block.props.rows ?? [];
  const alignments = block.props.alignments ?? [];
  const alignAttr = (i: number) =>
    alignments[i] ? ` style="text-align: ${alignments[i]}"` : "";

  const ths = await Promise.all(
    headers.map(async (h, i) => `<th${alignAttr(i)}>${await renderInlineMd(h, renderAsync)}</th>`),
  );
  const trs = await Promise.all(
    rows.map(async (row) => {
      const tds = await Promise.all(
        row.map(async (cell, i) => `<td${alignAttr(i)}>${await renderInlineMd(cell, renderAsync)}</td>`),
      );
      return `<tr>${tds.join("")}</tr>`;
    }),
  );
  return `<table class="cm-table"><thead><tr>${ths.join("")}</tr></thead><tbody>${trs.join("")}</tbody></table>`;
}

/**
 * Render replacement HTML for every table block in `blocks`, in document order.
 * Pair with a `table` customRenderer that returns these positionally:
 *
 *   const tables = await renderTableReplacements(blocks, renderAsync);
 *   let i = 0;
 *   await renderAsync(blocks, { customRenderers: { table: () => tables[i++] ?? "" } });
 */
export async function renderTableReplacements(
  blocks: Block[],
  renderAsync: RenderAsync,
): Promise<string[]> {
  const tableBlocks = blocks.filter((b): b is TableBlock => b.type === "table");
  return Promise.all(tableBlocks.map((block) => renderTableBlock(block, renderAsync)));
}
