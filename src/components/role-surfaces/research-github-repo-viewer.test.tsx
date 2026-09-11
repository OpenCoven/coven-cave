// @ts-nocheck — react-test-renderer ships no types; this is a rendered surface behavior test.
import React from "react";
import { act, create } from "react-test-renderer";
import { afterEach, expect, test, vi } from "vitest";

import { LiveRegionProvider } from "@/components/ui/live-region";
import { ResearchGithubRepoViewer } from "./research-github-repo-viewer";

vi.mock("@/components/message-bubble", () => ({
  MarkdownBlock: ({
    text,
    className,
    onOpenUrl,
    resolveOpenUrl,
    stripLayoutHtml,
    suppressRemoteMedia,
  }: {
    text: string;
    className?: string;
    onOpenUrl?: (url: string) => void;
    resolveOpenUrl?: (url: string) => string | null;
    stripLayoutHtml?: boolean;
    suppressRemoteMedia?: boolean;
  }) => (
    <pre
      data-testid="markdown-block"
      data-suppress-remote-media={suppressRemoteMedia}
      data-strip-layout-html={stripLayoutHtml}
      data-resolved-relative-url={resolveOpenUrl?.("docs/guide.md")}
      className={className}
      onClick={() => {
        const url = resolveOpenUrl?.("docs/guide.md");
        if (url) onOpenUrl?.(url);
      }}
    >
      {text}
    </pre>
  ),
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const COMMIT_SHA = "a".repeat(40);
const README_SHA = "b".repeat(40);
const INDEX_SHA = "c".repeat(40);
const UTIL_SHA = "d".repeat(40);
const DEEP_SHA = "e".repeat(40);
const BINARY_SHA = "f".repeat(40);

const SNAPSHOT = {
  version: 1,
  owner: "OpenCoven",
  repo: "coven-cave",
  description: "Desktop control room",
  primaryLanguage: "TypeScript",
  licenseSpdx: "MIT",
  visibility: "public",
  stars: 42,
  forks: 7,
  defaultBranch: "main",
  resolvedRef: "main",
  commitSha: COMMIT_SHA,
  fetchedAt: "2026-09-01T12:00:00.000Z",
  truncated: false,
  tree: [
    { path: "README.md", type: "blob", sha: README_SHA, size: 12 },
    { path: "src", type: "tree", sha: COMMIT_SHA },
    { path: "src/index.ts", type: "blob", sha: INDEX_SHA, size: 40 },
    { path: "src/util.ts", type: "blob", sha: UTIL_SHA, size: 30 },
    { path: "vendor/deep/nest/only/Widget.swift", type: "blob", sha: DEEP_SHA, size: 90 },
    { path: "assets/logo.png", type: "blob", sha: BINARY_SHA, size: 240_000 },
  ],
  readme: { path: "README.md", markdown: "# Hello" },
};

const { tree: _tree, readme: _readme, ...SUMMARY } = SNAPSHOT;

async function mount(overrides = {}) {
  const props = {
    summary: SUMMARY,
    snapshot: SNAPSHOT,
    loadError: null,
    onRetryLoad: vi.fn(),
    openUrl: vi.fn(),
    onClose: vi.fn(),
    onPreviewInBrowser: vi.fn(),
    removeSlot: <span>remove-slot</span>,
    addToRunSlot: <span>add-slot</span>,
    ...overrides,
  };
  let renderer;
  await act(async () => {
    renderer = create(
      <LiveRegionProvider>
        <ResearchGithubRepoViewer {...props} />
      </LiveRegionProvider>,
    );
  });
  return { renderer, ...props };
}

/**
 * Visible text only. `JSON.stringify(toJSON())` also serialises `title`,
 * `aria-label` and every other prop, so counting identity with it conflates
 * accessible duplicates with the on-screen repetition this redesign removed —
 * and a predicate that stringifies live `props.children` hits React's circular
 * element refs outright.
 */
function visibleText(node) {
  if (node === null || node === undefined || node === false) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(visibleText).join("");
  return visibleText(node.children);
}

function screenText(renderer) {
  return visibleText(renderer.toJSON());
}

/** A rail row, addressed the way the design labels them: by full path. */
function row(renderer, path) {
  return renderer.root.find(
    (node) => node.type === "button" && node.props.title === path && "data-row-index" in node.props,
  );
}

function rowPaths(renderer) {
  return renderer.root
    .findAll((node) => node.type === "button" && "data-row-index" in node.props, { deep: true })
    .map((node) => node.props.title);
}

async function click(node) {
  await act(async () => {
    await node.props.onClick();
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("renders the persisted commit snapshot without fetching on mount", async () => {
  const fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
  const { renderer } = await mount();

  expect(fetchSpy).not.toHaveBeenCalled();
  const json = JSON.stringify(renderer.toJSON());
  expect(json).toMatch(/OpenCoven\/coven-cave/);
  // The header states provenance once, as the short SHA over its ref.
  expect(json).toMatch(new RegExp(COMMIT_SHA.slice(0, 7)));
  expect(renderer.root.findByProps({ "data-testid": "markdown-block" }).props.children).toBe("# Hello");
  renderer.unmount();
});

test("identity, provenance and metrics are each stated exactly once", async () => {
  const { renderer } = await mount();
  const text = screenText(renderer);

  // The P0 this redesign exists for: the slug was rendered three times and the
  // domain twice before any content. On screen the slug now appears once as
  // the heading and once inside the copyable URL — and nowhere else.
  expect(text.match(/OpenCoven\/coven-cave/g)).toHaveLength(2);
  expect(text.match(/github\.com/g)).toHaveLength(1);
  // `public` is the default, so nothing renders for it — absence IS the fact.
  expect(text).not.toMatch(/public/);
  // The old second identity block carried this eyebrow; it is gone entirely.
  expect(text).not.toMatch(/Saved GitHub repository/);
  renderer.unmount();
});

test("a private repository is the one thing that earns a badge", async () => {
  const { renderer } = await mount({
    snapshot: { ...SNAPSHOT, visibility: "private" },
    summary: { ...SUMMARY, visibility: "private" },
  });
  expect(JSON.stringify(renderer.toJSON())).toMatch(/private/);
  renderer.unmount();
});

test("README rendering suppresses remote media, strips layout HTML, and routes relative links through the captured commit", async () => {
  const { renderer, openUrl } = await mount();
  const markdown = renderer.root.findByProps({ "data-testid": "markdown-block" });

  expect(markdown.props["data-suppress-remote-media"]).toBe(true);
  expect(markdown.props["data-strip-layout-html"]).toBe(true);
  expect(markdown.props["data-resolved-relative-url"]).toBe(
    `https://github.com/OpenCoven/coven-cave/blob/${COMMIT_SHA}/docs/guide.md`,
  );
  markdown.props.onClick();
  expect(openUrl).toHaveBeenCalledWith(
    `https://github.com/OpenCoven/coven-cave/blob/${COMMIT_SHA}/docs/guide.md`,
  );
  renderer.unmount();
});

test("a single-child directory spine renders as ONE row, not five", async () => {
  const { renderer } = await mount();
  const paths = rowPaths(renderer);

  // `vendor/deep/nest/only` is four directories with one child each; the rail
  // shows the joined path once, and none of the intermediate rows exist.
  expect(paths).toContain("vendor/deep/nest/only");
  expect(paths).not.toContain("vendor");
  expect(paths).not.toContain("vendor/deep");
  renderer.unmount();
});

test("selecting a text file reads its exact captured blob inside Cave", async () => {
  const requested = [];
  vi.stubGlobal("fetch", vi.fn(async (input) => {
    requested.push(String(input));
    return new Response(JSON.stringify({
      ok: true,
      sha: INDEX_SHA,
      text: "export const cave = true;\n",
      bytes: 26,
    }), { headers: { "content-type": "application/json" } });
  }));
  const { renderer } = await mount();

  await click(row(renderer, "src"));           // open the directory
  await click(row(renderer, "src/index.ts"));  // then the file

  expect(requested).toEqual([
    `/api/research/github-repo/file?repo=OpenCoven%2Fcoven-cave&sha=${INDEX_SHA}`,
  ]);
  expect(JSON.stringify(renderer.toJSON())).toMatch(/export const cave = true/);
  expect(row(renderer, "src/index.ts").props["aria-selected"]).toBe(true);
  renderer.unmount();
});

test("a later file selection cannot be replaced by an older response", async () => {
  const pending = new Map();
  vi.stubGlobal("fetch", vi.fn((input) => new Promise((resolve) => {
    pending.set(String(input), resolve);
  })));
  const { renderer } = await mount();

  await click(row(renderer, "src"));
  await act(async () => {
    row(renderer, "src/index.ts").props.onClick();
    row(renderer, "src/util.ts").props.onClick();
  });
  await act(async () => {
    pending.get(`/api/research/github-repo/file?repo=OpenCoven%2Fcoven-cave&sha=${UTIL_SHA}`)(
      new Response(JSON.stringify({ ok: true, sha: UTIL_SHA, text: "newer", bytes: 5 })),
    );
  });
  await act(async () => {
    pending.get(`/api/research/github-repo/file?repo=OpenCoven%2Fcoven-cave&sha=${INDEX_SHA}`)(
      new Response(JSON.stringify({ ok: true, sha: INDEX_SHA, text: "stale", bytes: 5 })),
    );
  });

  const json = JSON.stringify(renderer.toJSON());
  expect(json).toMatch(/newer/);
  expect(json).not.toMatch(/stale/);
  renderer.unmount();
});

test("a failed blob read surfaces the real message and a retry", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(
    JSON.stringify({ ok: false, error: "This file could not be read from the capture." }),
    { status: 502, headers: { "content-type": "application/json" } },
  )));
  const { renderer } = await mount();

  await click(row(renderer, "src"));
  await click(row(renderer, "src/index.ts"));

  const json = JSON.stringify(renderer.toJSON());
  expect(json).toMatch(/could not be read from the capture/);
  expect(json).toMatch(/Retry/);
  renderer.unmount();
});

test("an unpreviewable file is refused in-pane WITHOUT a fetch", async () => {
  const fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
  const { renderer } = await mount();

  await click(row(renderer, "assets"));
  await click(row(renderer, "assets/logo.png"));

  // Asking GitHub for bytes Cave will refuse to render is wasted work.
  expect(fetchSpy).not.toHaveBeenCalled();
  const json = JSON.stringify(renderer.toJSON());
  expect(json).toMatch(/not previewable in Cave/);
  expect(json).toMatch(/234 KB/);
  renderer.unmount();
});

test("the filter switches the rail to a flat ranked file list", async () => {
  const { renderer } = await mount();
  const input = renderer.root.find(
    (node) => node.type === "input" && node.props["aria-label"] === "Filter repository files",
  );

  await act(async () => {
    input.props.onChange({ target: { value: "util" } });
  });

  const paths = rowPaths(renderer);
  expect(paths).toEqual(["src/util.ts"]);
  // Flat means flat: the directory it lives in is not a row of its own.
  expect(paths).not.toContain("src");
  renderer.unmount();
});

test("the primary action follows the selection rather than a fixed destination", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(
    JSON.stringify({ ok: true, sha: INDEX_SHA, text: "x", bytes: 1 }),
    { headers: { "content-type": "application/json" } },
  )));
  const { renderer, openUrl } = await mount();

  const primary = () => renderer.root.find(
    (node) => node.type === "button" && node.props.className === "research-gh__primary focus-ring",
  );

  // README selected: the repository root.
  await act(async () => { primary().props.onClick(); });
  expect(openUrl).toHaveBeenLastCalledWith("https://github.com/OpenCoven/coven-cave");

  await click(row(renderer, "src"));
  await click(row(renderer, "src/index.ts"));
  await act(async () => { primary().props.onClick(); });
  // A file selected: that file, at the captured commit.
  expect(openUrl).toHaveBeenLastCalledWith(
    `https://github.com/OpenCoven/coven-cave/blob/${COMMIT_SHA}/src/index.ts`,
  );
  renderer.unmount();
});

test("the header renders from the saved summary while the tree is still loading", async () => {
  const { renderer } = await mount({ snapshot: null });
  const text = screenText(renderer);

  // No flicker and no empty header: identity is known before the detail lands.
  expect(text).toMatch(/OpenCoven\/coven-cave/);
  expect(text).toMatch(new RegExp(`Restoring the snapshot at ${COMMIT_SHA.slice(0, 7)}`));
  expect(rowPaths(renderer)).toEqual([]);
  renderer.unmount();
});

test("a failed snapshot load keeps the header and offers a retry", async () => {
  const onRetryLoad = vi.fn();
  const { renderer } = await mount({
    snapshot: null,
    loadError: "Couldn’t load the saved repository snapshot. Try again.",
    onRetryLoad,
  });

  const text = screenText(renderer);
  expect(text).toMatch(/OpenCoven\/coven-cave/);
  expect(text).toMatch(/Couldn’t load the saved repository snapshot/);

  const retry = renderer.root.find(
    (node) => node.type === "button" && visibleText(node.props.children).includes("Retry"),
  );
  await act(async () => { retry.props.onClick(); });
  expect(onRetryLoad).toHaveBeenCalled();
  renderer.unmount();
});

test("a truncated tree states the count and offers the rest on GitHub", async () => {
  const openUrl = vi.fn();
  const { renderer } = await mount({
    openUrl,
    snapshot: { ...SNAPSHOT, truncated: true },
    summary: { ...SUMMARY, truncated: true },
  });

  expect(screenText(renderer)).toMatch(/GitHub truncated this tree at capture/);

  const browse = renderer.root.find(
    (node) => node.type === "button"
      && visibleText(node.props.children).includes("Browse the rest on GitHub"),
  );
  await act(async () => { browse.props.onClick(); });
  expect(openUrl).toHaveBeenCalledWith(
    `https://github.com/OpenCoven/coven-cave/tree/${COMMIT_SHA}`,
  );
  renderer.unmount();
});

test("the overlay-owned footer slots are hosted, not reimplemented", async () => {
  const { renderer } = await mount();
  const json = JSON.stringify(renderer.toJSON());
  expect(json).toMatch(/remove-slot/);
  expect(json).toMatch(/add-slot/);
  renderer.unmount();
});
