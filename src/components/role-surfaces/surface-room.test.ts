import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

// Strip comments so prose references don't satisfy source-contract checks.
const stripComments = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/([^:"'])\/\/[^\n"]*$/gm, "$1");

const extractBlock = (source: string, selector: string) => {
  const start = source.indexOf(selector);
  assert.ok(start >= 0, `${selector} block missing`);

  const open = source.indexOf("{", start);
  assert.ok(open >= 0, `${selector} block missing opening brace`);

  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }

  assert.fail(`${selector} block missing closing brace`);
};

const surfaceRoom = stripComments(read("src/components/role-surfaces/surface-room.tsx"));
const errorState = stripComments(read("src/components/ui/error-state.tsx"));
const host = stripComments(read("src/components/role-surface-host.tsx"));
const css = stripComments(read("src/styles/globals/surface-role-workspaces.css"));

assert.match(surfaceRoom, /export function SurfaceLoading\b/, "surface-room exports SurfaceLoading");
assert.match(surfaceRoom, /export function SurfaceError\b/, "surface-room exports SurfaceError");
assert.match(surfaceRoom, /role="status"/, "shared loading state uses role=status");
assert.match(surfaceRoom, /<ErrorState\b/, "SurfaceError renders the shared ErrorState");
assert.match(errorState, /role="alert"/, "shared error state uses role=alert");

assert.match(host, /<OverflowMenu\b/, "host uses OverflowMenu in JSX");
assert.doesNotMatch(host, /role-surface-commands-menu/, "host no longer contains role-surface-commands-menu");

const roomBlock = extractBlock(css, ".role-surface-room");
assert.ok(
  /container:\s*role-surface-room\s*\/\s*inline-size/.test(roomBlock) ||
    (/container-type:\s*inline-size/.test(roomBlock) && /container-name:\s*role-surface-room/.test(roomBlock)),
  "role-surface-room uses an inline-size container named role-surface-room",
);
assert.match(css, /@container\s+role-surface-room/, "role-surface workspaces declare a room container query");
const okBlock = extractBlock(css, ".role-surface-status-dot--ok");
assert.doesNotMatch(okBlock, /oklch\(/, "role-surface-status-dot--ok no longer hardcodes oklch");

console.log("role-surface room contract: ok");
