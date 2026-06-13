// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const settings = await readFile(
  new URL("./settings-shell.tsx", import.meta.url),
  "utf8",
);
const themeScript = await readFile(
  new URL("./theme-script.tsx", import.meta.url),
  "utf8",
);
const layout = await readFile(
  new URL("../app/layout.tsx", import.meta.url),
  "utf8",
);
const globals = await readFile(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);
const fontSettings = await readFile(
  new URL("./settings-fonts.tsx", import.meta.url),
  "utf8",
);

assert.match(
  settings,
  /aria-pressed=\{active\}/,
  "Theme preset cards should expose their selected state to assistive tech",
);

assert.doesNotMatch(
  settings,
  /url\.hostname\.endsWith\("tweakcn\.com"\)/,
  "tweakcn import should not allow attacker-controlled tweakcn.com suffix hosts",
);

assert.match(
  settings,
  /hostname === "tweakcn\.com"[\s\S]*hostname\.endsWith\("\.tweakcn\.com"\)/,
  "tweakcn import should allow only tweakcn.com or real tweakcn.com subdomains",
);

assert.match(
  settings,
  /encodeURIComponent\(themeId\)/,
  "tweakcn /r/themes/{id} imports should URL-encode the theme id",
);

assert.match(
  settings,
  /encodeURIComponent\(themeName\)/,
  "tweakcn editor imports should URL-encode the theme name",
);

assert.match(
  themeScript,
  /html\.style\.setProperty\(cssName, group\[name\]\)/,
  "ThemeScript should apply custom vars via setProperty so existing inline styles are preserved",
);

assert.match(
  themeScript,
  /applyGroup\(cssVars\.theme\)[\s\S]*modeGroup[\s\S]*applyGroup\(modeGroup\)/,
  "ThemeScript should apply both theme-level (fonts/radius) and selected-mode CSS var groups",
);

assert.match(
  themeScript,
  /name\.indexOf\("--"\) === 0 \? name : "--" \+ name/,
  "ThemeScript should accept tweakcn's bare-name keys by prefixing -- when missing",
);

assert.match(
  settings,
  /apply\(cssVars\.theme\)[\s\S]*modeGroup[\s\S]*apply\(modeGroup\)/,
  "applyCustomVars should apply both theme-level and selected-mode CSS var groups, not just a whitelist",
);

assert.match(
  settings,
  /name\.startsWith\("--"\) \? name : `--\$\{name\}`/,
  "applyCustomVars should accept tweakcn's bare-name keys by prefixing -- when missing",
);

assert.match(
  settings,
  /import \{ APP_VERSION \} from "@\/lib\/app-version"/,
  "About settings must import the shared app version source",
);

assert.match(
  settings,
  /<SettingsKV label="App version" value=\{APP_VERSION\} \/>/,
  "About settings must render the shared app version instead of a literal",
);

assert.doesNotMatch(
  settings,
  /<SettingsKV label="App version" value="[\d.]+"/,
  "About settings must not hardcode an app version literal",
);

// The screen-scale control was reframed as "Text size" and moved into the
// Typography block (<FontSettings />); it no longer lives in settings-shell.
assert.doesNotMatch(
  settings,
  /Screen magnification/,
  "settings-shell should no longer render the old Screen magnification control",
);

assert.match(
  fontSettings,
  /Text size/,
  "Typography (FontSettings) should expose a Text size control",
);

assert.match(
  fontSettings,
  /SCREEN_SCALE_OPTIONS\.map/,
  "Text size should render the shared scale options",
);

assert.match(
  fontSettings,
  /aria-pressed=\{scale === option\}/,
  "Text size buttons should expose the selected scale to assistive tech",
);

// Reading line-spacing applies app-wide (chat/library/memory render outside
// Settings), so its controller must be mounted in the root layout.
assert.match(
  fontSettings,
  /Line spacing/,
  "Typography (FontSettings) should expose a Line spacing control",
);
assert.match(
  fontSettings,
  /aria-pressed=\{leading === option\}/,
  "Line spacing buttons should expose the selected level to assistive tech",
);
assert.match(
  layout,
  /<ReadingLeadingController \/>/,
  "Root layout should mount the reading line-spacing controller so saved spacing applies on load",
);

assert.match(
  layout,
  /<ScreenMagnificationController \/>/,
  "Root layout should mount the global screen magnification controller",
);

assert.match(
  globals,
  /data-screen-scale="125"[\s\S]*--cave-screen-scale: 1\.25/,
  "Global CSS should map persisted screen magnification values to an app-wide scale",
);

assert.match(
  globals,
  /zoom: var\(--cave-screen-scale\)/,
  "Global CSS should magnify the entire app surface via the screen scale token",
);

assert.match(
  settings,
  /Demo mode/,
  "Settings should expose demo mode for tester screenshots without env-file editing",
);

assert.match(
  settings,
  /clearDemoModeData/,
  "Settings should offer an easy demo-mode reset path",
);
