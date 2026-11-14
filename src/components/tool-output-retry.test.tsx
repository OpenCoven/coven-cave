// @ts-nocheck
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { afterEach, expect, test, vi } from "vitest";
import { ToolOutputRetry } from "./tool-output-retry";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let renderer;
afterEach(async () => { await act(async () => renderer?.unmount()); });

async function setup() {
  const retry = vi.fn();
  const capture = vi.fn();
  await act(async () => { renderer = create(createElement(ToolOutputRetry, { onRetry: retry })); });
  return { retry, capture, button: () => renderer.root.findByType("button"),
    down: { button: 0, isPrimary: true, pointerId: 7, clientX: 40, clientY: 50,
      currentTarget: { setPointerCapture: capture } } };
}

test("a stationary primary press keeps its click target until one retry", async () => {
  const p = await setup();
  await act(async () => p.button().props.onPointerDown?.(p.down));
  expect(p.capture).toHaveBeenCalledWith(7);
  expect(p.retry).not.toHaveBeenCalled();
  await act(async () => {
    p.button().props.onPointerUp?.({ pointerId: 7 });
    p.button().props.onLostPointerCapture?.({ pointerId: 7 });
    p.button().props.onClick({ detail: 1 });
  });
  expect(p.retry).toHaveBeenCalledTimes(1);
});

test.each(["move", "cancel", "lost capture"])("%s cancels a captured press without blocking the next keyboard retry", async (kind) => {
  const p = await setup();
  await act(async () => {
    p.button().props.onPointerDown?.(p.down);
    if (kind === "move") p.button().props.onPointerMove?.({ pointerId: 7, clientX: 90, clientY: 50 });
    if (kind === "cancel") p.button().props.onPointerCancel?.({ pointerId: 7 });
    if (kind === "lost capture") p.button().props.onLostPointerCapture?.({ pointerId: 7 });
    p.button().props.onPointerUp?.({ pointerId: 7 });
    p.button().props.onClick({ detail: 1 });
  });
  expect(p.retry).not.toHaveBeenCalled();
  await act(async () => p.button().props.onClick({ detail: 0 }));
  expect(p.retry).toHaveBeenCalledTimes(1);
});

test("a second pointer cannot replace or cancel the primary press", async () => {
  const p = await setup();
  await act(async () => {
    p.button().props.onPointerDown?.(p.down);
    p.button().props.onPointerDown?.({ ...p.down, pointerId: 8, isPrimary: false });
    p.button().props.onPointerMove?.({ pointerId: 8, clientX: 900, clientY: 50 });
    p.button().props.onPointerCancel?.({ pointerId: 8 });
    p.button().props.onPointerUp?.({ pointerId: 7 });
    p.button().props.onClick({ detail: 1 });
  });
  expect(p.capture.mock.calls).toEqual([[7]]);
  expect(p.retry).toHaveBeenCalledTimes(1);
});

test("two primary pointer types cannot replace the owner's cancelled gesture", async () => {
  const p = await setup();
  await act(async () => {
    p.button().props.onPointerDown(p.down);
    p.button().props.onPointerMove({ pointerId: 7, clientX: 100, clientY: 50 });
    p.button().props.onPointerDown({ ...p.down, pointerId: 8, isPrimary: true });
    p.button().props.onPointerUp({ pointerId: 8 });
    p.button().props.onClick({ detail: 1, nativeEvent: { pointerId: 8 } });
    p.button().props.onPointerUp({ pointerId: 7 });
    p.button().props.onClick({ detail: 1, nativeEvent: { pointerId: 7 } });
  });
  expect(p.retry).not.toHaveBeenCalled();
  expect(p.capture.mock.calls).toEqual([[7]]);
  await act(async () => {
    p.button().props.onPointerDown({ ...p.down, pointerId: 9 });
    p.button().props.onPointerUp({ pointerId: 9 });
    p.button().props.onClick({ detail: 1, nativeEvent: { pointerId: 9 } });
  });
  expect(p.retry).toHaveBeenCalledTimes(1);
});
