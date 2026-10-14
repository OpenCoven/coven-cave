// @ts-nocheck
// Settings › General › Setup (#5982): the re-entry point for "Set up Cave".
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { SETTINGS_INDEX } from "./settings-sections.ts";

const shell = await readFile(new URL("./settings-shell.tsx", import.meta.url), "utf8");
const row = await readFile(new URL("./settings-setup.tsx", import.meta.url), "utf8");
const sheet = await readFile(new URL("../styles/dashboard.css", import.meta.url), "utf8");

assert.match(
  shell,
  /<SettingsGroup label="Setup" variant="ruled" panel=\{false\}>\s*<SetupStatusRow \/>\s*<\/SettingsGroup>\s*<BackupSettingsGroup \/>/,
  "Setup is a ruled General group between Progression and Backup",
);
assert.doesNotMatch(shell, /label="Startup"/, "no Startup group returns (#5421)");

const entry = SETTINGS_INDEX.find((item) => item.section === "general" && item.group === "Setup");
assert.ok(entry, "Setup is a search destination");
for (const keyword of ["setup", "first run", "onboarding", "node", "npm", "coven cli", "local service", "resume", "retry"]) {
  assert.ok(entry.keywords.includes(keyword), `search keyword present: ${keyword}`);
}
assert.equal(
  SETTINGS_INDEX.filter((item) => item.section === "general" && item.group === "Setup").length,
  1,
  "one index entry per destination",
);

assert.match(row, /<SettingsRow\s+label="Cave setup"/, "one row named Cave setup");
assert.equal((row.match(/<Button\b/g) ?? []).length, 1, "exactly one action on the row");
assert.match(row, /\{summary\.actionLabel\}/, "the action label follows the shared summary matrix");
assert.match(row, /useSetupOpener\("settings"\)/, "the action opens setup as a settings-origin request");
assert.match(row, /\{setupHost\}/, "the standalone route renders its own lazy overlay host");
assert.match(
  row,
  /useEffect\(\(\) => \{\s*let cancelled = false;\s*void fetchOnboardingBootstrapStatus\(\)/,
  "one status read on mount",
);
assert.match(
  row,
  /enabled: state\?\.status === "running" && !dialogOpen,\s*serialize: true,/,
  "polling only while a run is in progress and the dialog is closed",
);
assert.match(
  row,
  /settings-setup-status settings-setup-status--\$\{tone\}[\s\S]*?settings-setup-status__dot" aria-hidden="true"/,
  "status renders as a dot plus words",
);
assert.doesNotMatch(row, /cave_onboarding_dismissed|cave:onboarding:dismissed|document\.cookie|localStorage/, "Settings never clears the first-run dismissal");
assert.doesNotMatch(row, /import "@\/styles\//, "no new stylesheet: the status CSS lives on the General sheet");
assert.doesNotMatch(row, /Codex|Claude|Copilot|OpenClaw/i, "setup copy stays provider-free");

assert.match(sheet, /\.settings-setup-status--success \{\s*color: var\(--color-success\);/, "success tone uses the semantic token");
assert.match(sheet, /\.settings-setup-status--warning \{\s*color: var\(--color-warning\);/, "warning tone uses the semantic token");
assert.match(sheet, /\.settings-setup-status__dot \{[\s\S]*?background: currentColor;/, "the dot follows the tone color");
assert.doesNotMatch(sheet.match(/\.settings-setup[\s\S]*?\.settings-setup__detail \{[\s\S]*?\}/)?.[0] ?? "", /#[0-9a-f]{3,8}\b|\d+px/i, "Setup styles are token-only");

console.log("settings-setup.test.ts: ok");
