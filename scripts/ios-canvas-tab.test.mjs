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

console.log("ios-canvas-tab.test.mjs: ok");
