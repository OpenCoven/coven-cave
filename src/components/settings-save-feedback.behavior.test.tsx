// @ts-nocheck
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const flushAppPreferences = vi.hoisted(() => vi.fn());

vi.mock("@/lib/app-preferences", () => ({ flushAppPreferences }));
vi.mock("@/lib/icon", () => ({
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
}));

import {
  SETTINGS_SAVED_EVENT,
  showSettingsSavedAfterPreferencesFlush,
  showSettingsSavedToast,
} from "@/lib/settings-save-feedback";
import { SettingsSaveToast } from "./ui/settings-save-toast";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class TestCustomEvent<T> extends Event {
  detail: T;

  constructor(type: string, init?: CustomEventInit<T>) {
    super(type);
    this.detail = init?.detail as T;
  }
}

function textContent(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (node && typeof node === "object" && "children" in node) {
    return textContent((node as { children: unknown }).children);
  }
  return "";
}

let previousWindow: unknown;
let previousCustomEvent: unknown;
let eventTarget: EventTarget;
let removedListeners: string[];

beforeEach(() => {
  vi.useFakeTimers();
  flushAppPreferences.mockReset();
  eventTarget = new EventTarget();
  removedListeners = [];
  previousWindow = globalThis.window;
  previousCustomEvent = globalThis.CustomEvent;
  globalThis.CustomEvent = TestCustomEvent;
  globalThis.window = {
    addEventListener: eventTarget.addEventListener.bind(eventTarget),
    removeEventListener(type: string, listener: EventListener) {
      removedListeners.push(type);
      eventTarget.removeEventListener(type, listener);
    },
    dispatchEvent: eventTarget.dispatchEvent.bind(eventTarget),
    setTimeout,
    clearTimeout,
  };
});

afterEach(() => {
  vi.useRealTimers();
  if (previousWindow === undefined) delete globalThis.window;
  else globalThis.window = previousWindow;
  if (previousCustomEvent === undefined) delete globalThis.CustomEvent;
  else globalThis.CustomEvent = previousCustomEvent;
});

test("save feedback dispatches the requested payload and waits for persistence", async () => {
  const messages: string[] = [];
  window.addEventListener(SETTINGS_SAVED_EVENT, (event) => {
    messages.push((event as CustomEvent<{ message: string }>).detail.message);
  });

  showSettingsSavedToast("Theme saved.");
  expect(messages).toEqual(["Theme saved."]);

  flushAppPreferences.mockResolvedValueOnce(true);
  await expect(showSettingsSavedAfterPreferencesFlush("Fonts saved.")).resolves.toBe(true);
  expect(messages).toEqual(["Theme saved.", "Fonts saved."]);

  flushAppPreferences.mockResolvedValueOnce(false);
  await expect(showSettingsSavedAfterPreferencesFlush("Must not appear.")).resolves.toBe(false);
  expect(messages).toEqual(["Theme saved.", "Fonts saved."]);
});

test("toast defaults blank copy, replaces its timer, and dismisses automatically", async () => {
  let renderer;
  await act(async () => {
    renderer = create(<SettingsSaveToast />);
  });

  await act(async () => {
    window.dispatchEvent(new CustomEvent(SETTINGS_SAVED_EVENT, { detail: { message: " " } }));
  });
  expect(textContent(renderer.root)).toContain("Saved automatically.");

  await act(async () => {
    vi.advanceTimersByTime(2_300);
    window.dispatchEvent(new CustomEvent(SETTINGS_SAVED_EVENT, { detail: { message: "Project saved." } }));
  });
  expect(textContent(renderer.root)).toContain("Project saved.");

  await act(async () => {
    vi.advanceTimersByTime(2_399);
  });
  expect(textContent(renderer.root)).toContain("Project saved.");
  await act(async () => {
    vi.advanceTimersByTime(1);
  });
  expect(renderer.toJSON()).toBeNull();

  await act(async () => renderer.unmount());
  expect(removedListeners).toContain(SETTINGS_SAVED_EVENT);
});

test("toast supports immediate manual dismissal", async () => {
  let renderer;
  await act(async () => {
    renderer = create(<SettingsSaveToast />);
  });
  await act(async () => {
    window.dispatchEvent(new CustomEvent(SETTINGS_SAVED_EVENT, { detail: { message: "Saved." } }));
  });
  const dismiss = renderer.root.find(
    (node) => node.type === "button" && node.props["aria-label"] === "Dismiss saved notification",
  );
  await act(async () => dismiss.props.onClick());
  expect(renderer.toJSON()).toBeNull();
  await act(async () => renderer.unmount());
});
