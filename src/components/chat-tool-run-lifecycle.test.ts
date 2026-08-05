// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement, useCallback, useEffect, useState } from "react";
import { act, create } from "react-test-renderer";

import { ChatToolRunDisclosure } from "./chat-tool-run-disclosure.ts";
import { groupConsecutiveTools } from "../lib/turn-segments.ts";
import * as mutationTools from "../lib/tool-input-diff.ts";

const {
  isFileMutationTool,
  toolInputAsDiff,
  toolTargetFile,
  toolTargetPath,
} = mutationTools;

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
  for (const name of ["Edit", "write", " MultiEdit ", "NotebookEdit", "file_change", "apply_patch", "Patch"]) {
    assert.equal(isFileMutationTool(name), true, `${name} is a known mutation tool`);
  }
  for (const name of ["Read", "Bash", "EditDistance", "write_memory"]) {
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

test("repository adapter mutation payloads normalize through the public helpers", () => {
  const codexFileChange = JSON.stringify({
    changes: [{ path: "src/app.ts", kind: "update" }],
  });
  assert.deepEqual(
    mutationTools.normalizeFileMutation("file_change", codexFileChange),
    {
      name: "file_change",
      path: "src/app.ts",
      paths: ["src/app.ts"],
      targetFile: null,
      diff: null,
    },
    "the Codex parser's observed changes[] payload has one normalized descriptor",
  );
  assert.equal(
    toolTargetPath("file_change", codexFileChange),
    "src/app.ts",
    "Codex file_change uses the first observed changes[].path",
  );
  assert.equal(
    toolInputAsDiff("file_change", codexFileChange),
    null,
    "Codex path/kind metadata alone does not invent a reviewable code diff",
  );

  const openClawEdit = JSON.stringify({
    path: "/repo/src/openclaw.ts",
    edits: [
      { oldText: "const before = true;", newText: "const after = true;" },
      { oldText: "export { before };", newText: "export { after };" },
    ],
  });
  const openClawMutation = mutationTools.normalizeFileMutation("edit", openClawEdit);
  assert.ok(openClawMutation);
  assert.equal(mutationTools.isFileMutationActionReady(openClawMutation, "running"), false);
  assert.equal(mutationTools.isFileMutationActionReady(openClawMutation, "error"), false);
  assert.equal(mutationTools.isFileMutationActionReady(openClawMutation, "ok"), true);
  assert.equal(toolTargetFile("edit", openClawEdit), "/repo/src/openclaw.ts");
  assert.equal(
    toolInputAsDiff("edit", openClawEdit),
    [
      "--- a//repo/src/openclaw.ts",
      "+++ b//repo/src/openclaw.ts",
      "@@ edit 1/2 @@",
      "-const before = true;",
      "+const after = true;",
      "@@ edit 2/2 @@",
      "-export { before };",
      "+export { after };",
    ].join("\n"),
    "OpenClaw camelCase edit arrays render every real edit pair",
  );

  const openClawPatchText = [
    "*** Begin Patch",
    "*** Update File: src/patch.ts",
    "@@",
    "-before",
    "+after",
    "*** End Patch",
  ].join("\n");
  const openClawPatch = JSON.stringify({ input: openClawPatchText });
  assert.equal(
    toolInputAsDiff("apply_patch", openClawPatch),
    openClawPatchText,
    "OpenClaw's production { input } apply_patch payload preserves its patch text",
  );
  assert.equal(
    toolTargetPath("apply_patch", openClawPatch),
    "src/patch.ts",
    "OpenClaw apply_patch derives the changed path from the patch envelope",
  );
  assert.equal(
    mutationTools.actionReadyMutationTargetFile("apply_patch", openClawPatch, "ok", "/repo"),
    "/repo/src/patch.ts",
    "a successful OpenClaw patch resolves its relative path inside the active project",
  );
  for (const field of ["input", "patch", "diff"]) {
    assert.equal(
      toolInputAsDiff("edit", JSON.stringify({ path: "src/not-a-patch.ts", [field]: openClawPatchText })),
      null,
      `${field} patch text is only interpreted for a patch tool`,
    );
  }

  for (const name of ["file_change", "edit", "apply_patch"]) {
    assert.equal(
      isFileMutationTool(name),
      true,
      `${name} keeps its edit-card slot while streamed input is partial`,
    );
    assert.equal(toolInputAsDiff(name, '{"path":'), null);
  }
});

test("apply_patch normalization captures every operation and move destination", () => {
  const renamePatch = [
    "*** Begin Patch",
    "*** Update File: src/old-name.ts",
    "*** Move to: src/new-name.ts",
    "@@",
    "-before",
    "+after",
    "*** End Patch",
  ].join("\n");
  assert.deepEqual(
    mutationTools.normalizeFileMutation("apply_patch", JSON.stringify({ input: renamePatch })),
    {
      name: "apply_patch",
      path: "src/new-name.ts",
      paths: ["src/new-name.ts", "src/old-name.ts"],
      targetFile: null,
      diff: renamePatch,
    },
    "a rename reviews its destination while retaining both affected paths",
  );

  const multiPatch = [
    "*** Begin Patch",
    "*** Add File: src/added.ts",
    "+added",
    "*** Update File: src/updated.ts",
    "@@",
    "-before",
    "+after",
    "*** Delete File: src/deleted.ts",
    "*** Update File: src/updated.ts",
    "@@",
    "-after",
    "+final",
    "*** End Patch",
  ].join("\n");
  const mutation = mutationTools.normalizeFileMutation("apply_patch", multiPatch);
  assert.ok(mutation);
  assert.equal(mutation.path, "src/added.ts");
  assert.deepEqual(
    mutation.paths,
    ["src/added.ts", "src/updated.ts", "src/deleted.ts"],
    "add, update, and delete targets are complete and deduplicated",
  );
});

test("aggregate mutation targets include every contained path exactly once", () => {
  const containedPatch = [
    "*** Begin Patch",
    "*** Update File: src/a.ts",
    "@@",
    "-a",
    "+aa",
    "*** Add File: src/b.ts",
    "+b",
    "*** Delete File: src/a.ts",
    "*** End Patch",
  ].join("\n");

  assert.deepEqual(
    mutationTools.actionReadyMutationTargetFiles("apply_patch", containedPatch, "ok", "/repo"),
    ["/repo/src/a.ts", "/repo/src/b.ts"],
  );
  const escapingPatch = containedPatch.replace(
    "*** End Patch",
    "*** Add File: ../outside.ts\n*** End Patch",
  );
  assert.deepEqual(
    mutationTools.actionReadyMutationTargetFiles("apply_patch", escapingPatch, "ok", "/repo"),
    [],
    "one escaping operation makes the whole aggregate fail closed",
  );
});

test("no-op edit pairs do not produce normalized changes", () => {
  const topLevelNoOp = JSON.stringify({
    path: "/repo/src/top-level.ts",
    oldText: "same",
    newText: "same",
  });
  const topLevelMutation = mutationTools.normalizeFileMutation("edit", topLevelNoOp);
  assert.ok(topLevelMutation);
  assert.equal(topLevelMutation.diff, null);
  assert.equal(mutationTools.isFileMutationActionReady(topLevelMutation, "ok"), false);

  const allNoOp = JSON.stringify({
    path: "/repo/src/all-no-op.ts",
    edits: [
      { oldText: "same", newText: "same" },
      { old_string: "also same", new_string: "also same" },
    ],
  });
  const allNoOpMutation = mutationTools.normalizeFileMutation("edit", allNoOp);
  assert.ok(allNoOpMutation);
  assert.equal(allNoOpMutation.diff, null);
  assert.equal(mutationTools.isFileMutationActionReady(allNoOpMutation, "ok"), false);
  assert.equal(
    mutationTools.actionReadyMutationTargetFile("edit", allNoOp, "ok", "/repo"),
    null,
    "an all-no-op edit does not count as a changed file",
  );

  const mixed = JSON.stringify({
    path: "/repo/src/mixed.ts",
    edits: [
      { oldText: "same", newText: "same" },
      { oldText: "before", newText: "after" },
      { old_string: "also same", new_string: "also same" },
    ],
  });
  assert.equal(
    toolInputAsDiff("edit", mixed),
    [
      "--- a//repo/src/mixed.ts",
      "+++ b//repo/src/mixed.ts",
      "@@ edit 1/1 @@",
      "-before",
      "+after",
    ].join("\n"),
    "mixed edits include only real changes and renumber their hunks",
  );
});

test("aggregate review includes only successful action-ready mutations", () => {
  const actionReadyMutationTargetFile = mutationTools.actionReadyMutationTargetFile;
  assert.equal(
    typeof actionReadyMutationTargetFile,
    "function",
    "aggregate review has one shared action-readiness projection",
  );
  if (typeof actionReadyMutationTargetFile !== "function") return;

  const pathOnlyCodex = {
    name: "file_change",
    input: JSON.stringify({ changes: [{ path: "src/path-only.ts", kind: "update" }] }),
    status: "ok",
  };
  const failedOpenClaw = {
    name: "edit",
    input: JSON.stringify({
      path: "/repo/src/failed.ts",
      edits: [{ oldText: "before", newText: "after" }],
    }),
    status: "error",
  };
  const notReadyFiles = [pathOnlyCodex, failedOpenClaw]
    .map((tool) => actionReadyMutationTargetFile(tool.name, tool.input, tool.status, "/repo"))
    .filter(Boolean);
  assert.deepEqual(
    notReadyFiles,
    [],
    "path-only and failed mutations cannot produce an aggregate Review all action",
  );
  assert.equal(
    actionReadyMutationTargetFile(
      "Write",
      JSON.stringify({ file_path: "/repo/src/running.ts", content: "still working" }),
      "running",
      "/repo",
    ),
    null,
    "a running mutation cannot enter aggregate review before it succeeds",
  );

  const readyEdit = (path) =>
    actionReadyMutationTargetFile(
      "edit",
      JSON.stringify({
        path,
        edits: [{ oldText: "before", newText: "after" }],
      }),
      "ok",
      "/repo",
    );
  assert.equal(readyEdit("/repo/src/in-project.ts"), "/repo/src/in-project.ts");
  assert.equal(
    actionReadyMutationTargetFile(
      "edit",
      JSON.stringify({
        path: "/repo/src/no-project-context.ts",
        edits: [{ oldText: "before", newText: "after" }],
      }),
      "ok",
      null,
    ),
    null,
    "aggregate review is unavailable without an active Changes-panel project",
  );
  assert.equal(
    readyEdit("/repo-other/src/prefix-collision.ts"),
    null,
    "a path sharing only the project-root string prefix stays external",
  );
  assert.equal(
    readyEdit("src/relative.ts"),
    "/repo/src/relative.ts",
    "a relative mutation path resolves inside the active project",
  );
  assert.equal(
    readyEdit("/Users/person/.coven/workspaces/familiars/nova/memory.md"),
    null,
    "an external absolute familiar path cannot join aggregate review",
  );
  assert.equal(
    actionReadyMutationTargetFile(
      "Write",
      JSON.stringify({ file_path: "/repo/src/claude-ready.ts", content: "ready" }),
      "ok",
      "/repo",
    ),
    "/repo/src/claude-ready.ts",
    "successful supported mutation shapes inside the active project participate in aggregate review",
  );
  assert.equal(
    readyEdit("src/../../outside.ts"),
    null,
    "relative traversal cannot escape the project boundary",
  );
});

console.log("chat-tool-run-lifecycle.test.ts: ok");
