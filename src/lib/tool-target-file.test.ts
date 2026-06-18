// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { toolTargetFile } = await import("./tool-input-diff.ts");

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

// ── wiring: chat dispatches, comux handles, workspace falls back ─────────────
const chatView = await readFile(new URL("../components/chat-view.tsx", import.meta.url), "utf8");
const comux = await readFile(new URL("../components/comux-view.tsx", import.meta.url), "utf8");
const workspace = await readFile(new URL("../components/workspace.tsx", import.meta.url), "utf8");

assert.match(
  chatView,
  /toolTargetFile\(tool\.name, tool\.input\)/,
  "ToolBlock derives the openable target file from the tool input",
);
assert.match(
  chatView,
  /dispatchEvent\(new CustomEvent\("cave:open-project-file", \{ detail: \{ path: targetFile \} \}\)\)/,
  "clicking a tool's file dispatches cave:open-project-file",
);
// Click must not also toggle the <details> open/closed.
assert.match(chatView, /openTargetFile = \(e: ReactMouseEvent\) => \{[\s\S]*?stopPropagation\(\)/, "open handler stops propagation");

assert.match(
  comux,
  /addEventListener\("cave:open-project-file"/,
  "comux listens for cave:open-project-file",
);
assert.match(
  comux,
  /if \(!active\) return;[\s\S]*?setRightView\("files"\);[\s\S]*?openFilePreview\(detail\.path/,
  "the active comux opens the file in the Files preview",
);

assert.match(
  workspace,
  /if \(m === "code" \|\| m === "terminal"\) return;[\s\S]*?setMode\("code"\)[\s\S]*?dispatchEvent\(new CustomEvent\("cave:open-project-file"/,
  "workspace switches to Code mode and re-emits when no comux is showing",
);

console.log("tool-target-file.test.ts: ok");
