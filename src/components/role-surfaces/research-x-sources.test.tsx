// @ts-nocheck
import { createElement } from "react";
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const announce = vi.hoisted(() => vi.fn());
const openStudio = vi.hoisted(() => vi.fn());

vi.mock("@/components/ui/live-region", () => ({
  useAnnouncer: () => ({ announce }),
}));
vi.mock("@/lib/familiar-studio-context", () => ({
  openFamiliarStudioSettingsTab: openStudio,
}));
vi.mock("@/lib/icon", () => ({
  Icon: () => createElement("span", { "aria-hidden": true }),
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    loading,
    leadingIcon: _leadingIcon,
    trailingIcon: _trailingIcon,
    ...props
  }: Record<string, unknown>) => createElement("button", {
    ...props,
    "aria-busy": loading || undefined,
  }, children),
}));
vi.mock("@/components/ui/search-input", () => ({
  SearchInput: ({
    value,
    onValueChange,
    onClear: _onClear,
    containerClassName: _containerClassName,
    ...props
  }: Record<string, unknown>) => createElement("input", {
    ...props,
    type: "search",
    value,
    onChange: (event: { target: { value: string } }) => onValueChange(event.target.value),
  }),
}));
vi.mock("@/components/ui/relative-time", () => ({
  RelativeTime: ({ iso, fallback }: { iso?: string; fallback?: string }) =>
    iso ? createElement("time", { dateTime: iso }, iso) : fallback,
}));
vi.mock("@/components/ui/empty-state", () => ({
  EmptyState: ({
    headline,
    subtitle,
    actions,
    live = true,
  }: Record<string, unknown>) =>
    createElement("div", { role: live ? "status" : undefined }, headline, subtitle, actions),
}));
vi.mock("@/components/ui/error-state", () => ({
  ErrorState: ({
    headline,
    subtitle,
    actions,
    live = true,
  }: Record<string, unknown>) =>
    createElement("div", { role: live ? "alert" : undefined }, headline, subtitle, actions),
}));
vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: () => createElement("span", { "aria-hidden": true }),
  SkeletonGroup: ({ children }: { children: unknown }) =>
    createElement("div", { "aria-busy": "true" }, children),
}));

import { ResearchXSources } from "./research-x-sources";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const originalFetch = globalThis.fetch;

type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function response(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
  } as Response;
}

function connectedConnection() {
  return {
    configured: true,
    connected: true,
    activeFlow: false,
    account: { id: "42", username: "cave", name: "Cave" },
    scopes: ["tweet.read", "users.read", "offline.access"],
  };
}

const post = {
  id: "123",
  canonicalUrl: "https://x.com/cave/status/123",
  text: "A bounded research source.",
  author: { id: "42", username: "cave", name: "Cave" },
  createdAt: "2026-07-31T20:00:00.000Z",
};

function source(overrides: Record<string, unknown> = {}) {
  return {
    id: "source-123",
    familiarId: "familiar-a",
    postId: "123",
    canonicalUrl: post.canonicalUrl,
    originalUrl: post.canonicalUrl,
    note: "",
    tags: [],
    addedAt: "2026-07-31T21:00:00.000Z",
    updatedAt: "2026-07-31T21:00:00.000Z",
    attachedMissionIds: [],
    availability: "available",
    ...overrides,
  };
}

const familiarA = {
  id: "familiar-a",
  display_name: "A",
  role: "researcher",
  xResearchEnabled: true,
};
const familiarB = {
  id: "familiar-b",
  display_name: "B",
  role: "researcher",
  xResearchEnabled: true,
};

function textOf(node: ReactTestInstance): string {
  return node.children
    .map((child) => (typeof child === "string" ? child : textOf(child)))
    .join("");
}

function button(renderer: ReactTestRenderer, label: string): ReactTestInstance {
  const match = renderer.root
    .findAllByType("button")
    .find((candidate) => textOf(candidate).includes(label));
  if (!match) throw new Error(`button containing ${label} not found`);
  return match;
}

function input(renderer: ReactTestRenderer, label: string): ReactTestInstance {
  return renderer.root.find(
    (node) => node.type === "input" && node.props["aria-label"] === label,
  );
}

function form(renderer: ReactTestRenderer, label: string): ReactTestInstance {
  return renderer.root.find(
    (node) => node.type === "form" && node.props["aria-label"] === label,
  );
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderReady(
  fetcher: typeof fetch,
  props: Record<string, unknown> = {},
  createNodeMock?: Parameters<typeof create>[1]["createNodeMock"],
): Promise<ReactTestRenderer> {
  globalThis.fetch = fetcher;
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <ResearchXSources
        familiar={familiarA}
        selectedMissionId={null}
        {...props}
      />,
      createNodeMock ? { createNodeMock } : undefined,
    );
  });
  await settle();
  return renderer;
}

beforeEach(() => {
  announce.mockReset();
  openStudio.mockReset();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("ResearchXSources request discipline", () => {
  test("mount loads only local connection and familiar-scoped saved identities", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const renderer = await renderReady(vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url === "/api/x/connection") return response(connectedConnection());
      if (url === "/api/x/sources?familiarId=familiar-a") {
        return response({ ok: true, sources: [] });
      }
      throw new Error(`unexpected fetch ${url}`);
    }));

    expect(calls.map(({ url }) => url)).toEqual([
      "/api/x/connection",
      "/api/x/sources?familiarId=familiar-a",
    ]);
    expect(calls.every(({ init }) => init?.signal instanceof AbortSignal)).toBe(true);
    await act(async () => renderer.unmount());
  });

  test("typing, focus, selecting a preview, and mission changes never request X", async () => {
    const calls: string[] = [];
    const renderer = await renderReady(vi.fn(async (url: string) => {
      calls.push(url);
      if (url === "/api/x/connection") return response(connectedConnection());
      if (url.includes("/api/x/sources?")) return response({ ok: true, sources: [] });
      if (url === "/api/x/posts/search") return response({ ok: true, posts: [post] });
      throw new Error(`unexpected fetch ${url}`);
    }));

    await act(async () => {
      input(renderer, "Search X posts").props.onChange({ target: { value: "coven" } });
      input(renderer, "Search X posts").props.onFocus?.();
    });
    expect(calls.filter((url) => url.includes("/api/x/posts/"))).toHaveLength(0);

    await act(async () => form(renderer, "Search X posts").props.onSubmit({
      preventDefault() {},
    }));
    expect(calls.filter((url) => url === "/api/x/posts/search")).toHaveLength(1);

    await act(async () => button(renderer, "A bounded research source.").props.onClick());
    expect(calls.filter((url) => url === "/api/x/posts/search")).toHaveLength(1);

    await act(async () => {
      renderer.update(
        <ResearchXSources familiar={familiarA} selectedMissionId="mission-1" />,
      );
    });
    expect(calls.filter((url) => url.includes("/api/x/posts/"))).toHaveLength(1);
    await act(async () => renderer.unmount());
  });

  test("Grab validates locally and performs exactly one lookup on submit", async () => {
    const calls: Array<{ url: string; body?: string }> = [];
    const renderer = await renderReady(vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body as string | undefined });
      if (url === "/api/x/connection") return response(connectedConnection());
      if (url.includes("/api/x/sources?")) return response({ ok: true, sources: [] });
      if (url === "/api/x/posts/lookup") return response({ ok: true, post });
      throw new Error(`unexpected fetch ${url}`);
    }));

    await act(async () => {
      input(renderer, "X post URL").props.onChange({
        target: { value: "https://example.com/private-query?secret=raw" },
      });
      form(renderer, "Grab X post").props.onSubmit({ preventDefault() {} });
    });
    expect(calls.filter(({ url }) => url === "/api/x/posts/lookup")).toHaveLength(0);
    const invalidAlert = renderer.root.findByProps({ role: "alert" });
    expect(textOf(invalidAlert)).not.toContain("private-query");
    expect(textOf(invalidAlert)).not.toContain("secret=raw");

    await act(async () => {
      input(renderer, "X post URL").props.onChange({
        target: { value: "https://twitter.com/Cave/status/123?tracking=1" },
      });
    });
    await act(async () => form(renderer, "Grab X post").props.onSubmit({
      preventDefault() {},
    }));

    const lookups = calls.filter(({ url }) => url === "/api/x/posts/lookup");
    expect(lookups).toHaveLength(1);
    expect(JSON.parse(lookups[0].body!)).toEqual({
      familiarId: "familiar-a",
      url: "https://x.com/cave/status/123",
    });
    await act(async () => renderer.unmount());
  });

  test("Search runs once per submit, requests no pagination, and renders at most ten", async () => {
    const calls: Array<{ url: string; body?: string }> = [];
    const posts = Array.from({ length: 12 }, (_, index) => ({
      ...post,
      id: String(index + 1),
      canonicalUrl: `https://x.com/cave/status/${index + 1}`,
      text: `Post ${index + 1}`,
    }));
    const renderer = await renderReady(vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body as string | undefined });
      if (url === "/api/x/connection") return response(connectedConnection());
      if (url.includes("/api/x/sources?")) return response({ ok: true, sources: [] });
      if (url === "/api/x/posts/search") return response({ ok: true, posts });
      throw new Error(`unexpected fetch ${url}`);
    }));

    const search = input(renderer, "Search X posts");
    expect(search.props.placeholder).toBe("Search X posts…");
    await act(async () => search.props.onChange({ target: { value: "recent research" } }));
    await act(async () => form(renderer, "Search X posts").props.onSubmit({
      preventDefault() {},
    }));

    const searches = calls.filter(({ url }) => url === "/api/x/posts/search");
    expect(searches).toHaveLength(1);
    expect(JSON.parse(searches[0].body!)).toEqual({
      familiarId: "familiar-a",
      query: "recent research",
    });
    expect(renderer.root.findAllByProps({ "data-x-preview": true })).toHaveLength(10);
    await act(async () => renderer.unmount());
  });

  test("typing does not claim an empty result until an explicit search completes", async () => {
    const renderer = await renderReady(vi.fn(async (url: string) => {
      if (url === "/api/x/connection") return response(connectedConnection());
      if (url.includes("/api/x/sources?")) return response({ ok: true, sources: [] });
      if (url === "/api/x/posts/search") return response({ ok: true, posts: [] });
      throw new Error(`unexpected fetch ${url}`);
    }));

    await act(async () => {
      input(renderer, "Search X posts").props.onChange({ target: { value: "nothing yet" } });
    });
    expect(JSON.stringify(renderer.toJSON())).not.toContain("No X posts found");

    await act(async () => form(renderer, "Search X posts").props.onSubmit({
      preventDefault() {},
    }));
    expect(JSON.stringify(renderer.toJSON())).toContain("No X posts found");
    const noResults = renderer.root.find(
      (node) => node.type === "div" && textOf(node).includes("No X posts found"),
    );
    expect(noResults.props.role).toBeUndefined();
    expect(announce).toHaveBeenLastCalledWith("Found 0 X posts.");
    await act(async () => renderer.unmount());
  });

  test("lookup and search share one request channel and a late lookup cannot replace newer search results", async () => {
    const lookup = deferred<Response>();
    const search = deferred<Response>();
    let lookupSignal: AbortSignal | undefined;
    const newerPost = {
      ...post,
      id: "456",
      canonicalUrl: "https://x.com/cave/status/456",
      text: "Newer search result.",
    };
    const renderer = await renderReady(vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/x/connection") return response(connectedConnection());
      if (url.includes("/api/x/sources?")) return response({ ok: true, sources: [] });
      if (url === "/api/x/posts/lookup") {
        lookupSignal = init?.signal;
        return lookup.promise;
      }
      if (url === "/api/x/posts/search") return search.promise;
      throw new Error(`unexpected fetch ${url}`);
    }));

    await act(async () => {
      input(renderer, "X post URL").props.onChange({ target: { value: post.canonicalUrl } });
      input(renderer, "Search X posts").props.onChange({ target: { value: "newer" } });
    });
    act(() => {
      void form(renderer, "Grab X post").props.onSubmit({ preventDefault() {} });
    });
    act(() => {
      void form(renderer, "Search X posts").props.onSubmit({ preventDefault() {} });
    });
    expect(lookupSignal?.aborted).toBe(true);

    await act(async () => {
      search.resolve(response({ ok: true, posts: [newerPost] }));
      await search.promise;
    });
    await act(async () => {
      lookup.resolve(response({ ok: true, post }));
      await lookup.promise;
    });

    const rendered = JSON.stringify(renderer.toJSON());
    expect(rendered).toContain(newerPost.text);
    expect(rendered).not.toContain(post.text);
    expect(announce).toHaveBeenCalledWith("Found 1 X post.");
    expect(announce).toHaveBeenCalledTimes(1);
    expect(renderer.root.findAllByProps({ "aria-busy": true })).toHaveLength(0);
    await act(async () => renderer.unmount());
  });

  test("a newer lookup wins over a late search failure without inheriting its error or busy state", async () => {
    const search = deferred<Response>();
    const lookup = deferred<Response>();
    let searchSignal: AbortSignal | undefined;
    const renderer = await renderReady(vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/x/connection") return response(connectedConnection());
      if (url.includes("/api/x/sources?")) return response({ ok: true, sources: [] });
      if (url === "/api/x/posts/search") {
        searchSignal = init?.signal;
        return search.promise;
      }
      if (url === "/api/x/posts/lookup") return lookup.promise;
      throw new Error(`unexpected fetch ${url}`);
    }));

    await act(async () => {
      input(renderer, "Search X posts").props.onChange({ target: { value: "older" } });
      input(renderer, "X post URL").props.onChange({ target: { value: post.canonicalUrl } });
    });
    act(() => {
      void form(renderer, "Search X posts").props.onSubmit({ preventDefault() {} });
    });
    act(() => {
      void form(renderer, "Grab X post").props.onSubmit({ preventDefault() {} });
    });
    expect(searchSignal?.aborted).toBe(true);

    await act(async () => {
      lookup.resolve(response({ ok: true, post }));
      await lookup.promise;
    });
    await act(async () => {
      search.resolve(response({ ok: false, code: "internal" }, false));
      await search.promise;
    });

    const rendered = JSON.stringify(renderer.toJSON());
    expect(rendered).toContain(post.text);
    expect(rendered).not.toContain("Couldn’t complete the X request");
    expect(announce).toHaveBeenCalledWith("Found 1 X post.");
    expect(announce).toHaveBeenCalledTimes(1);
    expect(renderer.root.findAllByProps({ "aria-busy": true })).toHaveLength(0);
    await act(async () => renderer.unmount());
  });

  test("an aborted preview request is cancellation, not an internal error", async () => {
    let lookupSignal: AbortSignal | undefined;
    const renderer = await renderReady(vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/x/connection") return response(connectedConnection());
      if (url.includes("/api/x/sources?")) return response({ ok: true, sources: [] });
      if (url === "/api/x/posts/lookup") {
        lookupSignal = init?.signal;
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          }, { once: true });
        });
      }
      if (url === "/api/x/posts/search") return response({ ok: true, posts: [] });
      throw new Error(`unexpected fetch ${url}`);
    }));

    await act(async () => {
      input(renderer, "X post URL").props.onChange({ target: { value: post.canonicalUrl } });
      input(renderer, "Search X posts").props.onChange({ target: { value: "replacement" } });
    });
    act(() => {
      void form(renderer, "Grab X post").props.onSubmit({ preventDefault() {} });
    });
    await act(async () => form(renderer, "Search X posts").props.onSubmit({
      preventDefault() {},
    }));

    expect(lookupSignal?.aborted).toBe(true);
    expect(JSON.stringify(renderer.toJSON())).not.toContain("Couldn’t complete the X request");
    expect(announce).toHaveBeenLastCalledWith("Found 0 X posts.");
    await act(async () => renderer.unmount());
  });

  test("successful lookup and search announce completion with result counts", async () => {
    const renderer = await renderReady(vi.fn(async (url: string) => {
      if (url === "/api/x/connection") return response(connectedConnection());
      if (url.includes("/api/x/sources?")) return response({ ok: true, sources: [] });
      if (url === "/api/x/posts/lookup") return response({ ok: true, post });
      if (url === "/api/x/posts/search") return response({ ok: true, posts: [post, {
        ...post,
        id: "456",
        canonicalUrl: "https://x.com/cave/status/456",
      }] });
      throw new Error(`unexpected fetch ${url}`);
    }));

    await act(async () => {
      input(renderer, "X post URL").props.onChange({ target: { value: post.canonicalUrl } });
    });
    await act(async () => form(renderer, "Grab X post").props.onSubmit({
      preventDefault() {},
    }));
    expect(announce).toHaveBeenLastCalledWith("Found 1 X post.");

    await act(async () => {
      input(renderer, "Search X posts").props.onChange({ target: { value: "two" } });
    });
    await act(async () => form(renderer, "Search X posts").props.onSubmit({
      preventDefault() {},
    }));
    expect(announce).toHaveBeenLastCalledWith("Found 2 X posts.");
    await act(async () => renderer.unmount());
  });

  test("URL and search errors keep labels and expose stable conditional associations", async () => {
    const renderer = await renderReady(vi.fn(async (url: string) => {
      if (url === "/api/x/connection") return response(connectedConnection());
      if (url.includes("/api/x/sources?")) return response({ ok: true, sources: [] });
      if (url === "/api/x/posts/search") {
        return response({ ok: false, code: "invalid-request" }, false);
      }
      throw new Error(`unexpected fetch ${url}`);
    }));

    const urlInput = input(renderer, "X post URL");
    const searchInput = input(renderer, "Search X posts");
    expect(urlInput.props["aria-invalid"]).toBeUndefined();
    expect(urlInput.props["aria-describedby"]).toBeUndefined();
    expect(searchInput.props["aria-invalid"]).toBeUndefined();
    expect(searchInput.props["aria-describedby"]).toBeUndefined();

    await act(async () => {
      urlInput.props.onChange({ target: { value: "https://example.com/not-x" } });
      form(renderer, "Grab X post").props.onSubmit({ preventDefault() {} });
    });
    expect(input(renderer, "X post URL").props["aria-invalid"]).toBe(true);
    expect(input(renderer, "X post URL").props["aria-describedby"]).toBe("research-x-url-error");
    expect(renderer.root.findByProps({ id: "research-x-url-error" })).toBeTruthy();
    expect(renderer.root.findByProps({ htmlFor: "research-x-url" })).toBeTruthy();

    await act(async () => {
      searchInput.props.onChange({ target: { value: "bad query" } });
    });
    await act(async () => form(renderer, "Search X posts").props.onSubmit({
      preventDefault() {},
    }));
    expect(input(renderer, "Search X posts").props["aria-invalid"]).toBe(true);
    expect(input(renderer, "Search X posts").props["aria-describedby"]).toBe(
      "research-x-search-error",
    );
    expect(renderer.root.findByProps({ id: "research-x-search-error" })).toBeTruthy();
    expect(renderer.root.findByProps({ htmlFor: "research-x-search" })).toBeTruthy();
    await act(async () => renderer.unmount());
  });
});

describe("ResearchXSources previews and mutations", () => {
  test("previews show handle, text, time, and safe canonical links without metrics", async () => {
    const renderer = await renderReady(vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/x/connection") return response(connectedConnection());
      if (url.includes("/api/x/sources?")) return response({ ok: true, sources: [] });
      if (url === "/api/x/posts/lookup") return response({ ok: true, post });
      throw new Error(`unexpected fetch ${url} ${init?.method ?? "GET"}`);
    }));
    await act(async () => {
      input(renderer, "X post URL").props.onChange({ target: { value: post.canonicalUrl } });
    });
    await act(async () => form(renderer, "Grab X post").props.onSubmit({
      preventDefault() {},
    }));

    const rendered = JSON.stringify(renderer.toJSON());
    expect(rendered).toContain("@cave");
    expect(rendered).toContain(post.text);
    expect(rendered).not.toMatch(/like|repost|view count|metric/i);
    const link = renderer.root.findByProps({ href: post.canonicalUrl });
    expect(link.props.target).toBe("_blank");
    expect(link.props.rel).toContain("noopener");
    expect(link.props.rel).toContain("noreferrer");
    expect(renderer.root.findByType("time").props.dateTime).toBe(post.createdAt);
    await act(async () => renderer.unmount());
  });

  test("rejects a non-X preview URL instead of rendering an unsafe external link", async () => {
    const renderer = await renderReady(vi.fn(async (url: string) => {
      if (url === "/api/x/connection") return response(connectedConnection());
      if (url.includes("/api/x/sources?")) return response({ ok: true, sources: [] });
      if (url === "/api/x/posts/lookup") {
        return response({
          ok: true,
          post: { ...post, canonicalUrl: "javascript:alert(1)" },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    }));
    await act(async () => {
      input(renderer, "X post URL").props.onChange({ target: { value: post.canonicalUrl } });
    });
    await act(async () => form(renderer, "Grab X post").props.onSubmit({
      preventDefault() {},
    }));

    expect(JSON.stringify(renderer.toJSON())).toContain(
      "X returned an unexpected response.",
    );
    expect(renderer.root.findAllByType("a")).toHaveLength(0);
    await act(async () => renderer.unmount());
  });

  test("search results stay local until Save source and duplicate saves announce", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    let created = true;
    const renderer = await renderReady(vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url === "/api/x/connection") return response(connectedConnection());
      if (url.includes("/api/x/sources?")) return response({ ok: true, sources: [] });
      if (url === "/api/x/posts/search") return response({ ok: true, posts: [post] });
      if (url === "/api/x/sources" && init?.method === "POST") {
        const result = response({ ok: true, source: source({ preview: post }), created });
        created = false;
        return result;
      }
      throw new Error(`unexpected fetch ${url}`);
    }));
    await act(async () => {
      input(renderer, "Search X posts").props.onChange({ target: { value: "coven" } });
    });
    await act(async () => form(renderer, "Search X posts").props.onSubmit({
      preventDefault() {},
    }));
    expect(calls.filter(({ url }) => url === "/api/x/sources")).toHaveLength(0);

    await act(async () => button(renderer, "Save source").props.onClick());
    expect(calls.filter(({ url }) => url === "/api/x/sources")).toHaveLength(1);
    expect(announce).toHaveBeenLastCalledWith("X source saved.");
    expect(JSON.stringify(renderer.toJSON())).toContain("Saved X sources");

    await act(async () => button(renderer, "Save source").props.onClick());
    expect(calls.filter(({ url }) => url === "/api/x/sources")).toHaveLength(2);
    expect(announce).toHaveBeenLastCalledWith("X source was already saved.");
    await act(async () => renderer.unmount());
  });

  test("Attach has a visible associated prerequisite and applies the returned authoritative mission", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const attachedMission = {
      id: "mission-1",
      familiarId: "familiar-a",
      sources: [{ id: "x-123", url: post.canonicalUrl }],
    };
    const onMissionAttached = vi.fn();
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url === "/api/x/connection") return response(connectedConnection());
      if (url.includes("/api/x/sources?")) {
        return response({ ok: true, sources: [source({ preview: post })] });
      }
      if (url === "/api/x/sources" && init?.method === "POST") {
        return response({ ok: true, mission: attachedMission });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    const renderer = await renderReady(fetcher, { onMissionAttached });

    const disabledAttach = button(renderer, "Attach to mission");
    expect(disabledAttach.props.disabled).toBe(true);
    expect(disabledAttach.props.title).toBeUndefined();
    expect(disabledAttach.props["aria-describedby"]).toBe(
      "research-x-attach-help-source-123",
    );
    expect(textOf(renderer.root.findByProps({
      id: "research-x-attach-help-source-123",
    }))).toContain("Select a mission on the Desk first");
    await act(async () => {
      renderer.update(
        <ResearchXSources
          familiar={familiarA}
          selectedMissionId="mission-1"
          onMissionAttached={onMissionAttached}
        />,
      );
    });
    expect(button(renderer, "Attach to mission").props.disabled).toBe(false);
    await act(async () => button(renderer, "Attach to mission").props.onClick());

    const attach = calls.find(({ url, init }) => {
      if (url !== "/api/x/sources" || init?.method !== "POST") return false;
      return JSON.parse(init.body as string).action === "attach";
    });
    expect(JSON.parse(attach!.init!.body as string)).toEqual({
      action: "attach",
      familiarId: "familiar-a",
      sourceId: "source-123",
      missionId: "mission-1",
    });
    expect(announce).toHaveBeenLastCalledWith("X source attached to the mission.");
    expect(onMissionAttached).toHaveBeenCalledWith(attachedMission);
    expect(calls.filter(({ url }) => url.includes("/api/research/missions"))).toHaveLength(0);
    await act(async () => renderer.unmount());
  });

  test("Attach clears a prior per-source error before retry and after success", async () => {
    const retry = deferred<Response>();
    let attaches = 0;
    const renderer = await renderReady(vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/x/connection") return response(connectedConnection());
      if (url.includes("/api/x/sources?")) {
        return response({ ok: true, sources: [source({ preview: post })] });
      }
      if (url === "/api/x/sources" && init?.method === "POST") {
        attaches += 1;
        if (attaches === 1) {
          return response({ ok: false, code: "upstream-unavailable" }, false);
        }
        return retry.promise;
      }
      throw new Error(`unexpected fetch ${url}`);
    }), { selectedMissionId: "mission-1" });

    await act(async () => button(renderer, "Attach to mission").props.onClick());
    expect(JSON.stringify(renderer.toJSON())).toContain("X is unavailable right now.");

    act(() => {
      void button(renderer, "Attach to mission").props.onClick();
    });
    expect(JSON.stringify(renderer.toJSON())).not.toContain("X is unavailable right now.");

    await act(async () => {
      retry.resolve(response({ ok: true, mission: {
        id: "mission-1",
        familiarId: "familiar-a",
        sources: [],
      } }));
      await retry.promise;
    });
    expect(JSON.stringify(renderer.toJSON())).not.toContain("X is unavailable right now.");
    expect(announce).toHaveBeenLastCalledWith("X source attached to the mission.");
    await act(async () => renderer.unmount());
  });

  test("an identity without an eligible preview remains visible and refreshes explicitly", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const renderer = await renderReady(vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url === "/api/x/connection") return response(connectedConnection());
      if (url.includes("/api/x/sources?")) {
        return response({ ok: true, sources: [source()] });
      }
      if (url === "/api/x/sources" && init?.method === "POST") {
        return response({ ok: true, source: source(), post });
      }
      throw new Error(`unexpected fetch ${url}`);
    }));

    expect(JSON.stringify(renderer.toJSON())).toContain(post.canonicalUrl);
    expect(JSON.stringify(renderer.toJSON())).toContain("Preview expired or unavailable.");
    expect(calls.filter(({ url }) => url === "/api/x/sources")).toHaveLength(0);
    await act(async () => button(renderer, "Refresh post").props.onClick());

    expect(calls.filter(({ url }) => url === "/api/x/sources")).toHaveLength(1);
    expect(JSON.stringify(renderer.toJSON())).toContain(post.text);
    expect(announce).toHaveBeenLastCalledWith("X post refreshed.");
    await act(async () => renderer.unmount());
  });

  test("failed save, attach, and refresh mutations announce assertively", async () => {
    const renderer = await renderReady(vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/x/connection") return response(connectedConnection());
      if (url.includes("/api/x/sources?")) {
        return response({ ok: true, sources: [source(), source({
          id: "source-456",
          postId: "456",
          canonicalUrl: "https://x.com/i/web/status/456",
          originalUrl: "https://x.com/i/web/status/456",
          preview: { ...post, id: "456", canonicalUrl: "https://x.com/i/web/status/456" },
        })] });
      }
      if (url === "/api/x/sources" && init?.method === "POST") {
        return response({
          ok: false,
          code: "upstream-unavailable",
          error: "raw private upstream payload",
        }, false);
      }
      throw new Error(`unexpected fetch ${url}`);
    }), { selectedMissionId: "mission-1" });

    await act(async () => button(renderer, "Refresh post").props.onClick());
    expect(announce).toHaveBeenLastCalledWith(
      "X is unavailable right now. Try again when you’re ready.",
      "assertive",
    );

    await act(async () => button(renderer, "Attach to mission").props.onClick());
    expect(announce).toHaveBeenLastCalledWith(
      "X is unavailable right now. Try again when you’re ready.",
      "assertive",
    );
    expect(JSON.stringify(renderer.toJSON())).not.toContain("raw private upstream payload");
    expect(renderer.root.findAllByProps({ role: "alert" })).toHaveLength(0);
    await act(async () => renderer.unmount());
  });

  test("a failed Save source mutation announces without exposing the response body", async () => {
    const renderer = await renderReady(vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/x/connection") return response(connectedConnection());
      if (url.includes("/api/x/sources?")) return response({ ok: true, sources: [] });
      if (url === "/api/x/posts/lookup") return response({ ok: true, post });
      if (url === "/api/x/sources" && init?.method === "POST") {
        return response({
          ok: false,
          code: "billing-unavailable",
          error: "private billing account details",
        }, false);
      }
      throw new Error(`unexpected fetch ${url}`);
    }));
    await act(async () => {
      input(renderer, "X post URL").props.onChange({ target: { value: post.canonicalUrl } });
    });
    await act(async () => form(renderer, "Grab X post").props.onSubmit({
      preventDefault() {},
    }));
    await act(async () => button(renderer, "Save source").props.onClick());

    expect(announce).toHaveBeenLastCalledWith(
      "X API access or credits are unavailable.",
      "assertive",
    );
    expect(JSON.stringify(renderer.toJSON())).toContain(
      "X API access or credits are unavailable.",
    );
    expect(JSON.stringify(renderer.toJSON())).not.toContain("private billing");
    expect(renderer.root.findAllByProps({ role: "alert" })).toHaveLength(0);
    await act(async () => renderer.unmount());
  });

  test("a deleted refresh moves focus to the affected source card before Refresh unmounts", async () => {
    const focused: string[] = [];
    const renderer = await renderReady(vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/x/connection") return response(connectedConnection());
      if (url.includes("/api/x/sources?")) {
        return response({ ok: true, sources: [source()] });
      }
      if (url === "/api/x/sources" && init?.method === "POST") {
        return response({ ok: false, code: "not-found" }, false);
      }
      throw new Error(`unexpected fetch ${url}`);
    }), {}, (element) => {
      if (element.type === "article" && element.props["data-x-source-id"]) {
        return {
          focus: () => focused.push(String(element.props["data-x-source-id"])),
        };
      }
      return null;
    });

    await act(async () => button(renderer, "Refresh post").props.onClick());

    const card = renderer.root.findByProps({ "data-x-source-id": "source-123" });
    expect(card.props.tabIndex).toBe(-1);
    expect(focused).toEqual(["source-123"]);
    expect(JSON.stringify(card.toJSON?.() ?? renderer.toJSON())).toContain("Post deleted");
    expect(() => button(renderer, "Refresh post")).toThrow();
    await act(async () => renderer.unmount());
  });
});

describe("ResearchXSources availability and errors", () => {
  test("missing connection and missing familiar grant are distinct Brain-tab handoffs", async () => {
    const disconnected = await renderReady(vi.fn(async (url: string) => {
      if (url === "/api/x/connection") {
        return response({ configured: true, connected: false, activeFlow: false });
      }
      throw new Error(`unexpected fetch ${url}`);
    }));
    expect(JSON.stringify(disconnected.toJSON())).toContain("Connect X");
    await act(async () => button(disconnected, "Open Brain settings").props.onClick());
    expect(openStudio).toHaveBeenLastCalledWith("brain", "familiar-a");
    await act(async () => disconnected.unmount());

    const noGrant = await renderReady(vi.fn(async (url: string) => {
      if (url === "/api/x/connection") return response(connectedConnection());
      throw new Error(`unexpected fetch ${url}`);
    }), {
      familiar: { ...familiarA, xResearchEnabled: false },
    });
    expect(JSON.stringify(noGrant.toJSON())).toContain("Allow X research");
    await act(async () => button(noGrant, "Open Brain settings").props.onClick());
    expect(openStudio).toHaveBeenLastCalledWith("brain", "familiar-a");
    await act(async () => noGrant.unmount());
  });

  test("renders loading, empty, request error, rate-limit retry time, deleted, and unavailable states", async () => {
    const connection = deferred<Response>();
    globalThis.fetch = vi.fn(async (url: string) => {
      if (url === "/api/x/connection") return connection.promise;
      throw new Error(`unexpected fetch ${url}`);
    });
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<ResearchXSources familiar={familiarA} selectedMissionId={null} />);
    });
    expect(
      renderer.root.findByProps({ "aria-label": "Grab from X" }).props["aria-busy"],
    ).toBe("true");
    await act(async () => renderer.unmount());

    const empty = await renderReady(vi.fn(async (url: string) => {
      if (url === "/api/x/connection") return response(connectedConnection());
      if (url.includes("/api/x/sources?")) return response({ ok: true, sources: [] });
      throw new Error(`unexpected fetch ${url}`);
    }));
    expect(JSON.stringify(empty.toJSON())).toContain("No X sources saved");
    await act(async () => empty.unmount());

    const unavailable = await renderReady(vi.fn(async (url: string) => {
      if (url === "/api/x/connection") return response(connectedConnection());
      if (url.includes("/api/x/sources?")) {
        return response({
          ok: true,
          sources: [
            source({ availability: "deleted" }),
            source({
              id: "source-456",
              postId: "456",
              canonicalUrl: "https://x.com/i/web/status/456",
              originalUrl: "https://x.com/i/web/status/456",
              availability: "unavailable",
            }),
          ],
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    }));
    const unavailableText = JSON.stringify(unavailable.toJSON());
    expect(unavailableText).toContain("Post deleted");
    expect(unavailableText).toContain("Post unavailable");
    await act(async () => unavailable.unmount());

    const rateLimited = await renderReady(vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/x/connection") return response(connectedConnection());
      if (url.includes("/api/x/sources?")) return response({ ok: true, sources: [] });
      if (url === "/api/x/posts/search" && init?.method === "POST") {
        return response({
          ok: false,
          code: "rate-limited",
          retryAt: "2026-08-01T06:00:00.000Z",
          error: "raw query should not appear",
        }, false);
      }
      throw new Error(`unexpected fetch ${url}`);
    }));
    await act(async () => {
      input(rateLimited, "Search X posts").props.onChange({ target: { value: "query" } });
    });
    await act(async () => form(rateLimited, "Search X posts").props.onSubmit({
      preventDefault() {},
    }));
    expect(JSON.stringify(rateLimited.toJSON())).toContain("Try again");
    expect(rateLimited.root.findByType("time").props.dateTime).toBe(
      "2026-08-01T06:00:00.000Z",
    );
    expect(JSON.stringify(rateLimited.toJSON())).not.toContain("raw query");
    await act(async () => rateLimited.unmount());
  });

  test("a saved-source load failure does not replace the settled connection state", async () => {
    const renderer = await renderReady(vi.fn(async (url: string) => {
      if (url === "/api/x/connection") return response(connectedConnection());
      if (url.includes("/api/x/sources?")) throw new Error("filesystem unavailable");
      throw new Error(`unexpected fetch ${url}`);
    }));

    const rendered = JSON.stringify(renderer.toJSON());
    expect(rendered).toContain("Grab from X");
    expect(rendered).toContain("Couldn’t load saved X sources");
    expect(rendered).not.toContain("Couldn’t load X");
    await act(async () => renderer.unmount());
  });

  test.each([
    ["not-connected", "Connect X in Brain settings."],
    ["capability-disabled", "Allow X research for this familiar in Brain settings."],
    ["missing-scope", "Reconnect X in Brain settings to grant research access."],
    ["billing-unavailable", "X API access or credits are unavailable."],
    ["not-found", "That X post was deleted or is no longer available."],
    ["invalid-request", "Check the X post URL or search and try again."],
    ["upstream-unavailable", "X is unavailable right now. Try again when you’re ready."],
    ["invalid-response", "X returned an unexpected response. Try again when you’re ready."],
    ["internal", "Couldn’t complete the X request. Try again when you’re ready."],
  ])("maps %s without echoing the server payload", async (code, expected) => {
    const renderer = await renderReady(vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/x/connection") return response(connectedConnection());
      if (url.includes("/api/x/sources?")) return response({ ok: true, sources: [] });
      if (url === "/api/x/posts/search" && init?.method === "POST") {
        return response({ ok: false, code, error: "private raw query/url" }, false);
      }
      throw new Error(`unexpected fetch ${url}`);
    }));
    await act(async () => {
      input(renderer, "Search X posts").props.onChange({ target: { value: "query" } });
    });
    await act(async () => form(renderer, "Search X posts").props.onSubmit({
      preventDefault() {},
    }));
    const rendered = JSON.stringify(renderer.toJSON());
    expect(rendered).toContain(expected);
    expect(rendered).not.toContain("private raw");
    await act(async () => renderer.unmount());
  });
});

describe("ResearchXSources async ownership", () => {
  test("a familiar or grant switch synchronously removes prior sources and aborts a busy preview", async () => {
    const lookup = deferred<Response>();
    let lookupSignal: AbortSignal | undefined;
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/x/connection") return response(connectedConnection());
      if (url === "/api/x/sources?familiarId=familiar-a") {
        return response({ ok: true, sources: [source({ preview: post })] });
      }
      if (url === "/api/x/sources?familiarId=familiar-b") {
        return response({ ok: true, sources: [] });
      }
      if (url === "/api/x/posts/lookup") {
        lookupSignal = init?.signal;
        return lookup.promise;
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<ResearchXSources familiar={familiarA} selectedMissionId={null} />);
    });
    await settle();
    await act(async () => {
      input(renderer, "X post URL").props.onChange({ target: { value: post.canonicalUrl } });
    });
    act(() => {
      void form(renderer, "Grab X post").props.onSubmit({ preventDefault() {} });
    });

    await act(async () => {
      renderer.update(<ResearchXSources familiar={familiarB} selectedMissionId={null} />);
    });
    expect(lookupSignal?.aborted).toBe(true);
    expect(JSON.stringify(renderer.toJSON())).not.toContain(post.text);
    expect(JSON.stringify(renderer.toJSON())).not.toContain(post.canonicalUrl);
    await act(async () => {
      input(renderer, "X post URL").props.onChange({ target: { value: post.canonicalUrl } });
    });
    expect(button(renderer, "Grab post").props.disabled).toBe(false);

    await act(async () => {
      renderer.update(
        <ResearchXSources
          familiar={{ ...familiarB, xResearchEnabled: false }}
          selectedMissionId={null}
        />,
      );
    });
    expect(JSON.stringify(renderer.toJSON())).toContain("Allow X research");
    expect(JSON.stringify(renderer.toJSON())).not.toContain(post.text);
    await act(async () => renderer.unmount());
  });

  test("a stale familiar load is aborted and cannot replace the new familiar's sources", async () => {
    const oldSources = deferred<Response>();
    const signals: AbortSignal[] = [];
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.signal) signals.push(init.signal);
      if (url === "/api/x/connection") return response(connectedConnection());
      if (url === "/api/x/sources?familiarId=familiar-a") return oldSources.promise;
      if (url === "/api/x/sources?familiarId=familiar-b") {
        return response({
          ok: true,
          sources: [source({
            familiarId: "familiar-b",
            id: "source-b",
            postId: "999",
            canonicalUrl: "https://x.com/b/status/999",
            originalUrl: "https://x.com/b/status/999",
          })],
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<ResearchXSources familiar={familiarA} selectedMissionId={null} />);
    });
    await settle();
    await act(async () => {
      renderer.update(<ResearchXSources familiar={familiarB} selectedMissionId={null} />);
    });
    await settle();
    expect(signals.some((signal) => signal.aborted)).toBe(true);

    await act(async () => {
      oldSources.resolve(response({
        ok: true,
        sources: [source({ canonicalUrl: "https://x.com/a/status/123" })],
      }));
      await oldSources.promise;
      await Promise.resolve();
    });
    const rendered = JSON.stringify(renderer.toJSON());
    expect(rendered).toContain("https://x.com/b/status/999");
    expect(rendered).not.toContain("https://x.com/a/status/123");
    await act(async () => renderer.unmount());
  });

  test("a stale mutation cannot announce or change the next familiar after switch or unmount", async () => {
    const refresh = deferred<Response>();
    let refreshSignal: AbortSignal | undefined;
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/x/connection") return response(connectedConnection());
      if (url === "/api/x/sources?familiarId=familiar-a") {
        return response({ ok: true, sources: [source()] });
      }
      if (url === "/api/x/sources?familiarId=familiar-b") {
        return response({ ok: true, sources: [] });
      }
      if (url === "/api/x/sources" && init?.method === "POST") {
        refreshSignal = init.signal;
        return refresh.promise;
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<ResearchXSources familiar={familiarA} selectedMissionId={null} />);
    });
    await settle();
    await act(async () => button(renderer, "Refresh post").props.onClick());
    await act(async () => {
      renderer.update(<ResearchXSources familiar={familiarB} selectedMissionId={null} />);
    });
    expect(refreshSignal?.aborted).toBe(true);

    await act(async () => {
      refresh.resolve(response({ ok: true, source: source(), post }));
      await refresh.promise;
      await Promise.resolve();
    });
    expect(announce).not.toHaveBeenCalled();
    expect(JSON.stringify(renderer.toJSON())).not.toContain(post.text);

    await act(async () => renderer.unmount());
    expect(announce).not.toHaveBeenCalled();
  });
});
