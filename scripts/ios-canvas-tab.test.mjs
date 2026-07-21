import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (rel) => readFile(new URL(`../${rel}`, import.meta.url), "utf8");
const iosRoot = "apps/ios/CovenCave/CovenCave";

const model = await read(`${iosRoot}/State/AppModel.swift`);
const root = await read(`${iosRoot}/Views/RootView.swift`);
const client = await read(`${iosRoot}/Networking/CaveClient.swift`);
const artifact = await read(`${iosRoot}/Models/CanvasArtifact.swift`);
const detail = await read(`${iosRoot}/Views/ArtifactDetailView.swift`);
const webView = await read(`${iosRoot}/Views/ArtifactWebView.swift`);
const canvas = await read(`${iosRoot}/Views/CanvasView.swift`);

const boundedSlice = (source, startMarker, endMarker, label) => {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `${label}: missing start marker "${startMarker}"`);

  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `${label}: missing end marker "${endMarker}"`);
  assert(end > start, `${label}: end marker "${endMarker}" must follow start marker "${startMarker}"`);

  return source.slice(start, end);
};

const assertOrdered = (source, markers, label) => {
  let cursor = -1;
  for (const marker of markers) {
    const next = source.indexOf(marker, cursor + 1);
    assert.notEqual(next, -1, `${label}: missing "${marker}"`);
    assert(next > cursor, `${label}: "${marker}" must appear after the previous marker`);
    cursor = next;
  }
};

assert.match(model, /enum AppTab: String \{[^}]*\bcanvas\b[^}]*\}/, "AppTab includes Canvas");
assert.match(root, /Tab\("Canvas"[\s\S]*CanvasView\(\)/, "RootView mounts the native Canvas tab");
assert.match(client, /expectedUpdatedAt[\s\S]*expectedAbsent[\s\S]*resolvedAnnotations/, "Canvas saves use guarded revisions");
assert.match(client, /method: "PATCH"[\s\S]*Canvas annotation save/, "component comments use annotation-only PATCH");
assert.match(artifact, /struct CanvasAnnotation:[\s\S]*CanvasComponentTarget/, "iOS decodes persisted component annotations");
assert.match(detail, /saveCanvasComment[\s\S]*applyCanvasComments/, "detail view saves and applies inline comments");
assert.match(webView, /event\.isTrusted/, "preview selection rejects synthetic clicks");
assert.match(webView, /caveCanvasSelection/, "preview selection crosses a dedicated WKWebView message handler");
assert.match(webView, /WKContentWorld\.world/, "artifact code cannot forge inspector messages from the page world");
assert.match(webView, /setURLSchemeHandler/, "React sandbox assets load through the authenticated native scheme");
assert.match(webView, /Authorization/, "native sandbox asset requests carry the paired credential");
assert.doesNotMatch(detail, /\.onDisappear\s*\{[^}]*cancel/, "leaving Canvas does not cancel generation");
assert.match(canvas, /@Environment\(\\\.accessibilityReduceMotion\)\s+private var reduceMotion/, "Canvas honors Reduce Motion");
assert.match(canvas, /@State\s+private var headerScrollState = CanvasHeaderScrollState\(\)/, "Canvas owns header scroll state");
assert.match(canvas, /@State\s+private var headerControlsVisible = true/, "Canvas tracks header control visibility");
assert.match(canvas, /\.onScrollGeometryChange\(for:\s*CGFloat\.self\)/, "Canvas observes CGFloat scroll geometry");
assert.match(
  canvas,
  /CanvasHeaderScrollState\.normalizedOffset\(\s*contentOffsetY:\s*geometry\.contentOffset\.y,\s*topInset:\s*geometry\.contentInsets\.top\s*\)/,
  "Canvas normalizes scroll offset with the top content inset",
);
assert.match(
  canvas,
  /headerScrollState\.observe\(offset:\s*offset\)/,
  "Canvas forwards scroll changes to the header scroll state",
);
assert.match(
  canvas,
  /guard\s+controlsVisible\s*!=\s*headerControlsVisible\s+else\s*\{\s*return\s*\}/,
  "Canvas no-ops when header visibility is unchanged",
);
assert.match(
  canvas,
  /if\s*!controlsVisible\s*\{\s*promptFocused\s*=\s*false\s*\}\s*withAnimation\(reduceMotion\s*\?\s*nil\s*:\s*\.easeOut\(duration:\s*0\.2\)\)\s*\{\s*headerControlsVisible\s*=\s*controlsVisible\s*\}/s,
  "Canvas clears focus before animating the header visibility change",
);

const header = boundedSlice(
  canvas,
  "    private var header: some View {",
  "    private var titleRow: some View {",
  "Canvas header",
);

const titleRow = boundedSlice(
  canvas,
  "    private var titleRow: some View {",
  "    private var composer: some View {",
  "Canvas titleRow",
);

assertOrdered(header, ["titleRow", ".zIndex(1)", "if headerControlsVisible {"], "Canvas header order");
assert.match(header, /titleRow\s*\n\s*\.zIndex\(1\)/, "Canvas header keeps titleRow above the collapsible controls");
assert.match(header, /if headerControlsVisible \{[\s\S]*composer[\s\S]*starterBar[\s\S]*\}/, "Canvas header keeps composer and starterBar in the collapsible controls region");
assert.match(header, /\.transition\(\.move\(edge:\s*\.top\)\.combined\(with:\s*\.opacity\)\)/, "Canvas header controls combine a top move with an opacity transition");
assert.match(header, /\.zIndex\(0\)/, "Canvas header assigns zIndex 0 to the collapsible controls");

assert.match(titleRow, /Text\("Canvas"\)/, "Canvas titleRow renders the Canvas title");
assert.match(titleRow, /Text\("\^\[\\\(app\.canvasArtifacts\.count\) artifact\]\(inflect: true\)"\)/, "Canvas titleRow renders the artifact count");

console.log("ios-canvas-tab.test.mjs: ok");
