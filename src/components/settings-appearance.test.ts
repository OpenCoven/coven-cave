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
  new URL("../styles/globals/foundations.css", import.meta.url),
  "utf8",
);
const themes = await readFile(
  new URL("../styles/globals/themes.css", import.meta.url),
  "utf8",
);
const fontSettings = await readFile(
  new URL("./settings-fonts.tsx", import.meta.url),
  "utf8",
);
const appearanceRestore = await readFile(
  new URL("../lib/appearance-restore.ts", import.meta.url),
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
  /<head>\s*<ThemeScript preferences=\{preferences\} authoritative=\{false\} \/>[\s\S]*<\/head>/,
  "Root layout should pass an explicit paint-only snapshot to ThemeScript before paint",
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

// The Theme tokens editor is the single color-customization surface: editing
// the accent must persist a readable foreground for filled accent UI.
assert.match(
  settings,
  /"--accent-presence-foreground":\s*readableTextColor\(value\)/,
  "Token overrides must persist a readable foreground for custom accent colors",
);

// The old three-color "Customize colors" editor was redundant with the Theme
// tokens editor and has been removed.
assert.doesNotMatch(
  settings,
  /ThemeColorEditor|theme-color-editor|Customize colors/,
  "the redundant Customize-colors editor must not come back — the Theme tokens editor owns color customization",
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
  /appearance\.cornerRadius[\s\S]*--radius-control/,
  "ThemeScript should apply the canonical corner radius before paint (no flash)",
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

assert.doesNotMatch(
  settings,
  /THEME_OWNED_APPEARANCE_KEYS\s*=/,
  "Selecting a preset must not carry a destructive list of independent appearance preferences",
);

assert.match(
  settings,
  /function applyPreset\(theme: PresetTheme\) \{[\s\S]{0,500}clearCustomThemeVariables\(\)[\s\S]{0,500}updateAppPreferences\(\{ appearance: \{ theme: \{ id: theme, custom: null \} \} \}\)[\s\S]{0,500}reapplyIndependentAppearance\(\)/,
  "Selecting a preset should persist only the theme selection and then re-layer independent choices",
);

assert.match(
  appearanceRestore,
  /for \(const group of \[custom\.cssVars\.theme, custom\.cssVars\.light, custom\.cssVars\.dark\]\)[\s\S]*root\.style\.removeProperty\(name\)/,
  "theme switching should remove only CSS variables introduced by the previous custom theme",
);

for (const independentApply of [
  "applyFontPair", "applyScreenScale", "applyReadingLeading", "applyReadingTracking",
  "applyReadingAlign", "applyReadingWidth", "applyReadingWeight", "applyReadingHyphens",
  "applyCornerRadius", "applyBackdropToDocument",
]) {
  assert.ok(
    appearanceRestore.includes(independentApply),
    `preset/custom switches should reapply ${independentApply}`,
  );
}

assert.doesNotMatch(
  settings,
  /localStorage\.removeItem\("cave:(?:font|screen-scale|reading|corner-radius|backdrop)/,
  "theme selection must never delete independent saved appearance settings",
);

assert.match(
  themes,
  /\[data-theme="pastel-dreams"\]\s*\{[\s\S]*--font-sans:\s*var\(--font-open-sans\)[\s\S]*--font-mono:\s*var\(--font-ibm-plex-mono\)[\s\S]*--radius:\s*1\.5rem[\s\S]*--radius-control:\s*18px[\s\S]*--shadow-popover:[\s\S]*--cave-reading-leading:\s*1\.7/,
  "Pastel Dreams should carry TweakCN typography, radius, shadow, and reading-spacing tokens, not just colors",
);

// ── Manual resync button + per-token overrides ───────────────────────────────
assert.match(
  settings,
  /async function persistThemeTokens\(\): Promise<boolean>/,
  "persistThemeTokens returns a result so the Resync button can report success",
);
assert.match(
  settings,
  /persistThemeTokens\(\)[\s\S]{0,300}await flushAppPreferences\(\)[\s\S]{0,500}tokenOnly: true,[\s\S]{0,200}expectedSelectionRevision: preferences\.appearance\.theme\.selectionRevision/,
  "token-only publication must wait for canonical selection persistence and carry its revision",
);
assert.match(
  settings,
  /if \(res\.status === 409\) await refreshAppPreferences\(\)/,
  "a stale token publisher should refresh the winning canonical selection",
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
  /THEME_SYNC_KEYS\.map\(\(key\)[\s\S]{0,500}<TokenColorRow/,
  "the override panel renders an editable color row for each core token",
);
assert.match(
  settings,
  /function applyTokenOverride\(key: string, hex: string, mode: Mode\)/,
  "editing a token forks the active theme to a custom theme and re-syncs",
);

// ── Token edits must layer on the SELECTED theme (regression) ────────────────
// Flipping data-theme to "custom" un-applies the preset's whole CSS block, so
// the fork must (a) snapshot the full preset look before mutating the DOM and
// (b) live-apply the whole group — not just the edited key — or editing one
// token visually resets every other token to the default theme.
assert.match(
  settings,
  /const THEME_FORK_SNAPSHOT_KEYS = \[\s*\.\.\.THEME_SYNC_KEYS,[\s\S]*"--bg-panel",[\s\S]*"--background",[\s\S]*"--border",/,
  "forking a preset must snapshot the hardcoded per-theme tokens AND the legacy-vocab aliases",
);
// A fork must capture BOTH mode palettes. Seeding only the edited mode made
// the fork single-mode: flipping Light/Dark later kept rendering the edited
// mode's colors (activeCustomThemeVariables falls back to the only group) and
// the first edit in the other mode seeded it from the WRONG mode's computed
// look (cave-hkfq: a dark-only fork seeded lightAccent from the dark accent).
assert.match(
  settings,
  /if \(!existing\) \{\s*\n\s*for \(const name of THEME_FORK_SNAPSHOT_KEYS\) html\.style\.removeProperty\(name\);\s*\n\s*Object\.assign\(group, resolveTokens\(THEME_FORK_SNAPSHOT_KEYS\)\);/,
  "a fresh fork clears in-drag preview inline vars, then seeds the edited mode from the preset's computed look",
);
assert.match(
  settings,
  /html\.setAttribute\("data-mode", otherGroupKey\);\s*\n\s*otherSeed = resolveTokens\(THEME_FORK_SNAPSHOT_KEYS\);[\s\S]{0,300}?html\.setAttribute\("data-mode", restore\);/,
  "a fresh fork snapshots the OTHER mode's preset palette in the same task (getComputedStyle forces a sync recalc — nothing paints mid-flip)",
);
assert.match(
  settings,
  /\} else if \(Object\.keys\(group\)\.length === 0\) \{\s*\n\s*Object\.assign\(group, resolveTokens\(THEME_FORK_SNAPSHOT_KEYS\)\);/,
  "an imported custom theme missing this mode group still fills from the current computed look on first edit",
);
assert.match(
  settings,
  /\.\.\.\(otherSeed \? \{ \[otherGroupKey\]: otherSeed \} : \{\}\),/,
  "both mode groups land in the forked payload, so a Light/Dark flip actually changes the rendered palette",
);
assert.match(
  settings,
  /for \(const \[name, value\] of Object\.entries\(group\)\) \{\s*\n\s*html\.style\.setProperty\(name, value\);[\s\S]{0,200}html\.setAttribute\("data-theme", "custom"\)/,
  "the whole group is applied live before the data-theme flip so the selected theme's look survives",
);
assert.match(
  settings,
  /function deriveTokenCompanions\(/,
  "core-token edits update their companion tokens (legacy aliases, accent tints)",
);
assert.match(
  settings,
  /case "--bg-base":[\s\S]{0,400}"--background": value/,
  "editing the background must mirror the legacy --background alias legacy-vocab surfaces read",
);

// The picker fires per pointer-move. Drags must stay PAINT-ONLY: each rAF-
// coalesced frame writes the edited key + companions inline (element.style
// beats preset CSS), and the preferences store is untouched until commit.
// Anything else write-amplifies: one measured ~1s drag as a store-write-per-
// frame produced 8 PATCH /api/preferences + 4 PUT /api/theme, bumped
// selectionRevision 0→12, and triggered 38 GETs + 58 accent setProperty calls
// in a second open tab via the BroadcastChannel echo (cave-hkfq).
assert.match(
  settings,
  /function previewTokenOverride\(key: string, hex: string, mode: Mode\) \{[\s\S]{0,600}?\n\}/,
  "a paint-only preview path exists for in-drag token edits",
);
{
  const previewBody = settings.match(
    /function previewTokenOverride\(key: string, hex: string, mode: Mode\) \{([\s\S]{0,600}?)\n\}/,
  )?.[1] ?? "";
  assert.match(
    previewBody,
    /html\.style\.setProperty\(key, hex\)/,
    "the preview writes the edited token inline",
  );
  assert.match(
    previewBody,
    /deriveTokenCompanions\(key, hex, mode\)/,
    "the preview keeps companion tokens (accent washes, legacy aliases) in step",
  );
  assert.doesNotMatch(
    previewBody,
    /updateAppPreferences|readAppPreferences|setAttribute/,
    "the preview must not touch the preferences store or data-theme — no reconcile, no PATCH, no broadcast per frame",
  );
}
assert.match(
  settings,
  /frameRef\.current = requestAnimationFrame\(\(\) => \{[\s\S]{0,300}previewTokenOverride\(pending\.key, pending\.value/,
  "live token previews are coalesced to one paint per animation frame",
);
assert.doesNotMatch(
  settings,
  /requestAnimationFrame\(\(\) => \{[\s\S]{0,300}applyTokenOverride\(/,
  "no rAF frame may persist to the store — drags write pixels, commits write preferences",
);
assert.match(
  settings,
  /const handleCommit = [\s\S]{0,200}flushPendingPreview\(\);\s*\n\s*if \(!dirtyRef\.current\.has\(key\)\) return;[\s\S]{0,400}applyTokenOverride\(key, committed, modeRef\.current\);[\s\S]{0,300}onChange\(\);/,
  "commit persists the finished edit exactly once, and closing the picker without a pick is a no-op (no bogus custom fork)",
);
assert.match(
  settings,
  /for \(const key of dirtyRef\.current\)[\s\S]{0,200}applyTokenOverride\(key, value, modeRef\.current\)/,
  "unmounting mid-drag still persists the un-committed edit",
);
assert.doesNotMatch(
  settings,
  /const handlePick = [\s\S]{0,600}onChange\(\);\n {2}\};/,
  "handlePick must not trigger the per-move daemon sync",
);

// ── An explicit accent pick must disarm the backdrop auto-match (cave-hkfq) ──
// With a backdrop enabled and matchAccent armed (the default), every theme
// reconcile re-fits --accent-presence to the image seed via
// applyBackdropToDocument — silently overriding the user's pick during the
// drag, recording the fit color in the synced tokens, and reverting the swatch
// on reload. An explicit accent edit is a statement of intent: fold
// matchAccent: false into the SAME preferences patch as the token edit so no
// reconcile window exists between them. The backdrop settings toggle re-arms.
assert.match(
  settings,
  /const disarmBackdropAccent =\s*\n?\s*key === "--accent-presence" && backdrop\.enabled && backdrop\.matchAccent;/,
  "an explicit accent edit detects an armed backdrop auto-match",
);
assert.match(
  settings,
  /updateAppPreferences\(\{\s*\n\s*appearance: \{\s*\n\s*theme: \{ id: "custom", resolvedMode: mode, custom: data \},\s*\n\s*\.\.\.\(disarmBackdropAccent \? \{ backdrop: \{ matchAccent: false \} \} : \{\}\),\s*\n\s*\},\s*\n\s*\}\);/,
  "the disarm rides the token edit's own atomic patch — no reconcile can re-fit in between",
);
assert.doesNotMatch(
  settings,
  /const raw = null;/,
  "applyTokenOverride's dead localStorage-era fork branch stays deleted",
);

// ── The section must follow the store, not its mount-time snapshot ───────────
// External theme changes — the 10s /api/theme poll, another tab via the
// preferences BroadcastChannel, a phone PATCH — land in the store and repaint
// the app, but AppearanceSection hydrated activeTheme/mode/customData once on
// mount, so the theme grid and token-row swatches kept showing stale values
// until a full page reload (cave-hkfq).
assert.match(
  settings,
  /if \(!appearanceHydrated\) return;\s*\n\s*return subscribeAppPreferences\(\(\) => \{[\s\S]{0,300}setActiveTheme\(readPersistedTheme\(\)\);\s*\n\s*setMode\(readPersistedMode\(\)\);[\s\S]{0,600}\}\);\s*\n\s*\}, \[appearanceHydrated\]\);/,
  "the appearance section re-syncs its selection state on every preferences-store notify",
);
assert.match(
  settings,
  /setCustomData\(\(prev\) => \{[\s\S]{0,400}JSON\.stringify\(prev\) === JSON\.stringify\(next\)[\s\S]{0,100}return prev;/,
  "custom-theme state keeps its object identity when content is unchanged — store notifies must not retrigger the persist effect (echo PUTs)",
);
assert.match(
  settings,
  /reloadKey=\{`\$\{activeTheme\}:\$\{mode\}:\$\{customData \? JSON\.stringify\(customData\.cssVars\) : "preset"\}`\}/,
  "the token rows' reload key carries the custom payload's CONTENT, so external edits re-resolve the swatches",
);
assert.doesNotMatch(
  settings,
  /customData \? "c" : "p"/,
  "the presence-flag reload key is gone — it never changed while staying on the custom theme",
);
