// @ts-expect-error -- This existing test dependency does not ship declarations.
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ChatActivityMap } from "./chat-run-rail";
import type { InstrumentTurn } from "@/lib/chat-thread-instruments";

let root: ReactTestRenderer | undefined;
let row: { clientWidth: number };
let resize: (() => void) | undefined;
const observe = vi.fn();
const disconnect = vi.fn();
const turns: InstrumentTurn[] = [{ id: "reply", role: "assistant", text: "", createdAt: "2026-10-04T04:00:00Z",
  tools: [{ id: "read-1", name: "Read", status: "ok", durationMs: 20 }] }];

beforeEach(() => {
  row = { clientWidth: 390 }; resize = undefined;
  observe.mockReset(); disconnect.mockReset();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resize = callback; }
    observe = observe;
    disconnect = disconnect;
  });
});
afterEach(() => {
  act(() => root?.unmount()); root = undefined;
  vi.unstubAllGlobals();
});
function render(value: InstrumentTurn[]) {
  act(() => {
    const element = <ChatActivityMap turns={value} />;
    if (root) root.update(element);
    else root = create(element, { createNodeMock: (node: { type: string }) => node.type === "aside" ? { parentElement: row } : null });
  });
}
function narrow() { return root!.root.findByType("aside").props.className.includes("cave-runrail--narrow"); }

test("the first streamed tool measures a previously empty narrow row and follows resizes", () => {
  render([]);
  expect(observe).not.toHaveBeenCalled();
  render(turns);
  expect(narrow()).toBe(true);
  expect(observe).toHaveBeenCalledWith(row);
  row.clientWidth = 1400; act(() => resize?.());
  expect(narrow()).toBe(false);
  row.clientWidth = 800; act(() => resize?.());
  expect(narrow()).toBe(true);
});

test("clearing and repopulating the transcript observes the new row and disconnects the old one", () => {
  row.clientWidth = 1400; render(turns);
  expect(narrow()).toBe(false);
  render([]);
  expect(disconnect).toHaveBeenCalledTimes(1);
  row = { clientWidth: 390 }; render(turns);
  expect(narrow()).toBe(true);
  expect(observe).toHaveBeenLastCalledWith(row);
});

test("without ResizeObserver the first tool still measures the available width", () => {
  vi.stubGlobal("ResizeObserver", undefined);
  render([]); render(turns);
  expect(narrow()).toBe(true);
});
