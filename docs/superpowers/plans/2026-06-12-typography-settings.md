# Typography Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** User-selectable UI font, mono font, and base font size (12–20px) with 21 bundled fonts and custom installed-font support, applied app-wide via CSS vars; plus a consistency sweep of hardcoded font stacks.

**Architecture:** Follows the screen-magnification pattern exactly: pure lib (`font-settings.ts`) + localStorage + a controller mounted in `layout.tsx` that sets CSS vars on `<html>`; `globals.css` consumes them with Geist fallbacks; the type scale multiplies by a unitless `--cave-font-scale`. Bundled fonts are `next/font/google` instances with `preload: false` (lazy `@font-face` — unselected fonts never download). Settings UI is a new `TypographySettings` component rendered in Settings → Appearance.

**Tech Stack:** Next.js 15 app router, `next/font/google`, Tailwind 4 (`@theme inline`), node test files run by `pnpm test:app` (source-pin style, see `settings-appearance.test.ts`).

**Spec:** `docs/superpowers/specs/2026-06-12-font-settings-design.md`

**Conventions (repo rules — do not skip):**
- Work in worktree `.worktrees/feat-typography-settings` (created in Task 0).
- EVERY commit must be signed: `git commit -S` (repo also sets `commit.gpgsign=true`; keep `-S` anyway) and end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Run tests with `pnpm --dir <worktree> run test:app` (Bash cwd resets between calls — always use `--dir` / `git -C`).
- `docs/superpowers/` is gitignored — never `git add` the spec or this plan.

---

### Task 0: Worktree setup

**Files:** none (git only)

- [ ] **Step 1: Create worktree + install**

```bash
cd /Users/buns/Documents/GitHub/OpenCoven/coven-cave
git fetch origin main --quiet
git worktree add -b feat/typography-settings .worktrees/feat-typography-settings origin/main
pnpm --dir .worktrees/feat-typography-settings install
```

Expected: worktree at `.worktrees/feat-typography-settings`, install finishes in ~10s.

All paths below are relative to the worktree root `/Users/buns/Documents/GitHub/OpenCoven/coven-cave/.worktrees/feat-typography-settings/`.

---

### Task 1: Font catalog

**Files:**
- Create: `src/lib/font-catalog.ts`
- Test: `src/lib/font-settings.test.ts` (created here, grows in Task 2)

- [ ] **Step 1: Write the failing test**

Create `src/lib/font-settings.test.ts`:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import {
  FONT_OPTIONS,
  DEFAULT_FONT_ID,
  SANS_FALLBACK,
  MONO_FALLBACK,
  fontOptionById,
  fontStack,
} from "./font-catalog.ts";

// Spec: 15–25 bundled options spanning both slots.
assert.ok(
  FONT_OPTIONS.length >= 15 && FONT_OPTIONS.length <= 25,
  `catalog must bundle 15-25 fonts (got ${FONT_OPTIONS.length})`,
);
const sans = FONT_OPTIONS.filter((o) => o.slot === "sans");
const mono = FONT_OPTIONS.filter((o) => o.slot === "mono");
assert.ok(sans.length >= 8, "catalog needs a real sans selection");
assert.ok(mono.length >= 5, "catalog needs a real mono selection");

// Ids are unique and kebab-case; every entry carries a CSS var.
const ids = new Set(FONT_OPTIONS.map((o) => o.id));
assert.equal(ids.size, FONT_OPTIONS.length, "font ids must be unique");
for (const o of FONT_OPTIONS) {
  assert.match(o.id, /^[a-z0-9-]+$/, `id ${o.id} must be kebab-case`);
  assert.match(o.cssVar, /^--font-[a-z0-9-]+$/, `cssVar for ${o.id}`);
  assert.ok(o.label.length > 0, `label for ${o.id}`);
}

// Defaults are the existing Geist pair, so a fresh profile changes nothing.
assert.equal(DEFAULT_FONT_ID.sans, "geist");
assert.equal(DEFAULT_FONT_ID.mono, "geist-mono");
assert.equal(fontOptionById("geist")?.cssVar, "--font-geist-sans");
assert.equal(fontOptionById("geist-mono")?.cssVar, "--font-geist-mono");
assert.equal(fontOptionById("nope"), undefined);

// Stacks chain the font var onto the slot fallback.
assert.equal(
  fontStack(fontOptionById("geist")),
  `var(--font-geist-sans), ${SANS_FALLBACK}`,
);
assert.equal(
  fontStack(fontOptionById("geist-mono")),
  `var(--font-geist-mono), ${MONO_FALLBACK}`,
);

console.log("font-catalog tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --experimental-strip-types .worktrees/feat-typography-settings/src/lib/font-settings.test.ts
```
(Run from repo root; or `pnpm --dir <worktree> run test:app`.)
Expected: FAIL — `Cannot find module './font-catalog.ts'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/font-catalog.ts`:

```ts
/**
 * Bundled font registry. Every entry corresponds to a `next/font/google`
 * instance declared in src/app/fonts.ts whose `.variable` class is spread
 * onto <html> by the root layout — so each cssVar resolves anywhere in the
 * app. Unselected fonts cost nothing at runtime: they're declared with
 * `preload: false` and @font-face only downloads files for families that
 * rendered text actually uses.
 */
export type FontSlot = "sans" | "mono";

export type FontOption = {
  id: string;
  label: string;
  slot: FontSlot;
  cssVar: string;
};

export const SANS_FALLBACK =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
export const MONO_FALLBACK =
  'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

export const FONT_OPTIONS: FontOption[] = [
  // ── Sans (UI) ──
  { id: "geist", label: "Geist", slot: "sans", cssVar: "--font-geist-sans" },
  { id: "inter", label: "Inter", slot: "sans", cssVar: "--font-inter" },
  { id: "roboto", label: "Roboto", slot: "sans", cssVar: "--font-roboto" },
  { id: "open-sans", label: "Open Sans", slot: "sans", cssVar: "--font-open-sans" },
  { id: "lato", label: "Lato", slot: "sans", cssVar: "--font-lato" },
  { id: "source-sans-3", label: "Source Sans 3", slot: "sans", cssVar: "--font-source-sans-3" },
  { id: "noto-sans", label: "Noto Sans", slot: "sans", cssVar: "--font-noto-sans" },
  { id: "ibm-plex-sans", label: "IBM Plex Sans", slot: "sans", cssVar: "--font-ibm-plex-sans" },
  { id: "work-sans", label: "Work Sans", slot: "sans", cssVar: "--font-work-sans" },
  { id: "dm-sans", label: "DM Sans", slot: "sans", cssVar: "--font-dm-sans" },
  { id: "manrope", label: "Manrope", slot: "sans", cssVar: "--font-manrope" },
  { id: "figtree", label: "Figtree", slot: "sans", cssVar: "--font-figtree" },
  { id: "public-sans", label: "Public Sans", slot: "sans", cssVar: "--font-public-sans" },
  // ── Mono (code / terminal) ──
  { id: "geist-mono", label: "Geist Mono", slot: "mono", cssVar: "--font-geist-mono" },
  { id: "jetbrains-mono", label: "JetBrains Mono", slot: "mono", cssVar: "--font-jetbrains-mono" },
  { id: "fira-code", label: "Fira Code", slot: "mono", cssVar: "--font-fira-code" },
  { id: "source-code-pro", label: "Source Code Pro", slot: "mono", cssVar: "--font-source-code-pro" },
  { id: "ibm-plex-mono", label: "IBM Plex Mono", slot: "mono", cssVar: "--font-ibm-plex-mono" },
  { id: "roboto-mono", label: "Roboto Mono", slot: "mono", cssVar: "--font-roboto-mono" },
  { id: "space-mono", label: "Space Mono", slot: "mono", cssVar: "--font-space-mono" },
  { id: "inconsolata", label: "Inconsolata", slot: "mono", cssVar: "--font-inconsolata" },
];

export const DEFAULT_FONT_ID: Record<FontSlot, string> = {
  sans: "geist",
  mono: "geist-mono",
};

export function fontOptionById(id: string): FontOption | undefined {
  return FONT_OPTIONS.find((o) => o.id === id);
}

export function slotFallback(slot: FontSlot): string {
  return slot === "sans" ? SANS_FALLBACK : MONO_FALLBACK;
}

export function fontStack(option: FontOption): string {
  return `var(${option.cssVar}), ${slotFallback(option.slot)}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node --experimental-strip-types .worktrees/feat-typography-settings/src/lib/font-settings.test.ts
```
Expected: `font-catalog tests passed`.

- [ ] **Step 5: Commit**

```bash
git -C .worktrees/feat-typography-settings add src/lib/font-catalog.ts src/lib/font-settings.test.ts
git -C .worktrees/feat-typography-settings commit -S -m "$(cat <<'EOF'
feat(typography): bundled font catalog (13 sans + 8 mono)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Font settings lib (persistence + apply)

**Files:**
- Create: `src/lib/font-settings.ts`
- Test: append to `src/lib/font-settings.test.ts`

- [ ] **Step 1: Append the failing tests**

Append to `src/lib/font-settings.test.ts`:

```ts
import {
  DEFAULT_FONT_SIZE,
  FONT_SIZE_MIN,
  FONT_SIZE_MAX,
  FONT_SANS_KEY,
  FONT_MONO_KEY,
  FONT_SIZE_KEY,
  CUSTOM_FONTS_KEY,
  FONT_SETTINGS_EVENT,
  normalizeFontSize,
  sanitizeFontFamily,
  parseCustomFonts,
  stackForSelection,
} from "./font-settings.ts";

// Size normalization: clamp to 12–20, default 14, garbage → default.
assert.equal(DEFAULT_FONT_SIZE, 14);
assert.equal(FONT_SIZE_MIN, 12);
assert.equal(FONT_SIZE_MAX, 20);
assert.equal(normalizeFontSize(16), 16);
assert.equal(normalizeFontSize("18"), 18);
assert.equal(normalizeFontSize(9), 12);
assert.equal(normalizeFontSize(99), 20);
assert.equal(normalizeFontSize(14.6), 15, "fractional sizes round to ints");
assert.equal(normalizeFontSize("nope"), 14);
assert.equal(normalizeFontSize(null), 14);

// Custom family sanitization strips CSS-injection characters and bounds length.
assert.equal(sanitizeFontFamily("  JetBrains Mono NF  "), "JetBrains Mono NF");
assert.equal(
  sanitizeFontFamily('Evil"; background: url(x)'),
  "Evil background: urlx",
  "quotes, semicolons, and parens are stripped",
);
assert.equal(sanitizeFontFamily("a".repeat(100)).length, 64);
assert.equal(sanitizeFontFamily("   "), "");

// Custom-font list parsing is defensive: bad JSON / shapes → [].
assert.deepEqual(parseCustomFonts("not json"), []);
assert.deepEqual(parseCustomFonts('{"family":"x"}'), []);
assert.deepEqual(parseCustomFonts(null), []);
assert.deepEqual(
  parseCustomFonts('[{"family":"SF Pro","slot":"sans"},{"family":"","slot":"mono"},{"slot":"sans"}]'),
  [{ family: "SF Pro", slot: "sans" }],
  "entries with empty/missing family or bad slot are dropped",
);

// Stack resolution: bundled id → var chain; custom → quoted family before the
// default font var; unknown id → default stack for the slot.
assert.equal(
  stackForSelection("sans", "inter"),
  "var(--font-inter), ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", Roboto, sans-serif",
);
assert.equal(
  stackForSelection("mono", "custom:Berkeley Mono"),
  '"Berkeley Mono", var(--font-geist-mono), ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
);
assert.equal(
  stackForSelection("sans", "no-such-font"),
  "var(--font-geist-sans), ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", Roboto, sans-serif",
);
assert.equal(
  stackForSelection("mono", "inter"),
  "var(--font-geist-mono), ui-monospace, \"SF Mono\", Menlo, Consolas, \"Liberation Mono\", monospace",
  "a sans id stored in the mono slot falls back to the mono default",
);

// Storage keys + event names are stable contracts (controller + settings UI
// + cross-tab sync all key off them).
assert.equal(FONT_SANS_KEY, "cave:font-sans");
assert.equal(FONT_MONO_KEY, "cave:font-mono");
assert.equal(FONT_SIZE_KEY, "cave:font-size");
assert.equal(CUSTOM_FONTS_KEY, "cave:custom-fonts");
assert.equal(FONT_SETTINGS_EVENT, "cave:font-settings-change");

console.log("font-settings tests passed");
```

- [ ] **Step 2: Run to verify it fails**

```bash
node --experimental-strip-types .worktrees/feat-typography-settings/src/lib/font-settings.test.ts
```
Expected: FAIL — `Cannot find module './font-settings.ts'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/font-settings.ts`:

```ts
import {
  DEFAULT_FONT_ID,
  fontOptionById,
  fontStack,
  slotFallback,
  type FontSlot,
} from "./font-catalog";

// Mirrors the screen-magnification pattern (src/lib/screen-magnification.ts):
// localStorage + CSS vars on <html> + a window event for live listeners.
export const FONT_SANS_KEY = "cave:font-sans";
export const FONT_MONO_KEY = "cave:font-mono";
export const FONT_SIZE_KEY = "cave:font-size";
export const CUSTOM_FONTS_KEY = "cave:custom-fonts";
export const FONT_SETTINGS_EVENT = "cave:font-settings-change";

export const FONT_SIZE_MIN = 12;
export const FONT_SIZE_MAX = 20;
export const DEFAULT_FONT_SIZE = 14;
/** The baseline the type scale was designed against; --cave-font-scale = size/14. */
const FONT_SCALE_BASELINE = 14;

export const CUSTOM_PREFIX = "custom:";

export type CustomFont = { family: string; slot: FontSlot };

export function normalizeFontSize(value: unknown): number {
  const parsed =
    typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(parsed)) return DEFAULT_FONT_SIZE;
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(parsed)));
}

/** Strip characters that could break out of a font-family value. */
export function sanitizeFontFamily(value: string): string {
  return value
    .replace(/["'`;{}()[\]\\<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 64);
}

export function parseCustomFonts(raw: string | null): CustomFont[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const family = sanitizeFontFamily(String((entry as CustomFont).family ?? ""));
      const slot = (entry as CustomFont).slot;
      if (!family || (slot !== "sans" && slot !== "mono")) return [];
      return [{ family, slot }];
    });
  } catch {
    return [];
  }
}

/**
 * Resolve a stored selection (bundled id or `custom:<family>`) to a CSS
 * font-family stack. Unknown ids and ids from the wrong slot fall back to
 * the slot default — a stale localStorage value must never break rendering.
 */
export function stackForSelection(slot: FontSlot, selection: string | null): string {
  if (selection?.startsWith(CUSTOM_PREFIX)) {
    const family = sanitizeFontFamily(selection.slice(CUSTOM_PREFIX.length));
    const defaults = fontOptionById(DEFAULT_FONT_ID[slot]);
    if (family && defaults) return `"${family}", ${fontStack(defaults)}`;
  }
  const option = selection ? fontOptionById(selection) : undefined;
  if (option && option.slot === slot) return fontStack(option);
  const fallback = fontOptionById(DEFAULT_FONT_ID[slot]);
  return fallback ? fontStack(fallback) : slotFallback(slot);
}

// ── Browser-only helpers (no-ops during SSR) ──

function readStorage(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* ignore unavailable storage */
  }
}

export function readFontSelection(slot: FontSlot): string {
  return readStorage(slot === "sans" ? FONT_SANS_KEY : FONT_MONO_KEY) ?? DEFAULT_FONT_ID[slot];
}

export function readFontSize(): number {
  return normalizeFontSize(readStorage(FONT_SIZE_KEY));
}

export function readCustomFonts(): CustomFont[] {
  return parseCustomFonts(readStorage(CUSTOM_FONTS_KEY));
}

/** Push the current persisted settings onto <html> as CSS vars. */
export function applyFontSettings() {
  if (typeof document === "undefined") return;
  const html = document.documentElement;
  html.style.setProperty("--app-font-sans", stackForSelection("sans", readFontSelection("sans")));
  html.style.setProperty("--app-font-mono", stackForSelection("mono", readFontSelection("mono")));
  const size = readFontSize();
  html.style.setProperty("--cave-font-size", `${size}px`);
  // CSS calc() cannot divide two lengths into a unitless ratio, so the
  // scale multiplier is computed here (see globals.css type-scale tokens).
  html.style.setProperty("--cave-font-scale", String(size / FONT_SCALE_BASELINE));
}

function broadcast() {
  applyFontSettings();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(FONT_SETTINGS_EVENT));
  }
}

export function setFontSelection(slot: FontSlot, selection: string) {
  writeStorage(slot === "sans" ? FONT_SANS_KEY : FONT_MONO_KEY, selection);
  broadcast();
}

export function setFontSize(size: number) {
  writeStorage(FONT_SIZE_KEY, String(normalizeFontSize(size)));
  broadcast();
}

export function addCustomFont(slot: FontSlot, familyRaw: string): CustomFont | null {
  const family = sanitizeFontFamily(familyRaw);
  if (!family) return null;
  const fonts = readCustomFonts();
  if (!fonts.some((f) => f.slot === slot && f.family === family)) {
    fonts.push({ family, slot });
    writeStorage(CUSTOM_FONTS_KEY, JSON.stringify(fonts));
  }
  setFontSelection(slot, `${CUSTOM_PREFIX}${family}`);
  return { family, slot };
}

export function removeCustomFont(slot: FontSlot, family: string) {
  const fonts = readCustomFonts().filter((f) => !(f.slot === slot && f.family === family));
  writeStorage(CUSTOM_FONTS_KEY, JSON.stringify(fonts));
  if (readFontSelection(slot) === `${CUSTOM_PREFIX}${family}`) {
    setFontSelection(slot, DEFAULT_FONT_ID[slot]);
  } else {
    broadcast();
  }
}

export function resetFontSettings() {
  writeStorage(FONT_SANS_KEY, DEFAULT_FONT_ID.sans);
  writeStorage(FONT_MONO_KEY, DEFAULT_FONT_ID.mono);
  writeStorage(FONT_SIZE_KEY, String(DEFAULT_FONT_SIZE));
  broadcast();
}

/**
 * Resolved (substituted) font-family strings for consumers that cannot use
 * CSS var() — xterm's renderer and <canvas> context.font both parse the
 * family list themselves. getComputedStyle substitutes var() references in
 * custom properties, so this returns concrete family names.
 */
export function resolvedFontFamily(slot: FontSlot): string {
  if (typeof document !== "undefined") {
    const value = getComputedStyle(document.documentElement)
      .getPropertyValue(slot === "sans" ? "--app-font-sans" : "--app-font-mono")
      .trim();
    if (value) return value;
  }
  return slotFallback(slot);
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
node --experimental-strip-types .worktrees/feat-typography-settings/src/lib/font-settings.test.ts
```
Expected: both `font-catalog tests passed` and `font-settings tests passed`.

- [ ] **Step 5: Commit**

```bash
git -C .worktrees/feat-typography-settings add src/lib/font-settings.ts src/lib/font-settings.test.ts
git -C .worktrees/feat-typography-settings commit -S -m "$(cat <<'EOF'
feat(typography): font-settings persistence + apply lib

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: next/font instances + layout wiring + controller

**Files:**
- Create: `src/app/fonts.ts`
- Create: `src/components/font-settings-controller.tsx`
- Modify: `src/app/layout.tsx` (whole file shown below)
- Test: create `src/components/settings-typography.test.ts`

- [ ] **Step 1: Write the failing pin tests**

Create `src/components/settings-typography.test.ts`:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { FONT_OPTIONS } from "../lib/font-catalog.ts";

const fonts = await readFile(new URL("../app/fonts.ts", import.meta.url), "utf8");
const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");

// Every catalog entry must have a next/font instance exposing its CSS var…
for (const option of FONT_OPTIONS) {
  assert.match(
    fonts,
    new RegExp(`variable:\\s*"${option.cssVar}"`),
    `fonts.ts must declare a next/font instance for ${option.id} (${option.cssVar})`,
  );
}

// …and only the Geist defaults (+ Fredoka brand font) may preload; the other
// bundled fonts are lazy @font-face declarations that download on selection.
const preloadFalseCount = (fonts.match(/preload:\s*false/g) ?? []).length;
assert.ok(
  preloadFalseCount >= FONT_OPTIONS.length - 2,
  `non-default bundled fonts must set preload:false (found ${preloadFalseCount})`,
);

// The layout addresses every font var by spreading the shared class list…
assert.match(
  layout,
  /fontVariableClassName/,
  "layout must spread the shared font variable class list from fonts.ts",
);
assert.doesNotMatch(
  layout,
  /Geist\(\{/,
  "layout must not declare fonts inline anymore — fonts.ts owns them",
);

// …and mounts the controller that applies persisted typography on boot.
assert.match(
  layout,
  /<FontSettingsController \/>/,
  "Root layout should mount the global font settings controller",
);

const controller = await readFile(
  new URL("./font-settings-controller.tsx", import.meta.url),
  "utf8",
);
assert.match(
  controller,
  /applyFontSettings\(\)/,
  "controller must apply persisted font settings on mount",
);
assert.match(
  controller,
  /addEventListener\("storage"/,
  "controller must follow cross-tab storage changes",
);

console.log("settings-typography tests passed");
```

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm --dir .worktrees/feat-typography-settings run test:app
```
Expected: FAIL — `Cannot find module '../app/fonts.ts'`.

- [ ] **Step 3: Create `src/app/fonts.ts`**

```ts
import {
  DM_Sans,
  Figtree,
  Fira_Code,
  Fredoka,
  Geist,
  Geist_Mono,
  IBM_Plex_Mono,
  IBM_Plex_Sans,
  Inconsolata,
  Inter,
  JetBrains_Mono,
  Lato,
  Manrope,
  Noto_Sans,
  Open_Sans,
  Public_Sans,
  Roboto,
  Roboto_Mono,
  Source_Code_Pro,
  Source_Sans_3,
  Space_Mono,
  Work_Sans,
} from "next/font/google";

// Defaults + brand font keep preloading (they render on first paint).
const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const fredoka = Fredoka({
  variable: "--font-fredoka",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

// Selectable catalog — preload:false makes these lazy @font-face rules:
// the browser only downloads files for a family that styled text uses,
// so 19 extra fonts cost nothing until selected. display:"swap" avoids
// invisible text during the one-time load after selection.
const lazy = { subsets: ["latin"] as const, display: "swap" as const, preload: false };

const inter = Inter({ variable: "--font-inter", ...lazy });
const roboto = Roboto({ variable: "--font-roboto", weight: ["400", "500", "700"], ...lazy });
const openSans = Open_Sans({ variable: "--font-open-sans", ...lazy });
const lato = Lato({ variable: "--font-lato", weight: ["300", "400", "700"], ...lazy });
const sourceSans3 = Source_Sans_3({ variable: "--font-source-sans-3", ...lazy });
const notoSans = Noto_Sans({ variable: "--font-noto-sans", ...lazy });
const ibmPlexSans = IBM_Plex_Sans({ variable: "--font-ibm-plex-sans", weight: ["400", "500", "600"], ...lazy });
const workSans = Work_Sans({ variable: "--font-work-sans", ...lazy });
const dmSans = DM_Sans({ variable: "--font-dm-sans", ...lazy });
const manrope = Manrope({ variable: "--font-manrope", ...lazy });
const figtree = Figtree({ variable: "--font-figtree", ...lazy });
const publicSans = Public_Sans({ variable: "--font-public-sans", ...lazy });
const jetbrainsMono = JetBrains_Mono({ variable: "--font-jetbrains-mono", ...lazy });
const firaCode = Fira_Code({ variable: "--font-fira-code", ...lazy });
const sourceCodePro = Source_Code_Pro({ variable: "--font-source-code-pro", ...lazy });
const ibmPlexMono = IBM_Plex_Mono({ variable: "--font-ibm-plex-mono", weight: ["400", "500", "600"], ...lazy });
const robotoMono = Roboto_Mono({ variable: "--font-roboto-mono", ...lazy });
const spaceMono = Space_Mono({ variable: "--font-space-mono", weight: ["400", "700"], ...lazy });
const inconsolata = Inconsolata({ variable: "--font-inconsolata", ...lazy });

/** Every font's .variable class — spread onto <html> so all cssVars resolve. */
export const fontVariableClassName = [
  geistSans,
  geistMono,
  fredoka,
  inter,
  roboto,
  openSans,
  lato,
  sourceSans3,
  notoSans,
  ibmPlexSans,
  workSans,
  dmSans,
  manrope,
  figtree,
  publicSans,
  jetbrainsMono,
  firaCode,
  sourceCodePro,
  ibmPlexMono,
  robotoMono,
  spaceMono,
  inconsolata,
]
  .map((font) => font.variable)
  .join(" ");
```

If `pnpm build` later complains a family needs explicit weights (Google occasionally
converts variable↔static), add the smallest weight array that satisfies it
(`["400", "700"]`) — do not drop the font.

- [ ] **Step 4: Create `src/components/font-settings-controller.tsx`**

```tsx
"use client";

import { useEffect } from "react";
import {
  CUSTOM_FONTS_KEY,
  FONT_MONO_KEY,
  FONT_SANS_KEY,
  FONT_SIZE_KEY,
  applyFontSettings,
} from "@/lib/font-settings";

const WATCHED_KEYS = new Set([FONT_SANS_KEY, FONT_MONO_KEY, FONT_SIZE_KEY, CUSTOM_FONTS_KEY]);

/** Applies persisted typography on boot and follows cross-tab changes.
 *  Same pattern as ScreenMagnificationController. */
export function FontSettingsController() {
  useEffect(() => {
    applyFontSettings();
    const onStorage = (event: StorageEvent) => {
      if (event.key && !WATCHED_KEYS.has(event.key)) return;
      applyFontSettings();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  return null;
}
```

- [ ] **Step 5: Rewrite `src/app/layout.tsx`**

Replace the font imports/declarations and html className; mount the controller.
The full new file:

```tsx
import type { Metadata, Viewport } from "next";
import "./globals.css";
import { fontVariableClassName } from "./fonts";
import { SidecarAuthBridge } from "@/components/security/sidecar-auth-bridge";
import { SidecarAuthMonitor } from "@/components/security/sidecar-auth-monitor";
import { ScreenMagnificationController } from "@/components/screen-magnification-controller";
import { FontSettingsController } from "@/components/font-settings-controller";
import { ShellBannersProvider } from "@/lib/shell-banners";
import { LiveRegionProvider } from "@/components/ui/live-region";
import { PwaRegister } from "@/components/pwa-register";
import { DevCacheResetScript } from "@/components/dev-cache-reset-script";

export const metadata: Metadata = {
  title: "CovenCave",
  description: "Coven desktop cave for familiars, memory, and tools.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "CovenCave",
    statusBarStyle: "black-translucent",
  },
  icons: {
    apple: [
      { url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
    icon: [
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${fontVariableClassName} h-full antialiased`}>
      <body className="h-full flex flex-col">
        <DevCacheResetScript />
        <SidecarAuthBridge />
        <ShellBannersProvider>
          <LiveRegionProvider>
            <SidecarAuthMonitor />
            <ScreenMagnificationController />
            <FontSettingsController />
            <PwaRegister />
            {children}
          </LiveRegionProvider>
        </ShellBannersProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 6: Run tests + dev build smoke**

```bash
pnpm --dir .worktrees/feat-typography-settings run test:app
```
Expected: PASS including `settings-typography tests passed`.

```bash
PORT=3102 pnpm --dir .worktrees/feat-typography-settings dev &
sleep 25 && curl -s -o /dev/null -w "%{http_code}" http://localhost:3102/ && kill %1
```
Expected: `200` (next/font resolved all 21 families; a failure here means a
family name/weight mismatch — fix per the note in Step 3).

- [ ] **Step 7: Commit**

```bash
git -C .worktrees/feat-typography-settings add src/app/fonts.ts src/app/layout.tsx src/components/font-settings-controller.tsx src/components/settings-typography.test.ts
git -C .worktrees/feat-typography-settings commit -S -m "$(cat <<'EOF'
feat(typography): bundle 21 next/font families + boot controller

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: globals.css — consume the vars, scale the type tokens

**Files:**
- Modify: `src/app/globals.css` (three regions: `:root` type scale ~line 131, `@theme inline` ~line 303, `body` ~line 360)
- Test: append to `src/components/settings-typography.test.ts`

- [ ] **Step 1: Append the failing pin tests**

Append to `src/components/settings-typography.test.ts` (before the final `console.log`; keep that line last):

```ts
const globals = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

assert.match(
  globals,
  /--cave-font-scale:\s*1;/,
  ":root must default the unitless font scale to 1",
);
assert.match(
  globals,
  /font-family:\s*\n?\s*var\(--app-font-sans,\s*var\(--font-geist-sans\)\)/,
  "body font-family must consume the selectable sans var with the Geist fallback",
);
assert.match(
  globals,
  /font-size:\s*var\(--cave-font-size,\s*14px\)/,
  "body font-size must consume the selectable size var (default 14px)",
);
assert.match(
  globals,
  /--text-base:\s*calc\(13px \* var\(--cave-font-scale\)\)/,
  "type-scale tokens must multiply by the font scale so the hierarchy follows the baseline",
);
assert.match(
  globals,
  /--font-sans:\s*var\(--app-font-sans,\s*var\(--font-geist-sans\)\);/,
  "@theme inline must route Tailwind's font-sans through the selectable var",
);
assert.match(
  globals,
  /--font-mono:\s*var\(--app-font-mono,\s*var\(--font-geist-mono\)\);/,
  "@theme inline must route Tailwind's font-mono through the selectable var",
);
```

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm --dir .worktrees/feat-typography-settings run test:app
```
Expected: FAIL on the `--cave-font-scale` assertion.

- [ ] **Step 3: Edit `src/app/globals.css`**

3a. In `:root`, replace the type-scale block (current lines 131–141):

```css
  /* ---- Type scale ----
     Desktop-app density. Body baseline is --text-base (13px at scale 1);
     chat and long prose can promote to --text-md. Every token multiplies
     by --cave-font-scale (set from Settings → Appearance → Typography;
     scale = font-size / 14) so the whole hierarchy follows the user's
     base size. The scale is unitless and JS-computed: CSS calc() cannot
     divide two lengths. */
  --cave-font-scale: 1;
  --text-2xs: calc(10px * var(--cave-font-scale));
  --text-xs: calc(11px * var(--cave-font-scale));
  --text-sm: calc(12px * var(--cave-font-scale));
  --text-base: calc(13px * var(--cave-font-scale));
  --text-md: calc(14px * var(--cave-font-scale));
  --text-lg: calc(16px * var(--cave-font-scale));
  --text-xl: calc(20px * var(--cave-font-scale));
  --text-display: calc(28px * var(--cave-font-scale));
```

(Keep the `--leading-*` / `--tracking-*` lines that follow unchanged.)

3b. In `@theme inline` (current lines 303–304), replace:

```css
  --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);
```

with:

```css
  --font-sans: var(--app-font-sans, var(--font-geist-sans));
  --font-mono: var(--app-font-mono, var(--font-geist-mono));
```

3c. In the `body` rule (current lines 360–370), replace the font lines:

```css
body {
  font-family:
    var(--app-font-sans, var(--font-geist-sans)), ui-sans-serif, system-ui,
    -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: var(--cave-font-size, 14px);
  line-height: var(--leading-normal);
  -webkit-font-smoothing: antialiased;
  width: calc(100dvw / var(--cave-screen-scale));
  height: calc(100dvh / var(--cave-screen-scale));
  zoom: var(--cave-screen-scale);
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
pnpm --dir .worktrees/feat-typography-settings run test:app
```
Expected: PASS (the pre-existing `settings-appearance.test.ts` must also still pass — it pins `zoom: var(--cave-screen-scale)`, untouched).

- [ ] **Step 5: Commit**

```bash
git -C .worktrees/feat-typography-settings add src/app/globals.css src/components/settings-typography.test.ts
git -C .worktrees/feat-typography-settings commit -S -m "$(cat <<'EOF'
feat(typography): scale-aware type tokens + selectable font vars in CSS

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Settings UI — Typography block

**Files:**
- Create: `src/components/settings-primitives.tsx` (extract `SettingsGroup` + `SettingsRow` from settings-shell)
- Create: `src/components/settings-typography.tsx`
- Modify: `src/components/settings-shell.tsx` (delete the two local primitives, import them; render `<TypographySettings />` in `AppearanceSection`)
- Test: append to `src/components/settings-typography.test.ts`

- [ ] **Step 1: Append the failing pin tests**

```ts
const shell = await readFile(new URL("./settings-shell.tsx", import.meta.url), "utf8");
const typography = await readFile(new URL("./settings-typography.tsx", import.meta.url), "utf8");

assert.match(
  shell,
  /<TypographySettings \/>/,
  "Appearance settings must render the Typography block",
);
assert.match(
  shell,
  /import \{ SettingsGroup, SettingsRow \} from "@\/components\/settings-primitives"/,
  "settings-shell must use the shared primitives (extracted so settings-typography can too)",
);
assert.doesNotMatch(
  shell,
  /^function SettingsGroup/m,
  "the local SettingsGroup copy must be gone",
);

assert.match(typography, /FONT_OPTIONS/, "typography UI renders the shared catalog");
assert.match(
  typography,
  /aria-pressed|aria-label/,
  "typography controls need assistive-tech affordances",
);
assert.match(
  typography,
  /document\.fonts\.check/,
  "custom font input should warn (not block) when the family isn't installed",
);
assert.match(typography, /resetFontSettings/, "typography block must offer reset to defaults");
```

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm --dir .worktrees/feat-typography-settings run test:app
```
Expected: FAIL — `settings-typography.tsx` missing.

- [ ] **Step 3: Create `src/components/settings-primitives.tsx`**

Move the two functions verbatim from `settings-shell.tsx` (lines 996–1019) and export them:

```tsx
export function SettingsGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">{label}</p>
      <div className="divide-y divide-[var(--border-hairline)] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-card)] overflow-hidden">
        {children}
      </div>
    </div>
  );
}

export function SettingsRow({ label, description, comingSoon, children }: { label: string; description?: string; comingSoon?: boolean; children?: React.ReactNode }) {
  return (
    <div className={`flex items-center justify-between gap-4 px-4 py-3 ${comingSoon ? "opacity-50" : ""}`}>
      <div className="min-w-0">
        <p className="text-[13px] text-[var(--text-primary)]">{label}</p>
        {description && <p className="text-[11px] text-[var(--text-muted)]">{description}</p>}
      </div>
      {comingSoon ? (
        <span className="shrink-0 rounded-full bg-[var(--bg-raised)] px-2 py-0.5 text-[10px] text-[var(--text-muted)]">Soon</span>
      ) : children}
    </div>
  );
}
```

In `settings-shell.tsx`: delete those two local function definitions and add
`import { SettingsGroup, SettingsRow } from "@/components/settings-primitives";`
(keep `SettingsPage` and `SettingsKV` local — nothing else needs them).

- [ ] **Step 4: Create `src/components/settings-typography.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import {
  DEFAULT_FONT_ID,
  FONT_OPTIONS,
  type FontSlot,
} from "@/lib/font-catalog";
import {
  CUSTOM_PREFIX,
  DEFAULT_FONT_SIZE,
  FONT_SETTINGS_EVENT,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  addCustomFont,
  readCustomFonts,
  readFontSelection,
  readFontSize,
  removeCustomFont,
  resetFontSettings,
  setFontSelection,
  setFontSize,
  stackForSelection,
  type CustomFont,
} from "@/lib/font-settings";
import { SettingsGroup, SettingsRow } from "@/components/settings-primitives";

const SLOT_LABEL: Record<FontSlot, string> = { sans: "UI font", mono: "Mono font" };
const SLOT_DESCRIPTION: Record<FontSlot, string> = {
  sans: "Interface and chat text.",
  mono: "Code blocks and the terminal.",
};

function FontSelect({
  slot,
  value,
  customFonts,
  onChange,
}: {
  slot: FontSlot;
  value: string;
  customFonts: CustomFont[];
  onChange: (next: string) => void;
}) {
  const bundled = FONT_OPTIONS.filter((o) => o.slot === slot);
  const custom = customFonts.filter((f) => f.slot === slot);
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-label={`${SLOT_LABEL[slot]} family`}
      className="focus-ring shrink-0 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-base)] px-2.5 py-1.5 text-[12px] text-[var(--text-primary)]"
      style={{ fontFamily: stackForSelection(slot, value) }}
    >
      {bundled.map((option) => (
        <option key={option.id} value={option.id} style={{ fontFamily: `var(${option.cssVar})` }}>
          {option.label}
        </option>
      ))}
      {custom.length > 0 && (
        <optgroup label="Custom">
          {custom.map((font) => (
            <option key={font.family} value={`${CUSTOM_PREFIX}${font.family}`} style={{ fontFamily: font.family }}>
              {font.family}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}

function CustomFontInput({ slot, onAdded }: { slot: FontSlot; onAdded: () => void }) {
  const [value, setValue] = useState("");
  const [warning, setWarning] = useState<string | null>(null);

  const submit = () => {
    const family = value.trim();
    if (!family) return;
    // Best-effort availability probe — warn but never block: the CSS
    // fallback stack covers families the renderer can't find.
    let installed = true;
    try {
      installed = document.fonts.check(`16px "${family.replace(/"/g, "")}"`);
    } catch {
      /* probe unsupported — assume present */
    }
    setWarning(installed ? null : `"${family}" wasn't found on this machine — using fallback until it is.`);
    if (addCustomFont(slot, family)) {
      setValue("");
      onAdded();
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex shrink-0 items-center gap-1.5">
        <input
          type="text"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit();
          }}
          placeholder="Installed font name…"
          aria-label={`Add custom ${SLOT_LABEL[slot].toLowerCase()}`}
          className="focus-ring w-44 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-base)] px-2.5 py-1.5 text-[12px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!value.trim()}
          className="focus-ring rounded-md px-2.5 py-1.5 text-[11px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)] disabled:opacity-40"
        >
          Add
        </button>
      </div>
      {warning && <p className="max-w-64 text-right text-[10px] text-[var(--color-warning,#d9a514)]">{warning}</p>}
    </div>
  );
}

export function TypographySettings() {
  const [sansSelection, setSansSelection] = useState(DEFAULT_FONT_ID.sans);
  const [monoSelection, setMonoSelection] = useState(DEFAULT_FONT_ID.mono);
  const [size, setSize] = useState(DEFAULT_FONT_SIZE);
  const [customFonts, setCustomFonts] = useState<CustomFont[]>([]);

  const refresh = () => {
    setSansSelection(readFontSelection("sans"));
    setMonoSelection(readFontSelection("mono"));
    setSize(readFontSize());
    setCustomFonts(readCustomFonts());
  };

  useEffect(() => {
    refresh();
    window.addEventListener(FONT_SETTINGS_EVENT, refresh);
    return () => window.removeEventListener(FONT_SETTINGS_EVENT, refresh);
  }, []);

  const handleSelect = (slot: FontSlot) => (next: string) => {
    setFontSelection(slot, next);
  };

  const activeCustom = (slot: FontSlot, selection: string) =>
    selection.startsWith(CUSTOM_PREFIX) ? selection.slice(CUSTOM_PREFIX.length) : null;

  return (
    <SettingsGroup label="Typography">
      {(["sans", "mono"] as const).map((slot) => {
        const selection = slot === "sans" ? sansSelection : monoSelection;
        const customName = activeCustom(slot, selection);
        return (
          <div key={slot}>
            <SettingsRow label={SLOT_LABEL[slot]} description={SLOT_DESCRIPTION[slot]}>
              <div className="flex shrink-0 items-center gap-2">
                {customName && (
                  <button
                    type="button"
                    onClick={() => removeCustomFont(slot, customName)}
                    aria-label={`Remove custom font ${customName}`}
                    className="focus-ring rounded-md px-2 py-1 text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  >
                    Remove
                  </button>
                )}
                <FontSelect slot={slot} value={selection} customFonts={customFonts} onChange={handleSelect(slot)} />
              </div>
            </SettingsRow>
            <div className="flex justify-end px-4 pb-3 -mt-1">
              <CustomFontInput slot={slot} onAdded={refresh} />
            </div>
          </div>
        );
      })}

      <SettingsRow label="Font size" description="Base size; the whole type scale follows.">
        <div className="flex shrink-0 items-center gap-1 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-base)] p-0.5">
          <button
            type="button"
            onClick={() => setFontSize(size - 1)}
            disabled={size <= FONT_SIZE_MIN}
            aria-label="Decrease font size"
            className="focus-ring min-w-8 rounded-md px-2 py-1.5 text-[12px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)] disabled:opacity-40"
          >
            −
          </button>
          <span className="min-w-12 text-center text-[11px] font-medium text-[var(--text-primary)]" aria-live="polite">
            {size}px
          </span>
          <button
            type="button"
            onClick={() => setFontSize(size + 1)}
            disabled={size >= FONT_SIZE_MAX}
            aria-label="Increase font size"
            className="focus-ring min-w-8 rounded-md px-2 py-1.5 text-[12px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)] disabled:opacity-40"
          >
            +
          </button>
        </div>
      </SettingsRow>

      <SettingsRow label="Preview" description="Live sample in the selected fonts and size.">
        <div className="flex min-w-0 flex-col items-end gap-0.5 text-right">
          <span className="truncate text-[length:var(--cave-font-size,14px)] text-[var(--text-primary)]">
            The quick brown fox jumps over the lazy dog.
          </span>
          <code className="truncate font-mono text-[var(--text-sm)] text-[var(--text-secondary)]">
            const cave = summon("familiar");
          </code>
        </div>
      </SettingsRow>

      <SettingsRow label="Reset typography" description="Back to Geist / Geist Mono at 14px.">
        <button
          type="button"
          onClick={() => resetFontSettings()}
          className="focus-ring shrink-0 rounded-md border border-[var(--border-hairline)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
        >
          Reset
        </button>
      </SettingsRow>
    </SettingsGroup>
  );
}
```

- [ ] **Step 5: Wire into `settings-shell.tsx`**

Add imports near the other component imports:

```tsx
import { TypographySettings } from "@/components/settings-typography";
import { SettingsGroup, SettingsRow } from "@/components/settings-primitives";
```

In `AppearanceSection`'s JSX, insert between the Accessibility group (ends line ~819) and the Theme group:

```tsx
      {/* ── Typography ── */}
      <TypographySettings />
```

Delete the local `function SettingsGroup(…)` and `function SettingsRow(…)` definitions (lines ~996–1019).

- [ ] **Step 6: Run tests**

```bash
pnpm --dir .worktrees/feat-typography-settings run test:app
```
Expected: PASS, including the pre-existing `settings-appearance.test.ts`.

- [ ] **Step 7: Commit**

```bash
git -C .worktrees/feat-typography-settings add src/components/settings-primitives.tsx src/components/settings-typography.tsx src/components/settings-shell.tsx src/components/settings-typography.test.ts
git -C .worktrees/feat-typography-settings commit -S -m "$(cat <<'EOF'
feat(typography): Settings → Appearance typography block

Font family pickers (UI + mono) rendering each option in its own face,
12-20px size stepper, custom installed-font input with a non-blocking
availability warning, live preview, and reset.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Consistency sweep — terminal + canvas labels

**Files:**
- Modify: `src/components/bottom-terminal.tsx` (two `new Terminal({ fontFamily: … })` sites, ~lines 172–175 and ~350–353)
- Modify: `src/components/library-graph-3d.tsx` (~line 69)
- Modify: `src/components/trace-graph-3d.tsx` (~line 100)
- Test: append to `src/components/settings-typography.test.ts`

- [ ] **Step 1: Append the failing pin tests**

```ts
const terminal = await readFile(new URL("./bottom-terminal.tsx", import.meta.url), "utf8");
assert.doesNotMatch(
  terminal,
  /fontFamily:\s*\n?\s*'ui-monospace/,
  "the terminal must not hardcode a mono stack — it follows the selected mono font",
);
assert.match(
  terminal,
  /resolvedFontFamily\("mono"\)/,
  "the terminal reads the resolved mono font (xterm can't parse CSS var())",
);

const libraryGraph = await readFile(new URL("./library-graph-3d.tsx", import.meta.url), "utf8");
const traceGraph = await readFile(new URL("./trace-graph-3d.tsx", import.meta.url), "utf8");
for (const [name, src] of [["library-graph-3d", libraryGraph], ["trace-graph-3d", traceGraph]]) {
  assert.doesNotMatch(
    src,
    /context\.font = "600 \d+px system-ui/,
    `${name} canvas labels must follow the selected UI font, not a hardcoded stack`,
  );
  assert.match(
    src,
    /resolvedFontFamily\("sans"\)/,
    `${name} must read the resolved sans font for canvas text`,
  );
}
```

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm --dir .worktrees/feat-typography-settings run test:app
```
Expected: FAIL on the terminal assertion.

- [ ] **Step 3: Implement**

3a. `bottom-terminal.tsx` — add import:

```tsx
import { resolvedFontFamily } from "@/lib/font-settings";
```

At BOTH `new Terminal({…})` sites replace:

```ts
        fontFamily:
          'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
```

with:

```ts
        // Selected mono font; xterm parses font-family itself, so it gets
        // the substituted (var-free) value. Applies on next terminal mount.
        fontFamily: resolvedFontFamily("mono"),
```

3b. `library-graph-3d.tsx` — add the same import; replace line ~69:

```ts
    context.font = "600 28px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
```

with:

```ts
    context.font = `600 28px ${resolvedFontFamily("sans")}`;
```

3c. `trace-graph-3d.tsx` — same import; replace line ~100:

```ts
    context.font = "600 26px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
```

with:

```ts
    context.font = `600 26px ${resolvedFontFamily("sans")}`;
```

- [ ] **Step 4: Run tests**

```bash
pnpm --dir .worktrees/feat-typography-settings run test:app
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C .worktrees/feat-typography-settings add src/components/bottom-terminal.tsx src/components/library-graph-3d.tsx src/components/trace-graph-3d.tsx src/components/settings-typography.test.ts
git -C .worktrees/feat-typography-settings commit -S -m "$(cat <<'EOF'
polish(typography): route hardcoded font stacks through the selected fonts

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Build gate + live verification + PR

**Files:** none (verification only)

- [ ] **Step 1: Full test suite + production build**

```bash
pnpm --dir .worktrees/feat-typography-settings run test:app
pnpm --dir .worktrees/feat-typography-settings run build
```
Expected: both succeed. A build failure naming a font family → fix its weight
array in `src/app/fonts.ts` (see Task 3 Step 3 note), rerun, amend is NOT
allowed — make a new `fix:` commit.

- [ ] **Step 2: Live verify with Playwright**

```bash
PORT=3102 nohup pnpm --dir .worktrees/feat-typography-settings dev > /tmp/typography-dev.log 2>&1 &
```

Wait for `curl -s -o /dev/null -w "%{http_code}" http://localhost:3102/` → `200`.

Create `.worktrees/feat-typography-settings/.typography-verify.mjs` (delete after — never commit; a stray verifier file reached main once before):

```js
import { chromium } from "@playwright/test";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto("http://localhost:3102/settings", { waitUntil: "domcontentloaded" });
// The settings nav item may be a button or a link depending on the shell —
// fall back to a text click if the role lookup misses.
try {
  await page.getByRole("button", { name: "Appearance" }).click({ timeout: 5000 });
} catch {
  await page.click("text=Appearance");
}
await page.waitForSelector("text=Typography");

// Select Inter + JetBrains Mono + 17px.
await page.getByLabel("UI font family").selectOption("inter");
await page.getByLabel("Mono font family").selectOption("jetbrains-mono");
for (let i = 0; i < 3; i++) await page.getByLabel("Increase font size").click();

const result = await page.evaluate(() => ({
  bodyFamily: getComputedStyle(document.body).fontFamily,
  bodySize: getComputedStyle(document.body).fontSize,
  scale: getComputedStyle(document.documentElement).getPropertyValue("--cave-font-scale").trim(),
  sansVar: getComputedStyle(document.documentElement).getPropertyValue("--app-font-sans").trim(),
  storedSans: localStorage.getItem("cave:font-sans"),
  storedSize: localStorage.getItem("cave:font-size"),
}));
console.log(JSON.stringify(result, null, 2));

if (!/Inter/i.test(result.bodyFamily)) throw new Error("body did not adopt Inter");
if (result.bodySize !== "17px") throw new Error(`body size ${result.bodySize} != 17px`);
if (result.storedSans !== "inter" || result.storedSize !== "17") throw new Error("persistence failed");

// Reload → settings survive.
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);
const after = await page.evaluate(() => getComputedStyle(document.body).fontSize);
if (after !== "17px") throw new Error(`font size did not survive reload (${after})`);

await page.screenshot({ path: "/tmp/typography-settings.png" });
await browser.close();
console.log("typography live verify PASS");
```

Run: `node .worktrees/feat-typography-settings/.typography-verify.mjs`
Expected: `typography live verify PASS`. Read `/tmp/typography-settings.png` and
visually confirm the Typography block renders correctly. Then:

```bash
rm .worktrees/feat-typography-settings/.typography-verify.mjs
pkill -f "feat-typography-settings.*server.ts"
```

- [ ] **Step 3: Pre-push signature audit + push + PR**

```bash
git -C .worktrees/feat-typography-settings log origin/main..HEAD --pretty='%H %G?' | awk '$2 != "G" {print "UNSIGNED:", $0}'
```
Expected: no output. Then:

```bash
git -C .worktrees/feat-typography-settings push -u origin feat/typography-settings
gh pr create --title "feat(settings): selectable typography — font family, mono font, base size" --body "$(cat <<'EOF'
## What

Settings → Appearance gains a **Typography** block:

- **UI font + Mono font pickers** — 21 bundled families (13 sans, 8 mono) compiled via `next/font/google` with `preload: false`, so unselected fonts never download; each option previews in its own face.
- **Custom fonts** — type any font installed on the machine; non-blocking warning via `document.fonts.check` when it isn't found; fallback stack covers it either way.
- **Font size** — 12–20px stepper (default 14). The whole type scale (`--text-2xs`…`--text-display`) multiplies by a unitless `--cave-font-scale`, so the hierarchy follows the baseline. Independent of screen magnification.
- **Consistency sweep** — the terminal and the 3D-graph canvas labels now follow the selected fonts instead of hardcoded stacks.

Persistence + application mirror the screen-magnification pattern: localStorage keys (`cave:font-*`) + a boot controller setting `--app-font-sans` / `--app-font-mono` / `--cave-font-size` on `<html>`; defaults keep today's exact rendering (Geist / Geist Mono / 14px).

## Verification

- Pin + behavioral tests in `src/lib/font-settings.test.ts` and `src/components/settings-typography.test.ts`; full `test:app` green; production build green.
- Live Playwright check: selected Inter / JetBrains Mono / 17px → computed body font/size match, values persist across reload; screenshot eyeballed.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

After merge: `git worktree remove .worktrees/feat-typography-settings`, `git branch -D feat/typography-settings`, verify the remote branch is gone via `git ls-remote --heads origin feat/typography-settings` (gh skips deletions when worktrees block the local one).
