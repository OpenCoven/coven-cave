// @ts-nocheck — this is a rendered primitive interaction test. The app's
// focused component suite uses react-test-renderer under Vitest's Node
// environment, so the portal is represented in the renderer tree while the
// DOM APIs reached by Popover are supplied by this small harness.
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    // React test renderer cannot mount a real DOM portal. Keeping the portal
    // children in the rendered tree still exercises both primitives and the
    // same event-handler ordering as the browser.
    createPortal: (children) => children,
  };
});

vi.mock("@/lib/icon", () => ({
  Icon: ({ name, ...props }) => <span {...props} data-icon={name} />,
}));

import { OverflowMenu } from "./overflow-menu";
import { PopoverItem, PopoverSubmenu } from "./popover";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let renderer;
let activeElement;
let body;
let frames;
let windowListeners;
let documentListeners;
let nodeRecords;
const interactiveNodes = new WeakMap();

function textOf(value) {
  if (value === null || value === undefined || typeof value === "boolean") return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(textOf).join("");
  return textOf(value.props?.children);
}

function makeNode(props) {
  const node = {
    nodeType: 1,
    disabled: Boolean(props.disabled),
    getAttribute(name) {
      const value = props[name];
      return value === undefined || value === null ? null : String(value);
    },
    closest() {
      return node;
    },
    getBoundingClientRect() {
      return { top: 100, left: 200, right: 300, bottom: 132, width: 100, height: 32 };
    },
    offsetWidth: 240,
    scrollHeight: 240,
    focus() {
      activeElement = node;
    },
    contains(target) {
      return target === node;
    },
  };
  nodeRecords.push({ node, props });
  return node;
}

function enabledMenuNodes() {
  return renderer.root
    .findAll(
      (node) =>
        typeof node.type === "string" &&
        node.type === "button" &&
        ["menuitem", "menuitemradio", "menuitemcheckbox"].includes(node.props.role),
    )
    .filter((node) => !node.props.disabled && node.props["aria-disabled"] !== "true")
    .map(eventNodeFor);
}

function eventNodeFor(testNode) {
  const previous = interactiveNodes.get(testNode);
  if (previous) return previous;
  const props = testNode.props;
  const node = {
    nodeType: 1,
    disabled: Boolean(props.disabled),
    getAttribute(name) {
      const value = props[name];
      return value === undefined || value === null ? null : String(value);
    },
    closest() {
      return node;
    },
    focus() {
      activeElement = node;
    },
  };
  interactiveNodes.set(testNode, node);
  return node;
}

function installDom() {
  frames = [];
  windowListeners = new Map();
  documentListeners = new Map();
  nodeRecords = [];
  body = {
    nodeType: 1,
    contains: () => false,
    focus() {
      activeElement = body;
    },
  };
  activeElement = body;

  const addListener = (store, type, listener) => {
    const listeners = store.get(type) ?? new Set();
    listeners.add(listener);
    store.set(type, listeners);
  };
  const removeListener = (store, type, listener) => {
    store.get(type)?.delete(listener);
  };
  const documentStub = {
    body,
    get activeElement() {
      return activeElement;
    },
    addEventListener(type, listener) {
      addListener(documentListeners, type, listener);
    },
    removeEventListener(type, listener) {
      removeListener(documentListeners, type, listener);
    },
  };
  const windowStub = {
    innerWidth: 1280,
    innerHeight: 800,
    visualViewport: undefined,
    addEventListener(type, listener) {
      addListener(windowListeners, type, listener);
    },
    removeEventListener(type, listener) {
      removeListener(windowListeners, type, listener);
    },
    setTimeout,
    clearTimeout,
  };
  const requestAnimationFrame = (callback) => {
    frames.push(callback);
    return frames.length;
  };
  const cancelAnimationFrame = (id) => {
    frames[id - 1] = null;
  };

  vi.stubGlobal("document", documentStub);
  vi.stubGlobal("window", windowStub);
  vi.stubGlobal("requestAnimationFrame", requestAnimationFrame);
  vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrame);
}

function flushFrames() {
  let pending;
  while ((pending = frames.splice(0)).length > 0) {
    for (const callback of pending) callback?.(0);
  }
}

function createNodeMock(element) {
  const node = makeNode(element.props ?? {});
  if (
    typeof element.type === "string" &&
    element.props?.className?.includes("ui-popover-submenu")
  ) {
    node.querySelector = () => {
      const first = findButton("First submenu item");
      return first ? eventNodeFor(first) : null;
    };
  }
  if (
    typeof element.type === "string" &&
    element.props?.onClick &&
    element.props?.onKeyDown
  ) {
    node.querySelectorAll = () => enabledMenuNodes();
  }
  return node;
}

function mountMenu(onFirstSelect = vi.fn()) {
  act(() => {
    renderer = create(
      <OverflowMenu ariaLabel="More actions">
        <PopoverItem onSelect={() => undefined}>Ordinary action</PopoverItem>
        <PopoverSubmenu label="Choose priority">
          <PopoverItem checked onSelect={onFirstSelect}>
            First submenu item
          </PopoverItem>
          <PopoverItem onSelect={() => undefined}>Second submenu item</PopoverItem>
        </PopoverSubmenu>
      </OverflowMenu>,
      { createNodeMock },
    );
  });
  return renderer;
}

function hostButtons() {
  return renderer.root.findAll(
    (node) => typeof node.type === "string" && node.type === "button",
  );
}

function findButton(label) {
  return hostButtons().find((node) => textOf(node.props.children) === label);
}

function findOverflowTrigger() {
  return hostButtons().find((node) => node.props["aria-label"] === "More actions");
}

function menuClickBoundary() {
  return renderer.root.find(
    (node) =>
      typeof node.type === "string" &&
      node.type === "div" &&
      typeof node.props.onClick === "function" &&
      typeof node.props.onKeyDown === "function",
  );
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

describe("OverflowMenu + PopoverSubmenu", () => {
  test("a submenu trigger opens its first item by click without closing the parent", () => {
    const selected = vi.fn();
    mountMenu(selected);

    const overflow = findOverflowTrigger();
    expect(overflow).toBeTruthy();
    act(() => overflow.props.onClick());

    const submenu = renderer.root.find(
      (node) =>
        typeof node.type === "string" &&
        node.type === "button" &&
        node.props.className?.includes("ui-popover-subtrigger"),
    );
    const submenuNode = eventNodeFor(submenu);

    // A browser dispatches the submenu handler first, then bubbles the same
    // click to OverflowMenu's body boundary. Model that ordering explicitly.
    act(() => {
      submenu.props.onClick();
      menuClickBoundary().props.onClick({ target: submenuNode });
      flushFrames();
    });

    expect(findOverflowTrigger().props["aria-expanded"]).toBe(true);
    const first = findButton("First submenu item");
    expect(first).toBeTruthy();
    expect(first.props.role).toBe("menuitemradio");

    const firstNode = eventNodeFor(first);
    act(() => {
      first.props.onClick();
      menuClickBoundary().props.onClick({ target: firstNode });
      flushFrames();
    });

    expect(selected).toHaveBeenCalledTimes(1);
    expect(findOverflowTrigger().props["aria-expanded"]).toBe(false);
    expect(activeElement.getAttribute("aria-label")).toBe("More actions");
  });

  test("keyboard opening and Escape keep the submenu focus contract intact", () => {
    mountMenu();
    const overflow = findOverflowTrigger();

    act(() => {
      overflow.props.onKeyDown({
        key: "ArrowDown",
        preventDefault() {},
        stopPropagation() {},
      });
    });
    act(() => flushFrames());
    expect(activeElement).not.toBe(body);
    expect(findButton("Ordinary action")).toBeTruthy();

    const submenu = renderer.root.find(
      (node) =>
        typeof node.type === "string" &&
        node.type === "button" &&
        node.props.className?.includes("ui-popover-subtrigger"),
    );
    act(() => {
      submenu.props.onKeyDown({
        key: "ArrowRight",
        preventDefault() {},
        stopPropagation() {},
      });
    });
    act(() => flushFrames());
    expect(findButton("First submenu item")).toBeTruthy();

    const rootEscape = [...windowListeners.get("keydown")][0];
    act(() =>
      rootEscape({
        key: "Escape",
        stopPropagation() {},
        stopImmediatePropagation() {},
      }),
    );
    expect(findButton("First submenu item")).toBeUndefined();
    expect(findButton("Choose priority")).toBeTruthy();

    // With no focused descendant left, the root Popover still owns the next
    // Escape and returns focus to its overflow trigger when it closes.
    activeElement = body;
    act(() =>
      rootEscape({
        key: "Escape",
        stopPropagation() {},
        stopImmediatePropagation() {},
      }),
    );
    expect(findOverflowTrigger().props["aria-expanded"]).toBe(false);
    expect(activeElement.getAttribute("aria-label")).toBe("More actions");
  });

  test("ordinary menuitem clicks still close the parent menu", () => {
    mountMenu();
    const overflow = findOverflowTrigger();
    act(() => overflow.props.onClick());
    expect(findButton("Ordinary action")).toBeTruthy();

    const ordinary = findButton("Ordinary action");
    const ordinaryNode = eventNodeFor(ordinary);
    act(() => {
      ordinary.props.onClick();
      menuClickBoundary().props.onClick({ target: ordinaryNode });
      flushFrames();
    });

    expect(findOverflowTrigger().props["aria-expanded"]).toBe(false);
    expect(activeElement.getAttribute("aria-label")).toBe("More actions");
  });
});
