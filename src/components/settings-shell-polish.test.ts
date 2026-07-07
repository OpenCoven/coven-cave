// @ts-nocheck
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./settings-shell.tsx", import.meta.url),
  "utf8",
);
const sectionsUrl = new URL("./settings-sections.ts", import.meta.url);
const overviewUrl = new URL("./settings-overview.tsx", import.meta.url);
const sections = existsSync(sectionsUrl) ? readFileSync(sectionsUrl, "utf8") : "";
const overview = existsSync(overviewUrl) ? readFileSync(overviewUrl, "utf8") : "";
const globals = readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);
const dashboardCssUrl = new URL("../styles/dashboard.css", import.meta.url);
const dashboardCss = existsSync(dashboardCssUrl) ? readFileSync(dashboardCssUrl, "utf8") : "";

assert.match(
  source,
  /const \[section, setSection\] = useState<Section>\("general"\)/,
  "SettingsShell should render the same initial section on server and client",
);

assert.doesNotMatch(
  source,
  /useState<Section>\(initialSection\)/,
  "SettingsShell must not read window.location.hash during the first client render",
);

assert.match(
  source,
  /useEffect\(\(\) => \{[\s\S]*window\.location\.hash\.replace\("#", ""\) as Section[\s\S]*setSection\(hash\)[\s\S]*setPickerView\(false\)/,
  "SettingsShell should apply hash deep-links after hydration",
);
assert.match(
  source,
  /window\.addEventListener\("hashchange", applyHashSection\)/,
  "SettingsShell should respond when the hash changes after the settings page has mounted",
);
assert.match(
  source,
  /window\.removeEventListener\("hashchange", applyHashSection\)/,
  "SettingsShell should clean up the hashchange listener",
);

// Keyboard hint footer at the bottom of the shell.
assert.match(
  source,
  /Esc back · ↑↓ navigate sections/,
  "renders the keyboard hint footer below the content area",
);
assert.match(
  source,
  /isMobile \? \(pickerView \? "Tap a section to open" : "Back returns to Settings"\) : "Esc back · ↑↓ navigate sections"/,
  "footer hint should match desktop keyboard navigation and mobile tap/back navigation",
);

assert.match(
  source,
  /settings-back-button/,
  "Settings back control should expose a mobile hit-area hook",
);
assert.match(
  globals,
  /@media \(max-width: 767px\) \{[\s\S]*\.settings-back-button\s*\{[\s\S]*min-height:\s*var\(--touch-target\)/,
  "Settings mobile back control should meet the shared touch target",
);

// Esc keydown handler routes back.
assert.match(
  source,
  /e\.key === "Escape"/,
  "keydown handler gates on the Escape key",
);
assert.match(
  source,
  /router\.back\(\)/,
  "Escape triggers router.back()",
);

// ↑↓ cycle through sections.
assert.match(
  source,
  /e\.key === "ArrowDown" \|\| e\.key === "ArrowUp"/,
  "keydown handler gates on the arrow keys for section nav",
);
assert.match(
  source,
  /SECTIONS\.findIndex\(\(s\) => s\.id === section\)/,
  "section index is looked up from SECTIONS",
);
assert.match(
  source,
  /openSection\(SECTIONS\[next\]\.id\)/,
  "arrow-key section navigation should reuse openSection so the URL hash stays in sync",
);

// Keydown handler skips inputs/textareas/selects/contentEditable.
assert.match(
  source,
  /tag === "INPUT" \|\| tag === "TEXTAREA" \|\| tag === "SELECT"/,
  "keydown handler skips form-control targets",
);
assert.match(
  source,
  /target\??\.isContentEditable/,
  "keydown handler skips contentEditable targets",
);

// comingSoon rows are dimmed.
assert.match(
  source,
  /\$\{comingSoon \? "opacity-50" : ""\}/,
  "comingSoon rows get opacity-50",
);

assert.doesNotMatch(
  source,
  /AddonsSection|ADDONS_TABS|settings-addon-switch|aria-label=\{`\$\{row\.label\} add-on`\}|Add-ons/,
  "Settings should not render an Add-ons section or add-on switches",
);
assert.doesNotMatch(
  dashboardCss,
  /settings-addon-switch/,
  "Settings stylesheet should not keep Add-ons switch chrome after the section is removed",
);
assert.match(
  dashboardCss,
  /\.settings-touch-action\s*\{[\s\S]*?min-height:\s*var\(--touch-target\)/,
  "Settings text actions should share the native touch-target floor",
);
assert.match(
  dashboardCss,
  /\.settings-mobile-switch\s*\{[\s\S]*?min-width:\s*64px[\s\S]*?min-height:\s*var\(--touch-target\)/,
  "Mobile mode switch should meet the native touch-target floor",
);
assert.match(
  source,
  /className=\{`settings-mobile-switch/,
  "Mobile mode switch should use the dedicated touch-target switch class",
);
assert.match(
  source,
  /className="settings-touch-action[\s\S]*Setup guide/,
  "Mobile setup guide link should use the shared Settings action touch target",
);
assert.match(
  source,
  /className="settings-touch-action[\s\S]*\{l\.label\}/,
  "About external links should use the shared Settings action touch target",
);
// Settings section nav exposes the active section to assistive tech.
assert.match(
  source,
  /aria-current=\{section === s\.id && !showPicker \? "page" : undefined\}/,
  "the active settings section is marked aria-current",
);
// The custom-theme reset button is labelled with the actual theme name.
assert.match(
  source,
  /aria-label=\{`Reset \$\{customData\.name\}`\}/,
  "the custom-theme reset button names the theme it resets",
);

assert.match(source, /className="max-w-none space-y-6"/, "settings pages fill the full pane width (no narrow max-w-2xl column on desktop)");

assert.match(
  source,
  /<section className="max-w-none space-y-6" aria-labelledby=\{pageTitleId\}>/,
  "SettingsPage should expose an accessible section label without adding a second visible page heading",
);

assert.match(
  source,
  /<h2 id=\{pageTitleId\} className="sr-only">\{title\}<\/h2>/,
  "SettingsPage should keep the section title available to assistive tech",
);

assert.doesNotMatch(
  source,
  /<h1 className="text-\[18px\] font-semibold text-\[var\(--text-primary\)\]">\{title\}<\/h1>/,
  "SettingsPage should not visibly repeat the overview title",
);

assert.match(
  globals,
  /@import "\.\.\/styles\/dashboard\.css";/,
  "globals.css should import the operational surface stylesheet that owns Settings shell styles",
);

assert.match(
  dashboardCss,
  /\.settings-shell\s*\{[\s\S]*?background:/,
  "Settings shell styles should live in an imported tracked stylesheet so the dev CSS bundle includes them reliably",
);

assert.doesNotMatch(
  globals,
  /\.settings-overview\s*\{/,
  "globals.css should not override the Settings overview styles owned by dashboard.css",
);

assert.match(
  dashboardCss,
  /\.settings-overview\s*\{[\s\S]*?display:\s*flex[\s\S]*?align-items:\s*center/,
  "Settings overview headers should compact into a single row on desktop",
);

assert.match(
  dashboardCss,
  /\.settings-overview-strip\s*\{[\s\S]*?display:\s*flex/,
  "Settings overview highlight chips should sit inline with the title row where space allows",
);

assert.match(
  sections,
  /type SectionMeta = \{ id: Section; label: string; icon: string; description: string; accent: string \}/,
  "Settings sections should carry descriptions and accent metadata for a richer desktop-native nav",
);

assert.match(
  sections,
  /export const SECTION_HIGHLIGHTS: Record<Section, string\[\]>/,
  "Settings should define section-specific summary points for the overview strip",
);

assert.match(
  source,
  /import \{ SettingsOverview \} from "\.\/settings-overview"/,
  "SettingsShell should import the overview component from a focused module",
);

assert.match(
  source,
  /import \{[\s\S]*SECTIONS[\s\S]*SETTINGS_INDEX[\s\S]*settingsSectionLabel[\s\S]*type Section[\s\S]*\} from "\.\/settings-sections"/,
  "SettingsShell should import section metadata/search ownership from a focused module",
);

assert.match(
  source,
  /<SettingsOverview section=\{section\} \/>/,
  "Settings content should render a section overview before the detailed controls",
);

assert.match(
  overview,
  /export function SettingsOverview\(\{ section \}: \{ section: Section \}\)/,
  "SettingsOverview should live outside the shell component",
);

assert.match(
  source,
  /className="settings-shell/,
  "SettingsShell should use a dedicated shell class instead of only utility classes",
);

assert.match(
  source,
  /className="settings-shell__sidebar/,
  "SettingsShell should expose a dedicated desktop sidebar class",
);

assert.doesNotMatch(
  source,
  /className="settings-nav__description/,
  "Settings nav items should show only the section label, not a second-row description",
);

assert.match(
  source,
  /CovenCave control room/,
  "Settings header should identify the desktop control-room context",
);

assert.doesNotMatch(
  source,
  /Tauri desktop|settings-shell__native-badge/,
  "Settings header should stay single-line and omit the old native Tauri badge",
);

assert.match(
  dashboardCss,
  /\.settings-shell__sidebar[\s\S]*width:\s*248px/,
  "Settings sidebar should have a stable desktop width",
);

assert.match(
  dashboardCss,
  /\.settings-overview\s*\{[\s\S]*?display:\s*flex[\s\S]*?align-items:\s*center/,
  "Settings overview should use a single-row desktop header",
);

assert.match(
  dashboardCss,
  /@media \(max-width: 767px\) \{[\s\S]*\.settings-overview\s*\{[\s\S]*display:\s*block[\s\S]*\.settings-overview-strip[\s\S]*flex-direction:\s*column/,
  "Settings overview should stack on mobile",
);

// ── 2026-07-03 settings a11y batch ────────────────────────────────────────────
assert.match(source, /const \{ announce \} = useAnnouncer\(\)/, "the settings surface consumes the shared announcer");
assert.match(source, /announce\("Daemon connection saved\."\)/, "saving the daemon connection announces");
assert.match(source, /announce\(ok \? "Theme synced to phone\." : "Couldn't reach the daemon to sync\.", ok \? "polite" : "assertive"\)/, "resync announces its result");
assert.match(source, /announce\(`Imported theme/, "importing a theme announces");
assert.match(source, /aria-label="Workspace path"/, "the workspace path field is labelled");
assert.match(source, /aria-label="Server hub URL"/, "the hub URL input is labelled");
assert.match(source, /aria-label="Executor addresses, one per line"/, "the executor textarea is labelled");
assert.match(source, /focusTarget\.focus\(\{ preventScroll: true \}\)/, "a search/deep-link jump moves focus to the target group");
assert.match(source, /connectionError && <span role="alert"/, "the daemon save error is a live alert");

console.log("settings-shell-polish.test.ts OK");
