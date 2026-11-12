import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { parse } from "@create-markdown/core";
import { stabilizeStreamingMarkdown } from "./message-markdown-stream.ts";
import { renderTableReplacements } from "./markdown-table-cells.ts";

// Exercise both published entry points: browser/ESM and CommonJS consumers.
(globalThis as Record<string, unknown>).HTMLElement = class {};
(globalThis as Record<string, unknown>).customElements = { define: () => {}, get: () => undefined };
const { renderAsync } = await import("@create-markdown/preview");
const require = createRequire(import.meta.url);
const cjsParse: typeof parse = require("@create-markdown/core").parse;

for (const [entry, parseMarkdown] of [["esm", parse], ["cjs", cjsParse]] as const) {
  for (const text of [
    "set MAX_RETRY_COUNT to 3", "use snake_case_name here", "file_a and file_b",
    "foo_bar", "foo__bar__baz", "foo___bar___baz", "привет_мир_ещё", "中文_变量_名称",
    "a_2_b", "a_😀_b", "_not closed_inside", "inside_open_ tail_",
  ]) {
    test(`${entry}: literal identifiers: ${text}`, async () => {
      const html = await renderAsync(parseMarkdown(text));
      assert.ok(html.includes(text), `rendered HTML must retain ${JSON.stringify(text)}: ${html}`);
      assert.doesNotMatch(html, /<(?:em|strong)>/);
    });
  }
  for (const [text, expected] of [
    ["_real emphasis_", "<em>real emphasis</em>"],
    ["__real bold__", "<strong>real bold</strong>"],
    ["___both___", "<strong><em>both</em></strong>"],
    ["(_real emphasis_)", "(<em>real emphasis</em>)"],
    ["_snake_case_name_", "<em>snake_case_name</em>"],
    ["*snake_case_name*", "<em>snake_case_name</em>"],
    ["**snake_case_name**", "<strong>snake_case_name</strong>"],
    ["_foo_bar_baz_", "<em>foo_bar_baz</em>"],
    ["_foo_bar_", "<em>foo_bar</em>"],
    ["foo _bar_ baz", "foo <em>bar</em> baz"],
    ["_(bar)_", "<em>(bar)</em>"],
    ["_€_", "<em>€</em>"],
    ["[snake_case_name](https://example.com/file_a_b)", "snake_case_name</a>"],
    ["`MAX_RETRY_COUNT`", "MAX_RETRY_COUNT</code>"],
    ["\\_literal\\_", "_literal_"],
  ]) {
    test(`${entry}: preserve markup: ${text}`, async () => {
      assert.ok((await renderAsync(parseMarkdown(text))).includes(expected), expected);
    });
  }
  test(`${entry}: fenced code stays byte-preserving`, async () => {
    const html = await renderAsync(parseMarkdown("```txt\n_foo_bar_ MAX_RETRY_COUNT\n```"));
    assert.ok(html.includes("_foo_bar_ MAX_RETRY_COUNT"));
    assert.doesNotMatch(html, /<em>/);
  });
}

for (const text of ["Set MAX_RETRY_", "MAX_", "foo__bar", "привет_мир_ещё", "foo_bar."]) {
  test(`pending render retains identifiers: ${text}`, async () => {
    const stabilized = stabilizeStreamingMarkdown(text);
    const html = await renderAsync(parse(stabilized));
    assert.ok(html.includes(text), `${JSON.stringify(text)} became ${JSON.stringify(stabilized)}: ${html}`);
    assert.doesNotMatch(html, /<(?:em|strong)>/);
  });
}
test("shared table cell renderer retains literal identifiers and emphasis", async () => {
  const blocks = parse("| Header_name_value | _real emphasis_ |\n| --- | --- |\n| MAX_RETRY_COUNT | snake_case_name |");
  const html = (await renderTableReplacements(blocks, renderAsync))[0];
  assert.ok(html.includes("Header_name_value"));
  assert.ok(html.includes("MAX_RETRY_COUNT"));
  assert.ok(html.includes("snake_case_name"));
  assert.match(html, /<em>real emphasis<\/em>/);
});
