// @ts-nocheck
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const shellSource = readFileSync(
  new URL("./settings-shell.tsx", import.meta.url),
  "utf8",
);
const daemonUrl = new URL("./settings-daemon.tsx", import.meta.url);
const daemonSource = existsSync(daemonUrl) ? readFileSync(daemonUrl, "utf8") : "";
const source = `${shellSource}\n${daemonSource}`;
const sectionsUrl = new URL("./settings-sections.ts", import.meta.url);
const overviewUrl = new URL("./settings-overview.tsx", import.meta.url);
const sections = existsSync(sectionsUrl) ? readFileSync(sectionsUrl, "utf8") : "";
const overview = existsSync(overviewUrl) ? readFileSync(overviewUrl, "utf8") : "";
const globals = readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);
const shellResponsiveCss = readFileSync(
  new URL("../styles/globals/shell-responsive.css", import.meta.url),
  "utf8",
);
const dashboardCssUrl = new URL("../styles/dashboard.css", import.meta.url);
const dashboardCss = existsSync(dashboardCssUrl) ? readFileSync(dashboardCssUrl, "utf8") : "";
const aboutSource = readFileSync(
  new URL("./settings-about.tsx", import.meta.url),
  "utf8",
);
const aboutCss = readFileSync(
  new URL("../styles/settings-about.css", import.meta.url),
  "utf8",
);
const phoneSource = readFileSync(
  new URL("./settings-phone.tsx", import.meta.url),
  "utf8",
);
const phoneCss = readFileSync(
  new URL("../styles/settings-phone.css", import.meta.url),
  "utf8",
);

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
  shellResponsiveCss,
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
  phoneSource,
  /className=\{`settings-switch focus-ring/,
  "Phone controls should use the shared track-and-knob switch",
);
assert.match(
  phoneSource,
  /<Button[\s\S]*size="sm"[\s\S]*Setup guide/,
  "Mobile setup guide should use the shared Button primitive",
);
assert.match(
  aboutSource,
  /settings-about-link-card[\s\S]*focus-ring/,
  "About external cards should keep the shared keyboard focus treatment",
);
assert.match(
  aboutCss,
  /@media \(hover: none\) and \(pointer: coarse\)[\s\S]*\.settings-about-link-card[\s\S]*min-height:\s*var\(--touch-target\)/,
  "About external cards should meet the shared touch-target floor on coarse pointers",
);
// Settings section nav exposes the active section to assistive tech.
assert.match(
  source,
  /aria-current=\{section === s\.id && !showPicker \? "page" : undefined\}/,
  "the active settings section is marked aria-current",
);
// The custom-theme discard button is labelled with the actual theme name and
// is two-step: first click arms, second confirms (cave-5lsj — an imported
// theme is unrecoverable once cleared).
assert.match(
  source,
  /resetCustomArmed \? \([\s\S]*?aria-label=\{`Really discard \$\{customData\.name\}\? Click again to confirm`\}/,
  "the armed custom-theme discard button names the theme and confirms via a second click",
);
assert.match(
  source,
  /<IconButton[\s\S]*?aria-label=\{`Discard \$\{customData\.name\}`\}/,
  "the idle custom-theme discard icon button names the theme",
);
assert.match(source, /setResetCustomArmed\(false\), 4000\)/, "arming auto-disarms after a beat");

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

// #3264: dashboard.css moved out of globals.css — the Settings shell now
// imports its owning stylesheet directly, which still guarantees the dev CSS
// bundle includes it whenever the surface renders.
assert.match(
  source,
  /import "@\/styles\/dashboard\.css";/,
  "settings-shell imports the operational surface stylesheet that owns Settings shell styles",
);
assert.doesNotMatch(
  globals,
  /@import "\.\.\/styles\/dashboard\.css";/,
  "dashboard.css stays out of the root stylesheet (#3264)",
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
assert.match(source, /connectionError (?:&&|\?) <span role="alert"/, "the daemon save error is a live alert");

// (cave-rj0z) var(--danger) is NOT a defined token — only --color-danger
// exists. Uses of the phantom variable silently resolved to nothing, so
// error text/borders rendered unstyled. Keep it out of the settings sources.
{
  const profile = readFileSync(new URL("./settings-profile.tsx", import.meta.url), "utf8");
  for (const [name, src] of [["settings-shell", source], ["settings-profile", profile], ["settings-phone", phoneSource]]) {
    assert.doesNotMatch(src, /var\(--danger\)/, `${name} must use var(--color-danger), not the undefined var(--danger)`);
  }
}

// The Phone handoff uses the same minimal track/knob control as the rest of
// Settings. Its label carries meaning and the shared pseudo-element preserves
// the generous pointer target.
assert.doesNotMatch(
  phoneSource,
  /settings-mobile-switch/,
  "Phone should not reintroduce the old labeled On/Off rectangle",
);
assert.doesNotMatch(
  dashboardCss,
  /\.settings-mobile-switch/,
  "the unused dedicated mobile switch chrome stays removed",
);
assert.match(
  phoneCss,
  /@media \(hover: none\) and \(pointer: coarse\)[\s\S]*min-height:\s*var\(--touch-target\)/,
  "Phone disclosures preserve native touch targets on coarse pointers",
);
assert.match(
  dashboardCss,
  /\.settings-switch \{[\s\S]{0,400}?border-radius: var\(--radius-pill\)/,
  "the minimal switch track follows the selected pill radius",
);
assert.match(
  dashboardCss,
  /\.settings-switch__knob \{[\s\S]{0,220}?border-radius: var\(--radius-pill\)/,
  "the minimal switch knob follows the selected pill radius",
);
assert.match(
  dashboardCss,
  /\.settings-switch::after \{[\s\S]{0,120}?inset: -12px/,
  "the small switch keeps a generous hit area",
);

console.log("settings-shell-polish.test.ts OK");
