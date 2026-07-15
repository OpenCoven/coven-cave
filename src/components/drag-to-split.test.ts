import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

// Source-text guards for the drag-to-split feature: a sidebar page can be
// dragged into the main area to open beside the current surface, resized with
// modern-desktop snapping, and the old right companion panel is gone.

test("sidebar nav rows are draggable and emit the page-drag protocol", () => {
  const src = read("./sidebar-minimal.tsx");
  assert.match(src, /draggable=\{draggable \|\| undefined\}/, "rows opt into native drag");
  assert.match(src, /isSplittablePage\(id\)/, "draggability gated on splittable pages");
  assert.match(src, /emitPageDragStart\(\{ mode: id, label \}\)/, "dragstart announces the page");
  assert.match(src, /emitPageDragEnd\(\)/, "dragend clears the drop zone");
  assert.match(src, /setData\(PAGE_DRAG_MIME, id\)/, "carries the namespaced MIME");
});

test("DetailSplitHost renders drop zones + a snapping divider", () => {
  const src = read("./detail-split-host.tsx");
  assert.match(src, /split-dropzone__half--left/, "left snap target");
  assert.match(src, /split-dropzone__half--right/, "right snap target");
  assert.match(src, /onDropPage\(drag\.mode, side\)/, "drop opens the page on a side");
  // Snapping on divider release goes through the pure resolver.
  assert.match(src, /resolveSplitRelease\(ratioRef\.current\)/);
  assert.match(src, /release\.action === "close"/, "drag past the near edge closes the split");
  assert.match(src, /secRef\.current\?\.resize\(PCT\(release\.ratio\)\)/, "snaps via imperative resize");
  assert.match(src, /nearestSnap\(dragRatio\)/, "live snap guide");
  // Dragging past the FAR edge collapses the primary and promotes the secondary.
  assert.match(src, /release\.action === "collapse"/, "drag past the far edge collapses the primary");
  assert.match(src, /onPromoteTile\(tile\.id\)/, "collapse promotes the secondary tile to the sole surface");
  assert.match(src, /split-host__guide--collapse/, "far-edge drag shows the fill guide");
});

test("the divider is seamless: no ratio buttons, magnetic even-split, double-click reset", () => {
  const src = read("./detail-split-host.tsx");
  // The clumsy ⅓ · ½ · ⅔ button row is gone — the divider itself is the control.
  assert.doesNotMatch(src, /Snap to a third/, "no ⅓ button");
  assert.doesNotMatch(src, /Snap to two thirds/, "no ⅔ button");
  assert.doesNotMatch(src, /snapTo\(/, "no per-ratio snap button handler");
  // Double-click the divider resets to an even split (replaces the ½ button).
  assert.match(src, /addEventListener\("dblclick"/, "double-click handled");
  assert.match(src, /closest\(".split-host__sep"\)[\s\S]*resize\(PCT\(SPLIT_DEFAULT_RATIO\)\)/, "double-click resets to even");
  // A hover/drag grip affordance on the seam.
  assert.match(src, /split-host__grip/, "divider shows a grip affordance");
  assert.match(src, /data-resizing=/, "group flags an active resize for grip feedback");
});

test("DetailSplitHost supports optimized variants for up to four visible pages", () => {
  const src = read("./detail-split-host.tsx");
  assert.match(src, /secondaryTiles: DetailSplitTile\[\]/, "host receives multiple secondary tiles");
  assert.match(src, /workspaceTileVariant\(tiles\.length\)/, "host chooses a layout variant from visible tile count");
  assert.match(src, /data-variant=\{variant\}/, "variant is exposed to CSS");
  assert.match(src, /split-host__mobile-switcher/, "mobile/tablet gets a tile switcher instead of cramped panes");
  assert.match(src, /onCloseTile\(tile\.id\)/, "each secondary tile can be closed independently");
});

test("Shell hosts the split inside the detail main with a drop zone", () => {
  const src = read("./shell.tsx");
  assert.match(src, /import \{ DetailSplitHost, type DetailSplitTile \}/);
  assert.match(src, /<DetailSplitHost[\s\S]*?primary=\{detail\}[\s\S]*?secondaryTiles=\{splitTiles\}/);
  assert.match(src, /onPromoteTile=\{\(id\) => onPromoteSplitTile\?\.\(id\)\}/, "forwards the promote handler");
  assert.match(src, /enableDrop=\{!isMobile\}/, "drop zone is desktop-only");
});

test("workspace owns split state and the drop handler, and reuses renderSurface", () => {
  const src = read("./workspace.tsx");
  assert.match(src, /const \[splitTargets, setSplitTargets\] = useState<SplitTarget\[\]>\(\[\]\)/);
  assert.match(src, /const openSplitPage = useCallback/);
  assert.match(src, /addSecondaryWorkspaceTile/, "workspace appends split pages up to the secondary tile cap");
  assert.match(src, /const renderSurface = \(mode: CaveMode\): ReactNode =>/);
  assert.match(src, /\{renderSurface\(mode\)\}/, "primary uses renderSurface");
  assert.match(src, /renderSurface\(target\.mode\)/, "secondary tiles reuse the same machinery");
  assert.match(src, /onDropSplitPage=\{openSplitPage\}/);
  assert.match(src, /addSplitTarget\(\{ kind: "salem" \}\)/, "Salem re-homed into the split (not the removed rail)");
  // Far-edge collapse promotes a page split to the primary via setMode.
  assert.match(src, /const promoteSplitTile = useCallback/, "workspace owns the promote handler");
  assert.match(src, /if \(target\?\.kind === "page"\) setMode\(target\.mode\)/, "promoting a page switches the primary mode");
  assert.match(src, /onPromoteSplitTile=\{promoteSplitTile\}/, "promote handler is passed to Shell");
});

test("the right companion (agent) panel is no longer mounted", () => {
  const src = read("./workspace.tsx");
  assert.doesNotMatch(src, /agent=\{/, "no agent panel is passed to Shell");
  assert.doesNotMatch(src, /<CompanionRail/, "CompanionRail is not rendered");
});

test("split tiles keep a usability floor (cave-hivd)", () => {
  const host = read("./detail-split-host.tsx");
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  // Multi-tile panels floor at 300px — a 12% min let dividers crush a tile to
  // ~110px letter soup on wide windows (tiles close via ✕, not drag-past-edge).
  assert.match(host, /id=\{`split-tile-\$\{tile\.id\}`\}[\s\S]{0,500}minSize="300px"/, "multi-tile panels have a pixel min");
  // The legacy two-pane path keeps its ratio min (the drag-to-close zone needs
  // it) — its CONTENT floors instead: pane bodies scroll horizontally under 300px.
  assert.match(host, /id="split-secondary"[\s\S]{0,300}minSize="10%"/, "legacy secondary keeps the ratio min for the close gesture");
  assert.match(css, /\.split-host__pane-body \{[\s\S]{0,220}overflow-x: auto/, "pane bodies scroll instead of crushing");
  assert.match(css, /\.split-host__pane-body > \* \{[\s\S]{0,400}min-width: 300px/, "pane content has the 300px floor");
  // The legacy primary shares the same body treatment.
  assert.match(host, /<div className="split-host__pane-body">\{primary\}<\/div>/, "legacy primary content uses the pane body class");
});

test("surfaces size their grids by PANE, not viewport (cave-hivd)", () => {
  // In a split tile, a wide window must not force wide-viewport column counts.
  const roster = readFileSync(new URL("./familiars-view.tsx", import.meta.url), "utf8");
  assert.match(roster, /@container p-4/, "familiars roster declares its container");
  assert.match(roster, /@min-\[700px\]:grid-cols-2 @min-\[1050px\]:grid-cols-3 @min-\[1400px\]:grid-cols-4/, "roster columns are container-keyed");
  assert.doesNotMatch(roster, /xl:grid-cols-4/, "the viewport-keyed roster grid must not return");
  const card = readFileSync(new URL("./capability-card.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(card, /sm:grid-cols-2/, "capability cards are no longer viewport-keyed");
  const autos = readFileSync(new URL("./automations-view.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(autos, /sm:grid-cols-2/, "cron detail grids are no longer viewport-keyed");
  const subs = readFileSync(new URL("./opencoven-submission-panel.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(subs, /xl:grid-cols-\[/, "the submissions side-by-side layout is no longer viewport-keyed");
});
