// @ts-nocheck
import assert from "node:assert/strict";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, test, vi } from "vitest";

const preview = vi.hoisted(() => ({
  html: "",
}));
const sanitizeHtml = vi.hoisted(() => vi.fn((html: string) => html));

vi.mock("@create-markdown/core", () => ({
  parse: (markdown: string) => markdown,
}));
vi.mock("@/lib/html-sanitize", () => ({ sanitizeHtml }));
vi.mock("@/lib/markdown-preview", () => ({
  loadMarkdownPreview: async () => ({
    renderAsync: async (_markdown: string, options: { sanitize?: (html: string) => string }) =>
      options.sanitize?.(preview.html) ?? preview.html,
  }),
}));

import { ResearchMarkdownPreview } from "./research-markdown-preview";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  preview.html = "";
  sanitizeHtml.mockReset();
  sanitizeHtml.mockImplementation((html: string) => html);
});

async function renderMarkdown(markdown: string): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(createElement(ResearchMarkdownPreview, { markdown }));
  });
  return renderer;
}

function renderedHtml(renderer: ReactTestRenderer): string {
  const previewNode = renderer.root.find(
    (node) => node.type === "div" && node.props.className === "research-markdown-preview",
  );
  return previewNode.props.dangerouslySetInnerHTML.__html;
}

test("malicious Markdown is sanitized before it reaches the preview DOM", async () => {
  preview.html = '<div class="cm-preview"><a href="javascript:alert(1)" onclick="alert(2)">unsafe</a><script>alert(3)</script></div>';
  sanitizeHtml.mockReturnValue('<div class="cm-preview"><a>unsafe</a></div>');

  const renderer = await renderMarkdown("[unsafe](javascript:alert(1))");
  const html = renderedHtml(renderer);

  assert.equal(html, "<a>unsafe</a>");
  assert.doesNotMatch(html, /javascript:|onclick=|<script/i);
  assert.equal(sanitizeHtml.mock.calls.length, 2);
  await act(async () => renderer.unmount());
});

test("a safe external Markdown link is preserved in the preview DOM", async () => {
  preview.html = '<div class="cm-preview"><a href="https://example.com/research">source</a></div>';

  const renderer = await renderMarkdown("[source](https://example.com/research)");
  const html = renderedHtml(renderer);

  assert.match(html, /<a href="https:\/\/example\.com\/research">source<\/a>/);
  await act(async () => renderer.unmount());
});
