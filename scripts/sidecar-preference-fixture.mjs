// The representative preference set the sidecar restart regression writes and
// then reads back (`scripts/sidecar-runtime-smoke.mjs`).
//
// It lives in its own module so a cheap unit test can assert it still covers
// every field the preferences schema round-trips. That guard exists because
// the smoke itself only runs during a RELEASE: when `appearance.reading.size`
// was added (#4736) without updating this patch, the restore assertion started
// failing on ubuntu, macOS and Windows simultaneously — and the first anyone
// saw of it was the v0.3.8 release job going red, after the tag was already
// pushed.
//
// Values are deliberately NOT the schema defaults. The smoke compares each
// restored group with deep-equality, so a field carrying its default value
// would still pass even if persistence dropped it entirely.
export const SIDECAR_PREFERENCE_PATCH = Object.freeze({
  appearance: {
    theme: {
      id: "tide",
      modePreference: "light",
      resolvedMode: "light",
      tokens: { "--background": "#112233", "--foreground": "#f8fafc" },
    },
    fonts: { serif: "fraunces", sans: "source-sans-3", mono: "source-code-pro" },
    screenScale: 125,
    reading: {
      size: 3,
      leading: "relaxed",
      tracking: "wide",
      align: "justify",
      width: "narrow",
      weight: "medium",
      hyphens: "on",
    },
    datetime: { clock: "24h", date: "ddmm", density: "verbose" },
    recentColors: ["#112233", "#aabbcc"],
    cornerRadius: "round",
    backdrop: {
      enabled: true,
      intensity: 67,
      matchAccent: false,
      accentSeed: { L: 0.63, a: 0.12, b: -0.08 },
    },
  },
  general: { stopPhrase: "halt", celebrations: false },
  phone: { mobileMode: false },
  voice: {
    defaultProvider: "elevenlabs",
    defaultModel: "eleven_turbo_v2_5",
    defaultVoice: "21m00Tcm4TlvDq8ikWAM",
  },
});

/**
 * The preference groups the smoke asserts with whole-object deep equality.
 * A patch that omits a key inside one of these fails once the schema grows a
 * field, because the restored object carries the new default and the patch
 * does not. Keyed by the path into `CavePreferences`.
 */
export const SIDECAR_PREFERENCE_DEEP_EQUAL_GROUPS = Object.freeze([
  "appearance.fonts",
  "appearance.reading",
  "appearance.datetime",
  "general",
  "phone",
  "voice",
]);
