// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const base = new URL("../../apps/ios/CovenCave/CovenCave/", import.meta.url);
const models = readFileSync(new URL("Models/Models.swift", base), "utf8");
const client = readFileSync(new URL("Networking/CaveClient.swift", base), "utf8");
const appModel = readFileSync(new URL("State/AppModel.swift", base), "utf8");
const theme = readFileSync(new URL("Theme/Theme.swift", base), "utf8");
const app = readFileSync(new URL("CovenCaveApp.swift", base), "utf8");
const root = readFileSync(new URL("Views/RootView.swift", base), "utf8");

assert.match(models, /struct ThemeSnapshot:\s*Codable[\s\S]*var tokens:\s*\[String:\s*String\]/, "iOS models decode the /api/theme snapshot tokens");
assert.match(models, /struct ThemeResponse:\s*Codable[\s\S]*let theme:\s*ThemeSnapshot/, "iOS models decode the /api/theme response envelope");

assert.match(client, /func fetchTheme\(\) async throws -> ThemeSnapshot[\s\S]*request\("api\/theme"\)/, "CaveClient fetches GET /api/theme");

assert.match(theme, /struct ChromePalette:\s*Equatable[\s\S]*var bgBase:\s*Color[\s\S]*var accent:\s*Color[\s\S]*var colorScheme:\s*ColorScheme/, "ChromePalette carries app chrome colors and color scheme");
assert.match(theme, /init\(snapshot:\s*ThemeSnapshot\)[\s\S]*--bg-base[\s\S]*--accent-presence[\s\S]*snapshot\.mode\.lowercased\(\) == "light"/, "ChromePalette maps desktop tokens and mode");
assert.match(theme, /extension EnvironmentValues[\s\S]*var chrome:\s*ChromePalette/, "ChromePalette is available through SwiftUI environment");

assert.match(appModel, /var chrome:\s*ChromePalette = \.fallback/, "AppModel owns the current chrome palette");
assert.match(appModel, /func loadTheme\(\) async[\s\S]*client\.fetchTheme\(\)[\s\S]*adopt\(snapshot\)/, "AppModel fetches and adopts the desktop palette");
// cave-9om1 task 5 consolidated the post-connect loads: theme now arrives via
// the concurrent ConnectionBootstrap payload inside loadCoreResources(), which
// runs after connectionState flips to .connected.
assert.match(appModel, /connectionState = \.connected[\s\S]*await (?:loadCoreResources|refreshLoadedSurfaces)\(\)/, "AppModel loads core resources after connecting");
assert.match(appModel, /func loadCoreResources\(\) async[\s\S]*ConnectionBootstrap\.load\(using: client\)[\s\S]*if case \.success\(let snapshot\) = payload\.theme \{ adopt\(snapshot\) \}/, "core-resource bootstrap adopts the theme snapshot");
assert.match(appModel, /private func adopt\(_ snapshot: ThemeSnapshot\)[\s\S]*ChromePalette\(snapshot: snapshot\)/, "adopt maps the snapshot into the chrome palette");

assert.match(app, /\.environment\(\\\.chrome,\s*resolved\.chrome\)[\s\S]*\.tint\(resolved\.chrome\.accent\)[\s\S]*\.preferredColorScheme\(resolved\.scheme\)/, "app scene injects and applies the resolved chrome + scheme");
// The appearance override (Match desktop / Light / Dark) resolves against the
// desktop chrome; "Match desktop" passes it through, a fixed mode forces it.
assert.match(app, /@AppStorage\(AppearanceMode\.storageKey\)/, "app scene reads the persisted appearance override");
assert.match(app, /mode\.resolve\(desktop:\s*app\.chrome\)/, "appearance mode resolves against the desktop chrome");
assert.match(root, /@Environment\(\\\.chrome\) private var chrome/, "RootView reads the chrome palette");
assert.match(root, /\.background\(chrome\.bgBase\.ignoresSafeArea\(\)\)[\s\S]*\.foregroundStyle\(chrome\.textPrimary\)/, "RootView applies desktop background and foreground");
assert.match(root, /\.glassBars\(\)/, "RootView applies the frosted, theme-tinted tab + navigation bar chrome");
assert.match(root, /while !Task\.isCancelled[\s\S]*await app\.loadTheme\(\)[\s\S]*Task\.sleep\(for:\s*\.seconds\(20\)\)/, "MainTabView polls the desktop theme while connected");
// The poll is scenePhase-gated: keyed on scenePhase and guarded so it only runs
// while the app is active (backgrounding cancels it, foregrounding restarts it).
assert.match(root, /@Environment\(\\\.scenePhase\) private var scenePhase/, "MainTabView observes scenePhase");
assert.match(root, /\.task\(id: scenePhase\) \{\s*guard scenePhase == \.active else \{ return \}/, "the theme poll only runs while the scene is active");

console.log("ios-theme-api.test.ts: ok");
