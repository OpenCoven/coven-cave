import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (rel) => readFile(new URL(`../${rel}`, import.meta.url), "utf8");
const iosRoot = "apps/ios/CovenCave/CovenCave";

const theme = await read(`${iosRoot}/Theme/Theme.swift`);
const model = await read(`${iosRoot}/State/AppModel.swift`);
const appEntry = await read(`${iosRoot}/CovenCaveApp.swift`);
const settings = await read(`${iosRoot}/Views/SettingsView.swift`);

// A device-local appearance preference exists, defaulting to mirroring desktop.
assert.match(theme, /enum AppearancePref: String, CaseIterable, Identifiable/, "AppearancePref enum exists");
for (const c of ["case desktop", "case system", "case light", "case dark"]) {
  assert.match(theme, new RegExp(c), `AppearancePref has ${c}`);
}

// The preference is persisted and defaults to .desktop (sync) when unset.
assert.match(model, /var appearance: AppearancePref = AppModel\.loadAppearancePref\(\)/, "AppModel holds the appearance pref");
assert.match(model, /UserDefaults\.standard\.set\(appearance\.rawValue, forKey: AppModel\.appearanceKey\)/, "appearance persists on change");
assert.match(model, /AppearancePref\(rawValue: UserDefaults\.standard\.string\(forKey: appearanceKey\) \?\? ""\) \?\? \.desktop/, "appearance defaults to .desktop when unset");

// Override resolves the effective palette + colour scheme.
assert.match(model, /var effectivePalette: ChromePalette \{[\s\S]{0,80}appearance == \.desktop \? chrome : \.fallback/, "effectivePalette uses the desktop palette only when syncing");
assert.match(model, /var effectiveColorScheme: ColorScheme\? \{/, "effectiveColorScheme is optional (system → nil)");
assert.match(model, /case \.desktop: return chrome\.colorScheme/, "desktop mode follows the synced scheme");
assert.match(model, /case \.system: return nil/, "system mode follows the OS");

// The app entry applies the effective values (not the raw synced ones).
assert.match(appEntry, /\.environment\(\\\.chrome, app\.effectivePalette\)/, "app propagates the effective palette");
assert.match(appEntry, /\.preferredColorScheme\(app\.effectiveColorScheme\)/, "app applies the effective colour scheme");

// Settings exposes the override picker.
assert.match(settings, /Text\("Appearance"\)/, "Settings has an Appearance section");
assert.match(settings, /Picker\("Theme", selection: Binding\(/, "Settings has a Theme picker bound to the pref");
assert.match(settings, /ForEach\(AppearancePref\.allCases\) \{ pref in/, "the picker lists every appearance option");

console.log("ios-appearance-override.test.mjs: ok");
