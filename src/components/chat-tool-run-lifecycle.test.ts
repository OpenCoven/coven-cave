// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement, useCallback, useEffect, useState } from "react";
import { act, create } from "react-test-renderer";

import { ChatToolRunDisclosure } from "./chat-tool-run-disclosure.ts";
import { groupConsecutiveTools } from "../lib/turn-segments.ts";
import {
  isFileMutationTool,
  toolInputAsDiff,
  toolTargetFile,
} from "../lib/tool-input-diff.ts";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function StatefulTool({ tool, controllers, lifecycle }) {
  const [expanded, setExpanded] = useState(false);
  const life = lifecycle[tool.id] ??= { mounts: 0, unmounts: 0 };
  const controller = controllers[tool.id] ??= {};
  controller.expanded = expanded;
  controller.open = () => setExpanded(true);
  const setNode = useCallback((node) => {
    controller.node = node;
  }, [controller]);
  useEffect(() => {
    life.mounts += 1;
    return () => {
      life.unmounts += 1;
    };
  }, [life]);
  return createElement("tool-control", { ref: setNode, toolId: tool.id, expanded });
}

function ToolRunsProbe({ tools, controllers, lifecycle }) {
  return createElement(
    "tool-runs",
    null,
    groupConsecutiveTools(tools).map((run) =>
      createElement(
        ChatToolRunDisclosure,
        {
          key: run.tools[0].id,
          repeated: run.tools.length > 1,
          statuses: run.tools.map((tool) => tool.status),
          category: "read",
          ariaLabel: `${run.name}, ${run.tools.length} calls`,
          summary: createElement("run-summary", null, `${run.name} ×${run.tools.length}`),
        },
        run.tools.map((tool) =>
          createElement(StatefulTool, {
            key: tool.id,
            tool,
            controllers,
            lifecycle,
          }),
        ),
      ),
    ),
  );
}

function ToolPlacementProbe({ tools, controllers, lifecycle }) {
  const editToolIds = new Set(
    tools.filter((tool) => isFileMutationTool(tool.name)).map((tool) => tool.id),
  );
  const renderTools = (selected) =>
    selected.map((tool) =>
      createElement(StatefulTool, {
        key: tool.id,
        tool,
        controllers,
        lifecycle,
      }),
    );
  return createElement(
    "tool-slots",
    null,
    createElement(
      "activity-slot",
      null,
      renderTools(tools.filter((tool) => !editToolIds.has(tool.id))),
    ),
    createElement(
      "edit-slot",
      null,
      renderTools(tools.filter((tool) => editToolIds.has(tool.id))),
    ),
  );
}

test("one call becoming a repeated run preserves the first focused tool instance", async () => {
  const controllers = {};
  const lifecycle = {};
  const firstNode = {};
  const secondNode = {};
  const outside = {};
  const toolNodes = new Map([
    ["read-1", firstNode],
    ["read-2", secondNode],
  ]);
  const toolNodeCreations = {};
  const detailsNode = {
    open: true,
    contains: (node) => node === firstNode || node === secondNode,
  };
  const originalDocument = globalThis.document;
  let renderer;
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { activeElement: firstNode },
  });
  try {
    await act(async () => {
      renderer = create(
        createElement(ToolRunsProbe, {
          tools: [{ id: "read-1", name: "Read", status: "ok" }],
          controllers,
          lifecycle,
        }),
        {
          createNodeMock(element) {
            if (element.type === "details") return detailsNode;
            if (element.type === "tool-control") {
              toolNodeCreations[element.props.toolId] =
                (toolNodeCreations[element.props.toolId] ?? 0) + 1;
              return toolNodes.get(element.props.toolId);
            }
            return {};
          },
        },
      );
    });
    assert.equal(renderer.root.findByType("details").props.open, true, "the one-off shell stays open");
    assert.equal(renderer.root.findByType("details").props.className, undefined, "the one-off shell has no visual framing");
    assert.equal(renderer.root.findByType("summary").props.hidden, true, "the one-off summary is invisible and inert");
    assert.equal(renderer.root.findByType("div").props.className, undefined, "the one-off list adds no nested framing");
    await act(async () => { controllers["read-1"].open(); });
    assert.equal(controllers["read-1"].expanded, true);

    await act(async () => {
      renderer.update(createElement(ToolRunsProbe, {
        tools: [
          { id: "read-1", name: "Read", status: "ok" },
          { id: "read-2", name: "Read", status: "running" },
        ],
        controllers,
        lifecycle,
      }));
    });

    assert.deepEqual(lifecycle["read-1"], { mounts: 1, unmounts: 0 });
    assert.equal(toolNodeCreations["read-1"], 1, "the first tool DOM node is reused");
    assert.equal(controllers["read-1"].expanded, true, "the first tool keeps local disclosure state");
    assert.equal(globalThis.document.activeElement, firstNode, "focus remains on the first tool");
    assert.deepEqual(
      renderer.root.findAllByType("tool-control").map((node) => node.props.toolId),
      ["read-1", "read-2"],
      "the repeated subgroup keeps transcript order",
    );
    assert.equal(renderer.root.findByType("summary").props.hidden, false);
    assert.equal(renderer.root.findByType("details").props.open, true);

    await act(async () => {
      renderer.update(createElement(ToolRunsProbe, {
        tools: [
          { id: "read-1", name: "Read", status: "ok" },
          { id: "read-2", name: "Read", status: "ok" },
        ],
        controllers,
        lifecycle,
      }));
    });
    assert.equal(renderer.root.findByType("details").props.open, true, "focused settlement stays open");

    await act(async () => {
      renderer.root.findByType("details").props.onBlurCapture({ relatedTarget: outside });
    });
    assert.equal(renderer.root.findByType("details").props.open, false, "the settled subgroup collapses after blur");
  } finally {
    await act(async () => { renderer?.unmount(); });
    if (originalDocument === undefined) delete globalThis.document;
    else Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
  }
});

test("a mutation tool stays in its id-keyed slot as partial input becomes parseable", async () => {
  const controllers = {};
  const lifecycle = {};
  const toolNode = {};
  const toolNodeCreations = {};
  const partialInput = '{"file_path":"/repo/src/a.ts","old_string":"before"';
  const completeInput = JSON.stringify({
    file_path: "/repo/src/a.ts",
    old_string: "before",
    new_string: "after",
  });
  assert.equal(toolInputAsDiff("Edit", partialInput), null, "Review is unavailable while the diff is incomplete");
  assert.equal(toolTargetFile("Edit", partialInput), null, "Undo is unavailable while the path is incomplete");
  const completeDiff = toolInputAsDiff("Edit", completeInput);
  assert.match(completeDiff, /^\-\-\- a\/.*\n\+\+\+ b\//, "Review becomes available with a parsed diff");
  assert.equal(toolTargetFile("Edit", completeInput), "/repo/src/a.ts", "Undo receives a concrete path only after parsing");

  const originalDocument = globalThis.document;
  let renderer;
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { activeElement: toolNode },
  });
  try {
    await act(async () => {
      renderer = create(
        createElement(ToolPlacementProbe, {
          tools: [{ id: "edit-1", name: "Edit", input: partialInput, status: "running" }],
          controllers,
          lifecycle,
        }),
        {
          createNodeMock(element) {
            if (element.type === "tool-control") {
              toolNodeCreations[element.props.toolId] =
                (toolNodeCreations[element.props.toolId] ?? 0) + 1;
              return toolNode;
            }
            return {};
          },
        },
      );
    });
    assert.deepEqual(
      renderer.root.findByType("edit-slot").findAllByType("tool-control").map((node) => node.props.toolId),
      ["edit-1"],
      "a known mutation starts in the edit-card slot before its payload parses",
    );
    assert.equal(renderer.root.findByType("activity-slot").findAllByType("tool-control").length, 0);
    await act(async () => { controllers["edit-1"].open(); });

    await act(async () => {
      renderer.update(
        createElement(ToolPlacementProbe, {
          tools: [{ id: "edit-1", name: "Edit", input: completeInput, status: "ok" }],
          controllers,
          lifecycle,
        }),
      );
    });

    assert.deepEqual(lifecycle["edit-1"], { mounts: 1, unmounts: 0 });
    assert.equal(toolNodeCreations["edit-1"], 1, "the edit tool DOM node is reused");
    assert.equal(controllers["edit-1"].expanded, true, "local disclosure state survives input completion");
    assert.equal(globalThis.document.activeElement, toolNode, "focus remains on the same tool");
    assert.deepEqual(
      renderer.root.findByType("edit-slot").findAllByType("tool-control").map((node) => node.props.toolId),
      ["edit-1"],
      "parseability does not relocate the tool",
    );
  } finally {
    await act(async () => { renderer?.unmount(); });
    if (originalDocument === undefined) delete globalThis.document;
    else Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
  }
});

test("mutation-slot classification is exact and independent of payload shape", () => {
  for (const name of ["Edit", "write", " MultiEdit ", "NotebookEdit"]) {
    assert.equal(isFileMutationTool(name), true, `${name} is a known mutation tool`);
  }
  for (const name of ["Read", "Bash", "EditDistance", "write_memory", "apply_patch"]) {
    assert.equal(isFileMutationTool(name), false, `${name} must stay generic`);
  }
  assert.equal(
    toolInputAsDiff("Bash", JSON.stringify({
      file_path: "/repo/src/a.ts",
      old_string: "before",
      new_string: "after",
    })),
    null,
    "an edit-shaped payload does not reclassify an unrelated tool",
  );
});

console.log("chat-tool-run-lifecycle.test.ts: ok");
