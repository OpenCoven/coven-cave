import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { access } from "node:fs/promises";

const read = (rel) => readFile(new URL(`../${rel}`, import.meta.url), "utf8");
const iosRoot = "apps/ios/CovenCave/CovenCave";

const model = await read(`${iosRoot}/State/AppModel.swift`);
const root = await read(`${iosRoot}/Views/RootView.swift`);
const client = await read(`${iosRoot}/Networking/CaveClient.swift`);
const slash = await read(`${iosRoot}/Models/SlashCommand.swift`);

// The bottom-tab enum no longer carries a canvas case (or a read case).
assert.match(
  model,
  /enum AppTab: String \{ case chats, tasks, calendar, dev, settings \}/,
  "AppTab should drop the canvas and read cases (calendar is fine)",
);
const appTabLine = model.match(/enum AppTab: String \{[^}]*\}/)?.[0] ?? "";
assert.doesNotMatch(appTabLine, /\bcanvas\b/, "AppTab case list should not include canvas");
assert.doesNotMatch(appTabLine, /\bread\b/, "AppTab case list should not include read");

// The app opens on Chats now that Canvas (and Read) are gone.
assert.match(model, /var selectedTab: AppTab = \.chats/, "default tab should be chats");

// The tab bar no longer mounts a Canvas/Read tab and no longer re-asserts them.
assert.doesNotMatch(root, /Tab\("Canvas"/, "RootView should not declare a Canvas tab");
assert.doesNotMatch(root, /CanvasView\(\)/, "RootView should not instantiate CanvasView");
assert.doesNotMatch(root, /selectedTab = \.canvas/, "RootView should not re-assert the canvas tab");
assert.doesNotMatch(root, /Tab\("Read"/, "RootView should not declare a Read tab");
assert.doesNotMatch(root, /ReadingView\(\)/, "RootView should not instantiate ReadingView");
assert.doesNotMatch(root, /selectedTab = \.read/, "RootView should not re-assert the read tab");

// The dormant Canvas + Read code is fully removed.
for (const rel of [
  `${iosRoot}/Models/CanvasArtifact.swift`,
  `${iosRoot}/Views/CanvasView.swift`,
  `${iosRoot}/Views/ArtifactDetailView.swift`,
  `${iosRoot}/Views/ArtifactWebView.swift`,
  `${iosRoot}/Models/ReadingItem.swift`,
  `${iosRoot}/Views/ReadingView.swift`,
  `${iosRoot}/Views/SafariReaderView.swift`,
]) {
  await assert.rejects(
    access(new URL(`../${rel}`, import.meta.url)),
    `${rel} should be deleted`,
  );
}
assert.doesNotMatch(model, /canvasArtifacts|generateArtifact|refineArtifact|loadCanvas/, "AppModel should drop canvas state/actions");
assert.doesNotMatch(model, /loadReading|setReadingStatus|deleteReading|setReadingProgress|var reading:/, "AppModel should drop reading state/actions");
assert.doesNotMatch(client, /canvasArtifacts|saveCanvasArtifact|deleteCanvasArtifact|api\/canvas/, "CaveClient should drop the canvas endpoints");
// The old *mutable* Reading surface stays gone. The read-only Library
// (Developer › Library) legitimately GETs /api/library/reading, so that path is
// allowed — only the removed reading mutations are forbidden.
assert.doesNotMatch(client, /func reading\(\)|updateReading|deleteReading|setReadingProgress/, "CaveClient should drop the old mutable reading endpoints");
assert.doesNotMatch(slash, /\/canvas|buildSketchPrompt|case sketch/, "the /canvas slash command should be removed");

console.log("ios-no-canvas-tab.test.mjs: ok");
