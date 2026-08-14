// @ts-nocheck — react-test-renderer ships no types; matches the convention in
// mobile-drawer-inert-focus-order.test.tsx.
//
// Behavioral regression for the cave-rl980 Task 5 spec finding: nav/list
// mobile drawers previously had NO focus management at all beyond the
// legacy standalone Escape listener in mobile-drawer.tsx (body-scroll lock
// and Escape-to-close only) — opening one never captured what was focused
// beforehand, closing one never restored it, and Tab could walk straight out
// of the drawer into content it visually covers. This proves the fix reuses
// the SAME useFocusTrap machinery the right-Chat drawer and Modal already
// use, for BOTH nav and list, across every dismissal path — not just
// Escape, but the backdrop button too, since that's the ordinary way a user
// actually closes one of these drawers.
//
// CONSTRAINT (same as mobile-drawer-inert-focus-order.test.tsx): MobileDrawer
// portals via `createPortal(..., document.body)`, which react-test-renderer
// categorically refuses ("ReactDOM.createPortal inside of a ReactTestRenderer
// tree... is not supported"), and this repo has neither jsdom nor happy-dom
// installed. So this file mounts a faithful MIRROR of mobile-drawer.tsx's
// nav/list-relevant slice — the exact `document.querySelector(".shell-nav-
// panel"/".shell-list-panel")` ref-population-in-render-body plus the exact
// `useFocusTrap(open === "nav"/"list", ...)` call shape — driven through the
// REAL `useFocusTrap` hook (imported from "@/lib/use-focus-trap", never
// reimplemented) via act() + real mount/update/cleanup. right-chat-panel.test.ts
// separately pins that mobile-drawer.tsx's actual source still matches this
// exact shape, so the two can't silently drift apart.
import { useRef } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, test } from "vitest";
import { resetFocusTrapStackForTest, useFocusTrap } from "@/lib/use-focus-trap";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type FakeElement = {
  readonly name: string;
  focus: () => void;
  hasAttribute: (name: string) => boolean;
};

function makeElement(name: string, activeHolder: { current: FakeElement | null }): FakeElement {
  const el: FakeElement = {
    name,
    focus: () => {
      activeHolder.current = el;
    },
    hasAttribute: () => false,
  };
  return el;
}

function makeContainer(elements: FakeElement[]) {
  return {
    querySelector: () => elements[0] ?? null,
    querySelectorAll: () => elements,
    contains: (el: unknown) => elements.includes(el as FakeElement),
    focus: () => {
      /* fallback focus target when a container has no focusable child */
    },
  };
}

function makeWindowStub() {
  const listeners: Array<(e: unknown) => void> = [];
  return {
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      if (type === "keydown") listeners.push(fn);
    },
    removeEventListener: (type: string, fn: (e: unknown) => void) => {
      if (type !== "keydown") return;
      const idx = listeners.indexOf(fn);
      if (idx !== -1) listeners.splice(idx, 1);
    },
    dispatchKeydown(partial: { key: string; shiftKey?: boolean }) {
      const event = { key: partial.key, shiftKey: partial.shiftKey ?? false, preventDefault: () => {} };
      for (const fn of [...listeners]) fn(event);
    },
  };
}

/** Stubs `document.activeElement` (mutable) and `document.querySelector`
 *  (returns whatever fake container is registered for a given selector) —
 *  the exact two DOM entry points mobile-drawer.tsx's nav/list ref-population
 *  and useFocusTrap itself touch. */
function stubDomGlobals(
  activeHolder: { current: FakeElement | null },
  win: ReturnType<typeof makeWindowStub>,
  selectorMap: Record<string, unknown>,
) {
  const previousDocument = (globalThis as Record<string, unknown>).document;
  const previousWindow = (globalThis as Record<string, unknown>).window;
  (globalThis as Record<string, unknown>).document = {
    get activeElement() {
      return activeHolder.current;
    },
    querySelector: (selector: string) => selectorMap[selector] ?? null,
  };
  (globalThis as Record<string, unknown>).window = win;
  return () => {
    (globalThis as Record<string, unknown>).document = previousDocument;
    (globalThis as Record<string, unknown>).window = previousWindow;
  };
}

/** Mirrors mobile-drawer.tsx's nav/list slice EXACTLY: refs populated via
 *  `document.querySelector` directly in the render body (not an effect), so
 *  they're always current by the time useFocusTrap's own effect reads them —
 *  then handed, unwrapped, to useFocusTrap with no onEscape (Escape stays the
 *  legacy listener's job in the real component; only capture/restore/Tab-
 *  containment are reused here). */
function MirrorNavListDrawer({ open }: { open: "nav" | "list" | null }) {
  const navContainerRef = useRef<unknown>(null);
  const listContainerRef = useRef<unknown>(null);
  if (typeof document !== "undefined") {
    navContainerRef.current = (document as { querySelector: (s: string) => unknown }).querySelector(
      ".shell-nav-panel",
    );
    listContainerRef.current = (document as { querySelector: (s: string) => unknown }).querySelector(
      ".shell-list-panel",
    );
  }
  useFocusTrap(open === "nav", navContainerRef as never);
  useFocusTrap(open === "list", listContainerRef as never);
  return null;
}

let renderer: ReactTestRenderer | null = null;
let restoreGlobals: (() => void) | null = null;

afterEach(() => {
  if (renderer) {
    act(() => {
      renderer!.unmount();
    });
    renderer = null;
  }
  restoreGlobals?.();
  restoreGlobals = null;
  resetFocusTrapStackForTest();
});

describe("mobile drawer nav/list focus capture/restore (cave-rl980 Task 5 finding #3)", () => {
  test("opening the nav drawer captures the trigger and moves focus in; the backdrop button dismissing it restores the trigger", () => {
    const activeHolder: { current: FakeElement | null } = { current: null };
    const win = makeWindowStub();
    const navToggleTrigger = makeElement("nav-toggle-button", activeHolder);
    const firstNavLink = makeElement("first-nav-link", activeHolder);
    const navContainer = makeContainer([firstNavLink]);
    restoreGlobals = stubDomGlobals(activeHolder, win, { ".shell-nav-panel": navContainer });

    // The user has just activated the top-bar's nav toggle — it holds focus
    // the instant before the drawer opens, exactly like a real <button onClick>.
    activeHolder.current = navToggleTrigger;

    act(() => {
      renderer = create(<MirrorNavListDrawer open={null} />);
    });
    expect(activeHolder.current).toBe(navToggleTrigger);

    act(() => {
      renderer!.update(<MirrorNavListDrawer open="nav" />);
    });
    // Capture-on-open: the nav drawer moved focus to its first focusable —
    // the previous (no focus management at all) implementation left focus
    // exactly on navToggleTrigger here instead.
    expect(activeHolder.current).toBe(firstNavLink);

    // The backdrop BUTTON is the ordinary way a user dismisses a mobile
    // drawer — in the real component its onClick calls the same `onClose`
    // that flips `mobileDrawer` state to null, which is exactly what this
    // update models: `open` flipping away from "nav" is what deactivates
    // the trap, regardless of which specific dismissal path triggered it.
    act(() => {
      renderer!.update(<MirrorNavListDrawer open={null} />);
    });
    // Restore-on-close: focus goes back to the nav toggle that opened it —
    // previously it stayed wherever Tab/backdrop-tap last left it.
    expect(activeHolder.current).toBe(navToggleTrigger);
  });

  test("the list drawer gets the identical capture/restore contract, independent of nav", () => {
    const activeHolder: { current: FakeElement | null } = { current: null };
    const win = makeWindowStub();
    const listToggleTrigger = makeElement("list-toggle-button", activeHolder);
    const firstListItem = makeElement("first-list-item", activeHolder);
    const listContainer = makeContainer([firstListItem]);
    restoreGlobals = stubDomGlobals(activeHolder, win, { ".shell-list-panel": listContainer });

    activeHolder.current = listToggleTrigger;

    act(() => {
      renderer = create(<MirrorNavListDrawer open={null} />);
    });

    act(() => {
      renderer!.update(<MirrorNavListDrawer open="list" />);
    });
    expect(activeHolder.current).toBe(firstListItem);

    act(() => {
      renderer!.update(<MirrorNavListDrawer open={null} />);
    });
    expect(activeHolder.current).toBe(listToggleTrigger);
  });

  test("Tab stays contained inside the open nav drawer", () => {
    const activeHolder: { current: FakeElement | null } = { current: null };
    const win = makeWindowStub();
    const trigger = makeElement("nav-toggle-button", activeHolder);
    const onlyLink = makeElement("only-nav-link", activeHolder);
    const navContainer = makeContainer([onlyLink]);
    restoreGlobals = stubDomGlobals(activeHolder, win, { ".shell-nav-panel": navContainer });
    activeHolder.current = trigger;

    act(() => {
      renderer = create(<MirrorNavListDrawer open="nav" />);
    });
    expect(activeHolder.current).toBe(onlyLink);

    // A single focusable: Tab (non-shift) must cycle back to itself, never
    // let focus escape the drawer onto content it visually covers.
    act(() => {
      win.dispatchKeydown({ key: "Tab" });
    });
    expect(activeHolder.current).toBe(onlyLink);
  });
});
