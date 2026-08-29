// @ts-nocheck — react-test-renderer ships no types; this is a rendered surface behavior test.
import React from "react";
import { act, create } from "react-test-renderer";
import { afterEach, expect, test, vi } from "vitest";

import { LiveRegionProvider } from "@/components/ui/live-region";
import { ResearchGithubRepoViewer } from "./research-github-repo-viewer";

// Keep the markdown renderer out of this test: it pulls in Shiki + the preview
// pipeline. The viewer's contract with it is just "pass the README markdown in".
vi.mock("@/components/message-bubble", () => ({
  MarkdownBlock: ({ text, className }: { text: string; className?: string }) => (
    <pre data-testid="markdown-block" className={className}>{text}</pre>
  ),
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const VIEW = {
  owner: "OpenCoven",
  repo: "coven-cave",
  defaultBranch: "main",
  resolvedRef: "main",
  truncated: false,
  tree: [
    { path: "README.md", type: "blob", size: 12 },
    { path: "src", type: "tree" },
    { path: "src/index.ts", type: "blob", size: 40 },
  ],
  readme: { path: "README.md", markdown: "# Hello" },
};

async function mount() {
  let renderer;
  await act(async () => {
    renderer = create(
      <LiveRegionProvider>
        <ResearchGithubRepoViewer openUrl={() => {}} />
      </LiveRegionProvider>,
    );
  });
  return renderer;
}

function repoInput(renderer) {
  return renderer.root.find((n) => n.type === "input" && n.props.placeholder === "owner/name or github.com URL");
}

function refInput(renderer) {
  return renderer.root.find((n) => n.type === "input" && n.props.placeholder === "main");
}

/** Type into the inputs (flushing the re-render), then submit the form. */
async function load(renderer, repo, ref) {
  await act(async () => {
    repoInput(renderer).props.onChange({ target: { value: repo } });
    if (ref !== undefined) refInput(renderer).props.onChange({ target: { value: ref } });
  });
  await act(async () => {
    const form = renderer.root.find((n) => n.type === "form");
    await form.props.onSubmit({ preventDefault: () => {} });
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("renders without fetching anything on mount", async () => {
  const fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
  const renderer = await mount();
  expect(fetchSpy).not.toHaveBeenCalled();
  renderer.unmount();
});

test("an invalid repo reference shows an error without any fetch", async () => {
  const fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
  const renderer = await mount();

  await load(renderer, "onlyowner");

  expect(fetchSpy).not.toHaveBeenCalled();
  expect(JSON.stringify(renderer.toJSON())).toMatch(
    /Enter a GitHub repository as owner\/name or a github\.com URL\./,
  );
  renderer.unmount();
});

test("loads a repository on demand and renders the tree and README", async () => {
  const requested = [];
  vi.stubGlobal("fetch", vi.fn(async (input) => {
    requested.push(String(input));
    return new Response(JSON.stringify({ ok: true, ...VIEW }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }));
  const renderer = await mount();

  expect(requested).toHaveLength(0);

  await load(renderer, "OpenCoven/coven-cave");

  expect(requested).toEqual(["/api/research/github-repo?repo=OpenCoven%2Fcoven-cave"]);
  const json = JSON.stringify(renderer.toJSON());
  expect(json).toMatch(/OpenCoven\/coven-cave/);
  expect(json).toMatch(/src\/index\.ts/);
  expect(json).toMatch(/Open on GitHub/);
  const markdown = renderer.root.findByProps({ "data-testid": "markdown-block" });
  expect(markdown.props.children).toBe("# Hello");
  renderer.unmount();
});

test("forwards an explicit branch to the endpoint", async () => {
  const requested = [];
  vi.stubGlobal("fetch", vi.fn(async (input) => {
    requested.push(String(input));
    return new Response(JSON.stringify({ ok: true, ...VIEW, resolvedRef: "feat/x" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }));
  const renderer = await mount();

  await load(renderer, "o/r", "feat/x");

  expect(requested).toEqual(["/api/research/github-repo?repo=o%2Fr&ref=feat%2Fx"]);
  renderer.unmount();
});

test("a failed load shows a recoverable error", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(
    JSON.stringify({ ok: false, error: "GitHub couldn't find that repository." }),
    { status: 404, headers: { "content-type": "application/json" } },
  )));
  const renderer = await mount();

  await load(renderer, "o/r");

  expect(JSON.stringify(renderer.toJSON())).toMatch(/GitHub couldn't find that repository\./);
  renderer.unmount();
});
