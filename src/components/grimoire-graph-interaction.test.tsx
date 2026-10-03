import type { ReactNode } from "react";
// @ts-expect-error -- react-test-renderer has no bundled declarations.
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { GrimoireGraphView } from "./grimoire-graph-view";
import { createForceSim, unpinForceSimNode } from "@/lib/grimoire-force";
import type { DocGraph } from "@/lib/grimoire-graph";

vi.mock("@/components/ui/popover", () => ({ Popover: ({ open, children }: { open: boolean; children: ReactNode }) => open ? children : null, PopoverBody: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/lib/icon", () => ({ Icon: () => null }));
vi.mock("@/components/ui/live-region", () => ({ useAnnouncer: () => ({ announce: vi.fn() }) }));
vi.mock("@/lib/use-prefers-reduced-motion", () => ({ usePrefersReducedMotion: () => true }));
vi.mock("@/lib/grimoire-force", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/grimoire-force")>();
  return { ...actual, createForceSim: vi.fn(actual.createForceSim), unpinForceSimNode: vi.fn(actual.unpinForceSimNode) };
});

const graph: DocGraph = {
  nodes: [
    { id: "a", kind: "memory", title: "Release decisions", ref: { kind: "memory", path: "/nova/a.md" }, degree: 1, scanned: true },
    { id: "b", kind: "knowledge", title: "Deployment guide", ref: { kind: "knowledge", id: "b" }, degree: 1, scanned: true },
    { id: "c", kind: "memory", title: "Unconnected insight", ref: { kind: "memory", path: "/sage/c.md" }, degree: 0, scanned: true },
  ],
  edges: [{ id: "ab", source: "a", target: "b", type: "link" }],
};
let root: ReactTestRenderer | undefined;
let nextFrame: (() => void) | undefined;
let arcs: number[][];
let labels: string[];
let resizeObserver: (() => void) | undefined;
const viewport = { width: 900, height: 600 };
const capture = new Set<number>();
const canvas = {
  width: 900, height: 600, clientWidth: 900, clientHeight: 600, style: {},
  getBoundingClientRect: () => ({ left: 0, top: 0, ...viewport }),
  getContext: () => new Proxy({}, { get: (_, key) => {
    if (key === "arc") return (...args: number[]) => arcs.push(args);
    if (key === "measureText") return (text: string) => ({ width: text.length * 6 });
    if (key === "fillText") return (text: string) => labels.push(text);
    return () => {};
  } }),
  addEventListener: vi.fn(), removeEventListener: vi.fn(),
  setPointerCapture: (id: number) => capture.add(id),
  hasPointerCapture: (id: number) => capture.has(id),
  releasePointerCapture: (id: number) => capture.delete(id),
};
function frame() { arcs = []; labels = []; const draw = nextFrame; nextFrame = undefined; act(() => draw?.()); }
function mount(data = graph) {
  act(() => {
    const element = <GrimoireGraphView graph={data} onOpen={vi.fn()} memoryOwnerByNodeId={new Map([["a", "nova"], ["c", "sage"]])} ownerLabel={(id) => id === "nova" ? "Nova" : "Sage"} />;
    if (root) root.update(element);
    else root = create(element, { createNodeMock: (element: { type: string }) => element.type === "canvas" || element.type === "div" ? canvas : null });
  });
  frame();
}
function canvasProps() { return root!.root.findByType("canvas").props; }
function textContent(node: unknown): string {
  if (typeof node === "string") return node;
  if (node && typeof node === "object" && "children" in node) return (node.children as unknown[]).map(textContent).join("");
  return "";
}
function button(text: string) { return root!.root.findAllByType("button").find((node: unknown) => textContent(node).trim() === text)!; }
function pointer(type: string, pointerId: number, x: number, y: number) { return { type, pointerId, clientX: x, clientY: y, button: 0, shiftKey: false }; }

beforeEach(() => {
  arcs = []; labels = []; capture.clear(); vi.clearAllMocks();
  viewport.width = 900; viewport.height = 600;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", { devicePixelRatio: 1, localStorage: { getItem: () => null, setItem: vi.fn() } });
  vi.stubGlobal("document", { documentElement: {} });
  vi.stubGlobal("getComputedStyle", () => ({ fontFamily: "sans-serif", getPropertyValue: () => "rgb(100, 110, 120)" }));
  vi.stubGlobal("ResizeObserver", class { constructor(callback: () => void) { resizeObserver = callback; } observe() {} disconnect() {} });
  vi.stubGlobal("MutationObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("requestAnimationFrame", (callback: (time: number) => void) => { nextFrame = () => callback(1000); return 1; });
  vi.stubGlobal("cancelAnimationFrame", () => { nextFrame = undefined; });
});
afterEach(() => { act(() => root?.unmount()); root = undefined; vi.unstubAllGlobals(); });

test("empty-to-populated transition keeps a live, sized canvas and paints nodes", () => {
  mount({ nodes: [], edges: [] });
  expect(canvasProps()).toBeDefined();
  mount();
  expect(arcs.length).toBeGreaterThan(0);
  expect(canvas.width).toBe(900);
});

test("overlapping projected nodes keep one readable label instead of overprinting titles", () => {
  mount();
  const sim = vi.mocked(createForceSim).mock.results.at(-1)!.value;
  sim.x.fill(0); sim.y.fill(0); sim.z.fill(0);
  act(() => root!.root.findByProps({ "aria-label": "Zoom in" }).props.onClick());
  frame();
  expect(labels).toHaveLength(1);
});

test("2D framing scales with a narrower pane rather than cropping the previous viewport", () => {
  mount();
  act(() => root!.root.findByProps({ "aria-label": "Expand graph filters" }).props.onClick());
  act(() => root!.root.findAllByType("select")[1].props.onChange({ target: { value: "2" } }));
  frame();
  const before = arcs.map((arc) => [...arc]);
  viewport.width = 450;
  act(() => resizeObserver?.());
  frame();
  expect(arcs).toHaveLength(before.length);
  for (let i = 0; i < arcs.length; i++) {
    expect(arcs[i][0] - 225).toBeCloseTo((before[i][0] - 450) / 2);
    expect(arcs[i][1] - 300).toBeCloseTo((before[i][1] - 300) / 2);
  }
});

test("search reaches disconnected files and updates matches without reheating the layout for each keystroke", () => {
  mount();
  const search = root!.root.findByType("input");
  act(() => search.props.onChange({ target: { value: "Unconnected" } }));
  expect(root!.root.findAllByProps({ className: "grimoire-graph-node__body" }).length).toBe(1);
  const builds = vi.mocked(createForceSim).mock.calls.length;
  act(() => search.props.onChange({ target: { value: "Unconnected insight" } }));
  expect(vi.mocked(createForceSim).mock.calls.length).toBe(builds);
  const row = root!.root.findAllByType("button").find((node: { props: { className?: string } }) => node.props.className?.startsWith("grimoire-graph-node"));
  act(() => row!.props.onClick());
  expect(root!.root.findByProps({ "aria-label": "Selected: Unconnected insight" })).toBeDefined();
});

test("familiar colors use inventory ownership and expose named legend entries without rebuilding physics", () => {
  mount();
  act(() => root!.root.findByProps({ "aria-label": "Expand graph filters" }).props.onClick());
  const builds = vi.mocked(createForceSim).mock.calls.length;
  act(() => root!.root.findAllByType("select")[0].props.onChange({ target: { value: "familiar" } }));
  expect(vi.mocked(createForceSim).mock.calls.length).toBe(builds);
  expect(JSON.stringify(root!.toJSON())).toContain("Familiar colors");
  expect(JSON.stringify(root!.toJSON())).toContain("Nova");
  expect(JSON.stringify(root!.toJSON())).toContain("Shared");
});

test("pinch changes the view and never selects a node on release; cancellation clears capture", () => {
  mount();
  const before = arcs.map((arc) => arc.slice(0, 3));
  act(() => {
    canvasProps().onPointerDown(pointer("pointerdown", 1, 300, 300));
    canvasProps().onPointerDown(pointer("pointerdown", 2, 600, 300));
    canvasProps().onPointerMove(pointer("pointermove", 2, 750, 340));
  });
  frame();
  expect(arcs.map((arc) => arc.slice(0, 3))).not.toEqual(before);
  act(() => {
    canvasProps().onPointerUp(pointer("pointerup", 2, 750, 340));
    canvasProps().onPointerCancel(pointer("pointercancel", 1, 300, 300));
  });
  expect(capture.size).toBe(0);
  expect(root!.root.findAllByType("section").some((node: { props: Record<string, string> }) => node.props["aria-label"]?.startsWith("Selected:"))).toBe(false);
});

test("canceling a node drag unpins it without selecting or opening a document", () => {
  mount();
  const [x, y] = arcs[0];
  act(() => {
    canvasProps().onPointerDown(pointer("pointerdown", 7, x, y));
    canvasProps().onPointerMove(pointer("pointermove", 7, x + 30, y + 20));
    canvasProps().onPointerCancel(pointer("pointercancel", 7, x + 30, y + 20));
  });
  expect(unpinForceSimNode).toHaveBeenCalled();
  expect(capture.size).toBe(0);
});

test("fit remains reachable when all groups are filtered away", () => {
  mount();
  act(() => root!.root.findByProps({ "aria-label": "Expand graph filters" }).props.onClick());
  for (const checkbox of root!.root.findAllByType("input").filter((node: { props: { type: string } }) => node.props.type === "checkbox").slice(0, 4)) {
    act(() => checkbox.props.onChange({ target: { checked: false } }));
  }
  expect(button("Show all documents")).toBeDefined();
  act(() => button("Show all documents").props.onClick());
  frame();
  expect(arcs.length).toBeGreaterThan(0);
});

function documentButton(title: string) {
  return root!.root.findAllByType("button").find((node: { findAllByType: (type: string) => { children: unknown[] }[] }) => node.findAllByType("span").some((span) => span.children.includes(title)))!;
}

test("the explorer traverses connections, returns through its trail, and opens the selected document", () => {
  mount();
  const open = root!.root.findByType(GrimoireGraphView).props.onOpen;
  act(() => button("Explore").props.onClick());
  act(() => documentButton("Release decisions").props.onClick());
  act(() => documentButton("Deployment guide").props.onClick());
  expect(root!.root.findByProps({ "aria-label": "Selected: Deployment guide" })).toBeDefined();
  act(() => button("Back").props.onClick());
  expect(root!.root.findByProps({ "aria-label": "Selected: Release decisions" })).toBeDefined();
  act(() => button("Open").props.onClick());
  expect(open).toHaveBeenCalledWith({ kind: "memory", path: "/nova/a.md" });
});

test("Escape clears keyboard selection and the next Tab leaves the canvas", () => {
  mount();
  const firstTab = vi.fn();
  act(() => canvasProps().onKeyDown({ key: "Tab", shiftKey: false, preventDefault: firstTab }));
  expect(firstTab).toHaveBeenCalled();
  act(() => canvasProps().onKeyDown({ key: "Escape", preventDefault: vi.fn() }));
  const exitTab = vi.fn();
  act(() => canvasProps().onKeyDown({ key: "Tab", shiftKey: false, preventDefault: exitTab }));
  expect(exitTab).not.toHaveBeenCalled();
});
