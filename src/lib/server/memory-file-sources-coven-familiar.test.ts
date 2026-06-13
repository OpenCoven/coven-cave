import assert from "node:assert/strict";
import { classifyMemoryFilePath } from "./memory-file-sources.ts";
const home = "/home/u";
const dream = "/home/u/.coven/workspaces/familiars/kitty/memory/dreaming/light/2026-04-26.md";
const c = classifyMemoryFilePath(dream, home);
assert.ok(c, "coven familiar dream path must classify");
assert.equal(c?.familiarId, "kitty");
assert.equal(c?.sourceKind, "coven-origin");
// OpenClaw still works:
const ocl = classifyMemoryFilePath("/home/u/.openclaw/workspace/sage/memory/note.md", home);
assert.equal(ocl?.familiarId, "sage");
console.log("memory-file-sources-coven-familiar.test: ok");
