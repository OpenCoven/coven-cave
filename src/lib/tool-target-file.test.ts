// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { toolTargetFile, toolTargetPath } = await import("./tool-input-diff.ts");

// ── toolTargetFile: openable absolute path for file tools, else null ─────────
{
  // Edit / Write / MultiEdit / NotebookEdit + Read are file tools.
  assert.equal(
    toolTargetFile("Edit", JSON.stringify({ file_path: "/repo/src/a.ts", old_string: "x", new_string: "y" })),
    "/repo/src/a.ts",
  );
  assert.equal(toolTargetFile("Write", JSON.stringify({ file_path: "/repo/b.ts", content: "z" })), "/repo/b.ts");
  assert.equal(toolTargetFile("Read", JSON.stringify({ file_path: "/repo/c.ts" })), "/repo/c.ts");
  assert.equal(
    toolTargetFile("NotebookEdit", JSON.stringify({ notebook_path: "/repo/n.ipynb", new_source: "q" })),
    "/repo/n.ipynb",
  );
  // Case-insensitive tool name.
  assert.equal(toolTargetFile("edit", JSON.stringify({ path: "/repo/d.ts" })), "/repo/d.ts");
  assert.equal(
    toolTargetPath("Edit", JSON.stringify({ file_path: "src/rel.ts", old_string: "x", new_string: "y" })),
    "src/rel.ts",
    "relative mutation paths remain displayable in chat even though they are not openable",
  );

  // Non-file tools → null.
  assert.equal(toolTargetFile("Bash", JSON.stringify({ command: "ls" })), null);
  assert.equal(toolTargetFile("Grep", JSON.stringify({ pattern: "x", path: "/repo" })), null);

  // Relative paths are NOT openable (the preview needs an absolute path) → null.
  assert.equal(toolTargetFile("Edit", JSON.stringify({ file_path: "src/rel.ts" })), null);
  // Missing path / unparseable / empty → null.
  assert.equal(toolTargetFile("Edit", JSON.stringify({ old_string: "x", new_string: "y" })), null);
  assert.equal(toolTargetFile("Edit", "not json"), null);
  assert.equal(toolTargetFile("Edit", ""), null);
  assert.equal(toolTargetFile("Edit", null), null);
}

// ── wiring: chat dispatches, code rail handles, workspace bridges ────────────
const chatView = await readFile(new URL("../components/chat-view.tsx", import.meta.url), "utf8");
const workspace = await readFile(new URL("../components/workspace.tsx", import.meta.url), "utf8");
const chatSurface = await readFile(new URL("../components/chat-surface.tsx", import.meta.url), "utf8");

assert.match(
  chatView,
  /toolTargetFile\(tool\.name, tool\.input\)/,
  "ToolBlock derives the openable target file from the tool input",
);
assert.match(
  chatView,
  /dispatchEvent\(\s*new CustomEvent\(isEditTool \? "cave:open-file-diff" : "cave:open-project-file", \{\s*detail: \{ path: targetFile \},/,
  "clicking a tool's file dispatches the diff jump for edit tools, else the file preview",
);
// Click must not also toggle the <details> open/closed.
assert.match(chatView, /openTargetFile = \(e: ReactMouseEvent\) => \{[\s\S]*?stopPropagation\(\)/, "open handler stops propagation");

// (ComuxView's cave:open-project-file listener left with the component,
// cave-c3yt — the chat code rail below is the live consumer.)
assert.match(
  workspace,
  /File\/diff links target ChatSurface's code rail[\s\S]*?setPendingCodeRailOpen\([\s\S]*?setMode\("chat"\)/,
  "workspace preserves file-open event detail while switching into chat",
);
assert.match(
  chatSurface,
  /addEventListener\("cave:open-project-file"[\s\S]*addEventListener\("cave:open-file-diff"[\s\S]*openCodeRailTarget/,
  "chat surface routes file and diff open events into the code rail",
);

console.log("tool-target-file.test.ts: ok");
