// @ts-nocheck — react-test-renderer has no declarations in this repository.
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";

vi.mock("next/link", () => ({ default: ({ children, ...props }) => createElement("a", props, children) }));
vi.mock("next/dynamic", () => ({ default: () => (props) => createElement("div", { "data-file": props.path, "data-line": props.initialLine }) }));
vi.mock("./message-bubble", () => ({ MarkdownBlock: ({ text }) => createElement("pre", null, text) }));
vi.mock("./ui/modal", () => ({ Modal: ({ open, children }) => open ? createElement("section", { role: "dialog" }, children) : null }));
vi.mock("./ui/skeleton", () => ({ SkeletonRows: () => createElement("span", null, "Loading") }));
import { CovenWikiReader } from "./covenwiki-reader";
import { covenWikiMarkdownHref } from "../lib/covenwiki-render";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const renderers = [];
afterEach(async () => {
  await act(async () => { for (const renderer of renderers.splice(0)) renderer.unmount(); });
  vi.unstubAllGlobals();
});
const manifest = {
  schemaVersion: "1.0", slug: "demo", title: "Demo", summary: "Wiki summary",
  source: { kind: "local", fingerprint: null, repoRoot: "/repo" },
  generation: { status: "stub", backend: "stub", generatedAt: "2026-07-15", wordTarget: [650, 950] },
  counts: { pages: 2 },
  navigation: [{ title: "Group", slug: null, children: [
    { title: "Nested", slug: null, children: [{ title: "Overview", slug: "overview", children: [] }] },
    { title: "Details", slug: "details", children: [] },
  ] }],
  pages: ["overview", "details"].map((slug) => ({ slug, title: slug, path: `pages/${slug}.md`, meta: `pages/${slug}.meta.json`, priority: "required", wordCount: 20 })),
};

test("server shell renders recursive group headings and draft state without fetching pages", () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  const html = renderToStaticMarkup(createElement(CovenWikiReader, { manifest, slug: "overview" }));
  expect(html).toContain("Wiki summary");
  expect(html).toContain("Draft");
  expect(html).toContain("Group");
  expect(html).toContain("Nested");
  expect(html).toContain('href="/wikis/demo/overview"');
  expect(html).not.toContain('/null');
  expect(fetch).not.toHaveBeenCalled();
});

test("loads one selected page and opens citation file at its source line", async () => {
  const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, page: {
    markdown: "# Overview", meta: { citations: [{ path: "README.md", startLine: 2, endLine: 4 }], coverageNotes: ["Draft prose"], relatedPages: ["details"] },
  } }) }));
  vi.stubGlobal("fetch", fetch);
  let renderer;
  await act(async () => { renderer = create(createElement(CovenWikiReader, { manifest, slug: "overview" })); });
  renderers.push(renderer);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][0]).toBe("/api/wikis/demo/page/overview");
  expect(JSON.stringify(renderer.toJSON())).toContain("Draft prose");
  const citation = renderer.root.findAllByType("button").find((button) => button.props["data-citation"]);
  await act(async () => citation.props.onClick());
  expect(renderer.root.findByProps({ "data-file": "/repo/README.md" }).props["data-line"]).toBe(2);
});

test("failed page loads show a retry action", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404 })));
  let renderer;
  await act(async () => { renderer = create(createElement(CovenWikiReader, { manifest, slug: "overview" })); });
  renderers.push(renderer);
  expect(renderer.root.findByProps({ role: "alert" })).toBeTruthy();
  expect(renderer.root.findAllByType("button").some((button) => button.children.includes("Retry"))).toBe(true);
});

test("late responses cannot replace the newly selected page", async () => {
  const pending = [];
  vi.stubGlobal("fetch", vi.fn((url) => new Promise((resolve) => pending.push({ url, resolve }))));
  let renderer;
  await act(async () => { renderer = create(createElement(CovenWikiReader, { manifest, slug: "overview" })); });
  renderers.push(renderer);
  await act(async () => renderer.update(createElement(CovenWikiReader, { manifest, slug: "details" })));
  const response = (markdown) => ({ ok: true, json: async () => ({ ok: true, page: { markdown, meta: { citations: [], coverageNotes: [], relatedPages: [] } } }) });
  await act(async () => pending[1].resolve(response("# Details loaded")));
  await act(async () => pending[0].resolve(response("# Old overview")));
  expect(JSON.stringify(renderer.toJSON())).toContain("Details loaded");
  expect(JSON.stringify(renderer.toJSON())).not.toContain("Old overview");
});

test("markdown links resolve known pages and index without enabling unsafe schemes", () => {
  expect(covenWikiMarkdownHref(manifest, "pages/details.md#usage")).toBe("/wikis/demo/details#usage");
  expect(covenWikiMarkdownHref(manifest, "details.md")).toBe("/wikis/demo/details");
  expect(covenWikiMarkdownHref(manifest, "index.md")).toBe("/wikis/demo");
  expect(covenWikiMarkdownHref(manifest, "javascript:alert(1)")).toBeNull();
  expect(covenWikiMarkdownHref(manifest, "../../secrets")).toBeNull();
});
