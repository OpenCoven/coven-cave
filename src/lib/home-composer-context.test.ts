// @ts-nocheck
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/icon", () => ({
  Icon: () => null,
}));

import { HomeFromTaskRow } from "@/components/home/home-from-task";
import { resolveHomeTaskHandoff } from "@/lib/home-task-handoff";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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

function textContent(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (node && typeof node === "object" && "children" in node) {
    return textContent((node as { children: unknown }).children);
  }
  return "";
}

describe("home task context", () => {
  it("resolves requested project and familiar context", () => {
    const resolved = resolveHomeTaskHandoff(
      {
        title: "Repair project navigation",
        projectRoot: "/work/docs",
        familiarId: "cody",
      },
      {
        projects,
        currentProjectId: "cave",
        familiars,
        currentFamiliarId: "sage",
      },
    );

    expect(resolved?.projectId).toBe("docs");
    expect(resolved?.familiarId).toBe("cody");
  });

  it("falls back through valid current context and the roster", () => {
    const current = resolveHomeTaskHandoff(
      {
        title: "Recover stale context",
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
    expect(current?.projectId).toBe("cave");
    expect(current?.familiarId).toBe("sage");

    const rosterFallback = resolveHomeTaskHandoff(
      { title: "Recover without selected context" },
      {
        projects,
        currentProjectId: "removed-project",
        familiars,
        currentFamiliarId: "removed-familiar",
      },
    );
    expect(rosterFallback?.projectId).toBeNull();
    expect(rosterFallback?.familiarId).toBe("sage");
  });

  it("renders task origin and caps actionable suggestions at three", async () => {
    const onPickSuggestion = vi.fn();
    let renderer;
    await act(async () => {
      renderer = create(createElement(HomeFromTaskRow, {
        origin: {
          title: "Repair the recovered handoff",
          suggestions: ["Inspect", "Implement", "Verify", "Do not render"],
        },
        onPickSuggestion,
      }));
    });

    expect(textContent(renderer.root)).toContain("From task");
    expect(textContent(renderer.root)).toContain("Repair the recovered handoff");
    const buttons = renderer.root.findAllByType("button");
    expect(buttons).toHaveLength(3);
    await act(async () => buttons[1].props.onClick());
    expect(onPickSuggestion).toHaveBeenCalledWith("Implement");
    await act(async () => renderer.unmount());
  });

  it("renders nothing without a task origin", async () => {
    let renderer;
    await act(async () => {
      renderer = create(createElement(HomeFromTaskRow, {
        origin: null,
        onPickSuggestion: vi.fn(),
      }));
    });
    expect(renderer.toJSON()).toBeNull();
    await act(async () => renderer.unmount());
  });
});
