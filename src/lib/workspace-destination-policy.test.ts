import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  paletteDestinations,
  sidebarDestinations,
  statusContextPolicy,
} from "./workspace-destination-policy.ts";
import { WORKSPACE_NAV_ITEMS } from "./workspace-navigation.ts";
import { WORKSPACE_CANONICAL_PAGE_DEFINITIONS } from "./workspace-page-registry.ts";

const policySource = readFileSync(new URL("./workspace-destination-policy.ts", import.meta.url), "utf8");

test("destination metadata lookup is indexed and policy validation stays test-owned", () => {
  assert.match(policySource, /const WORKSPACE_NAV_ITEMS_BY_ID = new Map/);
  assert.match(policySource, /WORKSPACE_NAV_ITEMS_BY_ID\.get\(definition\.id\)/);
  assert.doesNotMatch(policySource, /NAV_SECTIONS\.some/);
  assert.doesNotMatch(policySource, /Sidebar destination policy must keep every navigation section populated/);
});

test("palette destinations expose only visible canonical destinations", () => {
  const destinations = paletteDestinations();
  assert.deepEqual(
    destinations.map(({ id }) => id),
    ["chat", "home", "inbox", "board", "salem", "browser", "marketplace", "grimoire"],
  );
  assert.ok(destinations.every(({ id, canonicalId, palette }) => id === canonicalId && palette !== "hidden"));
  assert.equal(new Set(destinations.map(({ id }) => id)).size, destinations.length);
});

test("every visible destination carries exactly one shared navigation metadata row", () => {
  const navItemsById = new Map(WORKSPACE_NAV_ITEMS.map((item) => [item.id, item]));

  for (const destination of paletteDestinations()) {
    const navItem = navItemsById.get(destination.id);
    assert.ok(navItem, `${destination.id} needs shared navigation metadata`);
    assert.equal(destination.iconName, navItem.iconName);
    assert.equal(destination.description, navItem.description);
    assert.equal(destination.kbd, navItem.kbd);
  }

  for (const destination of sidebarDestinations()) {
    const navItem = navItemsById.get(destination.id);
    assert.ok(navItem, `${destination.id} needs shared navigation metadata`);
    assert.equal(destination.iconName, navItem.iconName);
    assert.equal(destination.description, navItem.description);
    assert.equal(destination.kbd, navItem.kbd);
  }
});

test("the sidebar is one flat list with Chat directly under Home", () => {
  const paletteIds = new Set(paletteDestinations().map(({ id }) => id));
  const ids: string[] = sidebarDestinations().map(({ id }) => id);

  // Chat sits immediately after Home. It used to live in a separate "Code"
  // room behind a titlebar toggle, so it was unreachable from Home entirely.
  assert.equal(ids[0], "home");
  assert.equal(ids[1], "chat");

  // Every former Home and Code destination now appears in the same list.
  for (const id of ["home", "chat", "board", "inbox", "marketplace", "grimoire"]) {
    assert.ok(ids.includes(id), `${id} should be present in the unified sidebar`);
  }

  for (const definition of sidebarDestinations()) {
    assert.ok(
      paletteIds.has(definition.id),
      `${definition.id} should stay reachable from the palette`,
    );
  }
});

test("aliases do not create duplicate visible canonical destinations", () => {
  const paletteIds = paletteDestinations().map(({ id }) => id);
  const visiblePaletteIds = new Set<string>(paletteIds);
  for (const alias of [
    "groupchat",
    "calendar",
    "journal",
    "roles",
    "capabilities",
    "flow",
    "familiar-work-queue",
    "code",
    "github",
  ]) {
    assert.equal(visiblePaletteIds.has(alias), false, `${alias} should stay hidden from palette results`);
  }

  assert.equal(paletteIds.filter((id) => id === "grimoire").length, 1);
  assert.equal(sidebarDestinations().filter(({ id }) => id === "grimoire").length, 1);
});

test("status context policy stays explicit for canonical pages and hides unknown ids", () => {
  for (const definition of WORKSPACE_CANONICAL_PAGE_DEFINITIONS) {
    assert.equal(
      statusContextPolicy(definition.id),
      definition.statusContext,
      `${definition.id} should publish an explicit status-context policy`,
    );
  }

  assert.equal(statusContextPolicy("home"), "persistent");
  assert.equal(statusContextPolicy("chat"), "persistent");
  assert.equal(statusContextPolicy("board"), "persistent");
  assert.equal(statusContextPolicy("inbox"), "persistent");
  assert.equal(statusContextPolicy("browser"), "contextual");
  assert.equal(statusContextPolicy("settings"), "contextual");
  assert.equal(statusContextPolicy("memory"), "hidden");
  assert.equal(statusContextPolicy("terminal"), "hidden");
  assert.equal(statusContextPolicy("surface:code"), "contextual");
  assert.equal(statusContextPolicy("not-a-page"), "hidden");
});
