// @ts-nocheck — react-test-renderer ships no types; matches the convention in
// right-chat-panel-behavior.test.tsx and chat-router-removal-race.test.tsx.
//
// Behavioral regression for the cave-rl980 Task 5 spec finding: background
// inert must be cleared before useFocusTrap restores focus to the shell
// toggle that opened the mobile right-Chat drawer.
//
// CONSTRAINT (why this isn't a full MobileDrawer render): MobileDrawer's
// backdrop/modal both mount via `createPortal(..., document.body)`, and
// react-dom's `createPortal` refuses any container without a real DOM
// `nodeType` ("Target container is not a DOM element") — a check that runs
// before react-test-renderer's own tree is ever touched. react-test-renderer
// additionally refuses a `createPortal` call inside its tree outright
// ("ReactDOM.createPortal inside of a ReactTestRenderer tree... is not
// supported"), independent of the container check. This repo has neither
// jsdom nor happy-dom installed (grep the lockfile: both are optional peers
// of vitest with no resolved package), so there is no way to mount a real
// `document`/DOM tree for MobileDrawer itself today — that lands with the
// real browser wiring in Task 6. Verified empirically against this repo's
// exact react-dom/react-test-renderer versions before writing this file.
//
// What IS genuinely testable without jsdom: the ordering contract itself.
// react-test-renderer's `createNodeMock` lets a host ref resolve to any
// plain object, so this file mounts the REAL `useFocusTrap` hook (imported
// from "@/lib/use-focus-trap", not reimplemented) alongside a mirrored copy
// of mobile-drawer.tsx's shell-inert effect, in the same relative
// declaration order production code uses, and drives it through React's
// actual effect-commit machinery (act() + real mount/update/cleanup) rather
// than hand-simulating what "should" happen. It proves two things a regex
// match on source text cannot:
//   1. React truly does run a component's passive-effect cleanups in
//      top-down declaration order (not reversed) — verified here against
//      the live React runtime, not asserted as a fact about React.
//   2. Given that real ordering, the FIXED declaration order (inert effect
//      before useFocusTrap) makes the shell already non-inert at the moment
//      focus is restored, while the ORIGINAL buggy order (useFocusTrap
//      before the inert effect) restores focus while the shell is still
//      inert — reproducing the exact defect this task fixes.
// shell-drawer-smoke.test.ts separately pins that mobile-drawer.tsx's real
// source still declares the effects in the order mirrored below, so the two
// files can't silently drift apart.
import { useEffect, useRef } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, test } from "vitest";
import { useFocusTrap } from "@/lib/use-focus-trap";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Order = string[];

/** Stands in for `.shell-frame` — a plain object with an `inert` flag,
 * exactly like the real DOM property mobile-drawer.tsx toggles. */
function makeShell() {
  return { inert: false };
}

/** Stands in for the shell toggle button that opened the drawer and should
 * regain focus on close. Records, at the moment `.focus()` actually fires,
 * whatever `shell.inert` currently is — that observation IS the regression
 * check: a correct ordering observes `false`, the bug observes `true`. */
function makeTrigger(shell: { inert: boolean }, order: Order) {
  return {
    focus() {
      order.push(`trigger:focus(shellInert=${shell.inert})`);
    },
  };
}

/** A container ref target with no focusable descendants, so useFocusTrap's
 * activate-time `focusFirst` fallback focuses the container itself instead
 * — harmless and orthogonal to the deactivate-time regression under test. */
function makeContainer(order: Order) {
  return {
    querySelector: () => null,
    focus: () => order.push("container:focus"),
  };
}

/** useFocusTrap registers its Tab/Escape keydown listener on `window` —
 * stub just enough of it (add/removeEventListener) since there is no jsdom
 * `window` in this repo's test environment (see the file-level constraint
 * note above). */
function makeWindow() {
  return {
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}

/** Mirrors mobile-drawer.tsx's FIXED effect order: the shell-inert effect is
 * declared BEFORE useFocusTrap(...), so its cleanup (clearing `shell.inert`)
 * runs before useFocusTrap's own cleanup (which restores focus). */
function FixedOrderDrawer({
  active,
  shell,
  order,
}: {
  active: boolean;
  shell: { inert: boolean };
  order: Order;
}) {
  const containerRef = useRef<unknown>(null);

  useEffect(() => {
    if (!active) return;
    const prevInert = shell.inert;
    shell.inert = true;
    order.push("inert:set(true)");
    return () => {
      shell.inert = prevInert;
      order.push(`inert:cleanup(restored=${prevInert})`);
    };
  }, [active]);

  useFocusTrap(active, containerRef as never, {});

  return <div ref={containerRef as never} />;
}

/** Mirrors the ORIGINAL buggy order this task fixes: useFocusTrap declared
 * BEFORE the shell-inert effect, so its cleanup (focus restore) runs first,
 * while the shell is still inert. */
function BuggyOrderDrawer({
  active,
  shell,
  order,
}: {
  active: boolean;
  shell: { inert: boolean };
  order: Order;
}) {
  const containerRef = useRef<unknown>(null);

  useFocusTrap(active, containerRef as never, {});

  useEffect(() => {
    if (!active) return;
    const prevInert = shell.inert;
    shell.inert = true;
    order.push("inert:set(true)");
    return () => {
      shell.inert = prevInert;
      order.push(`inert:cleanup(restored=${prevInert})`);
    };
  }, [active]);

  return <div ref={containerRef as never} />;
}

let renderer: ReactTestRenderer | null = null;
let restoreGlobals: (() => void) | null = null;

/** Stubs the minimal `document`/`window` surface useFocusTrap touches, and
 * returns a restore function. See the file-level constraint note: no jsdom
 * exists in this repo's test environment, so these are plain object stubs,
 * not a real DOM. */
function stubDomGlobals(trigger: unknown) {
  const previousDocument = (globalThis as Record<string, unknown>).document;
  const previousWindow = (globalThis as Record<string, unknown>).window;
  (globalThis as Record<string, unknown>).document = { activeElement: trigger };
  (globalThis as Record<string, unknown>).window = makeWindow();
  return () => {
    (globalThis as Record<string, unknown>).document = previousDocument;
    (globalThis as Record<string, unknown>).window = previousWindow;
  };
}

afterEach(() => {
  if (renderer) {
    act(() => {
      renderer!.unmount();
    });
    renderer = null;
  }
  restoreGlobals?.();
  restoreGlobals = null;
});

describe("mobile drawer background-inert / focus-trap cleanup ordering", () => {
  test("FIXED order: inert clears before focus is restored to the shell toggle", () => {
    const order: Order = [];
    const shell = makeShell();
    const trigger = makeTrigger(shell, order);
    const container = makeContainer(order);
    restoreGlobals = stubDomGlobals(trigger);

    act(() => {
      renderer = create(<FixedOrderDrawer active shell={shell} order={order} />, {
        createNodeMock: () => container,
      });
    });
    expect(shell.inert).toBe(true);

    act(() => {
      renderer!.update(<FixedOrderDrawer active={false} shell={shell} order={order} />);
    });

    // The load-bearing assertion: focus was restored (a "trigger:focus"
    // entry exists) and, at that exact moment, the shell was NOT inert.
    const focusEntry = order.find((entry) => entry.startsWith("trigger:focus"));
    expect(focusEntry).toBe("trigger:focus(shellInert=false)");
    expect(shell.inert).toBe(false);

    // And the inert cleanup strictly precedes the focus-restore call.
    const inertCleanupIndex = order.indexOf("inert:cleanup(restored=false)");
    const focusIndex = order.indexOf(focusEntry!);
    expect(inertCleanupIndex).toBeGreaterThanOrEqual(0);
    expect(inertCleanupIndex).toBeLessThan(focusIndex);
  });

  test("BUGGY order reproduces the defect: focus is restored while still inert", () => {
    const order: Order = [];
    const shell = makeShell();
    const trigger = makeTrigger(shell, order);
    const container = makeContainer(order);
    restoreGlobals = stubDomGlobals(trigger);

    act(() => {
      renderer = create(<BuggyOrderDrawer active shell={shell} order={order} />, {
        createNodeMock: () => container,
      });
    });
    expect(shell.inert).toBe(true);

    act(() => {
      renderer!.update(<BuggyOrderDrawer active={false} shell={shell} order={order} />);
    });

    // With useFocusTrap declared first, its cleanup (focus restore) runs
    // BEFORE the inert effect's cleanup — this is the bug: `.focus()` fires
    // while the shell subtree is still inert, so a real browser would treat
    // it as a silent no-op.
    const focusEntry = order.find((entry) => entry.startsWith("trigger:focus"));
    expect(focusEntry).toBe("trigger:focus(shellInert=true)");

    const focusIndex = order.indexOf(focusEntry!);
    const inertCleanupIndex = order.indexOf("inert:cleanup(restored=false)");
    expect(inertCleanupIndex).toBeGreaterThanOrEqual(0);
    expect(focusIndex).toBeLessThan(inertCleanupIndex);
  });
});
