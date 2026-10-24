// @ts-nocheck
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { EnhanceControl, EnhanceStrip } from "./composer-enhance";

// Exercise the real control's events and state without a DOM portal.
vi.mock("@/lib/icon", () => ({ Icon: () => null }));
vi.mock("@/components/ui/popover", () => ({
  Popover: ({ open, children }) => open ? children : null,
  PopoverBody: ({ children }) => children,
  PopoverItem: ({ children, onSelect }) => createElement("button", { onClick: onSelect }, children),
  PopoverSeparator: () => null,
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let renderer;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", (callback) => setTimeout(callback, 0));
  vi.stubGlobal("cancelAnimationFrame", clearTimeout);
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  renderer = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function setup(state = { phase: "idle" }, props = {}) {
  const enhance = vi.fn();
  const cancel = vi.fn();
  await act(async () => {
    renderer = create(createElement(EnhanceControl, { state, onEnhance: enhance, onCancel: cancel, ...props }));
  });
  return {
    enhance, cancel,
    main: () => renderer.root.findAllByType("button")[0],
    options: () => renderer.root.findAllByType("button")[1],
    tick: () => act(async () => vi.advanceTimersByTime(421)),
  };
}

const capture = vi.fn();
const pointer = () => ({ button: 0, pointerId: 1, clientX: 10, clientY: 10, currentTarget: { setPointerCapture: capture } });

test("a stationary press captures the pointer and survives geometry-only leave", async () => {
  const p = await setup();
  capture.mockClear();
  await act(async () => p.main().props.onPointerDown(pointer()));
  expect(capture).toHaveBeenCalledWith(1);
  await act(async () => p.main().props.onPointerLeave?.());
  await p.tick();
  expect(p.options().props["aria-expanded"]).toBe(true);
});

test("moving a captured pointer cancels the menu and consumes the release click", async () => {
  const p = await setup();
  await act(async () => {
    p.main().props.onPointerDown(pointer());
    p.main().props.onPointerMove?.({ pointerId: 1, clientX: 80, clientY: 10 });
    p.main().props.onPointerUp({ pointerId: 1 });
    p.main().props.onClick({ detail: 1 });
  });
  await p.tick();
  expect(p.options().props["aria-expanded"]).toBe(false);
  expect(p.enhance).not.toHaveBeenCalled();
});

test("unexpected capture loss cancels a pending gesture", async () => {
  const p = await setup();
  await act(async () => {
    p.main().props.onPointerDown(pointer());
    p.main().props.onLostPointerCapture?.({ pointerId: 1 });
    p.main().props.onClick({ detail: 1 });
  });
  await p.tick();
  expect(p.options().props["aria-expanded"]).toBe(false);
  expect(p.enhance).not.toHaveBeenCalled();
});

test("a cancelled gesture does not consume the next pointer click on Cancel", async () => {
  const p = await setup();
  await act(async () => {
    p.main().props.onPointerDown(pointer());
    p.main().props.onPointerCancel({ pointerId: 1 });
    renderer.update(createElement(EnhanceControl, {
      state: { phase: "loading", intent: "auto", preview: "" },
      onEnhance: p.enhance, onCancel: p.cancel,
    }));
  });
  await act(async () => {
    p.main().props.onPointerDown(pointer());
    p.main().props.onPointerUp({ pointerId: 1 });
    p.main().props.onClick({ detail: 1 });
  });
  expect(p.cancel).toHaveBeenCalledOnce();
});

test("short click enhances once; moving cancels a pending long press", async () => {
  const p = await setup();
  await act(async () => {
    p.main().props.onPointerDown(pointer());
    p.main().props.onPointerUp({ pointerId: 1 });
    p.main().props.onClick({ detail: 1 });
  });
  await p.tick();
  expect(p.enhance).toHaveBeenCalledExactlyOnceWith("auto");
  expect(p.options().props["aria-expanded"]).toBe(false);
  await act(async () => {
    p.main().props.onPointerDown(pointer());
    p.main().props.onPointerMove({ pointerId: 1, clientX: 80, clientY: 10 });
  });
  await p.tick();
  expect(p.options().props["aria-expanded"]).toBe(false);
});

test("long press opens options without generating on release", async () => {
  const p = await setup();
  await act(async () => p.main().props.onPointerDown(pointer()));
  await p.tick();
  expect(p.options().props["aria-expanded"]).toBe(true);
  await act(async () => {
    p.main().props.onPointerUp({ pointerId: 1 });
    p.main().props.onClick({ detail: 1 });
  });
  expect(p.enhance).not.toHaveBeenCalled();
});

test("pointer cancellation cannot open an abandoned menu", async () => {
  const p = await setup();
  await act(async () => {
    p.main().props.onPointerDown(pointer());
    p.main().props.onPointerCancel?.({ pointerId: 1 });
  });
  await p.tick();
  expect(p.options().props["aria-expanded"]).toBe(false);
});

test("loading exposes Cancel and blocks keyboard access to intent options", async () => {
  const p = await setup({ phase: "loading", intent: "auto", preview: "" });
  expect(p.main().props["aria-label"]).toMatch(/cancel/i);
  expect(p.options().props.disabled).toBe(true);
  await act(async () => p.main().props.onKeyDown({ key: "ArrowDown", preventDefault() {} }));
  expect(p.options().props["aria-expanded"]).toBe(false);
  await act(async () => p.main().props.onClick({ detail: 0 }));
  expect(p.cancel).toHaveBeenCalledOnce();
  expect(p.enhance).not.toHaveBeenCalled();
});

test("keyboard opens idle options and a secondary pointer does not", async () => {
  const p = await setup();
  await act(async () => p.main().props.onPointerDown({ button: 2 }));
  await p.tick();
  expect(p.options().props["aria-expanded"]).toBe(false);
  await act(async () => p.main().props.onKeyDown({ key: "ArrowDown", preventDefault() {} }));
  expect(p.options().props["aria-expanded"]).toBe(true);
  expect(p.enhance).not.toHaveBeenCalled();
});

test("secondary pointer events cannot interrupt or submit a primary hold", async () => {
  const p = await setup();
  await act(async () => {
    p.main().props.onPointerDown(pointer());
    p.main().props.onPointerDown({ ...pointer(), pointerId: 2, isPrimary: false });
    p.main().props.onPointerMove({ pointerId: 2, clientX: 100, clientY: 100 });
    p.main().props.onPointerUp({ pointerId: 2 });
    p.main().props.onPointerCancel({ pointerId: 2 });
    p.main().props.onLostPointerCapture({ pointerId: 2 });
  });
  await p.tick();
  expect(p.options().props["aria-expanded"]).toBe(true);
  await act(async () => {
    p.main().props.onPointerUp({ pointerId: 1 });
    p.main().props.onClick({ detail: 1 });
  });
  expect(p.enhance).not.toHaveBeenCalled();
});

const controlWrapper = () => renderer.root.findAllByType("span")
  .find((node) => String(node.props.className).startsWith("composer-enhance-control "));

test("without a familiar both segments are disabled and say why", async () => {
  const reason = "Choose a familiar to enhance this prompt.";
  const p = await setup({ phase: "idle" }, { unavailableReason: reason });
  expect(p.main().props.disabled).toBe(true);
  expect(p.options().props.disabled).toBe(true);
  expect(p.main().props.title).toBe(reason);
  expect(p.main().props["aria-label"]).toBe("Enhance prompt");
  expect(controlWrapper().props.title).toBe(reason);
  await act(async () => p.main().props.onPointerDown(pointer()));
  await p.tick();
  await act(async () => p.main().props.onKeyDown({ key: "ArrowDown", preventDefault() {} }));
  expect(p.options().props["aria-expanded"]).toBe(false);
  expect(p.enhance).not.toHaveBeenCalled();
});

test("an available control carries no unavailable reason", async () => {
  const p = await setup();
  expect(p.main().props.disabled).toBe(false);
  expect(p.main().props.title).toBe("Enhance prompt");
  expect(controlWrapper().props.title).toBeUndefined();
});

async function strip(state) {
  const handlers = { onApply: vi.fn(), onDismiss: vi.fn(), onRevert: vi.fn(), onCancel: vi.fn(), onRetry: vi.fn(), onFocusComposer: vi.fn() };
  await act(async () => {
    renderer = create(createElement(EnhanceStrip, { state, ...handlers }));
  });
  const button = (label) => renderer.root.findAllByType("button").find((node) => node.props["aria-label"] === label);
  return { handlers, button };
}

test("a retryable failure keeps the message and offers Retry before Dismiss", async () => {
  const message = "Couldn't enhance the prompt: the familiar didn't start responding within 30 seconds. Your draft was kept.";
  const { handlers, button } = await strip({ phase: "error", message, retryable: true });
  expect(renderer.root.findByProps({ role: "alert" }).findByProps({ className: "composer-enhance-strip__message" }).props.children).toBe(message);
  expect(renderer.root.findAllByType("button").map((node) => node.props.children)).toEqual(["Retry", "Dismiss"]);
  await act(async () => button("Retry enhance").props.onClick());
  expect(handlers.onRetry).toHaveBeenCalledOnce();
  await act(async () => vi.advanceTimersByTime(1));
  expect(handlers.onFocusComposer).toHaveBeenCalledOnce();
  expect(handlers.onDismiss).not.toHaveBeenCalled();
});

test("a failure that retrying cannot fix offers only Dismiss", async () => {
  const { button } = await strip({ phase: "error", message: "Choose a familiar to enhance this prompt.", retryable: false });
  expect(button("Retry enhance")).toBeUndefined();
  expect(button("Dismiss enhance error")).toBeDefined();
});

test("success copy never labels a rewrite as offline", async () => {
  const recommendation = { id: "r1", rationale: "Smart enhance was selected.", evidenceRefs: [] };
  await strip({ phase: "applied", original: "draft", recommendation });
  expect(JSON.stringify(renderer.toJSON())).toContain("Prompt improved.");
  expect(JSON.stringify(renderer.toJSON())).not.toMatch(/offline/i);
});
