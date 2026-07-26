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

const surfaceRoom = stripComments(read("src/components/role-surfaces/surface-room.tsx"));
const host = stripComments(read("src/components/role-surface-host.tsx"));
const css = stripComments(read("src/styles/globals/surface-role-workspaces.css"));

assert.match(surfaceRoom, /\bSurfaceLoading\b/, "surface-room exports SurfaceLoading");
assert.match(surfaceRoom, /\bSurfaceError\b/, "surface-room exports SurfaceError");
assert.match(surfaceRoom, /role="status"/, "shared loading state uses role=status");
assert.match(surfaceRoom, /role="alert"/, "shared error state uses role=alert");

assert.match(host, /\bOverflowMenu\b/, "host uses OverflowMenu");
assert.doesNotMatch(host, /role-surface-commands-menu/, "host no longer contains role-surface-commands-menu");

assert.match(css, /container-type:\s*inline-size/, "role-surface workspaces use inline-size containers");
assert.match(css, /@container\s+role-surface-room/, "role-surface workspaces declare a room container query");
assert.doesNotMatch(
  css,
  /\.role-surface-status-dot--ok\s*\{[\s\S]*?oklch[\s\S]*?\}/,
  "role-surface-status-dot--ok no longer hardcodes oklch",
);

console.log("role-surface room contract: ok");
