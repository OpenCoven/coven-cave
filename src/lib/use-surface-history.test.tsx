// @ts-nocheck — react-test-renderer ships no types; matches the convention in
// workspace-canonical-memory-navigation-behavior.test.tsx.
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { useOverlayHistory, useSurfaceHistory, type SurfaceHistory } from "./use-surface-history";
import {
  canMoveSurfaceHistory,
  moveSurfaceHistory,
  recordSurfaceHistory,
  resetSurfaceHistoryForTest,
} from "./surface-history";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => resetSurfaceHistoryForTest());

type Scope = "conversation" | "projects" | "canvas" | "familiar";

/** Mount the hook and expose its latest return value to the test. */
function mount(initial: Scope = "conversation", coalesceMs = 0) {
  const latest = { current: null as SurfaceHistory<Scope> | null };
  function Probe() {
    latest.current = useSurfaceHistory<Scope>({ id: "chat:scope", initial, coalesceMs });
    return null;
  }
  let renderer: ReactTestRenderer;
  act(() => {
    renderer = create(<Probe />);
  });
  return {
    get value() {
      return latest.current!.value;
    },
    select: (next: Scope) => act(() => latest.current!.select(next)),
    show: (next: Scope) => act(() => latest.current!.show(next)),
    back: () => act(() => void moveSurfaceHistory(-1)),
    forward: () => act(() => void moveSurfaceHistory(1)),
    unmount: () => act(() => renderer.unmount()),
  };
}

describe("useSurfaceHistory", () => {
  it("starts with nowhere to go", () => {
    mount();
    expect(canMoveSurfaceHistory(-1)).toBe(false);
    expect(canMoveSurfaceHistory(1)).toBe(false);
  });

  it("steps back one level per select, then forward again", () => {
    const surface = mount();
    surface.select("projects");
    surface.select("canvas");
    expect(surface.value).toBe("canvas");

    surface.back();
    expect(surface.value).toBe("projects");
    surface.back();
    expect(surface.value).toBe("conversation");

    // Exhausted — the Workspace falls through to the mode stack from here,
    // which is what makes the third Back leave Chat.
    expect(canMoveSurfaceHistory(-1)).toBe(false);

    surface.forward();
    expect(surface.value).toBe("projects");
    surface.forward();
    expect(surface.value).toBe("canvas");
    expect(canMoveSurfaceHistory(1)).toBe(false);
  });

  it("show() lands without recording an entry", () => {
    const surface = mount();
    surface.show("projects");
    expect(surface.value).toBe("projects");
    // A cross-surface handoff already pushed on a level the Workspace tracks;
    // recording here too would cost two Back presses for one action.
    expect(canMoveSurfaceHistory(-1)).toBe(false);
  });

  it("show() after select() replaces the current entry, keeping the trail", () => {
    const surface = mount();
    surface.select("projects");
    surface.show("familiar");
    expect(surface.value).toBe("familiar");

    surface.back();
    expect(surface.value).toBe("conversation");
  });

  it("selecting the current value records nothing", () => {
    const surface = mount();
    surface.select("conversation");
    expect(canMoveSurfaceHistory(-1)).toBe(false);
  });

  it("truncates the forward trail when a new destination is selected", () => {
    const surface = mount();
    surface.select("projects");
    surface.select("canvas");
    surface.back();
    // Selecting from a rewound position drops "canvas" — the abandoned branch
    // must not stay reachable by Forward.
    surface.select("familiar");

    expect(canMoveSurfaceHistory(1)).toBe(false);
    surface.back();
    expect(surface.value).toBe("projects");
    surface.back();
    expect(surface.value).toBe("conversation");
  });

  it("collapses a burst when the level opts into coalescing", () => {
    const surface = mount("conversation", 700);
    surface.select("projects");
    surface.select("canvas");
    surface.select("familiar");
    expect(surface.value).toBe("familiar");

    surface.back();
    expect(surface.value).toBe("conversation");
    expect(canMoveSurfaceHistory(-1)).toBe(false);
  });

  describe("overlays", () => {
    function mountOverlay() {
      const state = { open: false };
      const api = { current: null as ReturnType<typeof useOverlayHistory> | null };
      function Probe() {
        const [open, setOpen] = useState(false);
        state.open = open;
        api.current = useOverlayHistory({ id: "overlay:palette", open, setOpen });
        return null;
      }
      act(() => {
        create(<Probe />);
      });
      return {
        get open() {
          return state.open;
        },
        openOverlay: () => act(() => api.current!.openOverlay()),
        closeOverlay: () => act(() => api.current!.closeOverlay()),
        back: () => act(() => void moveSurfaceHistory(-1)),
      };
    }

    it("closes on Back instead of navigating", () => {
      const overlay = mountOverlay();
      overlay.openOverlay();
      expect(overlay.open).toBe(true);

      overlay.back();
      expect(overlay.open).toBe(false);
      expect(canMoveSurfaceHistory(-1)).toBe(false);
    });

    it("consumes its entry when dismissed, so Back does not reopen it", () => {
      const overlay = mountOverlay();
      overlay.openOverlay();
      overlay.closeOverlay();
      expect(overlay.open).toBe(false);
      // The entry is gone rather than sitting there waiting to reopen.
      expect(canMoveSurfaceHistory(-1)).toBe(false);
      expect(canMoveSurfaceHistory(1)).toBe(false);
    });

    it("leaves the journal alone when a move landed on top of it", () => {
      const overlay = mountOverlay();
      overlay.openOverlay();
      // Something else navigated while the overlay was open — its entry is no
      // longer on top, so closing must not swallow that unrelated move.
      recordSurfaceHistory("chat:scope", "conversation", "projects");
      overlay.closeOverlay();
      expect(overlay.open).toBe(false);
      expect(canMoveSurfaceHistory(-1)).toBe(true);
    });

    it("ignores a redundant open or close", () => {
      const overlay = mountOverlay();
      overlay.closeOverlay();
      expect(canMoveSurfaceHistory(-1)).toBe(false);
      overlay.openOverlay();
      overlay.openOverlay();
      overlay.back();
      expect(overlay.open).toBe(false);
      expect(canMoveSurfaceHistory(-1)).toBe(false);
    });
  });

  it("unregisters its level on unmount", () => {
    const surface = mount();
    surface.select("projects");
    expect(canMoveSurfaceHistory(-1)).toBe(true);
    surface.unmount();
    expect(canMoveSurfaceHistory(-1)).toBe(false);
  });
});
