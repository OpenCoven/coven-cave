// @ts-nocheck
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  SECTIONS,
  SECTION_HIGHLIGHTS,
  getSectionMeta,
  settingsSectionLabel,
} from "./settings-sections.ts";

// ── settings-sections catalog (pure) ─────────────────────────────────────────

test("every section has full overview metadata + a highlight strip", () => {
  const ids = ["profile", "general", "daemon", "familiars", "mobile", "appearance", "about"];
  assert.deepEqual(SECTIONS.map((s) => s.id), ids, "the section set matches the shell nav");
  for (const s of SECTIONS) {
    assert.ok(s.label && s.icon.startsWith("ph:") && s.description.length > 0, `${s.id} has label/icon/description`);
    assert.match(s.accent, /^#[0-9a-f]{6}$/i, `${s.id} has a hex accent`);
    assert.ok(Array.isArray(SECTION_HIGHLIGHTS[s.id]) && SECTION_HIGHLIGHTS[s.id].length > 0, `${s.id} has highlights`);
  }
});

test("getSectionMeta / settingsSectionLabel resolve, with a safe fallback", () => {
  assert.equal(getSectionMeta("appearance").label, "Appearance");
  assert.equal(settingsSectionLabel("mobile"), "Phone");
  // Unknown id falls back to the first section rather than throwing.
  assert.equal(getSectionMeta("nope").id, "profile");
});

// ── SettingsOverview header (source-text) ────────────────────────────────────

const overview = readFileSync(new URL("./settings-overview.tsx", import.meta.url), "utf8");

test("the overview header renders mark, kicker, title, description, and the strip", () => {
  assert.match(overview, /getSectionMeta\(section\)/, "pulls section metadata");
  assert.match(overview, /settings-overview__mark[\s\S]*backgroundColor[\s\S]*meta\.accent/, "accent-tinted mark");
  assert.match(overview, /settings-overview__kicker[\s\S]*meta\.label/, "kicker names the section");
  assert.match(overview, /settings-overview__title">\{meta\.label\}/, "title is the section label");
  assert.match(overview, /settings-overview__description">\{meta\.description\}/, "one-line description");
  assert.match(overview, /SECTION_HIGHLIGHTS\[section\]\.map/, "renders the highlight strip");
});

// ── shell wiring (source-text) ───────────────────────────────────────────────

const shell = readFileSync(new URL("./settings-shell.tsx", import.meta.url), "utf8");
const daemon = readFileSync(new URL("./settings-daemon.tsx", import.meta.url), "utf8");
const profile = readFileSync(new URL("./settings-profile.tsx", import.meta.url), "utf8");
const about = readFileSync(new URL("./settings-about.tsx", import.meta.url), "utf8");
const phone = readFileSync(new URL("./settings-phone.tsx", import.meta.url), "utf8");

test("the shell sources sections from settings-sections and renders the overview", () => {
  assert.match(shell, /import \{ SettingsOverview \} from "\.\/settings-overview"/);
  assert.match(shell, /SETTINGS_INDEX/);
  assert.match(shell, /SECTIONS/);
  assert.match(shell, /settingsSectionLabel/);
  assert.match(shell, /type Section/);
  // SettingsPage swaps the plain <h1> for the overview when a section is given.
  assert.match(shell, /section \? \(\s*<SettingsOverview section=\{section\} \/>/);
  // The shared search index is sourced from settings-sections.
  assert.doesNotMatch(shell, /const SETTINGS_INDEX: SettingsIndexEntry\[\]/);
  // Each SettingsPage-based section opts into its overview header. Profile,
  // Phone, Daemon, and About use their approved richer heroes instead.
  assert.match(profile, /<header className="settings-profile__hero">/, "profile renders its control-sheet hero");
  assert.match(profile, />SETTINGS · PROFILE</, "profile hero preserves settings wayfinding");
  assert.doesNotMatch(profile, /<SettingsOverview/, "profile does not duplicate the generic overview");
  for (const id of ["general", "appearance"]) {
    assert.match(shell, new RegExp(`section="${id}"`), `${id} page passes its section`);
  }
  assert.match(daemon, /className="settings-daemon-hero"/, "daemon uses its approved control-sheet hero");
  assert.match(
    phone,
    /aria-labelledby="settings-phone-title"[\s\S]*<h1 id="settings-phone-title">Phone<\/h1>/,
    "Phone replaces the generic overview with its accessible handoff hero",
  );
  assert.match(
    about,
    /aria-labelledby="settings-about-title"[\s\S]*<h1 id="settings-about-title">About<\/h1>/,
    "About replaces the generic overview with its accessible handoff hero",
  );
  assert.doesNotMatch(shell, /section="addons"|AddonsSection|Add-ons/, "Add-ons is not a settings section");
});

console.log("settings-overview.test.ts: ok");
