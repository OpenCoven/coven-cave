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

const extractExport = (source: string, name: string) => {
  const start = source.indexOf(`export function ${name}`);
  assert.ok(start >= 0, `${name} export missing`);
  const next = source.indexOf("\nexport function ", start + 1);
  return source.slice(start, next >= 0 ? next : source.length);
};

const surfaceRoom = stripComments(read("src/components/role-surfaces/surface-room.tsx"));
const errorState = stripComments(read("src/components/ui/error-state.tsx"));
const host = stripComments(read("src/components/role-surface-host.tsx"));
const css = stripComments(read("src/styles/globals/surface-role-workspaces.css"));
const loadingState = extractExport(surfaceRoom, "SurfaceLoading");
const roomErrorState = extractExport(surfaceRoom, "SurfaceError");
const emptyState = extractExport(surfaceRoom, "SurfaceEmpty");

assert.match(surfaceRoom, /export function SurfaceLoading\b/, "surface-room exports SurfaceLoading");
assert.match(surfaceRoom, /export function SurfaceError\b/, "surface-room exports SurfaceError");
assert.match(loadingState, /<SkeletonRows\b/, "SurfaceLoading renders shared skeleton rows");
assert.match(loadingState, /role="status"/, "shared loading state uses role=status");
assert.match(loadingState, /aria-label=\{label\}/, "shared loading state is named for the object being loaded");
assert.match(loadingState, />\{label\}<\/span>/, "shared loading state keeps its object label visible");
assert.match(roomErrorState, /<ErrorState[\s\S]*?\bcompact\b/, "SurfaceError renders compact shared ErrorState");
assert.match(
  roomErrorState,
  /<Button[\s\S]*?\bsize="sm"[\s\S]*?>\s*Retry\s*<\/Button>/,
  "SurfaceError uses the shared small Retry button",
);
assert.match(errorState, /role="alert"/, "shared error state uses role=alert");
assert.match(emptyState, /<EmptyState[\s\S]*?\bcompact\b/, "SurfaceEmpty renders compact shared EmptyState");
assert.match(emptyState, /actions=\{action\}/, "SurfaceEmpty forwards its optional action");

assert.equal(surfaceRoom.match(/useState\(false\)/g)?.length, 2, "both room rail disclosures start closed");
assert.match(surfaceRoom, /aria-expanded=\{leftRailOpen\}/, "left rail control exposes expanded state");
assert.match(surfaceRoom, /aria-expanded=\{rightRailOpen\}/, "right rail control exposes expanded state");
assert.match(surfaceRoom, /aria-controls=\{railIds\.left\}/, "left rail control identifies its rail");
assert.match(surfaceRoom, /aria-controls=\{railIds\.right\}/, "right rail control identifies its rail");
assert.match(surfaceRoom, /id=\{disclosure\?\.ids\[side\]\}/, "SurfaceRail receives a stable disclosure target id");
assert.match(surfaceRoom, /role-surface-rail--expanded/, "SurfaceRail exposes its local expanded presentation state");

assert.match(host, /<OverflowMenu\b/, "host uses OverflowMenu in JSX");
assert.doesNotMatch(host, /role-surface-commands-menu/, "host no longer contains role-surface-commands-menu");

const roomBlock = extractBlock(css, ".role-surface-room");
assert.ok(
  /container:\s*role-surface-room\s*\/\s*inline-size/.test(roomBlock) ||
    (/container-type:\s*inline-size/.test(roomBlock) && /container-name:\s*role-surface-room/.test(roomBlock)),
  "role-surface-room uses an inline-size container named role-surface-room",
);
assert.match(css, /@container\s+role-surface-room/, "role-surface workspaces declare a room container query");
assert.doesNotMatch(css, /@media\s*\(max-width:\s*1023px\)/, "room layout no longer responds to viewport width");
const narrowRoomBlock = extractBlock(css, "@container role-surface-room");
assert.match(narrowRoomBlock, /\.role-surface-disclosures\s*\{[\s\S]*?display:\s*flex/, "narrow rooms show rail controls");
assert.match(narrowRoomBlock, /\.role-surface-rail\s*\{[\s\S]*?display:\s*none/, "narrow rooms hide rails by default");
assert.match(
  narrowRoomBlock,
  /\.role-surface-rail--expanded\s*\{[\s\S]*?display:\s*flex/,
  "narrow rooms reveal an expanded rail",
);
const okBlock = extractBlock(css, ".role-surface-status-dot--ok");
assert.doesNotMatch(okBlock, /oklch\(/, "role-surface-status-dot--ok no longer hardcodes oklch");

console.log("role-surface room contract: ok");
