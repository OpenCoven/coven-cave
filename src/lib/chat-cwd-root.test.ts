// @ts-nocheck
import assert from "node:assert/strict";
import { resolveRootedCwd } from "./chat-cwd-root.ts";

assert.equal(
  resolveRootedCwd("", "/Users/buns/Documents/GitHub", null),
  "/Users/buns/Documents/GitHub",
  "blank CWD uses the configured root",
);

assert.equal(
  resolveRootedCwd("OpenCoven/coven-cave", "/Users/buns/Documents/GitHub", null),
  "/Users/buns/Documents/GitHub/OpenCoven/coven-cave",
  "relative CWD resolves below the configured root",
);

assert.equal(
  resolveRootedCwd("/tmp/override", "/Users/buns/Documents/GitHub", null),
  "/tmp/override",
  "absolute CWD overrides the configured root",
);

assert.equal(
  resolveRootedCwd("OpenCoven/coven", "", "/Users/buns/Documents/GitHub"),
  "/Users/buns/Documents/GitHub/OpenCoven/coven",
  "relative CWD falls back to the pending project root when ROOT is empty",
);

assert.equal(
  resolveRootedCwd("", "", null),
  "",
  "no root and no CWD sends no projectRoot",
);

console.log("chat-cwd-root.test.ts: ok");
