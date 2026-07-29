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
  /export function SettingsOverview\(/,
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

assert.match(
  source,
  /className="settings-general"/,
  "General owns a dedicated control-sheet container",
);
assert.match(
  source,
  /<SettingsGroup label="Workspace" variant="ruled"/,
  "General groups use the opt-in ruled heading",
);
assert.match(
  dashboardCss,
  /\.settings-general\s*\{[\s\S]*container-type:\s*inline-size/,
  "General responds to its content width",
);
assert.match(
  dashboardCss,
  /\.settings-general\s*\{[\s\S]*?gap:\s*var\(--space-3\)/,
  "General preserves the compact 12px group rhythm from the Claude Design source",
);
assert.match(
  dashboardCss,
  /\.settings-group__rule\s*\{[\s\S]*?margin-bottom:\s*var\(--space-1\)/,
  "ruled headings stay attached to their controls",
);
assert.match(
  dashboardCss,
  /\.settings-group__rule-label\s*\{[\s\S]*?color:\s*var\(--text-secondary\)/,
  "ruled labels use the source's secondary text tier",
);
assert.match(
  dashboardCss,
  /\.settings-group__rule-line\s*\{[\s\S]*?background:\s*var\(--border-hairline\)/,
  "ruled headings use a hairline rather than a strong divider",
);
const controlSheetOverviewCss =
  dashboardCss.match(/\.settings-overview--control-sheet\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
assert.match(
  controlSheetOverviewCss,
  /padding:\s*var\(--space-2\) var\(--space-3\)/,
  "General's overview uses the compact source padding",
);
assert.match(
  controlSheetOverviewCss,
  /background:\s*var\(--bg-panel\)/,
  "General's overview uses the quiet panel surface",
);
assert.doesNotMatch(
  controlSheetOverviewCss,
  /min-height|linear-gradient/,
  "General's overview does not reintroduce the oversized gradient hero",
);
assert.match(
  source,
  /<SettingsGroup label="Chat" variant="ruled" panel=\{false\}>/,
  "Chat stays an unboxed ruled row like the source",
);
assert.match(
  dashboardCss,
  /\.settings-stop-phrases\s*\{[\s\S]*?background:\s*var\(--bg-sunken\)/,
  "the phrase chip editor uses the source's sunken input surface",
);
assert.match(
  dashboardCss,
  /\.settings-progression-card\s*\{[\s\S]*?background:\s*var\(--bg-panel\)/,
  "the progression card uses the quiet panel surface",
);
assert.match(
  dashboardCss,
  /\.settings-startup-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(min\(100%,\s*150px\),\s*1fr\)\)[\s\S]*?gap:\s*var\(--space-2\)/,
  "startup cells preserve the source's responsive two-cell grid and compact gap",
);
assert.equal(
  dashboardCss.match(/\.settings-startup-grid\s*\{/g)?.length,
  1,
  "startup auto-fit behavior is not replaced by a premature one-column breakpoint",
);
assert.match(
  dashboardCss,
  /@container settings-general \(max-width:/,
  "narrow General layout uses a container query",
);
assert.match(
  source,
  /shell_open_path[\s\S]{0,220}Workspace folder opened/,
  "Browse truthfully opens the current workspace directory",
);
assert.match(
  source,
  /useIsTauriDesktop/,
  "workspace Browse is gated to desktop Tauri",
);
assert.match(
  source,
  /SettingsGroup label="Progression" variant="ruled"[\s\S]*settings-progression-card/,
  "Progression uses the ruled full-width composition",
);
assert.match(
  source,
  /SettingsGroup label="Startup" variant="ruled"[\s\S]*settings-startup-grid/,
  "Startup uses the ruled two-cell composition",
);
assert.match(
  dashboardCss,
  /\.settings-startup-cell\s*\{[\s\S]*border:\s*1px dashed var\(--border-hairline\)/,
  "Soon cells use the quiet dashed affordance language",
);
assert.match(
  source,
  /<SettingsGroup label="Backup" variant="ruled"[\s\S]*settings-backup-grid/,
  "Backup uses the reference two-column composition",
);
assert.match(
  source,
  /settings-backup-manual[\s\S]*Backup passphrase[\s\S]*Export backup[\s\S]*Choose backup[\s\S]*Restore/,
  "manual backup retains every action",
);
assert.match(
  source,
  /settings-backup-guidance[\s\S]*backupPassphraseGuidance\.label/,
  "manual backup shows objective passphrase-length guidance",
);
assert.doesNotMatch(
  source,
  /Strong passphrase|Good passphrase|Weak passphrase/,
  "length-only backup guidance makes no security-strength claim",
);
assert.match(
  source,
  /variant="primary"[\s\S]{0,260}Export backup/,
  "manual export keeps the source's primary action hierarchy",
);
assert.match(
  source,
  /variant="ghost"[\s\S]{0,260}\{busy === "restore" \? "Restoring…" : "Restore"\}/,
  "Restore remains the quiet tertiary action",
);
assert.match(
  dashboardCss,
  /\.settings-backup-manual\s*\{[\s\S]*?padding:\s*0[\s\S]*?border:\s*0[\s\S]*?background:\s*transparent/,
  "manual backup remains unboxed beside the scheduled-sync card",
);
assert.match(
  source,
  /syncLoadState === "error"[\s\S]*Couldn't load scheduled sync[\s\S]*Retry/,
  "scheduled sync does not disguise request failures as an empty panel",
);
assert.match(
  source,
  /syncLoadState === "error"[\s\S]{0,240}<section className="settings-backup-card settings-backup-sync" aria-label="Scheduled sync">/,
  "scheduled sync retains an accessible section name when loading fails",
);
assert.match(
  source,
  /syncLoadState === "loading"[\s\S]{0,360}role="status"[\s\S]*aria-busy="true"[\s\S]*Loading scheduled sync…/,
  "scheduled sync announces its loading state instead of exposing an empty region",
);
assert.match(
  source,
  /setOverview\(json as BackupSyncOverview\)[\s\S]{0,160}dispatchEvent\(new Event\("cave:backup-sync-refresh"\)\)/,
  "successful scheduled-sync mutations refresh the General summary",
);
assert.match(
  source,
  /settings-backup-sync__state[\s\S]*\{enabled \? "On" : "Off"\}/,
  "scheduled sync always names its state",
);
// Was a responsive two-column grid. Scheduled sync carries a destination, a
// passphrase, a retention field and a freshness readout — several times the
// height of the manual export beside it — so the pair left a dead half-column
// the length of the taller card. Stacked full-width, each block gets the whole
// measure and the section reads top to bottom.
assert.match(
  dashboardCss,
  /\.settings-backup-grid\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
  "Backup stacks its two blocks full-width instead of pairing them",
);
assert.equal(
  dashboardCss.match(/\.settings-backup-grid\s*\{/g)?.length,
  1,
  "Backup auto-fit behavior is not replaced by a premature one-column breakpoint",
);
for (const token of [
  "--bg-base",
  "--bg-panel",
  "--bg-raised",
  "--bg-sunken",
  "--text-primary",
  "--text-secondary",
  "--text-muted",
  "--border-hairline",
  "--border-strong",
  "--accent-presence",
]) {
  assert.match(
    dashboardCss,
    new RegExp(`var\\(${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\)`),
    `control-sheet CSS uses ${token}`,
  );
}
assert.doesNotMatch(
  dashboardCss.match(/\.settings-general[\s\S]*?(?=\/\* ── Unified dashboard)/)?.[0] ?? "",
  /#[0-9a-f]{3,8}\b/i,
  "General control-sheet CSS introduces no literal colors",
);
const coarsePointerRules =
  dashboardCss.match(/@media \(hover: none\) and \(pointer: coarse\)\s*\{[\s\S]*?\n\}/g)?.join("\n") ?? "";
for (const selector of [
  ".settings-overview-anchor",
  ".settings-overview__summary-retry",
  ".settings-stop-phrase__remove",
  ".settings-stop-phrases__clear",
  ".settings-voice-catalog__toggle",
]) {
  assert.match(
    coarsePointerRules,
    new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]{0,240}(?:min-width|min-height):\\s*var\\(--touch-target\\)`),
    `${selector} preserves the coarse-pointer touch floor`,
  );
}

console.log("settings-shell-polish.test.ts OK");
