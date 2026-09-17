// @ts-nocheck — react-test-renderer ships no types; this is a rendered surface behavior test.
import React from "react";
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { LiveRegionProvider } from "@/components/ui/live-region";
import { sha256Digest } from "@/lib/research-protocol/digest";
import { ResearchTabResources } from "./research-tab-resources.tsx";

vi.mock("@/components/message-bubble", () => ({
  MarkdownBlock: ({ text }: { text: string }) => <pre>{text}</pre>,
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

const manifest = {
  version: 1,
  id: "resource_a",
  revision: 2,
  kind: "local-file",
  canonicalIdentity: "local-file:resource_a",
  title: "Field notes",
  sourceType: "local-file",
  subject: {},
  sensitivity: "private",
  ingest: { desired: true, state: "ready" },
  currentSnapshotId: "snapshot_2",
  createdAt: "2026-08-27T00:00:00.000Z",
  updatedAt: "2026-08-27T00:00:00.000Z",
};

function hit(excerpt: string) {
  return {
    resourceId: manifest.id,
    snapshotId: manifest.currentSnapshotId,
    resourceRevision: manifest.revision,
    normalizedBlobDigest: "a".repeat(64),
    selector: { type: "text-span", start: 0, end: Buffer.byteLength(excerpt) },
    excerpt,
    excerptDigest: sha256Digest(excerpt),
    retrieval: {
      exact: false,
      lexical: { matched: true, rank: 1 },
      semantic: { state: "unavailable", matched: false },
    },
  };
}

const research = {
  selected: null,
  missions: [],
  act: async () => ({ ok: true }),
  applyMission: () => {},
};
const context = {
  activeFamiliar: { id: "familiar_a", name: "Sage" },
  openUrl: () => {},
};
const savedLink = {
  id: "saved_a",
  url: "https://example.com/other",
  category: "other",
  title: "Other source",
  addedAt: "2026-08-27T00:00:00.000Z",
  source: "desk",
};
const githubSummary = {
  version: 1,
  owner: "OpenCoven",
  repo: "coven-cave",
  description: "Desktop control room",
  visibility: "public",
  stars: 42,
  forks: 7,
  defaultBranch: "main",
  resolvedRef: "main",
  commitSha: "a".repeat(40),
  fetchedAt: "2026-09-01T12:00:00.000Z",
  truncated: false,
};
const githubSavedLink = {
  ...savedLink,
  id: "saved_github",
  url: "https://github.com/OpenCoven/coven-cave",
  category: "github",
  title: "OpenCoven/coven-cave",
  githubRepo: githubSummary,
};

function visibleText(renderer) {
  return JSON.stringify(renderer.toJSON());
}

test("query edits synchronously hide stale evidence before the debounce and recovery actions target the current query", async () => {
  const originalFetch = globalThis.fetch;
  let betaAttempts = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === "/api/research/links") return Response.json({ ok: true, links: [savedLink] });
    if (url === "/api/research/resources") return Response.json({ ok: true, resources: [manifest] });
    if (url === "/api/research/resources/search") {
      const query = JSON.parse(String(init?.body)).text;
      if (query === "alpha") {
        return Response.json({
          ok: true,
          result: { version: 1, ranking: "hybrid", hits: [hit("alpha evidence")] },
        });
      }
      if (query === "beta") betaAttempts += 1;
      if (query !== "beta" || betaAttempts === 1) {
        return Response.json(
          { ok: false, code: "unavailable", error: "resource search unavailable" },
          { status: 503 },
        );
      }
      return Response.json({
        ok: true,
        result: { version: 1, ranking: "hybrid", hits: [hit("beta evidence")] },
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  let renderer;
  try {
    await act(async () => {
      renderer = create(
        <LiveRegionProvider>
          <ResearchTabResources research={research} context={context} onNavigate={() => {}} />
        </LiveRegionProvider>,
      );
    });
    const search = renderer.root.find(
      (node) => node.type === "input" && node.props["aria-label"] === "Search resources",
    );

    act(() => { search.props.onChange({ target: { value: "alpha" } }); });
    await act(async () => {
      vi.advanceTimersByTime(250);
      await Promise.resolve();
    });
    expect(visibleText(renderer)).toMatch(/alpha evidence/);

    act(() => { search.props.onChange({ target: { value: "beta" } }); });
    expect(visibleText(renderer)).not.toMatch(/alpha evidence/);
    expect(betaAttempts).toBe(0);

    await act(async () => {
      vi.advanceTimersByTime(250);
      await Promise.resolve();
    });
    const retry = renderer.root.findByProps({ children: "Retry search" });
    const clear = renderer.root.findByProps({ children: "Clear search" });
    expect(retry.props.onClick).toBeTypeOf("function");
    expect(clear.props.onClick).toBeTypeOf("function");

    await act(async () => {
      retry.props.onClick();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(visibleText(renderer)).toMatch(/beta evidence/);
    expect(visibleText(renderer)).toMatch(/Local evidence search refreshed/);

    act(() => { search.props.onChange({ target: { value: "gamma" } }); });
    await act(async () => {
      vi.advanceTimersByTime(250);
      await Promise.resolve();
    });
    const currentClear = renderer.root.findByProps({ children: "Clear search" });
    act(() => { currentClear.props.onClick(); });
    expect(renderer.root.find(
      (node) => node.type === "input" && node.props["aria-label"] === "Search resources",
    ).props.value).toBe("");
    expect(visibleText(renderer)).not.toMatch(/Local evidence search is unavailable/);
    expect(visibleText(renderer)).toMatch(/Cleared local evidence search/);

    act(() => { search.props.onChange({ target: { value: "gamma" } }); });
    await act(async () => {
      vi.advanceTimersByTime(250);
      await Promise.resolve();
    });
    expect(visibleText(renderer)).toMatch(/Local evidence search is unavailable/);
    const clearFilters = renderer.root.findByProps({ children: "Clear filters" });
    act(() => { clearFilters.props.onClick(); });
    expect(renderer.root.find(
      (node) => node.type === "input" && node.props["aria-label"] === "Search resources",
    ).props.value).toBe("");
    expect(visibleText(renderer)).not.toMatch(/Local evidence search is unavailable/);
    expect(visibleText(renderer)).not.toMatch(/Local evidence/);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    globalThis.fetch = originalFetch;
  }
});

test("opening a saved GitHub card automatically loads and renders its full snapshot", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    requests.push(url);
    if (url === "/api/research/links") {
      return Response.json({ ok: true, links: [githubSavedLink] });
    }
    if (url === "/api/research/links?id=saved_github") {
      return Response.json({
        ok: true,
        link: {
          ...githubSavedLink,
          githubRepo: {
            ...githubSummary,
            tree: [{ path: "README.md", type: "blob", sha: "b".repeat(40), size: 6 }],
            readme: { path: "README.md", markdown: "# Saved repository" },
          },
        },
      });
    }
    if (url === "/api/research/resources") {
      return Response.json({ ok: true, resources: [] });
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  let renderer;
  try {
    await act(async () => {
      renderer = create(
        <LiveRegionProvider>
          <ResearchTabResources research={research} context={context} onNavigate={() => {}} />
        </LiveRegionProvider>,
      );
    });
    const open = renderer.root.find(
      (node) => node.type === "button" && node.props.children?.[0] === "OpenCoven/coven-cave",
    );
    await act(async () => {
      open.props.onClick();
      await Promise.resolve();
      await Promise.resolve();
    });

    const text = visibleText(renderer);
    expect(requests.filter((url) => url === "/api/research/links?id=saved_github")).toHaveLength(1);
    expect(text).toMatch(/Saved GitHub repository/);
    expect(text).toMatch(/Saved repository/);
    expect(text).toMatch(new RegExp("a".repeat(12)));
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    globalThis.fetch = originalFetch;
  }
});
