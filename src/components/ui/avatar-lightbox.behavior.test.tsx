// @ts-nocheck -- react-test-renderer has no bundled types.
import { useRef } from "react";
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, createPortal: (children) => children };
});

vi.mock("@/lib/icon", () => ({
  Icon: ({ name, ...props }) => <span {...props} data-icon={name} />,
}));

import { AvatarLightbox } from "./avatar-lightbox";
import { Popover, PopoverLayersContext } from "./popover";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let renderer;
let activeElement;
let body;
let windowListeners;
let documentListeners;
let nodesByClass;

function addListener(store, type, listener, options) {
  const listeners = store.get(type) ?? [];
  listeners.push({ listener, capture: options === true || options?.capture === true });
  store.set(type, listeners);
}

function removeListener(store, type, listener, options) {
  const capture = options === true || options?.capture === true;
  store.set(
    type,
    (store.get(type) ?? []).filter(
      (entry) => entry.listener !== listener || entry.capture !== capture,
    ),
  );
}

function installDom() {
  windowListeners = new Map();
  documentListeners = new Map();
  nodesByClass = new Map();
  body = {
    nodeType: 1,
    contains: () => false,
    focus() {
      activeElement = body;
    },
  };
  activeElement = body;

  vi.stubGlobal("document", {
    body,
    get activeElement() {
      return activeElement;
    },
    addEventListener(type, listener, options) {
      addListener(documentListeners, type, listener, options);
    },
    removeEventListener(type, listener, options) {
      removeListener(documentListeners, type, listener, options);
    },
  });
  vi.stubGlobal("window", {
    innerWidth: 1280,
    innerHeight: 800,
    visualViewport: undefined,
    addEventListener(type, listener, options) {
      addListener(windowListeners, type, listener, options);
    },
    removeEventListener(type, listener, options) {
      removeListener(windowListeners, type, listener, options);
    },
  });
  vi.stubGlobal("requestAnimationFrame", (callback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
}

function makeNode(props) {
  const node = {
    nodeType: 1,
    scrollHeight: 240,
    offsetWidth: 240,
    getBoundingClientRect: () => ({
      top: 100,
      left: 200,
      right: 300,
      bottom: 132,
      width: 100,
      height: 32,
    }),
    querySelector: () => null,
    querySelectorAll: () => [],
    getClientRects: () => [{ width: 1, height: 1 }],
    hasAttribute: () => false,
    contains(target) {
      return target === node;
    },
    focus() {
      activeElement = node;
    },
  };
  if (typeof props.className === "string") {
    for (const className of props.className.split(/\s+/)) nodesByClass.set(className, node);
  }
  return node;
}

function createNodeMock(element) {
  return makeNode(element.props ?? {});
}

function hostButton(label) {
  return renderer.root.find(
    (node) => node.type === "button" && node.props["aria-label"] === label,
  );
}

function backdrop() {
  return renderer.root.find(
    (node) =>
      node.type === "div" &&
      typeof node.props.className === "string" &&
      node.props.className.includes("ui-modal-backdrop"),
  );
}

function dispatchDocument(type, target) {
  for (const { listener } of documentListeners.get(type) ?? []) listener({ target });
}

function dispatchEscape() {
  let stopped = false;
  const event = {
    key: "Escape",
    stopPropagation() {
      stopped = true;
    },
  };
  const listeners = windowListeners.get("keydown") ?? [];
  for (const { listener } of listeners.filter((entry) => entry.capture)) listener(event);
  if (stopped) return;
  for (const { listener } of listeners.filter((entry) => !entry.capture)) listener(event);
}

beforeEach(() => {
  installDom();
});

afterEach(() => {
  if (renderer) {
    act(() => renderer.unmount());
    renderer = null;
  }
  vi.unstubAllGlobals();
});

describe("AvatarLightbox nested in Popover", () => {
  test("ordinary parent re-renders do not churn layer registration", () => {
    const cleanup = vi.fn();
    const register = vi.fn(() => cleanup);
    const layers = { register, contains: () => false };

    function Scene({ revision }) {
      return (
        <PopoverLayersContext.Provider value={layers}>
          <span>{revision}</span>
          <AvatarLightbox src="/avatar.png" label="Wren">
            <span>avatar</span>
          </AvatarLightbox>
        </PopoverLayersContext.Provider>
      );
    }

    act(() => {
      renderer = create(<Scene revision={1} />, { createNodeMock });
    });
    act(() => hostButton("Enlarge Wren avatar").props.onClick());
    expect(register).toHaveBeenCalledTimes(1);
    expect(cleanup).not.toHaveBeenCalled();

    act(() => renderer.update(<Scene revision={2} />));
    expect(register).toHaveBeenCalledTimes(1);
    expect(cleanup).not.toHaveBeenCalled();

    act(() => backdrop().props.onClick());
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  test("backdrop and Escape dismiss only the lightbox and return focus to its trigger", () => {
    const popoverClose = vi.fn();

    function Scene() {
      const anchorRef = useRef(null);
      return (
        <>
          <button ref={anchorRef}>anchor</button>
          <Popover open onOpenChange={popoverClose} anchorRef={anchorRef} ariaLabel="Avatar menu">
            <AvatarLightbox src="/avatar.png" label="Wren">
              <span>avatar</span>
            </AvatarLightbox>
          </Popover>
        </>
      );
    }

    act(() => {
      renderer = create(<Scene />, { createNodeMock });
    });

    const trigger = hostButton("Enlarge Wren avatar");
    activeElement = makeNode(trigger.props);
    act(() => trigger.props.onClick());
    const firstBackdrop = backdrop();
    const backdropNode = nodesByClass.get("ui-modal-backdrop");

    act(() => dispatchDocument("mousedown", backdropNode));
    expect(popoverClose).not.toHaveBeenCalled();
    act(() => firstBackdrop.props.onClick());
    expect(popoverClose).not.toHaveBeenCalled();
    expect(renderer.root.findAllByProps({ role: "dialog" })).toHaveLength(1);

    const reopenedTrigger = hostButton("Enlarge Wren avatar");
    const triggerNode = makeNode(reopenedTrigger.props);
    activeElement = triggerNode;
    act(() => reopenedTrigger.props.onClick());
    act(() => dispatchEscape());
    expect(popoverClose).not.toHaveBeenCalled();
    expect(renderer.root.findAllByProps({ role: "dialog" })).toHaveLength(1);
    expect(activeElement).toBe(triggerNode);
  });
});
