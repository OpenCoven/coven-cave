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
assert.match(appModel, /func loadTheme\(\) async[\s\S]*client\.fetchTheme\(\)[\s\S]*ChromePalette\(snapshot:\s*snapshot\)/, "AppModel fetches and adopts the desktop palette");
assert.match(appModel, /connectionState = \.connected[\s\S]*await loadFamiliars\(\)[\s\S]*await loadTheme\(\)/, "AppModel loads the theme after connecting");

assert.match(app, /\.environment\(\\\.chrome,\s*app\.chrome\)[\s\S]*\.tint\(app\.chrome\.accent\)[\s\S]*\.preferredColorScheme\(app\.chrome\.colorScheme\)/, "app scene injects and applies desktop chrome");
assert.match(root, /@Environment\(\\\.chrome\) private var chrome/, "RootView reads the chrome palette");
assert.match(root, /\.background\(chrome\.bgBase\.ignoresSafeArea\(\)\)[\s\S]*\.foregroundStyle\(chrome\.textPrimary\)/, "RootView applies desktop background and foreground");
assert.match(root, /\.toolbarBackground\(chrome\.bgRaised,\s*for:\s*\.navigationBar,\s*\.tabBar\)/, "RootView applies desktop chrome to navigation and tab bars");
assert.match(root, /while !Task\.isCancelled[\s\S]*await app\.loadTheme\(\)[\s\S]*Task\.sleep\(for:\s*\.seconds\(20\)\)/, "MainTabView polls the desktop theme while connected");

console.log("ios-theme-api.test.ts: ok");
