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
    suppressRemoteMedia,
  }: {
    text: string;
    className?: string;
    onOpenUrl?: (url: string) => void;
    resolveOpenUrl?: (url: string) => string | null;
    suppressRemoteMedia?: boolean;
  }) => (
    <pre
      data-testid="markdown-block"
      data-suppress-remote-media={suppressRemoteMedia}
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
  ],
  readme: { path: "README.md", markdown: "# Hello" },
};

async function mount(openUrl = vi.fn()) {
  let renderer;
  await act(async () => {
    renderer = create(
      <LiveRegionProvider>
        <ResearchGithubRepoViewer snapshot={SNAPSHOT} openUrl={openUrl} />
      </LiveRegionProvider>,
    );
  });
  return { renderer, openUrl };
}

function fileButton(renderer, path) {
  return renderer.root.find((node) => node.type === "button" && node.props.title === `Read ${path}`);
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
  expect(json).toMatch(new RegExp(COMMIT_SHA.slice(0, 12)));
  expect(json).toMatch(/src\/index\.ts/);
  expect(renderer.root.findByProps({ "data-testid": "markdown-block" }).props.children).toBe("# Hello");
  renderer.unmount();
});

test("README rendering suppresses remote media and routes relative links through the captured commit", async () => {
  const { renderer, openUrl } = await mount();
  const markdown = renderer.root.findByProps({ "data-testid": "markdown-block" });

  expect(markdown.props["data-suppress-remote-media"]).toBe(true);
  expect(markdown.props["data-resolved-relative-url"]).toBe(
    `https://github.com/OpenCoven/coven-cave/blob/${COMMIT_SHA}/docs/guide.md`,
  );
  markdown.props.onClick();
  expect(openUrl).toHaveBeenCalledWith(
    `https://github.com/OpenCoven/coven-cave/blob/${COMMIT_SHA}/docs/guide.md`,
  );
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

  await act(async () => {
    await fileButton(renderer, "src/index.ts").props.onClick();
  });

  expect(requested).toEqual([
    `/api/research/github-repo/file?repo=OpenCoven%2Fcoven-cave&sha=${INDEX_SHA}`,
  ]);
  expect(JSON.stringify(renderer.toJSON())).toMatch(/export const cave = true/);
  expect(fileButton(renderer, "src/index.ts").props["aria-current"]).toBe("page");
  renderer.unmount();
});

test("a later file selection cannot be replaced by an older response", async () => {
  const pending = new Map();
  vi.stubGlobal("fetch", vi.fn((input) => new Promise((resolve) => {
    pending.set(String(input), resolve);
  })));
  const { renderer } = await mount();

  await act(async () => {
    fileButton(renderer, "src/index.ts").props.onClick();
    fileButton(renderer, "src/util.ts").props.onClick();
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

test("non-previewable files surface a specific recoverable state", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(
    JSON.stringify({ ok: false, error: "This binary file cannot be previewed as text in Cave." }),
    { status: 415, headers: { "content-type": "application/json" } },
  )));
  const { renderer } = await mount();

  await act(async () => {
    await fileButton(renderer, "src/index.ts").props.onClick();
  });

  expect(JSON.stringify(renderer.toJSON())).toMatch(/binary file cannot be previewed/);
  expect(JSON.stringify(renderer.toJSON())).toMatch(/Retry/);
  renderer.unmount();
});
