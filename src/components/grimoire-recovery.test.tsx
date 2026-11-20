import type { ComponentProps } from "react";
// @ts-expect-error -- react-test-renderer has no bundled declarations.
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { GrimoireLauncher } from "./grimoire-launcher";
import { GrimoireDocReader, MemoryDocReader, JournalDocReader } from "./grimoire-doc-reader";

vi.mock("@/lib/icon", () => ({ Icon: () => null }));
// The reader only needs this interval; loading the editing engine requires a DOM.
vi.mock("@/components/md-editor/memory-md-editor", () => ({ LIVE_FOLLOW_INTERVAL_MS: 5000 }));
let root: ReactTestRenderer;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", {
    localStorage: { getItem: () => null, setItem: vi.fn() },
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
  });
});
afterEach(() => { act(() => root?.unmount()); vi.unstubAllGlobals(); });

const launcher: ComponentProps<typeof GrimoireLauncher> = {
  knowledge: [], memory: [], journal: [], graph: null, query: "",
  onQueryChange: vi.fn(), journalTitle: (date) => date, onOpen: vi.fn(),
  onNewStitch: vi.fn(), onBlankEntry: vi.fn(), onShowJournal: vi.fn(), onShowGraph: vi.fn(),
};
const reader = {
  docKey: "memory:fixture", fallbackTitle: "Fixture memory",
  docIndex: { knowledge: [], memory: [], journal: [] }, onOpenDoc: vi.fn(),
};
function text() { return JSON.stringify(root.toJSON()); }
function retry() {
  return root.root.findAllByType("button").find((node: { children: unknown[] }) => node.children.includes("Retry"));
}

test("Library loading and failure never claim there are no memories", () => {
  const onRetry = vi.fn();
  act(() => { root = create(<GrimoireLauncher {...launcher} loading onRetry={onRetry} />); });
  expect(root.root.findAllByProps({ "aria-busy": true })).toHaveLength(1);
  expect(text()).not.toContain("No memories yet");
  act(() => root.update(<GrimoireLauncher {...launcher} loadError="Service unavailable" onRetry={onRetry} />));
  expect(root.root.findAllByProps({ role: "alert" })).toHaveLength(1);
  expect(text()).not.toContain("No memories yet");
  expect(retry()).toBeDefined();
  act(() => retry()!.props.onClick());
  expect(onRetry).toHaveBeenCalledOnce();
});

test("a refresh failure keeps readable content and offers recovery", () => {
  act(() => {
    root = create(<GrimoireDocReader {...reader} markdown="# Saved decision\nKeep the existing route." loadError="Offline" onRetry={vi.fn()} />);
  });
  expect(text()).toContain("Keep the existing route.");
  expect(text()).toContain("Offline");
  expect(retry()).toBeDefined();
});

for (const kind of ["memory", "journal"] as const) {
  test(`${kind} reader can retry an initial fetch failure`, async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ ok: false, error: "Service unavailable" }, { status: 503 }))
      .mockResolvedValueOnce(Response.json(kind === "memory"
        ? { ok: true, text: "# Recovered\nThe decision is readable.", mtimeMs: 1 }
        : { ok: true, entry: { reflection: "# Recovered\nThe decision is readable." } }));
    vi.stubGlobal("fetch", fetcher);
    await act(async () => {
      root = create(kind === "memory"
        ? <MemoryDocReader {...reader} path="/fixture/memory.md" active={false} />
        : <JournalDocReader {...reader} date="2026-10-20" familiar="nova" />);
    });
    expect(text()).toContain("Service unavailable");
    expect(retry()).toBeDefined();
    await act(async () => retry()!.props.onClick());
    expect(text()).toContain("The decision is readable.");
    expect(text()).not.toContain("Service unavailable");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
}
