import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HOME_TASK_NAVIGATION_EVENT,
  requestHomeFromTask,
  resolveHomeTaskHandoff,
} from "./home-task-handoff.ts";

const projects = [
  {
    id: "cave",
    name: "Coven Cave",
    root: "/work/cave",
    createdAt: "2026-08-20T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:00.000Z",
  },
  {
    id: "docs",
    name: "Docs",
    root: "/work/docs/",
    createdAt: "2026-08-20T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:00.000Z",
  },
];
const familiars = [{ id: "sage" }, { id: "cody" }];

describe("resolveHomeTaskHandoff", () => {
  it("resolves the requested project and familiar against the live registries", () => {
    assert.deepEqual(
      resolveHomeTaskHandoff(
        {
          title: "Repair project navigation",
          suggestions: ["Inspect the failing path", "  Run focused tests  ", ""],
          projectRoot: "/work/docs",
          familiarId: "cody",
        },
        {
          projects,
          currentProjectId: "cave",
          familiars,
          currentFamiliarId: "sage",
        },
      ),
      {
        origin: {
          title: "Repair project navigation",
          suggestions: ["Inspect the failing path", "Run focused tests"],
          projectRoot: "/work/docs",
          familiarId: "cody",
        },
        projectId: "docs",
        familiarId: "cody",
      },
    );
  });

  it("falls back to current valid context, then the first familiar", () => {
    const current = resolveHomeTaskHandoff(
      {
        title: "Recover stale task context",
        projectRoot: "/removed/project",
        familiarId: "removed-familiar",
      },
      {
        projects,
        currentProjectId: "cave",
        familiars,
        currentFamiliarId: "sage",
      },
    );
    assert.equal(current?.projectId, "cave");
    assert.equal(current?.familiarId, "sage");

    const registryFallback = resolveHomeTaskHandoff(
      { title: "Recover without selected context" },
      {
        projects,
        currentProjectId: "removed-project",
        familiars,
        currentFamiliarId: "removed-familiar",
      },
    );
    assert.equal(registryFallback?.projectId, null);
    assert.equal(registryFallback?.familiarId, "sage");
  });

  it("rejects malformed task payloads instead of changing context", () => {
    assert.equal(
      resolveHomeTaskHandoff(
        { title: " ", projectRoot: { path: "/work/cave" } },
        { projects, currentProjectId: "cave", familiars, currentFamiliarId: "sage" },
      ),
      null,
    );
  });
});

describe("requestHomeFromTask", () => {
  it("dispatches the task-bearing home navigation contract", () => {
    const events: Array<{ type: string; detail: unknown }> = [];
    const previousWindow = globalThis.window;
    globalThis.window = {
      dispatchEvent(event: Event) {
        events.push({ type: event.type, detail: (event as CustomEvent).detail });
        return true;
      },
    } as Window & typeof globalThis;
    try {
      requestHomeFromTask({
        title: "Review the recovered task",
        projectRoot: "/work/cave",
        familiarId: "sage",
      });
    } finally {
      globalThis.window = previousWindow;
    }
    assert.deepEqual(events, [{
      type: HOME_TASK_NAVIGATION_EVENT,
      detail: {
        mode: "home",
        task: {
          title: "Review the recovered task",
          projectRoot: "/work/cave",
          familiarId: "sage",
        },
      },
    }]);
  });
});
