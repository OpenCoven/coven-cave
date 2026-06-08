// @ts-nocheck
import assert from "node:assert/strict";
import path from "node:path";
import {
  classifyMemoryFilePath,
  memoryFileSourcesForHome,
} from "./memory-file-sources.ts";

const home = "/Users/val";
const sources = memoryFileSourcesForHome(home);

assert.deepEqual(
  sources.map((source) => ({
    id: source.id,
    kind: source.kind,
    label: source.label,
    rootPath: source.rootPath,
  })),
  [
    {
      id: "coven-origin",
      kind: "coven-origin",
      label: "Coven native memory",
      rootPath: path.join(home, ".coven", "memory"),
    },
    {
      id: "openclaw-workspace",
      kind: "external-harness",
      label: "OpenClaw harness memory",
      rootPath: path.join(home, ".openclaw", "workspace", "memory"),
    },
    {
      id: "openclaw-index",
      kind: "external-harness",
      label: "OpenClaw workspace index",
      rootPath: path.join(home, ".openclaw", "workspace", "MEMORY.md"),
    },
    {
      id: "codex-runtime",
      kind: "runtime",
      label: "Codex runtime memory",
      rootPath: path.join(home, ".codex", "memories"),
    },
  ],
  "memory file sources should separate native Coven origin memory from external harness and runtime roots",
);

const native = classifyMemoryFilePath(path.join(home, ".coven", "memory", "nova.md"), home);
assert.equal(native?.kind, "coven-origin");
assert.equal(native?.origin, "coven");
assert.equal(native?.root, "coven-origin");
assert.equal(native?.rootLabel, "Coven native memory");

const familiar = classifyMemoryFilePath(
  path.join(home, ".openclaw", "workspace", "echo", "memory", "failure.md"),
  home,
);
assert.equal(familiar?.kind, "external-harness");
assert.equal(familiar?.harnessId, "openclaw");
assert.equal(familiar?.familiarId, "echo");
assert.equal(familiar?.root, "familiar:echo");
assert.equal(familiar?.rootLabel, "Echo harness memory");

const runtime = classifyMemoryFilePath(path.join(home, ".codex", "memories", "MEMORY.md"), home);
assert.equal(runtime?.kind, "runtime");
assert.equal(runtime?.runtimeId, "codex");
assert.equal(runtime?.root, "codex-runtime");
assert.equal(runtime?.rootLabel, "Codex runtime memory");

assert.equal(
  classifyMemoryFilePath(path.join(home, ".ssh", "config"), home),
  null,
  "unrelated local files should not be treated as memory API sources",
);

console.log("memory-file-sources.test.ts: ok");
