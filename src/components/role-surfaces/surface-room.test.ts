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
const roomLayout = extractExport(surfaceRoom, "SurfaceRoom");
const surfaceRail = extractExport(surfaceRoom, "SurfaceRail");
const loadingState = extractExport(surfaceRoom, "SurfaceLoading");
const roomErrorState = extractExport(surfaceRoom, "SurfaceError");
const emptyState = extractExport(surfaceRoom, "SurfaceEmpty");

assert.match(surfaceRoom, /export function SurfaceLoading\b/, "surface-room exports SurfaceLoading");
assert.match(surfaceRoom, /export function SurfaceError\b/, "surface-room exports SurfaceError");
assert.match(loadingState, /<SkeletonRows\b/, "SurfaceLoading renders shared skeleton rows");
assert.match(loadingState, /live\?: boolean/, "SurfaceLoading exposes the shared live-region opt-out");
assert.match(
  loadingState,
  /role=\{live \? "status" : undefined\}/,
  "shared loading state can suppress duplicate status announcements",
);
assert.match(loadingState, /aria-label=\{label\}/, "shared loading state is named for the object being loaded");
assert.match(loadingState, />\{label\}<\/span>/, "shared loading state keeps its object label visible");
assert.match(roomErrorState, /<ErrorState[\s\S]*?\bcompact\b/, "SurfaceError renders compact shared ErrorState");
assert.match(roomErrorState, /live\?: boolean/, "SurfaceError exposes the shared live-region opt-out");
assert.match(roomErrorState, /live=\{live\}/, "SurfaceError forwards its live-region behavior");
assert.match(
  roomErrorState,
  /<Button[\s\S]*?\bsize="sm"[\s\S]*?>\s*Retry\s*<\/Button>/,
  "SurfaceError uses the shared small Retry button",
);
assert.match(errorState, /role=\{live \? "alert" : undefined\}/, "shared error state can suppress duplicate alerts");
assert.match(emptyState, /<EmptyState[\s\S]*?\bcompact\b/, "SurfaceEmpty renders compact shared EmptyState");
assert.match(emptyState, /actions=\{action\}/, "SurfaceEmpty forwards its optional action");

assert.doesNotMatch(
  surfaceRoom,
  /\bChildren\b|\bisValidElement\b|child\.type|getRailLabels/,
  "SurfaceRoom never introspects child component identity",
);
assert.doesNotMatch(roomLayout, /\buseId\(/, "rail ids belong to each SurfaceRail instance");
assert.equal(surfaceRail.match(/\buseId\(\)/g)?.length, 1, "each SurfaceRail owns one stable React id");
assert.match(surfaceRoom, /expanded\?: boolean/, "SurfaceRail accepts controlled disclosure state");
assert.match(
  surfaceRoom,
  /onExpandedChange\?: \(next: boolean\) => void/,
  "SurfaceRail reports controlled disclosure changes",
);
assert.match(surfaceRail, /useState\(false\)/, "SurfaceRail remains uncontrolled by default");
assert.match(surfaceRail, /<Button\b/, "each rail owns its native keyboard disclosure control");
assert.match(surfaceRail, /createPortal\(/, "each rail registers its disclosure without parent child inspection");
assert.match(surfaceRail, /aria-label=\{`\$\{isExpanded \? "Hide" : "Show"\} \$\{label\}`\}/, "control is labeled by rail");
assert.match(surfaceRail, /aria-expanded=\{isExpanded\}/, "control exposes its disclosure state");
assert.match(surfaceRail, /aria-controls=\{railId\}/, "control identifies its own unique rail");
assert.match(surfaceRail, /id=\{railId\}/, "rail owns the target id referenced by its control");
assert.match(surfaceRail, /role-surface-rail--expanded/, "SurfaceRail exposes its expanded presentation state");
assert.ok(
    /useRef<HTMLButtonElement \| null>\(null\)/.test(surfaceRail) &&
    /useRef<HTMLElement \| null>\(null\)/.test(surfaceRail) &&
    /getComputedStyle\(disclosureTarget\)\.display === "none"/.test(surfaceRail) &&
    /useEffect\([\s\S]*?requestAnimationFrame\([\s\S]*?querySelector<HTMLElement>[\s\S]*?\.focus\(\)/.test(surfaceRail) &&
    /e\.key !== "Escape"/.test(surfaceRail) &&
    /setExpanded\(false\)/.test(surfaceRail) &&
    /requestAnimationFrame\([\s\S]*?disclosureRef\.current\?\.focus\(\)/.test(surfaceRail) &&
    /ref=\{disclosureRef\}/.test(surfaceRail) &&
    /className=\{`role-surface-disclosure[\s\S]*?focus-ring/.test(surfaceRail) &&
    /ref=\{railRef\}/.test(surfaceRail) &&
    /tabIndex=\{-1\}/.test(surfaceRail) &&
    /onKeyDown=\{onRailKeyDown\}/.test(surfaceRail),
  "adaptive rail overlays focus on open and close with Escape back to their own trigger",
);

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
const columnsBlock = extractBlock(css, ".role-surface-columns");
assert.match(columnsBlock, /position:\s*relative/, "room columns anchor on-demand rail overlays");
const disclosureBlock = extractBlock(css, ".role-surface-disclosures");
assert.match(disclosureBlock, /display:\s*none/, "wide rooms hide disclosure controls");
assert.match(
  css,
  /@media\s*\(pointer:\s*coarse\)\s*\{[\s\S]*?\.role-surface-disclosure\s*\{[\s\S]*?min-width:\s*var\(--touch-target\)[\s\S]*?min-height:\s*var\(--touch-target\)/,
  "coarse-pointer rail disclosures use the shared touch target",
);
const mediumRoomBlock = extractBlock(css, "@container role-surface-room (max-width: 860px)");
assert.match(mediumRoomBlock, /\.role-surface-disclosures\s*\{[\s\S]*?display:\s*flex/, "medium rooms show disclosures");
assert.match(
  mediumRoomBlock,
  /\.role-surface-disclosure--left\s*\{[\s\S]*?display:\s*none/,
  "medium rooms keep the left disclosure hidden",
);
assert.match(
  mediumRoomBlock,
  /\.role-surface-rail--right\s*\{[\s\S]*?display:\s*none/,
  "medium rooms make only right rails on-demand",
);
assert.match(
  mediumRoomBlock,
  /\.role-surface-rail--right\.role-surface-rail--expanded\s*\{[\s\S]*?display:\s*flex[\s\S]*?position:\s*absolute[\s\S]*?grid-area:\s*canvas/,
  "medium rooms overlay an expanded right inspector without collapsing the canvas",
);
const compactRoomBlock = extractBlock(css, "@container role-surface-room (max-width: 620px)");
assert.match(
  compactRoomBlock,
  /\.role-surface-disclosure--left\s*\{[\s\S]*?display:/,
  "compact rooms restore the left disclosure",
);
assert.match(
  compactRoomBlock,
  /\.role-surface-rail--left\s*,\s*\.role-surface-rail--right\s*\{[\s\S]*?display:\s*none/,
  "compact rooms make both rails on-demand",
);
assert.match(
  compactRoomBlock,
  /\.role-surface-rail--expanded\s*\{[\s\S]*?display:\s*flex[\s\S]*?position:\s*absolute[\s\S]*?grid-area:\s*canvas/,
  "compact rooms overlay either expanded rail without collapsing the canvas",
);
const okBlock = extractBlock(css, ".role-surface-status-dot--ok");
assert.doesNotMatch(okBlock, /oklch\(/, "role-surface-status-dot--ok no longer hardcodes oklch");

console.log("role-surface room contract: ok");
