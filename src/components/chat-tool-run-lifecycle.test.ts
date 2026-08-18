// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement, useCallback, useEffect, useState } from "react";
import { act, create } from "react-test-renderer";

import { ChatToolRunDisclosure } from "./chat-tool-run-disclosure.ts";
import { groupConsecutiveTools } from "../lib/turn-segments.ts";

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

console.log("chat-tool-run-lifecycle.test.ts: ok");
