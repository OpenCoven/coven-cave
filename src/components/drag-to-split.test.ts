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
  assert.match(src, /release\.action === "close"/, "drag past the edge closes the split");
  assert.match(src, /secRef\.current\?\.resize\(PCT\(release\.ratio\)\)/, "snaps via imperative resize");
  assert.match(src, /nearestSnap\(dragRatio\)/, "live snap guide");
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
  assert.match(src, /enableDrop=\{!isMobile\}/, "drop zone is desktop-only");
});

test("workspace owns split state and the drop handler, and reuses renderSurface", () => {
  const src = read("./workspace.tsx");
  assert.match(src, /const \[splitTargets, setSplitTargets\] = useState<SplitTarget\[\]>\(\[\]\)/);
  assert.match(src, /const openSplitPage = useCallback/);
  assert.match(src, /addSecondaryWorkspaceTile/, "workspace appends split pages up to the secondary tile cap");
  assert.match(src, /const renderSurface = \(mode: WorkspaceMode\): ReactNode =>/);
  assert.match(src, /\{mode === "terminal" \? null : renderSurface\(mode\)\}/, "primary uses renderSurface");
  assert.match(src, /renderSurface\(target\.mode\)/, "secondary tiles reuse the same machinery");
  assert.match(src, /onDropSplitPage=\{openSplitPage\}/);
  assert.match(src, /addSplitTarget\(\{ kind: "salem" \}\)/, "Salem re-homed into the split (not the removed rail)");
});

test("the right companion (agent) panel is no longer mounted", () => {
  const src = read("./workspace.tsx");
  assert.doesNotMatch(src, /agent=\{/, "no agent panel is passed to Shell");
  assert.doesNotMatch(src, /<CompanionRail/, "CompanionRail is not rendered");
});
