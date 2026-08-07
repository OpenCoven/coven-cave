import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CHAT_SESSION_LEVEL,
  canMoveSurfaceHistory,
  moveSurfaceHistory,
  recordSurfaceHistory,
  registerSurfaceHistoryGate,
  registerSurfaceHistoryLevel,
  resetSurfaceHistoryForTest,
  subscribeSurfaceHistory,
  surfaceHistoryGateOpen,
  surfaceHistoryJournalForTest,
} from "./surface-history";

afterEach(() => resetSurfaceHistoryForTest());

/** A level that records what it was asked to restore. */
function level(id: string) {
  const applied: unknown[] = [];
  const unregister = registerSurfaceHistoryLevel({ id, apply: (v) => applied.push(v) });
  return { id, applied, unregister };
}

describe("surface history journal", () => {
  it("reports nothing movable when nothing was recorded", () => {
    expect(canMoveSurfaceHistory(-1)).toBe(false);
    expect(canMoveSurfaceHistory(1)).toBe(false);
    expect(moveSurfaceHistory(-1)).toBe(false);
  });

  it("steps back the most recent move, across levels", () => {
    // The reason this is one journal and not a stack per level: Back must undo
    // what the user did last, not whichever level is consulted first.
    const tab = level("board:tab");
    const filter = level("board:filter");
    recordSurfaceHistory("board:filter", "all", "mine");
    recordSurfaceHistory("board:tab", "tasks", "queue");

    expect(moveSurfaceHistory(-1)).toBe(true);
    expect(tab.applied).toEqual(["tasks"]);
    expect(filter.applied).toEqual([]);

    expect(moveSurfaceHistory(-1)).toBe(true);
    expect(filter.applied).toEqual(["all"]);
    expect(canMoveSurfaceHistory(-1)).toBe(false);
  });

  it("retraces forward in the same order", () => {
    const tab = level("board:tab");
    recordSurfaceHistory("board:tab", "tasks", "queue");
    recordSurfaceHistory("board:tab", "queue", "archive");
    moveSurfaceHistory(-1);
    moveSurfaceHistory(-1);
    expect(tab.applied).toEqual(["queue", "tasks"]);

    moveSurfaceHistory(1);
    moveSurfaceHistory(1);
    expect(tab.applied).toEqual(["queue", "tasks", "queue", "archive"]);
    expect(canMoveSurfaceHistory(1)).toBe(false);
  });

  it("truncates the forward trail when a new move is recorded", () => {
    level("board:tab");
    recordSurfaceHistory("board:tab", "tasks", "queue");
    recordSurfaceHistory("board:tab", "queue", "archive");
    moveSurfaceHistory(-1);
    recordSurfaceHistory("board:tab", "queue", "shipped");

    expect(canMoveSurfaceHistory(1)).toBe(false);
    expect(surfaceHistoryJournalForTest().entries).toHaveLength(2);
  });

  it("ignores a move to the value already showing", () => {
    level("board:tab");
    recordSurfaceHistory("board:tab", "tasks", "tasks");
    expect(canMoveSurfaceHistory(-1)).toBe(false);
  });

  it("drops a level's entries when it unmounts, and pulls the cursor back", () => {
    const chat = level("chat:scope");
    recordSurfaceHistory("chat:scope", "conversation", "projects");
    recordSurfaceHistory("chat:scope", "projects", "canvas");
    expect(canMoveSurfaceHistory(-1)).toBe(true);

    // Leaving Chat unmounts the strip. Back must fall through to the mode
    // history rather than trying to restore a surface that is gone.
    chat.unregister();
    expect(canMoveSurfaceHistory(-1)).toBe(false);
    expect(canMoveSurfaceHistory(1)).toBe(false);
    expect(surfaceHistoryJournalForTest().entries).toHaveLength(0);
  });

  it("keeps other levels' entries when one unmounts", () => {
    const board = level("board:tab");
    const chat = level("chat:scope");
    recordSurfaceHistory("board:tab", "tasks", "queue");
    recordSurfaceHistory("chat:scope", "conversation", "projects");

    chat.unregister();
    expect(moveSurfaceHistory(-1)).toBe(true);
    expect(board.applied).toEqual(["tasks"]);
  });

  it("keeps a remount's registration when the previous cleanup runs late", () => {
    const first = registerSurfaceHistoryLevel({ id: "chat:scope", apply: () => {} });
    const applied: unknown[] = [];
    registerSurfaceHistoryLevel({ id: "chat:scope", apply: (v) => applied.push(v) });
    // React can run the previous effect's cleanup after the replacement
    // registered. Dropping the entry here would silently disable the level.
    first();

    recordSurfaceHistory("chat:scope", "conversation", "projects");
    expect(moveSurfaceHistory(-1)).toBe(true);
    expect(applied).toEqual(["conversation"]);
  });

  describe("coalescing", () => {
    it("collapses a burst on one level into a single entry", () => {
      const filter = level("gh:filter");
      recordSurfaceHistory("gh:filter", "all", "pr", 700);
      recordSurfaceHistory("gh:filter", "pr", "issue", 700);
      recordSurfaceHistory("gh:filter", "issue", "review", 700);

      expect(surfaceHistoryJournalForTest().entries).toHaveLength(1);
      expect(moveSurfaceHistory(-1)).toBe(true);
      // Back lands where the burst started, not one chip earlier.
      expect(filter.applied).toEqual(["all"]);
    });

    it("does not coalesce across levels", () => {
      level("gh:filter");
      level("gh:tab");
      recordSurfaceHistory("gh:filter", "all", "pr", 700);
      recordSurfaceHistory("gh:tab", "a", "b", 700);
      expect(surfaceHistoryJournalForTest().entries).toHaveLength(2);
    });

    it("does not coalesce a tab strip, where every pick is a destination", () => {
      level("chat:scope");
      recordSurfaceHistory("chat:scope", "conversation", "projects");
      recordSurfaceHistory("chat:scope", "projects", "canvas");
      expect(surfaceHistoryJournalForTest().entries).toHaveLength(2);
    });
  });

  describe("gates", () => {
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
  });

  describe("subscribers", () => {
    it("notifies after a traversal", () => {
      // The shell disables Back/Forward off these flags. Without a notify here
      // the Forward button stayed dead after the first Back.
      level("a");
      recordSurfaceHistory("a", 1, 2);
      const listener = vi.fn();
      subscribeSurfaceHistory(listener);
      moveSurfaceHistory(-1);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("stays quiet when nothing moved", () => {
      const listener = vi.fn();
      subscribeSurfaceHistory(listener);
      expect(moveSurfaceHistory(-1)).toBe(false);
      expect(listener).not.toHaveBeenCalled();
    });

    it("notifies on record, registration, and unregistration", () => {
      const listener = vi.fn();
      const unsubscribe = subscribeSurfaceHistory(listener);
      const a = level("a");
      expect(listener).toHaveBeenCalledTimes(1);
      recordSurfaceHistory("a", 1, 2);
      expect(listener).toHaveBeenCalledTimes(2);
      a.unregister();
      expect(listener).toHaveBeenCalledTimes(3);
      unsubscribe();
      recordSurfaceHistory("a", 2, 3);
      expect(listener).toHaveBeenCalledTimes(3);
    });
  });
});
