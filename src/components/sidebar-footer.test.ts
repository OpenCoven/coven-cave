// @ts-nocheck
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const chrome = readFileSync(new URL("./sidebar-chrome.tsx", import.meta.url), "utf8");
const minimal = readFileSync(new URL("./sidebar-minimal.tsx", import.meta.url), "utf8");
const chatNav = readFileSync(new URL("./workspace-sidebar.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");

assert.equal(existsSync(new URL("./sidebar-footer.tsx", import.meta.url)), false, "the superseded two-row footer is retired");
assert.match(chrome, /export function SidebarUtilityNav/, "shared chrome owns lower utilities");
assert.match(chrome, /href="\/dashboard"/, "utilities link to Dashboard");
assert.match(chrome, /onClick=\{onOpenSettings\}[\s\S]*?aria-label="Settings"/, "utilities wire Settings");
assert.match(chrome, /onClick=\{openSidebarSearch\}[\s\S]*?aria-label="Search"/, "utilities expose labeled Search");
assert.match(chrome, /className="sidebar-attribution">Coven Cave v\{APP_VERSION\}/, "identity footer shows the app version");
assert.match(chrome, /<FamiliarQuickSwitch[\s\S]*?placement="top-start"/, "identity footer owns familiar selection");

for (const [name, source] of [["standard", minimal], ["Chat", chatNav]]) {
  assert.match(source, /<SidebarUtilityNav onOpenSettings=\{onOpenSettings\}/, `${name} host uses shared utilities`);
  assert.match(source, /<SidebarIdentityFooter/, `${name} host uses shared identity footer`);
  assert.doesNotMatch(source, /SidebarFooter/, `${name} host does not import the retired footer`);
}

assert.match(chatNav, /onOpenSettings: \(\) => void;/, "WorkspaceSidebar declares an onOpenSettings prop");
assert.match(
  workspace,
  /<WorkspaceSidebar[\s\S]*?onOpenSettings=\{\(\) => \{[\s\S]*?push\("\/settings"\)/,
  "workspace wires Settings into the Chat host",
);

console.log("sidebar-footer.test.ts: ok");
