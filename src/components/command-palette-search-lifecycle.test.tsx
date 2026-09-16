// @ts-nocheck
import {
  act,
  create,
  type ReactTestRenderer,
} from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { CommandPalette } from "./command-palette";

const resources = vi.hoisted(() => ({
  loadCanonical: vi.fn(),
}));

vi.mock("@/lib/canonical-memory-resources", () => ({
  loadCanonicalMemoryList: resources.loadCanonical,
}));
vi.mock("@/lib/use-projects", () => ({
  useProjects: () => ({ projects: [] }),
}));
vi.mock("@/lib/use-focus-trap", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/use-focus-trap")>()),
  useFocusTrap: () => {},
}));
vi.mock("@/lib/datetime-format", () => ({
  useDateTimePrefs: () => {},
}));
vi.mock("@/lib/platform-keys", () => ({
  platformizeHint: (value: string) => value,
  useKeySymbols: () => ({
    up: "up",
    down: "down",
    enter: "enter",
    mod: "cmd",
  }),
}));
vi.mock("@/lib/icon", () => ({
  Icon: () => null,
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let renderer: ReactTestRenderer | undefined;
let searches: { signal: AbortSignal; resolve: (value: unknown) => void }[];
const props = { onClose: () => {}, familiars: [], sessions: [], onIntent: () => {} };
const palette = (open: boolean, initialQuery = "needle") =>
  <CommandPalette {...props} open={open} initialQuery={initialQuery} />;
const render = async (open: boolean, query = "needle") => {
  await act(async () => {
    if (renderer) renderer.update(palette(open, query));
    else renderer = create(palette(open, query));
  });
};
const tick = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(300); }); };

beforeEach(() => {
  vi.useFakeTimers();
  searches = [];
  resources.loadCanonical.mockResolvedValue({ state: "ready", entries: [] });
  vi.stubGlobal("window", { setTimeout, clearTimeout, localStorage: { getItem: () => null, setItem: () => {} } });
  vi.stubGlobal("document", { getElementById: () => null });
  vi.stubGlobal("fetch", vi.fn((input, init) => {
    if (String(input).startsWith("/api/chat/search?")) {
      return new Promise(resolve => searches.push({ signal: init.signal, resolve }));
    }
    return Promise.resolve({ json: async () => ({ ok: true, cards: [], entries: [] }) });
  }));
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("conversation search visibility", () => {
  test("dismissal cancels the debounce and reopening starts a fresh search", async () => {
    await render(true);
    await render(false);
    await tick();
    expect(searches).toHaveLength(0);
    await render(true);
    await tick();
    expect(searches).toHaveLength(1);
  });

  test("dismissal aborts an in-flight search and a late result cannot leak into reopening", async () => {
    await render(true);
    await tick();
    expect(searches).toHaveLength(1);
    await render(false);
    expect(searches[0].signal.aborted).toBe(true);
    await act(async () => {
      searches[0].resolve({ json: async () => ({ ok: true, hits: [{ sessionId: "late", title: "Stale conversation", snippet: "needle", matchCount: 1 }] }) });
    });
    await render(true);
    expect(JSON.stringify(renderer!.toJSON())).not.toContain("Stale conversation");
    await tick();
    expect(searches).toHaveLength(2);
    expect(searches[1].signal.aborted).toBe(false);
    await act(async () => {
      searches[1].resolve({ json: async () => ({ ok: true, hits: [{ sessionId: "fresh", title: "Fresh conversation", snippet: "needle", matchCount: 1 }] }) });
    });
    expect(JSON.stringify(renderer!.toJSON())).toContain("Fresh conversation");
  });

  test.each(["", "x", "/settings", "@salem needle"])("does not search an ineligible query %s", async query => {
    await render(true, query);
    await tick();
    expect(searches).toHaveLength(0);
  });
});
