import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_NAV_SECTION,
  NAV_SECTIONS,
  isNavSection,
  navItemsForSection,
  navSectionForMode,
  roomBelongsToSection,
} from "./nav-section.ts";

test("the rail offers exactly two sections, Home first", () => {
  assert.deepEqual(
    NAV_SECTIONS.map((s) => s.id),
    ["home", "code"],
  );
  assert.equal(DEFAULT_NAV_SECTION, "home");
});

test("chat and the browser live in the Code room", () => {
  assert.equal(navSectionForMode("chat"), "code");
  assert.equal(navSectionForMode("browser"), "code");
});

test("chat aliases resolve into the Code room", () => {
  // groupchat -> chat, code/github -> surface:code
  assert.equal(navSectionForMode("groupchat"), "code");
  assert.equal(navSectionForMode("code"), "code");
  assert.equal(navSectionForMode("github"), "code");
});

test("the coding workbench room is the only Code-room surface", () => {
  assert.equal(navSectionForMode("surface:code"), "code");
  assert.equal(navSectionForMode("surface:researcher-desk"), "home");
});

test("every other destination stays in Home", () => {
  for (const mode of ["home", "board", "inbox", "grimoire", "marketplace", "salem", "submissions", "agents"]) {
    assert.equal(navSectionForMode(mode), "home", `${mode} should be a Home destination`);
  }
});

test("Home-room aliases keep lighting Home", () => {
  assert.equal(navSectionForMode("calendar"), "home");
  assert.equal(navSectionForMode("familiar-work-queue"), "home");
  assert.equal(navSectionForMode("roles"), "home");
  assert.equal(navSectionForMode("journal"), "home");
});

test("an unknown mode falls back to Home rather than an empty rail", () => {
  assert.equal(navSectionForMode("not-a-real-mode"), "home");
  assert.equal(navSectionForMode(""), "home");
});

test("nav rows partition across the two sections with no overlap or loss", () => {
  const home = navItemsForSection("home").map((i) => i.id);
  const code = navItemsForSection("code").map((i) => i.id);
  assert.ok(home.includes("home") && home.includes("board") && home.includes("inbox"));
  assert.deepEqual(code, ["chat"]);
  assert.equal(new Set([...home, ...code]).size, home.length + code.length);
});

test("roomBelongsToSection routes registry rooms to their section", () => {
  assert.equal(roomBelongsToSection("surface:code", "code"), true);
  assert.equal(roomBelongsToSection("surface:code", "home"), false);
  assert.equal(roomBelongsToSection("surface:writers-room", "home"), true);
});

test("isNavSection guards persisted values", () => {
  assert.equal(isNavSection("home"), true);
  assert.equal(isNavSection("code"), true);
  assert.equal(isNavSection("chat"), false);
});
