// @ts-nocheck
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ChatThreadRail } from "./chat-thread-rail";

vi.mock("@/components/ui/live-region", () => ({ useAnnouncer: () => ({ announce: vi.fn() }) }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let renderer;
let storage;
const KEY = "cave:chat-rail:width:v1";
beforeEach(() => {
  storage = new Map();
  vi.stubGlobal("localStorage", { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) });
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  vi.unstubAllGlobals();
});
const grip = () => renderer.root.findByProps({ role: "separator" });
const width = () => grip().props["aria-valuenow"];
async function mount(availableWidth = 1200) {
  await act(async () => { renderer = create(createElement(ChatThreadRail, { availableWidth }, "Threads")); });
}
const target = { focus: vi.fn(), setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() };
const pointer = (x, extra = {}) => ({ pointerId: 1, clientX: x, button: 0, isPrimary: true, preventDefault: vi.fn(), currentTarget: target, ...extra });

test("saved width is clamped to the pane without losing the preferred width", async () => {
  storage.set(KEY, "420");
  await mount(700);
  expect(width()).toBe(300);
  expect(storage.get(KEY)).toBe("420");
  await act(async () => renderer.update(createElement(ChatThreadRail, { availableWidth: 1200 }, "Threads")));
  expect(width()).toBe(420);
});

test("keyboard steps, limits and reset persist", async () => {
  await mount();
  const key = async (key, shiftKey = false) => act(async () => grip().props.onKeyDown({ key, shiftKey, preventDefault: vi.fn() }));
  await key("ArrowRight", true);
  expect(width()).toBe(344);
  await key("End");
  expect(width()).toBe(440);
  await key("ArrowRight");
  expect(width()).toBe(440);
  await key("Home");
  expect(width()).toBe(220);
  await key("Enter");
  expect(storage.get(KEY)).toBe("280");
});

test("only the primary drag changes width; cancel restores and release commits", async () => {
  await mount();
  await act(async () => grip().props.onPointerDown(pointer(0, { button: 2 })));
  await act(async () => grip().props.onPointerMove(pointer(100)));
  expect(width()).toBe(280);
  await act(async () => grip().props.onPointerDown(pointer(10)));
  await act(async () => grip().props.onPointerMove(pointer(70)));
  expect(width()).toBe(340);
  expect(storage.has(KEY)).toBe(false);
  await act(async () => grip().props.onPointerCancel());
  expect(width()).toBe(280);
  await act(async () => grip().props.onPointerDown(pointer(10)));
  await act(async () => grip().props.onPointerUp(pointer(90)));
  expect(width()).toBe(360);
  expect(storage.get(KEY)).toBe("360");
});

test("unavailable or corrupt storage never blocks resizing", async () => {
  storage.set(KEY, "NaN");
  await mount();
  expect(width()).toBe(280);
  localStorage.setItem = () => { throw new Error("blocked"); };
  await act(async () => grip().props.onKeyDown({ key: "ArrowLeft", preventDefault: vi.fn() }));
  expect(width()).toBe(264);
});
