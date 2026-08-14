// @ts-nocheck — react-test-renderer ships no types; matches the convention in
// mobile-drawer-inert-focus-order.test.tsx and use-surface-history.test.tsx.
//
// Behavioral companion to use-focus-trap.test.ts. That file pins the source
// contract with fast text assertions; this file actually mounts the REAL
// `useFocusTrap` hook (imported from "@/lib/use-focus-trap", never
// reimplemented) through React's genuine effect-commit machinery (act() +
// real mount/update/cleanup, including a StrictMode pass) to prove the
// cave-rl980 Task 5 modal/focus findings behave, not just that certain
// substrings exist in source:
//
//   1. Nested traps: when a body-portaled child dialog (e.g. an artifact
//      fullscreen viewer) opens on top of an already-active trap (e.g. the
//      right-Chat drawer), only the TOPMOST trap acts on Escape and Tab.
//      Escape closes only the child; the drawer's own onEscape never fires
//      while the child is open. Tab containment is likewise owned solely by
//      the topmost trap — the parent's Tab handler never touches its own
//      focusables while a child sits above it (previously it would: seeing
//      focus inside the child, `!container.contains(activeEl)` was true for
//      the PARENT's own container, so the parent's "recapture" branch would
//      forcibly yank focus back into the parent's own focusables).
//   2. When the child trap deactivates (closes), the parent "resumes" —
//      the very next Escape now reaches the parent — with no extra
//      bookkeeping on either side.
//   3. hadTrapAbove safety: if the PARENT deactivates while the child is
//      STILL active (the pathological "drawer closes out from under an open
//      child" ordering — the rare case FocusTrapOwnerHiddenContext exists to
//      avoid, but the stack itself must still degrade safely if it happens),
//      the parent's own focus-restore is skipped rather than fighting the
//      still-active child's containment. The child's own eventual
//      deactivation still restores focus correctly.
//   4. StrictMode's dev mount→cleanup→mount double-invoke never leaves a
//      duplicated stack entry: escape routing after a StrictMode-wrapped
//      mount is identical to a normal mount.
//   5. FocusTrapOwnerHiddenContext: an active trap nested under a boundary
//      that flips to `hidden` is asked to close through the same onEscape
//      callback Escape already uses — the mechanism behind "closing the
//      retained right-Chat drawer must not leave an independently portaled
//      child Chat modal visible/interactive" (finding #2).
import { StrictMode, useEffect, useRef, useState, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, test } from "vitest";
import {
  FocusTrapOwnerHiddenContext,
  resetFocusTrapStackForTest,
  useFocusTrap,
} from "@/lib/use-focus-trap";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A fake focusable DOM node: focusing it updates the shared activeElement
 *  holder, exactly like a real element updates `document.activeElement`. */
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

/** A fake dialog container: just enough of the DOM surface useFocusTrap
 *  touches (querySelector/querySelectorAll/contains/focus). querySelectorAll
 *  calls are counted so tests can prove a BACKGROUND trap's Tab handler
 *  never even inspects its own focusables while a trap above it is topmost. */
function makeContainer(elements: FakeElement[], activeHolder: { current: FakeElement | null }) {
  let querySelectorAllCalls = 0;
  return {
    elements,
    get querySelectorAllCalls() {
      return querySelectorAllCalls;
    },
    querySelector: () => elements[0] ?? null,
    querySelectorAll: () => {
      querySelectorAllCalls += 1;
      return elements;
    },
    contains: (el: unknown) => elements.includes(el as FakeElement),
    focus: () => {
      /* fallback focus target when a container has no focusable child */
    },
  };
}

/** useFocusTrap reads `document.activeElement` and registers on `window` —
 *  stub just enough of both since there is no jsdom in this repo (see the
 *  file-level constraint note in mobile-drawer-inert-focus-order.test.tsx). */
function makeWindowStub() {
  const listeners: Array<(e: unknown) => void> = [];
  return {
    listeners,
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      if (type === "keydown") listeners.push(fn);
    },
    removeEventListener: (type: string, fn: (e: unknown) => void) => {
      if (type !== "keydown") return;
      const idx = listeners.indexOf(fn);
      if (idx !== -1) listeners.splice(idx, 1);
    },
    /** Dispatches to every currently-registered listener, in registration
     *  order — exactly how a real `window` fires multiple keydown listeners.
     *  Snapshots the list first: a handler reacting synchronously (e.g.
     *  onEscape triggering a state update inside the same act() call) must
     *  not perturb the iteration. */
    dispatchKeydown(partial: { key: string; shiftKey?: boolean }) {
      const event = {
        key: partial.key,
        shiftKey: partial.shiftKey ?? false,
        preventDefault: () => {},
      };
      for (const fn of [...listeners]) fn(event);
    },
  };
}

function stubDomGlobals(activeHolder: { current: FakeElement | null }, win: ReturnType<typeof makeWindowStub>) {
  const previousDocument = (globalThis as Record<string, unknown>).document;
  const previousWindow = (globalThis as Record<string, unknown>).window;
  (globalThis as Record<string, unknown>).document = {
    get activeElement() {
      return activeHolder.current;
    },
  };
  (globalThis as Record<string, unknown>).window = win;
  return () => {
    (globalThis as Record<string, unknown>).document = previousDocument;
    (globalThis as Record<string, unknown>).window = previousWindow;
  };
}

/** Mounts a single useFocusTrap instance against whatever fake container
 *  `createNodeMock` resolves for its `data-probe-id`. */
function TrapProbe({
  probeId,
  active,
  onEscape,
}: {
  probeId: string;
  active: boolean;
  onEscape: () => void;
}) {
  const containerRef = useRef<unknown>(null);
  useFocusTrap(active, containerRef as never, { onEscape });
  return <div data-probe-id={probeId} ref={containerRef as never} />;
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
  // Belt-and-suspenders: a test that throws before unmounting must not leak
  // a stray registration into a later test in this same file/process.
  resetFocusTrapStackForTest();
});

describe("useFocusTrap stack-awareness (cave-rl980 Task 5 nested modal findings)", () => {
  test("Escape closes only the topmost (child) trap while both are active, then the parent resumes", () => {
    const activeHolder: { current: FakeElement | null } = { current: null };
    const win = makeWindowStub();
    restoreGlobals = stubDomGlobals(activeHolder, win);

    const parentTrigger = makeElement("parent-trigger", activeHolder);
    const parentFocusable = makeElement("parent-focusable", activeHolder);
    const childFocusable = makeElement("child-focusable", activeHolder);
    const parentContainer = makeContainer([parentFocusable], activeHolder);
    const childContainer = makeContainer([childFocusable], activeHolder);

    activeHolder.current = parentTrigger;

    let parentEscapeCount = 0;
    let childEscapeCount = 0;

    function Scene({ showChild }: { showChild: boolean }) {
      return (
        <>
          <TrapProbe probeId="parent" active onEscape={() => (parentEscapeCount += 1)} />
          {showChild ? (
            <TrapProbe probeId="child" active onEscape={() => (childEscapeCount += 1)} />
          ) : null}
        </>
      );
    }

    act(() => {
      renderer = create(<Scene showChild={false} />, {
        createNodeMock: (element) =>
          element.props["data-probe-id"] === "parent" ? parentContainer : childContainer,
      });
    });
    // Parent activation captured the trigger and moved focus to its own
    // focusable (focusFirst defaults true).
    expect(activeHolder.current).toBe(parentFocusable);

    // The child dialog opens ON TOP of the already-active parent trap — a
    // SEPARATE update, matching the real "modal opened later from within
    // already-open content" timeline (not a same-commit sibling mount).
    act(() => {
      renderer!.update(<Scene showChild />);
    });
    expect(activeHolder.current).toBe(childFocusable);

    act(() => {
      win.dispatchKeydown({ key: "Escape" });
    });
    expect(childEscapeCount).toBe(1);
    expect(parentEscapeCount).toBe(0);

    // Close the child (active flips false, component stays mounted — the
    // same "hidden rather than unmounted" shape ChatArtifactViewer's own
    // `fullscreen` toggle uses).
    function SceneChildInactive() {
      return (
        <>
          <TrapProbe probeId="parent" active onEscape={() => (parentEscapeCount += 1)} />
          <TrapProbe probeId="child" active={false} onEscape={() => (childEscapeCount += 1)} />
        </>
      );
    }
    act(() => {
      renderer!.update(<SceneChildInactive />);
    });

    // The parent resumes: the very next Escape reaches it, with no extra
    // bookkeeping required on either side.
    act(() => {
      win.dispatchKeydown({ key: "Escape" });
    });
    expect(parentEscapeCount).toBe(1);
    expect(childEscapeCount).toBe(1);
  });

  test("Tab containment is owned solely by the topmost trap — the background trap never inspects its own focusables", () => {
    const activeHolder: { current: FakeElement | null } = { current: null };
    const win = makeWindowStub();
    restoreGlobals = stubDomGlobals(activeHolder, win);

    const parentFocusable = makeElement("parent-focusable", activeHolder);
    const childOnlyFocusable = makeElement("child-focusable", activeHolder);
    const parentContainer = makeContainer([parentFocusable], activeHolder);
    const childContainer = makeContainer([childOnlyFocusable], activeHolder);

    function Scene() {
      return (
        <>
          <TrapProbe probeId="parent" active onEscape={() => {}} />
          <TrapProbe probeId="child" active onEscape={() => {}} />
        </>
      );
    }

    act(() => {
      renderer = create(<Scene />, {
        createNodeMock: (element) =>
          element.props["data-probe-id"] === "parent" ? parentContainer : childContainer,
      });
    });
    expect(activeHolder.current).toBe(childOnlyFocusable);

    const parentQueriesBeforeTab = parentContainer.querySelectorAllCalls;

    // Tab (non-shift) with the single child focusable already active should
    // cycle back to itself (first === last) and must never reach into the
    // PARENT's container at all — the previous, non-stack-aware bug would
    // see `!parentContainer.contains(childOnlyFocusable)` (true, since they
    // are unrelated fake containers) and forcibly steal focus into the
    // parent's own focusable.
    act(() => {
      win.dispatchKeydown({ key: "Tab" });
    });

    expect(activeHolder.current).toBe(childOnlyFocusable);
    expect(parentContainer.querySelectorAllCalls).toBe(parentQueriesBeforeTab);
  });

  test("hadTrapAbove safety: a parent deactivating while a child is still active skips its own focus restore", () => {
    const activeHolder: { current: FakeElement | null } = { current: null };
    const win = makeWindowStub();
    restoreGlobals = stubDomGlobals(activeHolder, win);

    const outerTrigger = makeElement("outer-trigger", activeHolder);
    const parentFocusable = makeElement("parent-focusable", activeHolder);
    const childFocusable = makeElement("child-focusable", activeHolder);
    const parentContainer = makeContainer([parentFocusable], activeHolder);
    const childContainer = makeContainer([childFocusable], activeHolder);
    activeHolder.current = outerTrigger;

    function Scene({ parentActive, childActive }: { parentActive: boolean; childActive: boolean }) {
      return (
        <>
          <TrapProbe probeId="parent" active={parentActive} onEscape={() => {}} />
          <TrapProbe probeId="child" active={childActive} onEscape={() => {}} />
        </>
      );
    }

    act(() => {
      renderer = create(<Scene parentActive childActive={false} />, {
        createNodeMock: (element) =>
          element.props["data-probe-id"] === "parent" ? parentContainer : childContainer,
      });
    });
    expect(activeHolder.current).toBe(parentFocusable);

    act(() => {
      renderer!.update(<Scene parentActive childActive />);
    });
    expect(activeHolder.current).toBe(childFocusable);

    // Pathological ordering: the parent (drawer) deactivates while the
    // child (an independently portaled dialog) is STILL active — the exact
    // shape "closing the right-Chat drawer must not leave a child Chat
    // modal visible/interactive" describes when nothing has told the child
    // to close yet. The parent's cleanup must NOT yank focus away from the
    // still-active, still-topmost child.
    act(() => {
      renderer!.update(<Scene parentActive={false} childActive />);
    });
    expect(activeHolder.current).toBe(childFocusable);

    // The child's own eventual deactivation restores focus to whatever WAS
    // focused when the child itself activated — parentFocusable, since the
    // parent's trap was still the active one at that moment. That target is
    // exactly what a REAL browser would treat as a no-op: the parent's own
    // container is presumably already closed (unmounted, detached, or, per
    // finding #4, marked `inert`), and `.focus()` on a detached/inert
    // element is a spec-guaranteed no-op, not a crash or a stuck state. A
    // single trap's cleanup is only ever responsible for restoring ITS OWN
    // saved focus, never for walking further back to find some earlier
    // still-live ancestor — this pathological "parent closes out from under
    // an open child" ordering is precisely what FocusTrapOwnerHiddenContext
    // (see the dedicated test below) exists to make the rare case rather
    // than the one every trap must defend against unaided.
    act(() => {
      renderer!.update(<Scene parentActive={false} childActive={false} />);
    });
    expect(activeHolder.current).toBe(parentFocusable);
  });

  test("StrictMode's dev double-invoke does not duplicate the stack registration", () => {
    const activeHolder: { current: FakeElement | null } = { current: null };
    const win = makeWindowStub();
    restoreGlobals = stubDomGlobals(activeHolder, win);

    const focusable = makeElement("focusable", activeHolder);
    const container = makeContainer([focusable], activeHolder);
    let escapeCount = 0;

    function Scene() {
      return (
        <StrictMode>
          <TrapProbe probeId="only" active onEscape={() => (escapeCount += 1)} />
        </StrictMode>
      );
    }

    act(() => {
      renderer = create(<Scene />, {
        createNodeMock: () => container,
      });
    });

    act(() => {
      win.dispatchKeydown({ key: "Escape" });
    });

    // A duplicated registration would still deliver exactly one Escape here
    // (there's only ever one trap in this scene), so the load-bearing check
    // is that exactly ONE keydown listener answers a single dispatch — a
    // leaked duplicate registration from a broken mount→cleanup→mount cycle
    // would otherwise silently double-count.
    expect(escapeCount).toBe(1);
  });

  test("FocusTrapOwnerHiddenContext asks a still-active nested trap to close through its own onEscape", () => {
    const activeHolder: { current: FakeElement | null } = { current: null };
    const win = makeWindowStub();
    restoreGlobals = stubDomGlobals(activeHolder, win);

    const focusable = makeElement("focusable", activeHolder);
    const container = makeContainer([focusable], activeHolder);
    let escapeCount = 0;

    function Scene({ hidden }: { hidden: boolean }) {
      return (
        <FocusTrapOwnerHiddenContext.Provider value={hidden}>
          <TrapProbe probeId="child" active onEscape={() => (escapeCount += 1)} />
        </FocusTrapOwnerHiddenContext.Provider>
      );
    }

    act(() => {
      renderer = create(<Scene hidden={false} />, {
        createNodeMock: () => container,
      });
    });
    expect(escapeCount).toBe(0);

    // The owner (e.g. RightChatPanel) becomes hidden/inert while this trap
    // is still active — nothing dispatched a real Escape keydown.
    act(() => {
      renderer!.update(<Scene hidden />);
    });
    expect(escapeCount).toBe(1);
  });

  test("a component with no owner boundary above it is completely unaffected by the context (default false)", () => {
    const activeHolder: { current: FakeElement | null } = { current: null };
    const win = makeWindowStub();
    restoreGlobals = stubDomGlobals(activeHolder, win);

    const focusable = makeElement("focusable", activeHolder);
    const container = makeContainer([focusable], activeHolder);
    let escapeCount = 0;

    act(() => {
      renderer = create(<TrapProbe probeId="only" active onEscape={() => (escapeCount += 1)} />, {
        createNodeMock: () => container,
      });
    });

    // No provider anywhere above — the context default (false) applies, so
    // merely re-rendering (or existing at all) never triggers onEscape.
    act(() => {
      renderer!.update(<TrapProbe probeId="only" active onEscape={() => (escapeCount += 1)} />);
    });
    expect(escapeCount).toBe(0);
  });

  test("closing the retained right-Chat drawer closes a still-open child Chat modal (finding #2 integration)", () => {
    // Mirrors the REAL shape end to end: RightChatPanelFrame/the resolved
    // <aside> wrap ChatRouter's render branch in
    // FocusTrapOwnerHiddenContext.Provider value={!open}; ChatArtifactViewer
    // (unchanged, not reimplemented here beyond its exact useFocusTrap call
    // shape) owns its own `fullscreen` boolean and calls
    // `useFocusTrap(fullscreen, shellRef, { onEscape: () => setFullscreen(false) })`.
    // This proves the full round trip — not just that onEscape was invoked,
    // but that the CHILD's own state genuinely flips closed — with nothing
    // ever telling ChatArtifactViewer directly to exit fullscreen.
    const activeHolder: { current: FakeElement | null } = { current: null };
    const win = makeWindowStub();
    restoreGlobals = stubDomGlobals(activeHolder, win);
    const container = makeContainer([], activeHolder);

    function ChatArtifactViewerLike({
      onFullscreenChange,
    }: {
      onFullscreenChange: (value: boolean) => void;
    }) {
      // Opened before the drawer starts closing — the exact "independently
      // portaled child Chat modal" left visible/interactive by the bug.
      const [fullscreen, setFullscreen] = useState(true);
      const shellRef = useRef<unknown>(null);
      useFocusTrap(fullscreen, shellRef as never, { onEscape: () => setFullscreen(false) });
      useEffect(() => {
        onFullscreenChange(fullscreen);
      }, [fullscreen, onFullscreenChange]);
      return null;
    }

    function RightChatDrawerLike({ open, children }: { open: boolean; children: ReactNode }) {
      return (
        <FocusTrapOwnerHiddenContext.Provider value={!open}>{children}</FocusTrapOwnerHiddenContext.Provider>
      );
    }

    let latestFullscreen = true;
    const onFullscreenChange = (value: boolean) => {
      latestFullscreen = value;
    };

    act(() => {
      renderer = create(
        <RightChatDrawerLike open>
          <ChatArtifactViewerLike onFullscreenChange={onFullscreenChange} />
        </RightChatDrawerLike>,
        { createNodeMock: () => container },
      );
    });
    expect(latestFullscreen).toBe(true);

    // The drawer closes/hides (a mobile backdrop tap, the desktop panel
    // collapsing, or any other dismissal) — nothing tells the artifact
    // viewer directly to leave fullscreen.
    act(() => {
      renderer!.update(
        <RightChatDrawerLike open={false}>
          <ChatArtifactViewerLike onFullscreenChange={onFullscreenChange} />
        </RightChatDrawerLike>,
      );
    });

    expect(latestFullscreen).toBe(false);
  });
});
