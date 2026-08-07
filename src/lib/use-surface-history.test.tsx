// @ts-nocheck — react-test-renderer ships no types; matches the convention in
// workspace-canonical-memory-navigation-behavior.test.tsx.
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it } from "vitest";
import { useSurfaceHistory, type SurfaceHistory } from "./use-surface-history";
import {
  canMoveSurfaceHistory,
  moveSurfaceHistory,
  resetSurfaceHistoryForTest,
} from "./surface-history";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => resetSurfaceHistoryForTest());

type Scope = "conversation" | "projects" | "canvas" | "familiar";

/** Mount the hook and expose its latest return value to the test. */
function mount(initial: Scope = "conversation") {
  const latest = { current: null as SurfaceHistory<Scope> | null };
  function Probe() {
    latest.current = useSurfaceHistory<Scope>({ id: "chat:scope", depth: 10, initial });
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

  it("unregisters its level on unmount", () => {
    const surface = mount();
    surface.select("projects");
    expect(canMoveSurfaceHistory(-1)).toBe(true);
    surface.unmount();
    expect(canMoveSurfaceHistory(-1)).toBe(false);
  });
});
