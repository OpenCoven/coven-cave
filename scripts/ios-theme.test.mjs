import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

const base = "apps/ios/CovenCave/CovenCave";
const models = await read(`${base}/Models/Models.swift`);
const theme = await read(`${base}/Theme/Theme.swift`);
const client = await read(`${base}/Networking/CaveClient.swift`);
const model = await read(`${base}/State/AppModel.swift`);
const app = await read(`${base}/CovenCaveApp.swift`);
const root = await read(`${base}/Views/RootView.swift`);

// --- Contract types decode GET /api/theme -----------------------------------

assert.match(
  models,
  /struct ThemeSnapshot: Codable \{[\s\S]*var themeId: String[\s\S]*var mode: String[\s\S]*var tokens: \[String: String\][\s\S]*var updatedAt: String/,
  "Models should define ThemeSnapshot mirroring the /api/theme payload",
);
assert.match(
  models,
  /struct ThemeResponse: Codable \{[\s\S]*let theme: ThemeSnapshot/,
  "Models should define the { ok, theme } envelope as ThemeResponse",
);

// --- ChromePalette resolves token hexes with fallbacks ----------------------

assert.match(theme, /struct ChromePalette: Equatable/, "Theme should define ChromePalette");
assert.match(
  theme,
  /static let fallback = ChromePalette\(\)/,
  "ChromePalette should expose a built-in fallback palette",
);
assert.match(
  theme,
  /init\(snapshot: ThemeSnapshot\)/,
  "ChromePalette should build from a ThemeSnapshot",
);
for (const token of [
  "--bg-base",
  "--bg-raised",
  "--bg-elevated",
  "--text-primary",
  "--text-secondary",
  "--text-muted",
  "--border-hairline",
  "--accent-presence",
]) {
  assert.match(
    theme,
    new RegExp(`Color\\(hex: t\\["${token}"\\]\\)`),
    `ChromePalette should read the ${token} token`,
  );
}
assert.match(
  theme,
  /colorScheme = snapshot\.mode\.lowercased\(\) == "light" \? \.light : \.dark/,
  "ChromePalette should derive light/dark from the theme mode",
);
// Exposed through the environment for incremental per-view adoption.
assert.match(
  theme,
  /extension EnvironmentValues \{[\s\S]*var chrome: ChromePalette/,
  "ChromePalette should be reachable via @Environment(\\.chrome)",
);

// --- Client fetches the theme -----------------------------------------------

assert.match(
  client,
  /func fetchTheme\(\) async throws -> ThemeSnapshot \{[\s\S]*request\("api\/theme"\)[\s\S]*decode\(ThemeResponse\.self/,
  "CaveClient.fetchTheme should GET api/theme and decode ThemeResponse",
);

// --- AppModel holds + loads the palette, on connect -------------------------

assert.match(model, /var chrome: ChromePalette = \.fallback/, "AppModel should hold a chrome palette");
assert.match(
  model,
  /func loadTheme\(\) async \{[\s\S]*client\.fetchTheme\(\)[\s\S]*ChromePalette\(snapshot: snapshot\)/,
  "AppModel.loadTheme should fetch and adopt the desktop palette",
);
assert.match(
  model,
  /await loadFamiliars\(\)\s*\n\s*await loadTheme\(\)/,
  "refreshConnection should load the theme on connect",
);

// --- App chrome applies accent, mode, and propagates the palette ------------

assert.match(app, /\.environment\(\\\.chrome, app\.chrome\)/, "App should inject the chrome palette");
assert.match(app, /\.tint\(app\.chrome\.accent\)/, "App should tint controls with the desktop accent");
assert.match(
  app,
  /\.preferredColorScheme\(app\.chrome\.colorScheme\)/,
  "App should follow the desktop light/dark mode (not a hardcoded scheme)",
);
assert.doesNotMatch(
  app,
  /\.preferredColorScheme\(\.dark\)/,
  "App should no longer hardcode the dark color scheme",
);

// --- Theme is kept fresh while connected ------------------------------------

assert.match(
  root,
  /connectionState == \.connected \{ await app\.loadTheme\(\) \}/,
  "MainTabView should poll the theme while connected",
);

console.log("ios-theme: ok");
