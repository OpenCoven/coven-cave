// @ts-nocheck
import assert from "node:assert/strict";

import {
  applyPreferencesPatch,
  createDefaultPreferences,
  legacyStorageToPreferencesPatch,
  normalizeCavePreferences,
  preferencesToLegacyStorage,
  PreferencesValidationError,
  validatePreferencesPatch,
} from "./preferences-schema.ts";

const defaults = createDefaultPreferences(false);
assert.equal(defaults.version, 1);
assert.equal(defaults.initialized, false);
assert.equal(defaults.appearance.theme.id, "coven");
assert.equal(defaults.appearance.fonts.sans, "inter");
assert.equal(defaults.appearance.datetime.clock, "12h");
assert.equal(defaults.general.newsHeadlines, true);
assert.equal(defaults.general.celebrations, true, "progression celebrations default on");
assert.equal(defaults.phone.mobileMode, true);

const fullPatch = validatePreferencesPatch({
  appearance: {
    theme: { id: "ember", modePreference: "light", resolvedMode: "light" },
    fonts: { serif: "eb-garamond", sans: "source-sans-3", mono: "source-code-pro" },
    screenScale: 125,
    reading: {
      leading: "relaxed",
      tracking: "wide",
      align: "justify",
      width: "narrow",
      weight: "light",
      hyphens: "on",
    },
    datetime: { clock: "24h", date: "ddmm", density: "verbose" },
    recentColors: ["#112233", "#aabbcc"],
    cornerRadius: "round",
    backdrop: {
      enabled: true,
      intensity: 64,
      matchAccent: false,
      accentSeed: { L: 0.6, a: 0.1, b: -0.08 },
    },
  },
  general: { newsHeadlines: false, celebrations: false },
  phone: { mobileMode: false },
});

const initialized = applyPreferencesPatch(
  defaults,
  fullPatch,
  new Date("2026-07-11T12:00:00.000Z"),
);
assert.equal(initialized.initialized, true);
assert.equal(initialized.revision, 1);
assert.equal(initialized.appearance.theme.selectionRevision, 1);
assert.equal(initialized.appearance.theme.id, "ember");
assert.equal(initialized.appearance.screenScale, 125);
assert.equal(initialized.appearance.reading.width, "narrow");
assert.equal(initialized.appearance.datetime.density, "verbose");
assert.equal(initialized.appearance.cornerRadius, "round");
assert.equal(initialized.appearance.backdrop.intensity, 64);
assert.equal(initialized.general.newsHeadlines, false);
assert.equal(initialized.general.celebrations, false, "celebrations patch lands");
assert.equal(initialized.phone.mobileMode, false);

const tokensPublished = applyPreferencesPatch(
  initialized,
  validatePreferencesPatch({ appearance: { theme: { tokens: { "--bg-base": "#120d0a" } } } }),
  new Date("2026-07-11T12:01:00.000Z"),
);
assert.equal(tokensPublished.revision, 2);
assert.equal(
  tokensPublished.appearance.theme.selectionRevision,
  1,
  "resolved token publication must not advance the selection revision",
);

const selectedAgain = applyPreferencesPatch(
  tokensPublished,
  validatePreferencesPatch({ appearance: { theme: { id: "tide", modePreference: "dark" } } }),
  new Date("2026-07-11T12:02:00.000Z"),
);
assert.equal(selectedAgain.appearance.theme.selectionRevision, 3);
assert.equal(selectedAgain.appearance.fonts.sans, "source-sans-3");
assert.equal(selectedAgain.appearance.reading.width, "narrow");
assert.equal(selectedAgain.appearance.cornerRadius, "round");
assert.equal(
  selectedAgain.appearance.backdrop.intensity,
  64,
  "selecting a preset must preserve independent appearance preferences",
);

const customTheme = {
  name: "Three-layer custom",
  cssVars: {
    theme: { "--font-sans": "Custom Sans", radius: "1rem" },
    light: { background: "#fafafa", "--accent-presence": "#3366ff" },
    dark: { background: "#101216", "--accent-presence": "#88aaff" },
  },
};
const customTokens = {
  "--bg-base": "#101216",
  "--text-primary": "#f4f6ff",
  "--accent-presence": "#88aaff",
};
const customPersisted = applyPreferencesPatch(
  createDefaultPreferences(false),
  validatePreferencesPatch({
    appearance: {
      theme: {
        id: "custom",
        modePreference: "system",
        resolvedMode: "dark",
        custom: customTheme,
        tokens: customTokens,
      },
    },
  }),
  new Date("2026-07-11T12:03:00.000Z"),
);
const customRoundTrip = normalizeCavePreferences(JSON.parse(JSON.stringify(customPersisted)));
assert.equal(customRoundTrip.appearance.theme.id, "custom");
assert.deepEqual(
  customRoundTrip.appearance.theme.custom,
  customTheme,
  "canonical JSON round-trip preserves theme-level and light/dark custom CSS groups",
);
assert.deepEqual(
  customRoundTrip.appearance.theme.tokens,
  customTokens,
  "canonical JSON round-trip preserves resolved native-client tokens",
);
const customLegacyRoundTrip = legacyStorageToPreferencesPatch(
  preferencesToLegacyStorage(customRoundTrip),
);
assert.deepEqual(
  customLegacyRoundTrip.appearance?.theme?.custom,
  customTheme,
  "the compatibility cache can seed all three custom CSS groups during one-time migration",
);

for (const invalid of [
  { authToken: "secret" },
  { appearance: { theme: { id: "not-a-theme" } } },
  { appearance: { fonts: { sans: "remote-font-url" } } },
  { appearance: { backdrop: { image: { mime: "image/svg+xml" } } } },
  { phone: { mobileMode: "yes" } },
]) {
  assert.throws(
    () => validatePreferencesPatch(invalid),
    PreferencesValidationError,
    "the API patch validator should reject unknown, secret, and out-of-domain data",
  );
}

const recovered = normalizeCavePreferences({
  version: 999,
  initialized: true,
  revision: -4,
  authToken: "must-not-survive",
  appearance: {
    theme: { id: "<script>", tokens: { bad: "value", "--ok": "#123456" } },
    screenScale: 999,
    recentColors: ["#AABBCC", "bad", "#aabbcc"],
    backdrop: { intensity: 999, image: { mime: "image/svg+xml" } },
  },
});
assert.equal(recovered.version, 1);
assert.equal(recovered.revision, 0);
assert.equal(recovered.appearance.theme.id, "coven");
assert.deepEqual(recovered.appearance.theme.tokens, { "--ok": "#123456" });
assert.equal(recovered.appearance.screenScale, 100);
assert.deepEqual(recovered.appearance.recentColors, ["#aabbcc"]);
assert.equal(recovered.appearance.backdrop.intensity, 100);
assert.equal(recovered.appearance.backdrop.image.mime, null);
assert.equal(Object.hasOwn(recovered, "authToken"), false);

const legacyPatch = legacyStorageToPreferencesPatch({
  "coven-theme": "orchid",
  "coven-mode": "light",
  "cave:font:sans": "source-sans-3",
  "cave:screen-scale": "150",
  "cave:reading-width": "medium",
  "cave:datetime-clock": "24h",
  "cave:corner-radius": "sharp",
  "cave:home-news-enabled": "false",
  "cave:mobile-mode-enabled": "false",
  "cave:backdrop:v1": JSON.stringify({ enabled: true, intensity: 70 }),
  authToken: "ignored",
  "coven-access-token": "ignored",
});
assert.equal(legacyPatch.appearance?.theme?.id, "dusk");
assert.equal(legacyPatch.appearance?.fonts?.sans, "source-sans-3");
assert.equal(legacyPatch.appearance?.screenScale, 150);
assert.equal(legacyPatch.appearance?.reading?.width, "medium");
assert.equal(legacyPatch.appearance?.datetime?.clock, "24h");
assert.equal(legacyPatch.appearance?.cornerRadius, "sharp");
assert.equal(legacyPatch.appearance?.backdrop?.enabled, true);
assert.equal(legacyPatch.general?.newsHeadlines, false);
assert.equal(legacyPatch.phone?.mobileMode, false);
assert.equal(Object.hasOwn(legacyPatch, "authToken"), false);

const compatibilityCache = preferencesToLegacyStorage(selectedAgain);
assert.equal(compatibilityCache["coven-theme"], "tide");
assert.equal(compatibilityCache["cave:font:sans"], "source-sans-3");
assert.equal(compatibilityCache["cave:datetime-clock"], "24h");
assert.equal(Object.keys(compatibilityCache).some((key) => /token|secret|credential/i.test(key)), false);

// ── appearance.backdrop.familiars (cave-kf8p) ────────────────────────────────
// Per-familiar backdrop enablement: id → explicit boolean. Absent id = default
// rule (image presence) applied client-side; the schema only stores explicit
// choices.
assert.deepEqual(
  createDefaultPreferences(false).appearance.backdrop.familiars,
  {},
  "defaults carry an empty familiars map",
);

const familiarsNormalized = normalizeCavePreferences({
  appearance: {
    backdrop: {
      familiars: {
        "fam-a": true,
        "fam-b": false,
        "fam-junk": "yes",
        "": true,
      },
    },
  },
});
assert.deepEqual(
  familiarsNormalized.appearance.backdrop.familiars,
  { "fam-a": true, "fam-b": false },
  "normalize keeps boolean entries with non-empty ids and drops junk",
);
assert.deepEqual(
  normalizeCavePreferences({ appearance: { backdrop: { familiars: ["fam-a"] } } })
    .appearance.backdrop.familiars,
  {},
  "a non-record familiars value collapses to the empty map",
);

const familiarsPatch = validatePreferencesPatch({
  appearance: { backdrop: { familiars: { "fam-a": true, "fam-b": false } } },
});
assert.deepEqual(
  familiarsPatch.appearance?.backdrop?.familiars,
  { "fam-a": true, "fam-b": false },
  "the strict validator accepts an id → boolean map",
);
for (const invalidFamiliars of [
  { appearance: { backdrop: { familiars: { "fam-a": "yes" } } } },
  { appearance: { backdrop: { familiars: { "": true } } } },
  { appearance: { backdrop: { familiars: ["fam-a"] } } },
]) {
  assert.throws(
    () => validatePreferencesPatch(invalidFamiliars),
    PreferencesValidationError,
    "the strict validator rejects non-boolean entries, empty ids, and non-records",
  );
}

const familiarsApplied = applyPreferencesPatch(
  applyPreferencesPatch(createDefaultPreferences(true), {
    appearance: { backdrop: { familiars: { "fam-a": true, "fam-b": false } } },
  }),
  { appearance: { backdrop: { familiars: { "fam-a": false } } } },
);
assert.deepEqual(
  familiarsApplied.appearance.backdrop.familiars,
  { "fam-a": false },
  "a patch replaces the whole familiars map (writers always send the full map)",
);

console.log("preferences-schema.test.ts: ok");
