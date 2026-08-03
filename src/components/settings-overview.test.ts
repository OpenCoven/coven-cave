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
  const ids = ["profile", "general", "voice", "daemon", "mobile", "appearance", "about"];
  assert.deepEqual(SECTIONS.map((s) => s.id), ids, "the section set matches the shell nav");
  for (const s of SECTIONS) {
    assert.ok(s.label && s.icon.startsWith("ph:") && s.description.length > 0, `${s.id} has label/icon/description`);
    if (s.id === "voice") {
      assert.equal(s.accent, "var(--accent-presence)", "Voice follows the theme-aware presence token");
    } else {
      assert.match(s.accent, /^#[0-9a-f]{6}$/i, `${s.id} keeps its established accent`);
    }
    assert.ok(Array.isArray(SECTION_HIGHLIGHTS[s.id]) && SECTION_HIGHLIGHTS[s.id].length > 0, `${s.id} has highlights`);
  }
  assert.deepEqual(getSectionMeta("voice"), {
    id: "voice",
    label: "Voice",
    icon: "ph:waveform",
    description: "Providers, voices, local speech, and defaults for new familiars.",
    accent: "var(--accent-presence)",
  });
  assert.deepEqual(SECTION_HIGHLIGHTS.voice, [
    "Provider readiness",
    "Voices & models",
    "New familiar defaults",
  ]);
});

test("getSectionMeta / settingsSectionLabel resolve, with a safe fallback", () => {
  assert.equal(getSectionMeta("appearance").label, "Appearance");
  assert.equal(settingsSectionLabel("mobile"), "Phone");
  // Unknown id falls back to the first section rather than throwing.
  assert.equal(getSectionMeta("nope").id, "profile");
});

// ── SettingsOverview header (source-text) ────────────────────────────────────

const overview = readFileSync(new URL("./settings-overview.tsx", import.meta.url), "utf8");
const generalSummary = readFileSync(
  new URL("../lib/settings-general-summary.ts", import.meta.url),
  "utf8",
);

test("the overview header renders mark, kicker, title, description, and the strip", () => {
  assert.match(overview, /getSectionMeta\(section\)/, "pulls section metadata");
  assert.match(overview, /settings-overview__mark[\s\S]*backgroundColor[\s\S]*meta\.accent/, "accent-tinted mark");
  assert.match(overview, /settings-overview__kicker[\s\S]*meta\.label/, "kicker names the section");
  assert.match(overview, /settings-overview__title">\{meta\.label\}/, "title is the section label");
  assert.match(overview, /settings-overview__description">\{meta\.description\}/, "one-line description");
  assert.match(overview, /SECTION_HIGHLIGHTS\[section\]\.map/, "renders the highlight strip");
});

test("General can opt into the control-sheet overview without changing other sections", () => {
  assert.match(
    overview,
    /variant = "default"[\s\S]*variant === "control-sheet"/,
    "overview exposes an explicit opt-in variant",
  );
  assert.match(
    overview,
    /settings-overview--control-sheet/,
    "the reference treatment has a stable style hook",
  );
  assert.match(
    shell,
    /section="general"[\s\S]{0,160}variant="control-sheet"/,
    "General opts into the reference treatment",
  );
  for (const id of ["voice", "daemon", "mobile", "appearance", "about"]) {
    assert.doesNotMatch(
      shell,
      new RegExp(`section="${id}"[^>]*variant="control-sheet"`),
      `${id} retains the default settings treatment`,
    );
  }
});

test("the General control-sheet overview uses real summary sources and stable anchors", () => {
  assert.match(overview, /createGeneralSummaryLoader/, "the overview should reuse the dedicated summary loader");
  assert.match(
    overview,
    /summaryLoaderRef\.current\?\.dispose\(\)[\s\S]*summaryLoaderRef\.current = null/,
    "the overview should dispose active summary work when the control-sheet view unmounts",
  );
  assert.match(generalSummary, /fetchImpl\("\/api\/config", \{ cache: "no-store", signal \}\)/);
  assert.doesNotMatch(generalSummary, /fetchImpl\("\/api\/daemon\/status"/);
  assert.doesNotMatch(generalSummary, /\/api\/voice\/engines/);
  assert.match(generalSummary, /fetchImpl\("\/api\/backup\/sync", \{ cache: "no-store", signal \}\)/);
  assert.match(
    overview,
    /usePausablePoll\([\s\S]*loadSummary[\s\S]*30_000[\s\S]*enabled:\s*active/,
    "the live summary refreshes while General remains open",
  );
  assert.match(
    overview,
    /addEventListener\("cave:backup-sync-refresh", refreshSummary\)/,
    "backup mutations refresh the live summary immediately",
  );
  assert.doesNotMatch(overview, /cave:voice-engines-refresh/);
  assert.match(
    overview,
    /summaryStatus === "partial"[\s\S]*Some General settings details couldn't refresh/,
    "partial summary loads are explicit",
  );
  assert.match(
    overview,
    /summaryHasProblem[\s\S]*role=\{summaryHasProblem \? "alert" : "status"\}[\s\S]*Retry/,
    "partial and failed summary loads expose a retry action",
  );
  assert.match(overview, /settingsGroupId\("Workspace"\)/);
  assert.match(overview, /settingsGroupId\("Backup"\)/);
  assert.match(overview, /settingsGroupId\("Startup"\)/);
  assert.match(overview, /scrollIntoView\(\{[\s\S]*prefersReducedMotion/);
  assert.match(
    overview,
    /target\.focus\(\{\s*preventScroll:\s*true\s*\}\)/,
    "jump controls transfer focus to the destination group",
  );
  assert.match(overview, /settings-overview-anchor focus-ring/);
  assert.doesNotMatch(overview, /voices ready/);
  assert.doesNotMatch(overview, /readyVoices|totalVoices/);
  assert.match(overview, /sync \$\{summary\.syncEnabled \? "on" : "off"\}/);
  const settingsGroup = readFileSync(
    new URL("./ui/settings-group.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    settingsGroup,
    /tabIndex=\{-1\}[\s\S]*role="group"[\s\S]*aria-label=\{label\}[\s\S]*focus-ring/,
    "settings groups are programmatically focusable and named",
  );
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
  for (const id of ["general", "voice", "appearance"]) {
    assert.match(shell, new RegExp(`section="${id}"`), `${id} page passes its section`);
  }
  assert.match(shell, /section === "voice" && <VoiceSection \/>/, "the shell renders the Voice destination");
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
