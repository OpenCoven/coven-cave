// @ts-nocheck — react-test-renderer ships no types; rendered shortcut-dialog behavior test.
import React from "react";
import { act, create } from "react-test-renderer";
import { expect, test, vi, beforeEach, afterEach } from "vitest";

import { CodeShortcutsDialog } from "./code-shortcuts-dialog";
import { defaultCodeKeymap } from "@/lib/code-shortcuts";

vi.mock("react-dom", () => ({ createPortal: (node: unknown) => node }));
vi.mock("@/lib/icon", () => ({ Icon: () => null }));

const announce = vi.fn();
vi.mock("@/components/ui/live-region", () => ({
  useAnnouncer: () => ({ announce }),
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as { document?: unknown }).document = { body: {} };

type WindowListener = (event: KeyboardEvent) => void;

let listeners: Record<string, WindowListener[]>;
let previousWindow: typeof globalThis.window | undefined;

function dispatchKey(event: Partial<KeyboardEvent> & { key: string }) {
  const keyboardEvent = {
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {},
    ...event,
  } as KeyboardEvent;
  for (const listener of listeners.keydown ?? []) listener(keyboardEvent);
  return keyboardEvent;
}

beforeEach(() => {
  listeners = {};
  previousWindow = globalThis.window;
  globalThis.window = {
    addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      const fn = typeof listener === "function" ? listener : listener.handleEvent.bind(listener);
      listeners[type] ??= [];
      listeners[type].push(fn as WindowListener);
    },
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      const fn = typeof listener === "function" ? listener : listener.handleEvent.bind(listener);
      listeners[type] = (listeners[type] ?? []).filter((candidate) => candidate !== fn);
    },
  } as typeof globalThis.window;
  announce.mockReset();
});

afterEach(() => {
  if (previousWindow) globalThis.window = previousWindow;
  else delete (globalThis as { window?: typeof globalThis.window }).window;
});

test("reserved queue combos are refused during rebinding", () => {
  const onChange = vi.fn();
  let renderer;
  act(() => {
    renderer = create(
      <CodeShortcutsDialog
        open
        onClose={() => {}}
        keymap={defaultCodeKeymap()}
        onChange={onChange}
      />,
    );
  });

  const rebind = renderer.root.findAll(
    (node) => node.type === "button" && node.children.join("") === "Rebind",
  )[0];
  act(() => rebind.props.onClick());
  act(() => {
    dispatchKey({ key: "/", shiftKey: false });
  });

  expect(onChange).not.toHaveBeenCalled();
  expect(announce).toHaveBeenCalledWith("That shortcut is reserved for the session queue.");
});
