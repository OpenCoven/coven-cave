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
  assert.match(src, /closest\(".split-host__sep"\)[\s\S]*resizeToEvenSplit\(\)/, "double-click resets to exact even geometry");
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

test("workspace owns normalized split state and renders every registered request", () => {
  const src = read("./workspace.tsx");
  assert.match(src, /const \[splitTargets, setSplitTargets\] = useState<WorkspacePaneRequest\[\]>\(\[\]\)/);
  assert.match(src, /normalizeWorkspacePaneRequest\(nextPaneInstanceId\(\), m\)/);
  assert.match(src, /addSecondaryWorkspaceTile\(prev, target, workspacePaneRequestKey\)/);
  assert.match(src, /function splitTargetRendersMode\(target: WorkspacePaneRequest, mode: WorkspaceMode\): boolean \{[\s\S]*target\.pageId === mode/);
  assert.match(src, /const openSplitPage = useCallback/);
  assert.match(src, /if \(!request \|\| \(primary && workspacePaneRequestKey\(request\) === workspacePaneRequestKey\(primary\)\)\)/, "split drops reject unknown and exact duplicate pages");
  assert.match(src, /const renderSurface = \(mode: CaveMode\): ReactNode =>/);
  assert.match(src, /workspacePageDefinition\(request\.requestedPageId\)/, "secondary title and state come from the registry");
  assert.match(src, /WorkspacePanePage[\s\S]*unavailable=/, "unsupported runtime dependencies have an honest pane-local state");
  assert.match(src, /renderSurface\(request\.pageId\)/, "secondary pages reuse the canonical renderer");
  assert.match(src, /onDropSplitPage=\{openSplitPage\}/);
  assert.match(src, /const promoteSplitTile = useCallback/, "workspace owns the promote handler");
  assert.match(src, /if \(target && isWorkspaceMode\(target\.requestedPageId\)\) setMode\(target\.requestedPageId\)/, "promoting a workspace page switches the primary mode");
  assert.match(src, /onPromoteSplitTile=\{promoteSplitTile\}/, "promote handler is passed to Shell");
  assert.doesNotMatch(src, /type SplitTarget/);
});

test("the right companion (agent) panel is no longer mounted", () => {
  const src = read("./workspace.tsx");
  assert.doesNotMatch(src, /agent=\{/, "no agent panel is passed to Shell");
  assert.doesNotMatch(src, /<CompanionRail/, "CompanionRail is not rendered");
});

test("split panes use their container instead of generic overflow floors", () => {
  const host = read("./detail-split-host.tsx");
  // The pane-body rules' owning split module behind the globals.css facade
  // (cave-xd2kg: source contracts read owning modules, not the facade).
  const css = readFileSync(
    new URL("../styles/globals/surface-chat-overlays.css", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(host, /minSize="300px"/, "tiles must adapt rather than force an overflow floor");
  assert.match(host, /id="split-secondary"[\s\S]{0,300}minSize="10%"/, "legacy secondary keeps the ratio min for the close gesture");
  assert.doesNotMatch(css, /\.split-host__pane-body \{[\s\S]{0,220}overflow-x: auto/, "generic pane bodies do not claim horizontal scrolling");
  assert.doesNotMatch(css, /\.split-host__pane-body > \* \{[\s\S]{0,400}min-width: 300px/, "generic pane content has no minimum-width floor");
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
