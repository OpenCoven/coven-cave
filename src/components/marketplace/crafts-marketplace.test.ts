import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

const view = await readFile(new URL("../marketplace-view.tsx", import.meta.url), "utf8");
const card = await readFile(new URL("./marketplace-card.tsx", import.meta.url), "utf8");
const detail = await readFile(new URL("./marketplace-detail.tsx", import.meta.url), "utf8");
const craftDetailUrl = new URL("./craft-detail.tsx", import.meta.url);
const css = await readFile(new URL("../../app/globals.css", import.meta.url), "utf8");

assert.match(view, /\{ id: "crafts", label: "Crafts"/, "Crafts is a first-class Marketplace section");
assert.match(view, /\{ id: "craft", label: "Crafts" \}/, "Browse can filter catalog entries by Craft kind");
assert.match(view, /id="marketplace-panel-crafts"/, "Crafts section has a labelled tabpanel");
assert.match(view, /selectSection\("crafts"\)/, "Browse setup rail links to Crafts");
assert.match(view, /Familiar[\s\S]*Role[\s\S]*Craft[\s\S]*Capabilities/, "Crafts section explains the loadout hierarchy");
assert.match(view, /plugin\.kind === "craft"[\s\S]*\/api\/marketplace\/crafts\/install/, "Craft installs use the verified endpoint");
assert.match(view, /plugin\.kind === "craft"[\s\S]*\/api\/marketplace\/crafts\/uninstall/, "Craft removal uses the verified endpoint");
assert.match(view, /Craft installed and verified/, "successful verification has an accessible announcement");
assert.match(view, /Craft removed/, "successful Craft removal has an accessible announcement");

assert.match(card, /plugin\.kind === "craft"[\s\S]*onOpen\(plugin\.id\)/, "Craft card actions open preview before installation");
assert.match(card, /state === "added" \? "Manage" : "Preview"/, "Craft cards use explicit Preview and Manage states");
assert.match(card, /kind === "craft"[\s\S]*"Craft"/, "Craft cards have a distinct kind label");

assert.equal(existsSync(craftDetailUrl), true, "Craft detail component exists");
const craftDetail = await readFile(craftDetailUrl, "utf8");
assert.match(detail, /plugin\.kind === "craft"[\s\S]*<CraftDetail/, "generic drawer delegates Craft state to the loadout detail");
assert.match(craftDetail, /\/api\/marketplace\/crafts\/plan\?id=/, "drawer previews the exact install plan");
assert.match(craftDetail, /fetch\("\/api\/roles"/, "drawer loads Roles for equipping and effective capability display");
assert.match(craftDetail, /fetch\("\/api\/roles\/crafts"/, "Role picker uses the guarded attachment endpoint");
for (const heading of [
  "Install plan",
  "Required components",
  "Bundled skills",
  "Prompts & workflows",
  "Capability footprint",
  "Optional enhancements",
  "Provenance",
  "Equip Roles",
  "Effective capabilities",
]) {
  assert.match(craftDetail, new RegExp(heading), `${heading} is visible in the Craft dossier`);
}
assert.match(craftDetail, /plan\.commands\.install\.join\(" "\)/, "exact Codex install argv is shown before confirmation");
assert.match(craftDetail, /plan\?\.runtime\.disclosure/, "user-scope routing-boundary disclosure is visible");
assert.match(craftDetail, /Removing the Craft does not remove shared optional enhancements/, "shared enhancements are never silently removed");
assert.match(craftDetail, /originLabel/, "effective Role capability chips retain Direct/via-Craft origins");
assert.match(craftDetail, /affectedRoles/, "detach-first failure shows affected Roles");
assert.match(craftDetail, /affectedRolesTruncated/, "bounded detach-first diagnostics disclose omitted Role counts");
assert.match(craftDetail, /aria-live="polite"/, "plan and action state changes are announced");
assert.match(craftDetail, /ref=\{dialogRef\}[\s\S]*tabIndex=\{-1\}/, "focus-trap container remains programmatically focusable for its fallback path");
assert.doesNotMatch(craftDetail, /<label[^>]+className="craft-role-row"/, "Role rows do not nest a button inside a label");
assert.match(craftDetail, /Install Craft/, "new Crafts expose an explicit install state");
assert.match(craftDetail, /Update Craft/, "stale Crafts expose an explicit update state");
assert.match(craftDetail, /Installed and verified/, "current Crafts expose a verified state");
assert.match(craftDetail, /component\.id\}@\$\{component\.version/, "required components expose exact ids and versions");
assert.match(craftDetail, /licensePath/, "provenance includes the bundled license notice path");
assert.match(craftDetail, /upstreamPath[\s\S]*sourcePath[\s\S]*contentHash[\s\S]*modifications/, "bundled skill provenance exposes source paths, hashes, and Coven modifications");
assert.match(
  craftDetail,
  /plugin\.installation\?\.verifiedAt[\s\S]*plugin\.installation\?\.craftVersion[\s\S]*plugin\.updateAvailable/,
  "Role resolution refreshes when install verification or the current Craft version changes",
);

assert.match(css, /\.craft-loadout-path \{/, "Craft hierarchy has a stable visual hook");
assert.match(css, /\.craft-dossier__ledger \{/, "Craft grouped contents use a stable dossier ledger");
assert.match(css, /\.craft-role-row:focus-within \{/, "Role picker has a visible keyboard focus treatment");

console.log("crafts-marketplace.test.ts: ok");
