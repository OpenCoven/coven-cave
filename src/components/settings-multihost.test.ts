import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./settings-multihost.ts", import.meta.url), "utf8");
assert.match(source, /export function parseExecutorUrls/, "executor normalization has a focused owner");
assert.match(source, /export function parseHostWorkspaceText/, "host workspace parsing has a focused owner");
assert.match(source, /line\.startsWith\("#"\)/, "comment lines remain excluded from persisted mappings");
assert.match(source, /export function formatHostWorkspaceText/, "valid mappings can round-trip into the settings textarea");
