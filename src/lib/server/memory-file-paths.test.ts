// @ts-nocheck
import assert from "node:assert/strict";
import path from "node:path";
import { homedir } from "node:os";
import { isAllowedMemoryFilePath } from "./memory-file-paths.ts";

const workspaceRoot = path.join(homedir(), ".openclaw", "workspace");

assert.equal(
  isAllowedMemoryFilePath(path.join(workspaceRoot, "echo", "memory", "failure-radar-2026-06-08.md")),
  true,
  "familiar memory files listed by /api/memory should be readable by /api/memory/file",
);
assert.equal(
  isAllowedMemoryFilePath(path.join(workspaceRoot, "echo", "MEMORY.md")),
  true,
  "familiar MEMORY.md indexes should be readable by /api/memory/file",
);
assert.equal(
  isAllowedMemoryFilePath(path.join(workspaceRoot, "memory", "workspace-note.md")),
  true,
  "shared workspace memory files stay readable",
);
assert.equal(
  isAllowedMemoryFilePath(path.join(homedir(), ".coven", "memory", "note.md")),
  true,
  "shared coven memory files stay readable",
);
assert.equal(
  isAllowedMemoryFilePath(path.join(workspaceRoot, "echo", "roles", "ROLE.md")),
  false,
  "non-memory familiar workspace files must remain blocked",
);
assert.equal(
  isAllowedMemoryFilePath(path.join(workspaceRoot, "..", "agents", "echo", "memory.md")),
  false,
  "paths outside the workspace root must remain blocked",
);

console.log("memory-file-paths.test.ts: ok");
