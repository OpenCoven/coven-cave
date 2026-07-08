// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const settings = await readFile(
  new URL("./settings-shell.tsx", import.meta.url),
  "utf8",
);
const themeBootScript = await readFile(
  new URL("../../public/scripts/theme-init.js", import.meta.url),
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
const themeColorEditor = await readFile(
  new URL("./theme-color-editor.tsx", import.meta.url),
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
  themeBootScript,
  /html\.style\.setProperty\(cssName, group\[name\]\)/,
  "ThemeScript should apply custom vars via setProperty so existing inline styles are preserved",
);

assert.match(
  themeBootScript,
  /applyGroup\(cssVars\.theme\)[\s\S]*modeGroup[\s\S]*applyGroup\(modeGroup\)/,
  "ThemeScript should apply both theme-level (fonts/radius) and selected-mode CSS var groups",
);

assert.match(
  layout,
  /import\s+\{\s*ThemeScript\s*\}\s+from\s+"@\/components\/theme-script"/,
  "Root layout should import ThemeScript",
);

assert.match(
  layout,
  /<head>\s*<ThemeScript \/>[\s\S]*<\/head>/,
  "Root layout should mount ThemeScript in <head> so persisted theme background applies before paint",
);

assert.match(
  themeBootScript,
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

// tweakcn ships only shadcn base tokens; the Cave UI is driven by --accent-presence,
// --bg-panel, --bg-elevated and --bg-hover, which are hardcoded per theme and do NOT
// alias from the base. The import must translate the base tokens into those so an
// imported theme recolors the accent/sidebar/popovers, not just the canvas.
assert.match(
  settings,
  /function tweakcnSemanticVars\(/,
  "Imports must translate tweakcn base tokens into the Cave's semantic vocabulary",
);
assert.match(
  settings,
  /tweakcnSemanticVars[\s\S]*"--accent-presence"\] = accent/,
  "tweakcn import should drive --accent-presence from the theme's primary/ring/accent",
);
assert.match(
  settings,
  /tweakcnSemanticVars[\s\S]*"--accent-presence-foreground"\][\s\S]*pick\("primary-foreground"\)[\s\S]*readableTextColor\(accent\)/,
  "tweakcn import should derive a readable foreground for filled accent UI",
);
assert.match(
  settings,
  /pick\("primary"\) \|\| pick\("ring"\) \|\| pick\("accent"\)/,
  "Accent should resolve from primary, then ring, then accent",
);
assert.match(
  settings,
  /"--bg-panel"\][\s\S]*"--bg-hover"\][\s\S]*"--bg-elevated"\]/,
  "tweakcn import should derive the surface ramp (panel/hover/elevated) the app uses",
);
assert.match(
  settings,
  /const data = enrichTweakcnTheme\(raw\)/,
  "handleImport should enrich the raw tweakcn theme before applying and persisting it",
);
assert.match(
  settings,
  /enrichTweakcnTheme[\s\S]*\{ \.\.\.tweakcnSemanticVars\(group, modeName\), \.\.\.group \}/,
  "Enrichment must preserve raw tweakcn keys (spread last) while adding derived Cave tokens",
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
  globals,
  /--accent-presence-foreground\s*:\s*var\(--primary-foreground\)/,
  "Global themes must define a filled-accent foreground token",
);

assert.match(
  themeColorEditor,
  /"--accent-presence-foreground":\s*readableTextColor\(accent\)/,
  "Custom color editor must persist a readable foreground for custom accent colors",
);

assert.doesNotMatch(
  settings,
  /bg-\[var\(--accent-presence\)\][^"`]*text-white/,
  "Settings filled accent controls must not assume white text",
);

assert.match(
  settings,
  /bg-\[var\(--accent-presence\)\][^"`]*text-\[var\(--accent-presence-foreground\)\]/,
  "Settings filled accent controls must use the readable accent foreground token",
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
  fontSettings,
  /Letter spacing/,
  "Typography (FontSettings) should expose a Letter spacing control",
);
assert.match(
  fontSettings,
  /aria-pressed=\{tracking === option\}/,
  "Letter spacing buttons should expose the selected level to assistive tech",
);
assert.match(
  layout,
  /<ReadingTrackingController \/>/,
  "Root layout should mount the reading letter-spacing controller so saved tracking applies on load",
);
assert.match(
  fontSettings,
  /Text alignment/,
  "Typography (FontSettings) should expose a Text alignment control",
);
assert.match(
  fontSettings,
  /aria-pressed=\{align === option\}/,
  "Text alignment buttons should expose the selected level to assistive tech",
);
assert.match(
  layout,
  /<ReadingAlignController \/>/,
  "Root layout should mount the reading text-alignment controller so saved alignment applies on load",
);
assert.match(
  fontSettings,
  /Max reading width/,
  "Typography (FontSettings) should expose a Max reading width control",
);
assert.match(
  fontSettings,
  /aria-pressed=\{width === option\}/,
  "Max reading width buttons should expose the selected level to assistive tech",
);
assert.match(
  layout,
  /<ReadingWidthController \/>/,
  "Root layout should mount the reading-width controller so saved width applies on load",
);
assert.match(
  fontSettings,
  /Font weight/,
  "Typography (FontSettings) should expose a Font weight control",
);
assert.match(
  fontSettings,
  /aria-pressed=\{weight === option\}/,
  "Font weight buttons should expose the selected level to assistive tech",
);
assert.match(
  layout,
  /<ReadingWeightController \/>/,
  "Root layout should mount the reading font-weight controller so saved weight applies on load",
);
assert.match(
  fontSettings,
  /Hyphenation/,
  "Typography (FontSettings) should expose a Hyphenation control",
);
assert.match(
  fontSettings,
  /aria-pressed=\{hyphens === option\}/,
  "Hyphenation buttons should expose the selected state to assistive tech",
);
assert.match(
  layout,
  /<ReadingHyphensController \/>/,
  "Root layout should mount the reading hyphenation controller so saved setting applies on load",
);
assert.doesNotMatch(
  fontSettings,
  /Drop cap|READING_DROPCAP|applyReadingDropcap/,
  "Typography should not expose Library-only drop-cap controls in the integrated app",
);
assert.doesNotMatch(
  layout,
  /ReadingDropcapController/,
  "Root layout should not mount the Library-only drop-cap controller",
);

assert.match(
  layout,
  /<ScreenMagnificationController \/>/,
  "Root layout should mount the global screen magnification controller",
);

// Familiar switcher style — RETIRED. Familiar selection is dropdown-only (the
// chat sidebar header hosts it), so the avatar-strip style/scope/pin-order
// settings are gone with the strip.
assert.doesNotMatch(
  settings,
  /setFamiliarSwitcherStyle|setFamiliarStripScope|FamiliarPinOrder/,
  "the avatar-strip style, scope, and pin-order controls are retired (dropdown-only selection)",
);

// Corner radius drives the shared --radius tokens app-wide, so its boot block
// must run before paint (ThemeScript) and its controller must mount in layout.
assert.match(
  settings,
  /Corner radius/,
  "Appearance settings should expose a Corner radius control",
);
assert.match(
  layout,
  /<CornerRadiusController \/>/,
  "Root layout should mount the corner-radius controller so saved radius applies on load",
);
assert.match(
  themeBootScript,
  /localStorage\.getItem\("cave:corner-radius"\)[\s\S]*--radius-control/,
  "ThemeScript should apply the saved corner radius before paint (no flash)",
);

assert.match(
  globals,
  /data-screen-scale="125"[\s\S]*--cave-screen-scale: 1\.25/,
  "Global CSS should map persisted screen magnification values to an app-wide scale",
);

assert.match(
  globals,
  /font-size: calc\(16px \* var\(--cave-screen-scale\)\)/,
  "Global CSS should magnify the app via rem-based root font scaling (not an app-wide zoom, which broke getBoundingClientRect math)",
);

assert.match(
  settings,
  /THEME_OWNED_APPEARANCE_KEYS[\s\S]*localStorage\.removeItem\(key\)/,
  "Selecting a preset theme should clear stale typography/radius/reading overrides so theme-owned structure applies",
);

assert.match(
  globals,
  /\[data-theme="pastel-dreams"\]\s*\{[\s\S]*--font-sans:\s*var\(--font-open-sans\)[\s\S]*--font-mono:\s*var\(--font-ibm-plex-mono\)[\s\S]*--radius:\s*1\.5rem[\s\S]*--radius-control:\s*18px[\s\S]*--shadow-popover:[\s\S]*--cave-reading-leading:\s*1\.7/,
  "Pastel Dreams should carry TweakCN typography, radius, shadow, and reading-spacing tokens, not just colors",
);

// ── Manual resync button + per-token overrides ───────────────────────────────
assert.match(
  settings,
  /async function persistThemeTokens\(\): Promise<boolean>/,
  "persistThemeTokens returns a result so the Resync button can report success",
);
assert.match(settings, /Resync to phone/, "Appearance exposes a manual Resync to phone button");
assert.match(
  settings,
  /onClick=\{\(\) => void handleResync\(\)\}/,
  "the Resync button triggers a manual theme push",
);
assert.match(settings, /function ThemeTokenOverrides\(/, "a per-token override panel exists");
assert.match(
  settings,
  /THEME_SYNC_KEYS\.map\(\(key\)[\s\S]{0,500}type="color"/,
  "the override panel renders a colour input for each core token",
);
assert.match(
  settings,
  /function applyTokenOverride\(key: string, hex: string, mode: Mode\)/,
  "editing a token forks the active theme to a custom theme and re-syncs",
);
