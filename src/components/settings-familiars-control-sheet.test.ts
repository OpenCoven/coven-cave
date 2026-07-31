// @ts-nocheck
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const inline = readFileSync(new URL("./familiar-studio-inline.tsx", import.meta.url), "utf8");
const picker = readFileSync(new URL("./settings-familiar-picker.tsx", import.meta.url), "utf8");
const shell = readFileSync(new URL("./settings-shell.tsx", import.meta.url), "utf8");
const vault = readFileSync(new URL("./vault-panel.tsx", import.meta.url), "utf8");
const vaultRoute = readFileSync(new URL("../app/api/vault/route.ts", import.meta.url), "utf8");
const globals = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const stylesUrl = new URL("../styles/settings-familiars.css", import.meta.url);
const styles = existsSync(stylesUrl) ? readFileSync(stylesUrl, "utf8") : "";

// The legacy Settings host is retired; the shared inline primitives remain
// contract-tested for any remaining non-settings reuse.
assert.doesNotMatch(shell, /section === "familiars"|FamiliarsSection/, "Settings no longer hosts the retired Familiars control sheet");
assert.match(
  globals,
  /@import "\.\.\/styles\/settings-familiars\.css";/,
  "The focused Familiars control-sheet stylesheet is wired through the global facade",
);
assert.match(
  styles,
  /\.familiar-studio-inline\s*\{[\s\S]*?grid-template-columns:\s*var\(--familiar-roster-width\)\s+minmax\(0,\s*1fr\)/,
  "The Studio is a roster/detail grid rather than a dropdown over one column",
);
assert.match(
  styles,
  /\.familiar-studio-inline\s*\{[\s\S]*?grid-template-rows:\s*minmax\(0,\s*1fr\)[\s\S]*?border:\s*0[\s\S]*?border-radius:\s*0/,
  "The control sheet resets the legacy card rows and border so both panes fill the viewport",
);

// The familiar roster is persistent, searchable, collapsible, and keyboard
// selectable. Summon stays in the roster header; lifecycle remains safe.
assert.match(picker, /<aside[\s\S]*?className="settings-familiar-roster"/, "Renders an always-visible familiar roster");
assert.match(picker, /placeholder="Find a familiar…"/, "Uses the handoff search copy");
assert.match(picker, /aria-label=\{collapsed \? "Expand familiar list" : "Collapse familiar list"\}/, "Roster can collapse to its avatar rail");
assert.doesNotMatch(picker, /role="listbox"/, "Row actions are not nested inside an ARIA listbox");
assert.match(picker, /aria-current=\{selected \? "page" : undefined\}/, "The selected familiar is announced");
assert.match(picker, /className="sr-only"[\s\S]*?Status:/, "Roster status has a non-color screen-reader channel");
assert.match(picker, /archiveFamiliar/, "Roster archive action uses the production archive store");
assert.match(picker, /onManageLifecycle/, "Dismiss routes through the existing undo-safe lifecycle controls");
assert.doesNotMatch(picker, /<Popover/, "The Familiars handoff retires the dropdown picker");
assert.match(
  styles,
  /@container familiar-studio \(max-width: 560px\)[\s\S]*?settings-familiar-roster__summon[\s\S]*?display:\s*inline-grid/,
  "The narrow roster keeps Summon reachable when the expand control is hidden",
);
const narrowLayout = styles.slice(
  styles.indexOf("@container familiar-studio (max-width: 560px)"),
  styles.indexOf("@media (prefers-reduced-motion: reduce)"),
);
assert.doesNotMatch(
  narrowLayout,
  /\.settings-familiar-roster :is\([\s\S]*?settings-familiar-roster__search/,
  "The narrow roster keeps search, copy, status, and row actions available",
);
assert.doesNotMatch(
  narrowLayout,
  /\.settings-familiar-roster__collapse\s*\{[^}]*display:\s*none/,
  "The narrow roster remains collapsible",
);
assert.match(
  narrowLayout,
  /\.settings-familiar-roster\[data-collapsed\] \.settings-familiar-roster__list\s*\{[^}]*display:\s*none/,
  "Collapsing the narrow roster frees the vertical space used by its list",
);

// The detail hero is live production UI: avatar upload, runtime/model/voice
// facts, chat handoff, and a real read-only one-shot smoke test.
assert.match(inline, /useFamiliarImageUpload/, "Hero avatar uses the shared image upload contract");
assert.match(inline, /FAMILIAR_IMAGE_ACCEPT/, "Hero and Identity accept the same image formats");
assert.match(inline, /requestAgentsNewChat\(\{ familiarId: familiar\.id \}\)/, "Open chat uses the cross-route production handoff");
assert.match(inline, /streamFamiliarText/, "Test run uses the sanctioned familiar stream");
assert.match(inline, /permissionMode: "read"/, "Test run is a non-mutating read-only smoke test");
assert.match(
  inline,
  /streamFamiliarText\(\{[\s\S]*?origin: "enhance",[\s\S]*?permissionMode: "read"/,
  "The projectless readiness check uses an approved hidden-generation origin",
);
assert.match(inline, /catch \(cause\)/, "Aborting or failing a streamed smoke test cannot reject unhandled");
assert.match(inline, /className="familiar-studio-control__hero"/, "Renders the handoff identity hero");
assert.match(inline, /className="familiar-studio-control__stats"/, "Renders production runtime/model/voice/status facts");
assert.match(inline, /Open chat/, "Hero exposes the primary chat action");
assert.match(inline, /Test run/, "Hero exposes the smoke-test action");
assert.match(inline, /breadcrumb=\{\["Familiars", familiar\.display_name, "Test run"\]\}/, "Smoke test opens in the shared modal");
assert.match(
  inline,
  /if \(canonical\.state !== "ready" \|\| !files\.ok\) \{\s*setCount\(\{ state: "unavailable" \}\)/,
  "Failed memory APIs stay unknown instead of being reported as zero entries",
);
assert.match(inline, /<VaultPanel familiarId=\{familiar\.id\}/, "Vault receives the selected familiar scope");
assert.match(vault, /export function VaultPanel\(\{ familiarId \}/, "Vault accepts a familiar scope");
assert.match(vault, /method: "PATCH"/, "Familiar Vault grants update scope without rewriting or deleting the secret");
assert.match(vault, /Grant to familiar/, "Familiar Vault can grant an existing scoped key");
assert.match(vault, /Revoke from familiar/, "Familiar Vault can revoke only the selected familiar's grant");
assert.match(
  vault,
  /familiarId \?[\s\S]*?updateFamiliarGrant[\s\S]*?:[\s\S]*?handleDelete/,
  "The familiar-scoped action cannot invoke the global secret deletion path",
);
assert.match(vaultRoute, /normalizeVaultScope\(body\.scope\)/, "Vault writes can persist a familiar grant");
assert.match(vaultRoute, /export async function PATCH/, "Vault exposes a scope-only mutation");

// Preserve the five real Studio surfaces and the fixed autosave/offline footer.
for (const label of ["Identity", "Brain", "Memory", "Projects", "Vault"]) {
  assert.match(inline, new RegExp(`label: "${label}"`), `${label} remains in the Studio`);
}
assert.match(inline, /Changes save automatically/, "The fixed save-status footer remains");
assert.match(
  styles,
  /@media \(prefers-reduced-motion: reduce\)/,
  "The control sheet supplies a reduced-motion story",
);
assert.match(
  styles,
  /@container familiar-studio/,
  "The roster/detail layout adapts to its Settings content container",
);
assert.match(
  styles,
  /\.familiar-studio-grimoire:focus\s*\{/,
  "The programmatic Contract redirect always leaves a visible Grimoire focus ring",
);

console.log("settings-familiars-control-sheet.test.ts: ok");
