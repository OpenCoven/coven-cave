import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CHAT_SESSION_LEVEL,
  canMoveSurfaceHistory,
  moveSurfaceHistory,
  notifySurfaceHistoryChanged,
  registerSurfaceHistoryGate,
  registerSurfaceHistoryLevel,
  resetSurfaceHistoryForTest,
  subscribeSurfaceHistory,
  surfaceHistoryGateOpen,
  type SurfaceHistoryLevel,
} from "./surface-history";

afterEach(() => resetSurfaceHistoryForTest());

function level(id: string, depth: number, moves: boolean): SurfaceHistoryLevel & { moved: number[] } {
  const record: number[] = [];
  return {
    id,
    depth,
    moved: record,
    canMove: () => moves,
    move: (direction) => {
      record.push(direction);
      return moves;
    },
  };
}

describe("surface history registry", () => {
  it("reports nothing movable when no level is registered", () => {
    expect(canMoveSurfaceHistory(-1)).toBe(false);
    expect(moveSurfaceHistory(-1)).toBe(false);
  });

  it("moves the deepest movable level and stops there", () => {
    const shallow = level("shallow", 1, true);
    const deep = level("deep", 10, true);
    registerSurfaceHistoryLevel(shallow);
    registerSurfaceHistoryLevel(deep);

    expect(moveSurfaceHistory(-1)).toBe(true);
    expect(deep.moved).toEqual([-1]);
    expect(shallow.moved).toEqual([]);
  });

  it("falls through to a shallower level when the deepest cannot move", () => {
    const shallow = level("shallow", 1, true);
    const deep = level("deep", 10, false);
    registerSurfaceHistoryLevel(shallow);
    registerSurfaceHistoryLevel(deep);

    expect(moveSurfaceHistory(-1)).toBe(true);
    expect(deep.moved).toEqual([]);
    expect(shallow.moved).toEqual([-1]);
  });

  it("unregisters on cleanup", () => {
    const unregister = registerSurfaceHistoryLevel(level("only", 1, true));
    expect(canMoveSurfaceHistory(-1)).toBe(true);
    unregister();
    expect(canMoveSurfaceHistory(-1)).toBe(false);
  });

  it("keeps a remount's registration when the previous cleanup runs late", () => {
    const first = level("chat:scope", 10, false);
    const unregisterFirst = registerSurfaceHistoryLevel(first);
    const second = level("chat:scope", 10, true);
    registerSurfaceHistoryLevel(second);

    // React can run the previous effect's cleanup after the replacement
    // registered. Dropping the entry here would silently disable the level.
    unregisterFirst();

    expect(canMoveSurfaceHistory(-1)).toBe(true);
  });

  it("notifies subscribers after a traversal", () => {
    // The shell disables Back/Forward off these flags. Without a notify here
    // the Forward button stayed dead after the first Back.
    registerSurfaceHistoryLevel(level("only", 1, true));
    const listener = vi.fn();
    subscribeSurfaceHistory(listener);
    moveSurfaceHistory(-1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("does not notify when nothing moved", () => {
    registerSurfaceHistoryLevel(level("stuck", 1, false));
    const listener = vi.fn();
    subscribeSurfaceHistory(listener);
    expect(moveSurfaceHistory(-1)).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });

  it("treats an ungated level as reachable", () => {
    expect(surfaceHistoryGateOpen(CHAT_SESSION_LEVEL)).toBe(true);
  });

  it("honours a registered gate, and forgets it on cleanup", () => {
    let scope = "projects";
    const unregister = registerSurfaceHistoryGate(
      CHAT_SESSION_LEVEL,
      () => scope === "conversation",
    );
    expect(surfaceHistoryGateOpen(CHAT_SESSION_LEVEL)).toBe(false);
    scope = "conversation";
    expect(surfaceHistoryGateOpen(CHAT_SESSION_LEVEL)).toBe(true);
    unregister();
    expect(surfaceHistoryGateOpen(CHAT_SESSION_LEVEL)).toBe(true);
  });

  it("notifies subscribers on registration and on explicit change", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSurfaceHistory(listener);
    const unregister = registerSurfaceHistoryLevel(level("a", 1, true));
    expect(listener).toHaveBeenCalledTimes(1);
    notifySurfaceHistoryChanged();
    expect(listener).toHaveBeenCalledTimes(2);
    unregister();
    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
    notifySurfaceHistoryChanged();
    expect(listener).toHaveBeenCalledTimes(3);
  });
});
