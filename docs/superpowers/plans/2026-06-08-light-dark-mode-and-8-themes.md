# Light/Dark Mode + 8 Curated Themes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Light/Dark mode toggle to Coven Cave and replace the 4 dark-only presets with 8 curated themes that each ship light + dark palettes. Settings-only UI; flash-free restoration preserved; existing tweakcn custom-theme import becomes mode-aware.

**Architecture:** `<html data-theme="<id>" data-mode="<light|dark>">` drives all CSS. Default theme `coven` lives in `:root` (dark) / `:root[data-mode="light"]` (light). Other themes live in `[data-theme="X"]` / `[data-theme="X"][data-mode="light"]`. Border-family vars derive from `--foreground` via `color-mix` so they auto-invert. A small TypeScript module (`src/lib/theme-palettes.ts`) holds theme metadata + swatch tuples consumed by the settings UI.

**Tech Stack:** Next 16 / React 19 / TypeScript / Tailwind v4 / `oklch()` color space / `node:test`-style top-level test scripts run via `node --experimental-strip-types`.

**Reference spec:** `docs/superpowers/specs/2026-06-08-light-dark-mode-and-8-themes-design.md`

**Pre-flight checks before Task 1:**

1. Confirm signing key is configured: `git config --get user.signingkey` must return a key, and `git config --get gpg.format` must return `ssh`, `openpgp`, or `x509`. If `user.signingkey` is empty, STOP and surface to the user — every commit in this plan uses `-S` and signing will fail silently otherwise.
2. Confirm current branch is the feature branch (e.g., `git rev-parse --abbrev-ref HEAD` reports `feat/light-dark-themes` or similar), not `main`.
3. Confirm Node 22+: `node -v` reports ≥ v22.0. The test command relies on `--experimental-strip-types`.

---

## File Structure

**New files:**

- `src/lib/theme-palettes.ts` — Single source of truth for theme metadata (id, name, hue, dark/light accent hex). Exported `THEME_IDS`, `THEME_META`, `getSwatches(themeId, mode)`. Consumed by settings UI.
- `src/lib/theme-palettes.test.ts` — Unit test asserting `THEME_IDS.length === 8`, every theme has both swatches, and the rename map is correct.
- `src/components/mode-toggle.tsx` — Small segmented control. Pure presentational; `value` / `onChange` props.
- `src/components/theme-script.test.ts` — Unit test for the extracted rename-map module.
- `src/lib/theme-storage.ts` — Tiny extracted module holding the rename map + storage-key constants so they're testable (the inline script in `theme-script.tsx` reads the same constants).

**Modified files:**

- `src/app/globals.css` — Restructure `:root`, derive border vars from `--foreground`, replace existing 3 preset blocks (`midnight`, `orchid`, `sky`) with 7 new theme blocks. Each theme: dark block + light block.
- `src/components/theme-script.tsx` — Rewrite inline script logic.
- `src/components/settings-shell.tsx` — `ActiveTheme` type, `PresetTheme` type, `PRESETS` array, `applyPreset`, `applyCustomVars`, `clearCustomTheme`, `AppearanceSection` (add `ModeToggle`, mode-aware swatches, mode-change reapply for custom themes).
- `src/styles/sidebar-minimal.css` — Pass-1 audit (replace `oklch(1 0 0 / N%)` / `rgba(255…)` with `--foreground`-derived `color-mix`).
- `src/styles/cave-chat.css` — Pass-1 audit.
- `src/styles/home-composer.css` — Pass-1 audit.
- `src/styles/sessions-view.css` — Pass-1 audit.

**Marked-only (`TODO: light-mode-audit` comments, no behavior change):**

- `src/styles/library.css`
- `src/styles/board.css`
- `src/app/mockup/mockup.css`

---

## Task 1: Add theme metadata & storage module

**Files:**
- Create: `src/lib/theme-palettes.ts`
- Create: `src/lib/theme-storage.ts`
- Test: `src/lib/theme-palettes.test.ts`

- [ ] **Step 1.1: Write the failing test**

Create `src/lib/theme-palettes.test.ts`:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { THEME_IDS, THEME_META, getSwatches } from "./theme-palettes.ts";
import { LEGACY_THEME_RENAME, COVEN_THEME_KEY, COVEN_MODE_KEY } from "./theme-storage.ts";

// 8 themes, coven is the default (first).
assert.equal(THEME_IDS.length, 8);
assert.equal(THEME_IDS[0], "coven");
assert.deepEqual(
  [...THEME_IDS].sort(),
  ["bloom", "coven", "dusk", "ember", "grove", "mist", "slate", "tide"],
);

// Every theme has a name, hue, and both accent values.
for (const id of THEME_IDS) {
  const meta = THEME_META[id];
  assert.ok(meta, `metadata for ${id}`);
  assert.equal(typeof meta.name, "string");
  assert.equal(typeof meta.hue, "number");
  assert.match(meta.accentDark, /^#[0-9A-Fa-f]{6}$/, `accentDark for ${id}`);
  assert.match(meta.accentLight, /^#[0-9A-Fa-f]{6}$/, `accentLight for ${id}`);
}

// getSwatches returns distinct background swatches per mode.
for (const id of THEME_IDS) {
  const dark = getSwatches(id, "dark");
  const light = getSwatches(id, "light");
  assert.notEqual(dark.bg, light.bg, `${id} bg swatch differs by mode`);
  assert.equal(dark.accent, THEME_META[id].accentDark);
  assert.equal(light.accent, THEME_META[id].accentLight);
}

// Legacy rename map covers all 4 old ids.
assert.deepEqual(LEGACY_THEME_RENAME, {
  "mood-c": "coven",
  "sky": "tide",
  "orchid": "dusk",
  "midnight": "slate",
});

// Storage keys are stable strings.
assert.equal(COVEN_THEME_KEY, "coven-theme");
assert.equal(COVEN_MODE_KEY, "coven-mode");

console.log("theme-palettes.test.ts OK");
```

- [ ] **Step 1.2: Run the test to verify it fails**

Run: `node --experimental-strip-types src/lib/theme-palettes.test.ts`
Expected: `ERR_MODULE_NOT_FOUND` (modules don't exist yet).

- [ ] **Step 1.3: Create `src/lib/theme-storage.ts`**

```ts
/**
 * Storage keys + legacy id-rename map for the theme system.
 *
 * Extracted so the rename map is unit-testable and so the inline
 * <ThemeScript> body can stay a self-contained string while still
 * referencing the canonical keys via build-time substitution.
 */

export const COVEN_THEME_KEY = "coven-theme";
export const COVEN_MODE_KEY = "coven-mode";
export const COVEN_CUSTOM_THEME_KEY = "coven-custom-theme";

/**
 * Renames from the dark-only preset roster to the 8-theme roster.
 * Applied one-shot on first run after upgrade.
 */
export const LEGACY_THEME_RENAME: Record<string, string> = {
  "mood-c": "coven",
  "sky": "tide",
  "orchid": "dusk",
  "midnight": "slate",
};

export type Mode = "light" | "dark";
```

- [ ] **Step 1.4: Create `src/lib/theme-palettes.ts`**

```ts
/**
 * 8-theme roster metadata + swatch lookup for the appearance settings UI.
 * The actual palette CSS lives in `src/app/globals.css`; this module
 * mirrors the accent values and a representative background swatch
 * per (theme, mode) so the settings grid can preview each card.
 */

import type { Mode } from "./theme-storage.ts";

export const THEME_IDS = [
  "coven",
  "tide",
  "grove",
  "ember",
  "bloom",
  "dusk",
  "mist",
  "slate",
] as const;

export type ThemeId = (typeof THEME_IDS)[number];

export interface ThemeMeta {
  id: ThemeId;
  name: string;
  description: string;
  hue: number;
  accentDark: string;
  accentLight: string;
  /** Background swatch (CSS color string) for the preview card, per mode. */
  bgDark: string;
  bgLight: string;
}

export const THEME_META: Record<ThemeId, ThemeMeta> = {
  coven: {
    id: "coven", name: "Coven",
    description: "OpenCoven violet — the default lavender field manual",
    hue: 293, accentDark: "#9A8ECD", accentLight: "#6F62A8",
    bgDark: "oklch(0.07 0.004 293)", bgLight: "oklch(0.99 0.003 293)",
  },
  tide: {
    id: "tide", name: "Tide",
    description: "Cool slate-blue, daybreak accent",
    hue: 245, accentDark: "#6DA9FF", accentLight: "#3D7DD8",
    bgDark: "oklch(0.07 0.012 245)", bgLight: "oklch(0.99 0.005 245)",
  },
  grove: {
    id: "grove", name: "Grove",
    description: "Forest green, calm and grounded",
    hue: 145, accentDark: "#6DCB8E", accentLight: "#2F8C58",
    bgDark: "oklch(0.07 0.010 145)", bgLight: "oklch(0.99 0.005 145)",
  },
  ember: {
    id: "ember", name: "Ember",
    description: "Warm amber, focused-work feel",
    hue: 60, accentDark: "#E8A85C", accentLight: "#B5752A",
    bgDark: "oklch(0.07 0.010 60)", bgLight: "oklch(0.99 0.006 60)",
  },
  bloom: {
    id: "bloom", name: "Bloom",
    description: "Soft rose, friendly",
    hue: 15, accentDark: "#E88FA5", accentLight: "#C25A78",
    bgDark: "oklch(0.07 0.010 15)", bgLight: "oklch(0.99 0.005 15)",
  },
  dusk: {
    id: "dusk", name: "Dusk",
    description: "Magenta pink-violet",
    hue: 330, accentDark: "#D26BFF", accentLight: "#9F3FCE",
    bgDark: "oklch(0.07 0.014 330)", bgLight: "oklch(0.99 0.006 330)",
  },
  mist: {
    id: "mist", name: "Mist",
    description: "Teal/cyan, clinical",
    hue: 195, accentDark: "#5DD0CB", accentLight: "#1E938E",
    bgDark: "oklch(0.07 0.010 195)", bgLight: "oklch(0.99 0.005 195)",
  },
  slate: {
    id: "slate", name: "Slate",
    description: "Zero-chroma neutral",
    hue: 270, accentDark: "#A0A0AB", accentLight: "#5C5C66",
    bgDark: "oklch(0.07 0.000 270)", bgLight: "oklch(0.99 0.000 270)",
  },
};

export interface SwatchTuple {
  bg: string;
  accent: string;
  border: string;
}

export function getSwatches(id: ThemeId, mode: Mode): SwatchTuple {
  const m = THEME_META[id];
  return mode === "light"
    ? { bg: m.bgLight, accent: m.accentLight, border: `${m.accentLight}40` }
    : { bg: m.bgDark, accent: m.accentDark, border: `${m.accentDark}40` };
}
```

- [ ] **Step 1.5: Run the test to verify it passes**

Run: `node --experimental-strip-types src/lib/theme-palettes.test.ts`
Expected: `theme-palettes.test.ts OK`

- [ ] **Step 1.6: Typecheck**

Run: `pnpm typecheck`
Expected: exits 0.

- [ ] **Step 1.7: Commit**

```bash
git add src/lib/theme-palettes.ts src/lib/theme-storage.ts src/lib/theme-palettes.test.ts
git commit -S -m "$(cat <<'EOF'
feat(themes): add 8-theme metadata + storage-key module

New src/lib/theme-palettes.ts is the single source of truth for the
8 curated theme ids (coven, tide, grove, ember, bloom, dusk, mist,
slate), each with hue + light/dark accent hex + a representative
background swatch for the settings preview grid.

src/lib/theme-storage.ts holds the localStorage keys and the
mood-c|sky|orchid|midnight → coven|tide|dusk|slate one-shot rename
map used by the next-paint theme script.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature 2>&1 | grep -E "Good|signing" | head -2
```

Expected: log line contains `Good "<algorithm>" signature`. If `signing failed` or no signature line, STOP — fix signing config before continuing.

---

## Task 2: Rewrite the theme-script with mode + migration

**Files:**
- Modify: `src/components/theme-script.tsx` (entire file)
- Create: `src/components/theme-script.test.ts`

- [ ] **Step 2.1: Write the failing test**

Create `src/components/theme-script.test.ts`:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./theme-script.tsx", import.meta.url), "utf8");

// 1. Script defaults theme to "coven" and mode to "dark".
assert.match(source, /\|\|\s*"coven"/, "theme defaults to coven");
assert.match(source, /\|\|\s*"dark"/, "mode defaults to dark");

// 2. Script writes BOTH data-theme and data-mode.
assert.match(source, /setAttribute\(\s*"data-theme"/, "sets data-theme");
assert.match(source, /setAttribute\(\s*"data-mode"/, "sets data-mode");

// 3. Rename map covers all 4 legacy ids and writes through localStorage.
for (const legacy of ["mood-c", "sky", "orchid", "midnight"]) {
  assert.ok(source.includes(`"${legacy}"`), `rename map contains ${legacy}`);
}
assert.ok(source.includes("setItem"), "writes renamed id back to localStorage");

// 4. Custom theme path applies the mode-matching group.
assert.match(
  source,
  /cssVars\.light|cssVars\[\s*["']light["']\s*\]/,
  "custom path references light group",
);
assert.match(
  source,
  /cssVars\.dark|cssVars\[\s*["']dark["']\s*\]/,
  "custom path references dark group",
);

// 5. Reads keys via the COVEN_*_KEY constants (or matches their values).
assert.ok(
  source.includes("coven-theme") && source.includes("coven-mode"),
  "references both storage keys",
);

console.log("theme-script.test.ts OK");
```

- [ ] **Step 2.2: Run the test to verify it fails**

Run: `node --experimental-strip-types src/components/theme-script.test.ts`
Expected: assertion failure (current script doesn't set `data-mode` and defaults differently).

- [ ] **Step 2.3: Rewrite `src/components/theme-script.tsx`**

```tsx
/**
 * ThemeScript — flash-free theme + mode restoration.
 *
 * Rendered as a <script> tag inside <head> via layout.tsx.
 * Runs before the first paint so there's no theme flash.
 *
 * Strategy:
 *  1. Read localStorage["coven-theme"] (id or "custom"), default "coven".
 *  2. Read localStorage["coven-mode"] ("light" | "dark"), default "dark".
 *  3. One-shot rename: mood-c → coven, sky → tide, orchid → dusk, midnight → slate.
 *  4. Always set BOTH `data-theme` and `data-mode` on <html>.
 *  5. If theme === "custom", apply `cssVars.theme` (mode-agnostic) +
 *     `cssVars[mode]` (mode-specific) from localStorage["coven-custom-theme"].
 */

const THEME_SCRIPT = `
(function () {
  try {
    var rename = { "mood-c": "coven", "sky": "tide", "orchid": "dusk", "midnight": "slate" };
    var theme = localStorage.getItem("coven-theme") || "coven";
    if (rename[theme]) {
      theme = rename[theme];
      localStorage.setItem("coven-theme", theme);
    }
    var mode = localStorage.getItem("coven-mode") || "dark";
    if (mode !== "light" && mode !== "dark") mode = "dark";

    var html = document.documentElement;
    html.setAttribute("data-theme", theme);
    html.setAttribute("data-mode", mode);

    if (theme === "custom") {
      var raw = localStorage.getItem("coven-custom-theme");
      if (!raw) return;
      var data = JSON.parse(raw);
      var cssVars = data && data.cssVars;
      if (!cssVars) return;
      function applyGroup(group) {
        if (!group || typeof group !== "object") return;
        for (var name in group) {
          if (!Object.prototype.hasOwnProperty.call(group, name)) continue;
          if (typeof group[name] !== "string" || !name) continue;
          var cssName = name.indexOf("--") === 0 ? name : "--" + name;
          try { html.style.setProperty(cssName, group[name]); } catch (e) {}
        }
      }
      applyGroup(cssVars.theme);
      var modeGroup = mode === "light" ? cssVars.light : cssVars.dark;
      if (!modeGroup) modeGroup = mode === "light" ? cssVars.dark : cssVars.light;
      applyGroup(modeGroup);
    }
  } catch (e) {}
})();
`.trim();

/**
 * Inline <script> that runs synchronously before hydration.
 * Must be placed in <head>.
 */
export function ThemeScript() {
  return (
    <script
      id="theme-init"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: intentional flash-prevention inline script
      dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }}
    />
  );
}
```

- [ ] **Step 2.4: Run the test to verify it passes**

Run: `node --experimental-strip-types src/components/theme-script.test.ts`
Expected: `theme-script.test.ts OK`

- [ ] **Step 2.5: Typecheck**

Run: `pnpm typecheck`
Expected: exits 0.

- [ ] **Step 2.6: Commit**

```bash
git add src/components/theme-script.tsx src/components/theme-script.test.ts
git commit -S -m "$(cat <<'EOF'
feat(themes): rewrite ThemeScript for mode + 8-theme migration

The inline pre-paint script now sets both data-theme and data-mode
on <html>, defaults to coven/dark, and runs a one-shot rename so
upgrading users (mood-c|sky|orchid|midnight) land on the equivalent
new theme id without losing their preference. Custom-theme path
applies the mode-matching cssVars group with a graceful fallback
to the opposite group when a tweakcn import only ships one mode.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature 2>&1 | grep -E "Good|signing" | head -2
```

Expected: `Good "<algorithm>" signature`.

---

## Task 3: Restructure `globals.css` — default theme (Coven) dark + light, derived borders

**Files:**
- Modify: `src/app/globals.css:33-164` (the `:root` block) and `:root[data-mode="light"]` block (new).

- [ ] **Step 3.1: Write the failing test**

Create `src/app/globals.css.test.ts`:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");

// 1. :root[data-mode="light"] block exists with foreground/background.
const lightBlock = css.match(/:root\[data-mode="light"\]\s*\{([\s\S]*?)\}/)?.[1] ?? "";
assert.ok(lightBlock.length > 0, ":root[data-mode=light] block exists");
assert.match(lightBlock, /--background\s*:/, "light overrides --background");
assert.match(lightBlock, /--foreground\s*:/, "light overrides --foreground");

// 2. Border vars derive from --foreground via color-mix.
assert.match(
  css,
  /--border\s*:\s*color-mix\(in oklch, var\(--foreground\)/,
  "--border derives from --foreground",
);
assert.match(
  css,
  /--border-strong\s*:\s*color-mix\(in oklch, var\(--foreground\)/,
  "--border-strong derives from --foreground",
);

// 3. The old "the app runs dark-only" assumption comment is gone or rephrased.
assert.doesNotMatch(
  css,
  /the app runs dark-only/i,
  "removed the dark-only assertion",
);

// 4. data-theme="midnight" / "orchid" / "sky" blocks are removed
//    (replaced by new theme ids in a later task — Task 4).
//    For this task we just verify the default Coven structure is intact.
assert.match(css, /:root\s*\{[\s\S]*?--background\s*:\s*oklch\(0\.07/, "coven dark background");

console.log("globals.css.test.ts (task 3) OK");
```

- [ ] **Step 3.2: Run the test to verify it fails**

Run: `node --experimental-strip-types src/app/globals.css.test.ts`
Expected: assertion failure on the `:root[data-mode="light"]` regex or the `--border` regex.

- [ ] **Step 3.3: Edit `:root` in `globals.css`**

In `src/app/globals.css`, find the `:root { … }` block at lines 33-164. Two surgical changes:

a. Replace the existing `--border` and `--border-strong` lines (currently at `globals.css:49-50`):

```css
  --border: oklch(1 0 0 / 5%);
  --border-strong: oklch(1 0 0 / 9%);
```

with:

```css
  --border: color-mix(in oklch, var(--foreground) 12%, transparent);
  --border-strong: color-mix(in oklch, var(--foreground) 22%, transparent);
```

b. Replace the existing `--input` line (currently at `globals.css:51`):

```css
  --input: oklch(1 0 0 / 8%);
```

with:

```css
  --input: color-mix(in oklch, var(--foreground) 18%, transparent);
```

c. Replace the existing `--text-muted` line (currently at `globals.css:75`):

```css
  --text-muted: oklch(0.985 0 0 / 40%);
```

with:

```css
  --text-muted: color-mix(in oklch, var(--foreground) 40%, transparent);
```

- [ ] **Step 3.4: Add the `:root[data-mode="light"]` block**

Immediately after the closing `}` of `:root` (before the `@media (prefers-reduced-motion)` block at `globals.css:169`), insert:

```css
/* ============================================================
   Coven (default theme) — LIGHT mode palette.
   :root above holds the DARK palette; this override flips
   surfaces, foreground, and accents for light mode. Hue and
   structural tokens (radii, spacing, motion) are inherited.
   ============================================================ */
:root[data-mode="light"] {
  --background: oklch(0.99 0.003 293);
  --foreground: oklch(0.18 0.006 293);
  --card: oklch(0.97 0.004 293);
  --card-foreground: oklch(0.18 0.006 293);
  --popover: oklch(1.00 0.000 0);
  --popover-foreground: oklch(0.18 0.006 293);
  --primary: oklch(0.20 0.006 293);
  --primary-foreground: oklch(0.99 0.003 293);
  --secondary: oklch(0.93 0.005 293);
  --secondary-foreground: oklch(0.18 0.006 293);
  --muted: oklch(0.93 0.005 293);
  --muted-foreground: oklch(0.45 0.010 293);
  --accent: oklch(0.93 0.005 293);
  --accent-foreground: oklch(0.18 0.006 293);
  --ring: oklch(0.55 0.10 293);

  --accent-presence: #6F62A8;
  --accent-presence-soft: oklch(0.55 0.08 295);

  --bg-base: var(--background);
  --bg-panel: oklch(1.00 0.000 0);
  --bg-raised: var(--card);
  --bg-elevated: oklch(0.95 0.005 293);
  --bg-hover: oklch(0.91 0.005 293);

  --text-primary: var(--foreground);
  --text-secondary: var(--muted-foreground);
  /* --border, --border-strong, --input, --text-muted are derived from --foreground;
     they auto-invert. No override needed. */

  --ring-focus: color-mix(in oklch, #6F62A8 55%, transparent);
  --ring-focus-soft: color-mix(in oklch, #6F62A8 30%, transparent);
  --backdrop-scrim: oklch(0 0 0 / 40%);
}
```

- [ ] **Step 3.5: Remove the dark-only comment**

In the same file, find the comment block at `globals.css:24-31` that mentions "dark UI" / "near-black, low-light editor". Replace this paragraph:

```
   Palette v1.2 — Mood C tuned for a professional, sleek dark UI.
   Surface chroma drops from 0.022 → ~0.005 so the shell reads as
   refined neutral graphite rather than tinted purple. The cave base
   sits deep (L≈0.07) for that "near-black, low-light editor" feel,
   with small lightness steps building hierarchy (panel → card →
   elevated → hover). Brand hue 293 is preserved in accents so the
   accent-presence dot still feels OpenCoven without bleeding into
   every surface. */
```

with:

```
   Palette v1.2 — Coven (default) tuned for editor density at both
   modes. Dark uses near-black panels with low chroma on surfaces;
   light mirrors the structure with a near-white panel ladder. Brand
   hue 293 is preserved in accents so the accent-presence dot still
   feels OpenCoven without bleeding into every surface. */
```

- [ ] **Step 3.6: Run the test to verify it passes**

Run: `node --experimental-strip-types src/app/globals.css.test.ts`
Expected: `globals.css.test.ts (task 3) OK`

- [ ] **Step 3.7: Build sanity check**

Run: `pnpm build`
Expected: succeeds. (If Turbopack flakes per the CI hint, retry with `rm -rf .next && pnpm build`.)

- [ ] **Step 3.8: Commit**

```bash
git add src/app/globals.css src/app/globals.css.test.ts
git commit -S -m "$(cat <<'EOF'
feat(themes): add Coven light-mode palette + derive borders from --foreground

:root[data-mode="light"] now ships the Coven (default theme) light
palette: near-white surface ladder, dark foreground, accent at
#6F62A8 for AA contrast. Border/input/text-muted vars in :root
switch to color-mix(in oklch, var(--foreground) …%, transparent)
so they auto-invert with mode — no per-theme border overrides
needed in the common case.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature 2>&1 | grep -E "Good|signing" | head -2
```

Expected: `Good "<algorithm>" signature`.

---

## Task 4: Replace the 3 old preset blocks with 7 new theme blocks (dark + light)

**Files:**
- Modify: `src/app/globals.css:2142-2223` (the `Preset themes — Midnight + Orchid + Sky` section).

- [ ] **Step 4.1: Update the failing test**

Append to `src/app/globals.css.test.ts`:

```ts
// Task 4 assertions: the 7 non-default themes each have dark + light blocks.
const otherThemes = ["tide", "grove", "ember", "bloom", "dusk", "mist", "slate"];
for (const id of otherThemes) {
  const darkRe = new RegExp(`\\[data-theme="${id}"\\]\\s*\\{`);
  const lightRe = new RegExp(`\\[data-theme="${id}"\\]\\[data-mode="light"\\]\\s*\\{`);
  assert.match(css, darkRe, `${id} dark block exists`);
  assert.match(css, lightRe, `${id} light block exists`);
}

// Old preset ids no longer present as CSS selectors.
for (const old of ["midnight", "orchid", "sky"]) {
  const re = new RegExp(`\\[data-theme="${old}"\\]`);
  assert.doesNotMatch(css, re, `old preset ${old} removed`);
}

console.log("globals.css.test.ts (task 4) OK");
```

- [ ] **Step 4.2: Re-run the test (now reads updated globals.css from the previous task and the new file from this task)**

Run: `node --experimental-strip-types src/app/globals.css.test.ts`
Expected: failures on the new `otherThemes` and "old preset removed" assertions.

- [ ] **Step 4.3: Delete the existing preset block**

In `src/app/globals.css`, delete the entire range from the comment at line 2142 (`/* ============================================================\n   Preset themes — Midnight + Orchid + Sky\n   …\n   ============================================================ */`) through the closing `}` of `[data-theme="sky"]` at line 2223.

- [ ] **Step 4.4: Insert the 7 new theme blocks**

Insert at the same location:

```css
/* ============================================================
   Theme palettes — 7 non-default themes (Coven default lives in :root).
   Each theme ships a DARK and a LIGHT palette. Hue is held constant
   per theme; chroma is low on surfaces and saved for the accent.
   Border / input / text-muted derive from --foreground (set in :root)
   so they don't need per-theme overrides in the common case.
   ============================================================ */

/* ---- Tide (blue 245) ---- */
[data-theme="tide"] {
  --background: oklch(0.07 0.012 245);
  --card: oklch(0.115 0.014 245);
  --popover: oklch(0.135 0.014 245);
  --muted: oklch(0.17 0.014 245);
  --accent: oklch(0.17 0.014 245);
  --secondary: oklch(0.17 0.014 245);
  --muted-foreground: oklch(0.66 0.024 245);
  --accent-presence: #6DA9FF;
  --ring: oklch(0.62 0.14 245);
  --bg-base: var(--background);
  --bg-panel: oklch(0.055 0.012 245);
  --bg-raised: var(--card);
  --bg-elevated: oklch(0.17 0.014 245);
  --bg-hover: oklch(0.21 0.016 245);
  --ring-focus: color-mix(in oklch, #6DA9FF 55%, transparent);
}
[data-theme="tide"][data-mode="light"] {
  --background: oklch(0.99 0.005 245);
  --foreground: oklch(0.18 0.012 245);
  --card: oklch(0.97 0.006 245);
  --popover: oklch(1.00 0.000 0);
  --muted: oklch(0.93 0.008 245);
  --accent: oklch(0.93 0.008 245);
  --secondary: oklch(0.93 0.008 245);
  --muted-foreground: oklch(0.45 0.020 245);
  --accent-presence: #3D7DD8;
  --ring: oklch(0.55 0.14 245);
  --bg-base: var(--background);
  --bg-panel: oklch(1.00 0.000 0);
  --bg-raised: var(--card);
  --bg-elevated: oklch(0.95 0.008 245);
  --bg-hover: oklch(0.91 0.010 245);
  --ring-focus: color-mix(in oklch, #3D7DD8 55%, transparent);
}

/* ---- Grove (green 145) ---- */
[data-theme="grove"] {
  --background: oklch(0.07 0.010 145);
  --card: oklch(0.115 0.012 145);
  --popover: oklch(0.135 0.012 145);
  --muted: oklch(0.17 0.012 145);
  --accent: oklch(0.17 0.012 145);
  --secondary: oklch(0.17 0.012 145);
  --muted-foreground: oklch(0.66 0.020 145);
  --accent-presence: #6DCB8E;
  --ring: oklch(0.65 0.14 145);
  --bg-base: var(--background);
  --bg-panel: oklch(0.055 0.010 145);
  --bg-raised: var(--card);
  --bg-elevated: oklch(0.17 0.012 145);
  --bg-hover: oklch(0.21 0.014 145);
  --ring-focus: color-mix(in oklch, #6DCB8E 55%, transparent);
}
[data-theme="grove"][data-mode="light"] {
  --background: oklch(0.99 0.005 145);
  --foreground: oklch(0.18 0.010 145);
  --card: oklch(0.97 0.006 145);
  --popover: oklch(1.00 0.000 0);
  --muted: oklch(0.93 0.008 145);
  --accent: oklch(0.93 0.008 145);
  --secondary: oklch(0.93 0.008 145);
  --muted-foreground: oklch(0.45 0.018 145);
  --accent-presence: #2F8C58;
  --ring: oklch(0.55 0.14 145);
  --bg-base: var(--background);
  --bg-panel: oklch(1.00 0.000 0);
  --bg-raised: var(--card);
  --bg-elevated: oklch(0.95 0.008 145);
  --bg-hover: oklch(0.91 0.010 145);
  --ring-focus: color-mix(in oklch, #2F8C58 55%, transparent);
}

/* ---- Ember (amber 60) ---- */
[data-theme="ember"] {
  --background: oklch(0.07 0.010 60);
  --card: oklch(0.115 0.012 60);
  --popover: oklch(0.135 0.012 60);
  --muted: oklch(0.17 0.012 60);
  --accent: oklch(0.17 0.012 60);
  --secondary: oklch(0.17 0.012 60);
  --muted-foreground: oklch(0.66 0.022 60);
  --accent-presence: #E8A85C;
  --ring: oklch(0.72 0.14 60);
  --bg-base: var(--background);
  --bg-panel: oklch(0.055 0.010 60);
  --bg-raised: var(--card);
  --bg-elevated: oklch(0.17 0.012 60);
  --bg-hover: oklch(0.21 0.014 60);
  --ring-focus: color-mix(in oklch, #E8A85C 55%, transparent);
}
[data-theme="ember"][data-mode="light"] {
  --background: oklch(0.99 0.006 60);
  --foreground: oklch(0.18 0.010 60);
  --card: oklch(0.97 0.008 60);
  --popover: oklch(1.00 0.000 0);
  --muted: oklch(0.93 0.010 60);
  --accent: oklch(0.93 0.010 60);
  --secondary: oklch(0.93 0.010 60);
  --muted-foreground: oklch(0.45 0.018 60);
  --accent-presence: #B5752A;
  --ring: oklch(0.60 0.14 60);
  --bg-base: var(--background);
  --bg-panel: oklch(1.00 0.000 0);
  --bg-raised: var(--card);
  --bg-elevated: oklch(0.95 0.010 60);
  --bg-hover: oklch(0.91 0.012 60);
  --ring-focus: color-mix(in oklch, #B5752A 55%, transparent);
}

/* ---- Bloom (rose 15) ---- */
[data-theme="bloom"] {
  --background: oklch(0.07 0.010 15);
  --card: oklch(0.115 0.012 15);
  --popover: oklch(0.135 0.012 15);
  --muted: oklch(0.17 0.012 15);
  --accent: oklch(0.17 0.012 15);
  --secondary: oklch(0.17 0.012 15);
  --muted-foreground: oklch(0.66 0.022 15);
  --accent-presence: #E88FA5;
  --ring: oklch(0.70 0.14 15);
  --bg-base: var(--background);
  --bg-panel: oklch(0.055 0.010 15);
  --bg-raised: var(--card);
  --bg-elevated: oklch(0.17 0.012 15);
  --bg-hover: oklch(0.21 0.014 15);
  --ring-focus: color-mix(in oklch, #E88FA5 55%, transparent);
}
[data-theme="bloom"][data-mode="light"] {
  --background: oklch(0.99 0.005 15);
  --foreground: oklch(0.18 0.010 15);
  --card: oklch(0.97 0.006 15);
  --popover: oklch(1.00 0.000 0);
  --muted: oklch(0.93 0.008 15);
  --accent: oklch(0.93 0.008 15);
  --secondary: oklch(0.93 0.008 15);
  --muted-foreground: oklch(0.45 0.018 15);
  --accent-presence: #C25A78;
  --ring: oklch(0.58 0.14 15);
  --bg-base: var(--background);
  --bg-panel: oklch(1.00 0.000 0);
  --bg-raised: var(--card);
  --bg-elevated: oklch(0.95 0.008 15);
  --bg-hover: oklch(0.91 0.010 15);
  --ring-focus: color-mix(in oklch, #C25A78 55%, transparent);
}

/* ---- Dusk (magenta 330) ---- */
[data-theme="dusk"] {
  --background: oklch(0.13 0.030 330);
  --card: oklch(0.17 0.030 330);
  --popover: oklch(0.17 0.030 330);
  --muted: oklch(0.22 0.032 330);
  --accent: oklch(0.24 0.032 330);
  --secondary: oklch(0.24 0.032 330);
  --muted-foreground: oklch(0.70 0.030 330);
  --accent-presence: #D26BFF;
  --ring: oklch(0.60 0.16 330);
  --bg-base: var(--background);
  --bg-panel: oklch(0.11 0.028 330);
  --bg-raised: var(--card);
  --bg-elevated: oklch(0.24 0.034 330);
  --bg-hover: oklch(0.27 0.036 330);
  --ring-focus: color-mix(in oklch, #D26BFF 55%, transparent);
}
[data-theme="dusk"][data-mode="light"] {
  --background: oklch(0.99 0.006 330);
  --foreground: oklch(0.18 0.014 330);
  --card: oklch(0.97 0.008 330);
  --popover: oklch(1.00 0.000 0);
  --muted: oklch(0.93 0.010 330);
  --accent: oklch(0.93 0.010 330);
  --secondary: oklch(0.93 0.010 330);
  --muted-foreground: oklch(0.45 0.020 330);
  --accent-presence: #9F3FCE;
  --ring: oklch(0.50 0.18 330);
  --bg-base: var(--background);
  --bg-panel: oklch(1.00 0.000 0);
  --bg-raised: var(--card);
  --bg-elevated: oklch(0.95 0.010 330);
  --bg-hover: oklch(0.91 0.012 330);
  --ring-focus: color-mix(in oklch, #9F3FCE 55%, transparent);
}

/* ---- Mist (teal 195) ---- */
[data-theme="mist"] {
  --background: oklch(0.07 0.010 195);
  --card: oklch(0.115 0.012 195);
  --popover: oklch(0.135 0.012 195);
  --muted: oklch(0.17 0.012 195);
  --accent: oklch(0.17 0.012 195);
  --secondary: oklch(0.17 0.012 195);
  --muted-foreground: oklch(0.66 0.020 195);
  --accent-presence: #5DD0CB;
  --ring: oklch(0.70 0.14 195);
  --bg-base: var(--background);
  --bg-panel: oklch(0.055 0.010 195);
  --bg-raised: var(--card);
  --bg-elevated: oklch(0.17 0.012 195);
  --bg-hover: oklch(0.21 0.014 195);
  --ring-focus: color-mix(in oklch, #5DD0CB 55%, transparent);
}
[data-theme="mist"][data-mode="light"] {
  --background: oklch(0.99 0.005 195);
  --foreground: oklch(0.18 0.010 195);
  --card: oklch(0.97 0.006 195);
  --popover: oklch(1.00 0.000 0);
  --muted: oklch(0.93 0.008 195);
  --accent: oklch(0.93 0.008 195);
  --secondary: oklch(0.93 0.008 195);
  --muted-foreground: oklch(0.45 0.016 195);
  --accent-presence: #1E938E;
  --ring: oklch(0.55 0.14 195);
  --bg-base: var(--background);
  --bg-panel: oklch(1.00 0.000 0);
  --bg-raised: var(--card);
  --bg-elevated: oklch(0.95 0.008 195);
  --bg-hover: oklch(0.91 0.010 195);
  --ring-focus: color-mix(in oklch, #1E938E 55%, transparent);
}

/* ---- Slate (neutral 270) ---- */
[data-theme="slate"] {
  --background: oklch(0.07 0.000 270);
  --card: oklch(0.115 0.000 270);
  --popover: oklch(0.135 0.000 270);
  --muted: oklch(0.17 0.000 270);
  --accent: oklch(0.17 0.000 270);
  --secondary: oklch(0.17 0.000 270);
  --muted-foreground: oklch(0.66 0.000 270);
  --accent-presence: #A0A0AB;
  --ring: oklch(0.55 0.000 270);
  --bg-base: var(--background);
  --bg-panel: oklch(0.055 0.000 270);
  --bg-raised: var(--card);
  --bg-elevated: oklch(0.17 0.000 270);
  --bg-hover: oklch(0.21 0.000 270);
  --ring-focus: color-mix(in oklch, #A0A0AB 55%, transparent);
}
[data-theme="slate"][data-mode="light"] {
  --background: oklch(0.99 0.000 270);
  --foreground: oklch(0.18 0.000 270);
  --card: oklch(0.97 0.000 270);
  --popover: oklch(1.00 0.000 0);
  --muted: oklch(0.93 0.000 270);
  --accent: oklch(0.93 0.000 270);
  --secondary: oklch(0.93 0.000 270);
  --muted-foreground: oklch(0.45 0.000 270);
  --accent-presence: #5C5C66;
  --ring: oklch(0.45 0.000 270);
  --bg-base: var(--background);
  --bg-panel: oklch(1.00 0.000 0);
  --bg-raised: var(--card);
  --bg-elevated: oklch(0.95 0.000 270);
  --bg-hover: oklch(0.91 0.000 270);
  --ring-focus: color-mix(in oklch, #5C5C66 55%, transparent);
}
```

- [ ] **Step 4.5: Run the test to verify it passes**

Run: `node --experimental-strip-types src/app/globals.css.test.ts`
Expected: `globals.css.test.ts (task 4) OK`

- [ ] **Step 4.6: Build sanity check**

Run: `pnpm build`
Expected: succeeds.

- [ ] **Step 4.7: Commit**

```bash
git add src/app/globals.css src/app/globals.css.test.ts
git commit -S -m "$(cat <<'EOF'
feat(themes): add 7 non-default theme palettes (dark + light each)

Replace the dark-only [data-theme=midnight|orchid|sky] blocks with
7 new themes — tide, grove, ember, bloom, dusk, mist, slate —
each shipping a dark and a light palette. Coven is the default
and stays in :root.

Hue is held constant per theme; chroma stays low on surfaces and
high on the --accent-presence. Border / input / text-muted vars
inherit the :root --foreground-derived definition and auto-invert.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature 2>&1 | grep -E "Good|signing" | head -2
```

Expected: `Good "<algorithm>" signature`.

---

## Task 5: Add `<ModeToggle>` component

**Files:**
- Create: `src/components/mode-toggle.tsx`
- Create: `src/components/mode-toggle.test.ts`

- [ ] **Step 5.1: Write the failing test**

Create `src/components/mode-toggle.test.ts`:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./mode-toggle.tsx", import.meta.url), "utf8");

// 1. Exports the ModeToggle component.
assert.match(source, /export\s+function\s+ModeToggle/, "ModeToggle exported");

// 2. Accepts value + onChange of Mode type.
assert.match(source, /value\s*:\s*Mode/, "value: Mode prop");
assert.match(source, /onChange\s*:\s*\(/, "onChange callback");

// 3. Renders both Light and Dark options.
assert.match(source, /"light"/, "light option");
assert.match(source, /"dark"/, "dark option");

// 4. Uses aria-pressed for accessibility (segmented control).
assert.match(source, /aria-pressed/, "aria-pressed for active state");

console.log("mode-toggle.test.ts OK");
```

- [ ] **Step 5.2: Run the test to verify it fails**

Run: `node --experimental-strip-types src/components/mode-toggle.test.ts`
Expected: `ENOENT` / module not found.

- [ ] **Step 5.3: Create `src/components/mode-toggle.tsx`**

```tsx
"use client";

/**
 * ModeToggle — segmented Light / Dark control. Pure presentational.
 *
 * Lives in the Appearance settings section above the theme grid.
 * Caller is responsible for persistence + applying `data-mode` on <html>.
 */

import { Icon } from "@iconify/react";
import type { Mode } from "../lib/theme-storage";

interface ModeToggleProps {
  value: Mode;
  onChange: (next: Mode) => void;
}

const OPTIONS: { id: Mode; label: string; icon: string }[] = [
  { id: "light", label: "Light", icon: "ph:sun" },
  { id: "dark", label: "Dark", icon: "ph:moon" },
];

export function ModeToggle({ value, onChange }: ModeToggleProps) {
  return (
    <div
      role="group"
      aria-label="Color mode"
      className="inline-flex items-center gap-0.5 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-base)] p-0.5"
    >
      {OPTIONS.map((opt) => {
        const active = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.id)}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors ${
              active
                ? "bg-[var(--bg-raised)] text-[var(--text-primary)]"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            <Icon name={opt.icon} width={14} />
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 5.4: Run the test to verify it passes**

Run: `node --experimental-strip-types src/components/mode-toggle.test.ts`
Expected: `mode-toggle.test.ts OK`

- [ ] **Step 5.5: Typecheck**

Run: `pnpm typecheck`
Expected: exits 0.

- [ ] **Step 5.6: Commit**

```bash
git add src/components/mode-toggle.tsx src/components/mode-toggle.test.ts
git commit -S -m "$(cat <<'EOF'
feat(themes): add ModeToggle segmented control

Two-option Light/Dark segmented control with sun/moon icons.
Pure presentational — caller persists value and applies data-mode
on <html>. aria-pressed conveys active state to screen readers.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature 2>&1 | grep -E "Good|signing" | head -2
```

Expected: `Good "<algorithm>" signature`.

---

## Task 6: Wire mode + 8 themes into Settings → Appearance

**Files:**
- Modify: `src/components/settings-shell.tsx:375-470` (theme helpers + PRESETS) and `:525-700` (AppearanceSection body).

This is the largest single edit. The structure below replaces specific named regions; preserve everything outside those regions.

- [ ] **Step 6.1: Rewrite the theme-helper block**

Find the `// ─── Theme helpers ───` block (starts around `settings-shell.tsx:375`). Replace from that comment through the closing `}` of `clearCustomTheme` (around `settings-shell.tsx:434`) with:

```tsx
// ─── Theme helpers ───────────────────────────────────────────────────────────────────────

import { THEME_IDS, THEME_META, getSwatches } from "../lib/theme-palettes";
import type { ThemeId } from "../lib/theme-palettes";
import {
  COVEN_THEME_KEY,
  COVEN_MODE_KEY,
  COVEN_CUSTOM_THEME_KEY,
  LEGACY_THEME_RENAME,
} from "../lib/theme-storage";
import type { Mode } from "../lib/theme-storage";
import { ModeToggle } from "./mode-toggle";

type PresetTheme = ThemeId;
type ActiveTheme = PresetTheme | "custom";

interface CustomThemeData {
  name: string;
  cssVars: {
    theme?: Record<string, string>;
    light?: Record<string, string>;
    dark?: Record<string, string>;
  };
}

function clearCustomCssVars(html: HTMLElement) {
  const style = html.getAttribute("style") ?? "";
  const cleaned = style.replace(/--[\w-]+\s*:[^;]+;?/g, "").trim();
  if (cleaned) html.setAttribute("style", cleaned);
  else html.removeAttribute("style");
}

function applyPreset(theme: PresetTheme) {
  const html = document.documentElement;
  clearCustomCssVars(html);
  html.setAttribute("data-theme", theme);
  localStorage.setItem(COVEN_THEME_KEY, theme);
}

function applyMode(mode: Mode) {
  const html = document.documentElement;
  html.setAttribute("data-mode", mode);
  localStorage.setItem(COVEN_MODE_KEY, mode);
}

function applyCustomVars(cssVars: CustomThemeData["cssVars"], mode: Mode) {
  const html = document.documentElement;
  html.setAttribute("data-theme", "custom");
  clearCustomCssVars(html);

  const apply = (group?: Record<string, string>) => {
    if (!group) return;
    for (const [name, value] of Object.entries(group)) {
      if (typeof value !== "string" || !name) continue;
      const cssName = name.startsWith("--") ? name : `--${name}`;
      html.style.setProperty(cssName, value);
    }
  };
  // theme: mode-agnostic vars (fonts, radius, shadows, tracking).
  // light/dark: mode-specific colors. Fall back to the opposite group
  // when the import only ships one mode.
  apply(cssVars.theme);
  const modeGroup =
    (mode === "light" ? cssVars.light : cssVars.dark) ??
    (mode === "light" ? cssVars.dark : cssVars.light);
  apply(modeGroup);
}

function clearCustomTheme() {
  document.documentElement.setAttribute("data-theme", "coven");
  document.documentElement.removeAttribute("style");
  localStorage.removeItem(COVEN_CUSTOM_THEME_KEY);
  localStorage.setItem(COVEN_THEME_KEY, "coven");
}

function readPersistedTheme(): ActiveTheme {
  const raw = localStorage.getItem(COVEN_THEME_KEY);
  if (!raw) return "coven";
  if (LEGACY_THEME_RENAME[raw]) return LEGACY_THEME_RENAME[raw] as ActiveTheme;
  if (raw === "custom") return "custom";
  if ((THEME_IDS as readonly string[]).includes(raw)) return raw as ActiveTheme;
  return "coven";
}

function readPersistedMode(): Mode {
  const raw = localStorage.getItem(COVEN_MODE_KEY);
  return raw === "light" ? "light" : "dark";
}
```

- [ ] **Step 6.2: Replace the `PRESETS` array + `ThemePresetCard`**

Find `// ─── Preset cards ───` (around `settings-shell.tsx:436`). Replace from that comment through the closing `}` of `ThemePresetCard` (around `settings-shell.tsx:523`) with:

```tsx
// ─── Preset cards ─────────────────────────────────────────────────────────────────────────────

interface ThemePresetEntry {
  id: ThemeId;
  label: string;
  description: string;
}

const PRESETS: ThemePresetEntry[] = THEME_IDS.map((id) => ({
  id,
  label: THEME_META[id].name,
  description: THEME_META[id].description,
}));

function ThemePresetCard({
  preset,
  mode,
  active,
  onSelect,
}: {
  preset: ThemePresetEntry;
  mode: Mode;
  active: boolean;
  onSelect: (id: ThemeId) => void;
}) {
  const swatches = getSwatches(preset.id, mode);
  return (
    <button
      type="button"
      onClick={() => onSelect(preset.id)}
      aria-pressed={active}
      className={`relative flex flex-col gap-3 rounded-xl border p-4 text-left transition-all ${
        active
          ? "border-[var(--accent-presence)] bg-[var(--bg-raised)] ring-1 ring-[var(--accent-presence)]"
          : "border-[var(--border-hairline)] bg-[var(--bg-base)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-raised)]"
      }`}
    >
      <div className="flex items-center gap-1.5">
        <span
          className="h-5 w-5 rounded-full border border-[var(--border-hairline)]"
          style={{ background: swatches.bg }}
          title="Background"
        />
        <span
          className="h-5 w-5 rounded-full"
          style={{ background: swatches.accent }}
          title="Accent"
        />
        <span
          className="h-5 w-5 rounded-full border-2"
          style={{ background: swatches.bg, borderColor: swatches.border }}
          title="Border"
        />
      </div>

      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-[var(--text-primary)]">{preset.label}</p>
        <p className="text-[11px] text-[var(--text-muted)] leading-snug">{preset.description}</p>
      </div>

      {active && (
        <span className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent-presence)] text-white">
          <Icon name="ph:check-bold" width={11} />
        </span>
      )}
    </button>
  );
}
```

- [ ] **Step 6.3: Rewire `AppearanceSection`**

Find `function AppearanceSection() {` (around `settings-shell.tsx:527`). Inside the body, locate the existing state declarations (`activeTheme`, `customData`, etc.) and the `useEffect(() => { const saved = localStorage.getItem(...) ...` block.

Update the state + persistence block to:

```tsx
const [activeTheme, setActiveTheme] = useState<ActiveTheme>("coven");
const [mode, setMode] = useState<Mode>("dark");
const [customData, setCustomData] = useState<CustomThemeData | null>(null);
const [importUrl, setImportUrl] = useState("");
const [importing, setImporting] = useState(false);
const [importError, setImportError] = useState<string | null>(null);

// Read persisted theme + mode on mount
useEffect(() => {
  setActiveTheme(readPersistedTheme());
  setMode(readPersistedMode());
  const saved = localStorage.getItem(COVEN_THEME_KEY);
  if (saved === "custom") {
    const raw = localStorage.getItem(COVEN_CUSTOM_THEME_KEY);
    if (raw) {
      try {
        setCustomData(JSON.parse(raw) as CustomThemeData);
      } catch {
        /* malformed — ignore */
      }
    }
  }
}, []);

const handleSelectPreset = (id: PresetTheme) => {
  setActiveTheme(id);
  setCustomData(null);
  applyPreset(id);
};

const handleSetMode = (next: Mode) => {
  setMode(next);
  applyMode(next);
  // If a custom theme is active, re-apply with the new mode group.
  if (activeTheme === "custom" && customData) {
    applyCustomVars(customData.cssVars, next);
  }
};

const handleResetCustom = () => {
  clearCustomTheme();
  setActiveTheme("coven");
  setCustomData(null);
};
```

Inside the `handleImport` function (after a successful fetch, where `applyCustomVars(data.cssVars)` is called — around `settings-shell.tsx:619`), update the call to pass `mode`:

```tsx
applyCustomVars(data.cssVars, mode);
```

And update the success-path `localStorage.setItem` calls already in `handleImport` to use the constants:

```tsx
localStorage.setItem(COVEN_CUSTOM_THEME_KEY, JSON.stringify(data));
localStorage.setItem(COVEN_THEME_KEY, "custom");
```

Finally, in the returned JSX of `AppearanceSection`, locate the `<SettingsGroup label="Theme">` block. Insert a new `<SettingsGroup label="Mode">` BEFORE it:

```tsx
<SettingsGroup label="Mode">
  <div className="px-4 py-3">
    <ModeToggle value={mode} onChange={handleSetMode} />
  </div>
</SettingsGroup>
```

And update the existing theme grid rendering — find the `PRESETS.map((preset) =>` call (around `settings-shell.tsx:660` give or take) and change the `<ThemePresetCard>` element to pass `mode`:

```tsx
{PRESETS.map((preset) => (
  <ThemePresetCard
    key={preset.id}
    preset={preset}
    mode={mode}
    active={activeTheme === preset.id}
    onSelect={handleSelectPreset}
  />
))}
```

The grid container's className already uses a CSS grid; if it's `grid-cols-2`, change to `grid-cols-2 lg:grid-cols-4` so 8 cards lay out as 2×4 on wide settings panes and 4×2 on narrow.

- [ ] **Step 6.4: Typecheck**

Run: `pnpm typecheck`
Expected: exits 0.

- [ ] **Step 6.5: Build sanity check**

Run: `pnpm build`
Expected: succeeds.

- [ ] **Step 6.6: Manual smoke test (dev server)**

Run: `pnpm dev` (background, then visit http://localhost:3000)

Navigate to Settings → Appearance. Verify:
1. Mode segmented control renders at the top with "Dark" pre-selected.
2. 8 theme cards render in a grid (Coven, Tide, Grove, Ember, Bloom, Dusk, Mist, Slate).
3. Clicking "Light" flips every visible surface (app shell, chat, composer) to light.
4. Clicking "Dark" flips back.
5. All 8 swatch triplets update live when mode flips.
6. Picking a theme (e.g., Grove) changes the accent ring and surfaces; mode preference is preserved.
7. Hard refresh in Light + Grove → reloads in Light + Grove with no flash.

Stop dev server when satisfied.

- [ ] **Step 6.7: Commit**

```bash
git add src/components/settings-shell.tsx
git commit -S -m "$(cat <<'EOF'
feat(themes): mode toggle + 8-theme grid in Appearance settings

Add ModeToggle (Light/Dark) above the theme grid; replace the
4-preset list with the 8-theme roster sourced from
theme-palettes.ts. Swatches re-render live when mode flips so
each card previews its current-mode palette.

Custom theme import is now mode-aware: applies cssVars.light in
light mode, cssVars.dark in dark mode, with a fallback to the
opposite group when the tweakcn import only ships one. Flipping
mode while a custom theme is active live-reapplies the matching
group.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature 2>&1 | grep -E "Good|signing" | head -2
```

Expected: `Good "<algorithm>" signature`.

---

## Task 7: Pass-1 CSS audit — sidebar + composer

**Files:**
- Modify: `src/styles/sidebar-minimal.css`
- Modify: `src/styles/home-composer.css`

Goal: replace hardcoded `oklch(1 0 0 / N%)`, `rgba(255, 255, 255, …)`, and `rgba(0, 0, 0, …)` color literals with `--foreground`-derived `color-mix` (or `--backdrop-scrim`) so they auto-invert.

- [ ] **Step 7.1: Audit sidebar-minimal.css**

Run: `grep -nE 'oklch\(1 0 0|rgba\(255|rgba\(0, ?0, ?0' src/styles/sidebar-minimal.css`

For each hit, replace the dark-only literal with a derived value. Mapping table:

| Original | Replacement |
|---|---|
| `oklch(1 0 0 / 5%)` | `color-mix(in oklch, var(--foreground) 5%, transparent)` |
| `oklch(1 0 0 / 8%)` | `color-mix(in oklch, var(--foreground) 8%, transparent)` |
| `oklch(1 0 0 / 12%)` | `color-mix(in oklch, var(--foreground) 12%, transparent)` |
| `rgba(255, 255, 255, 0.04)` | `color-mix(in oklch, var(--foreground) 4%, transparent)` |
| `rgba(255, 255, 255, 0.08)` | `color-mix(in oklch, var(--foreground) 8%, transparent)` |
| `rgba(0, 0, 0, 0.4)` (scrim) | `var(--backdrop-scrim)` |
| `rgba(0, 0, 0, 0.6)` (deep scrim) | `var(--backdrop-scrim)` |

Edit each occurrence with the Edit tool (one Edit call per unique `old_string` if it occurs once; use `replace_all: true` when an identical literal appears multiple times).

Do not migrate `color: white` / `color: #fff` literals if they're on a colored background (e.g., a primary button's text) — those are intentional, not mode-dependent. Leave them alone.

- [ ] **Step 7.2: Audit home-composer.css**

Repeat Step 7.1 for `src/styles/home-composer.css`.

- [ ] **Step 7.3: Visual verification (dev server)**

Run: `pnpm dev`. Open the app. Flip Settings → Appearance → Mode to Light. Confirm:
1. Sidebar borders, hover states, and dividers are visible (faint black-tint) instead of invisible (faint white-tint).
2. Composer input border is visible in light mode.
3. Flip back to Dark — surfaces look identical to before this task.

- [ ] **Step 7.4: Commit**

```bash
git add src/styles/sidebar-minimal.css src/styles/home-composer.css
git commit -S -m "$(cat <<'EOF'
feat(themes): pass-1 light-mode audit — sidebar + composer

Replace hardcoded oklch(1 0 0 / N%) and rgba(255,…) borders with
color-mix(in oklch, var(--foreground) N%, transparent) so they
auto-invert with mode. Backdrop scrims migrate to
var(--backdrop-scrim).

Intentional white-on-colored-button text literals (e.g., primary
button foreground) are left as-is — they're not mode-dependent.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature 2>&1 | grep -E "Good|signing" | head -2
```

Expected: `Good "<algorithm>" signature`.

---

## Task 8: Pass-1 CSS audit — chat + sessions

**Files:**
- Modify: `src/styles/cave-chat.css`
- Modify: `src/styles/sessions-view.css`

Same mapping table as Task 7.

- [ ] **Step 8.1: Audit cave-chat.css**

Run: `grep -nE 'oklch\(1 0 0|rgba\(255|rgba\(0, ?0, ?0' src/styles/cave-chat.css`

Apply the Task 7.1 mapping. Be careful with assistant-turn background tints — some are intended to be subtly elevated above `--bg-base`; map those to `color-mix(in oklch, var(--foreground) N%, transparent)` so the elevation reads in both modes.

- [ ] **Step 8.2: Audit sessions-view.css**

Repeat for `src/styles/sessions-view.css`.

- [ ] **Step 8.3: Verify cave-chat.test.ts assertions still hold**

The existing `src/components/chat-view.test.ts` asserts specific CSS rules exist in `cave-chat.css`. Run it to confirm we haven't broken those expectations:

Run: `node --experimental-strip-types src/components/chat-view.test.ts`
Expected: exits 0 with no assertion failures.

- [ ] **Step 8.4: Visual verification**

Run: `pnpm dev`. Open a chat. Flip mode Light ↔ Dark several times. Confirm:
1. Assistant turn elevation is visible in both modes.
2. User turn bubble (if styled) reads cleanly in both modes.
3. Code blocks, dividers, and scroll affordances are readable in both modes.
4. Sessions view list rows have visible hover/active states in both modes.

- [ ] **Step 8.5: Commit**

```bash
git add src/styles/cave-chat.css src/styles/sessions-view.css
git commit -S -m "$(cat <<'EOF'
feat(themes): pass-1 light-mode audit — chat + sessions

Migrate hardcoded white-alpha and black-alpha literals in
cave-chat.css and sessions-view.css to var(--foreground)-derived
color-mix calls (or var(--backdrop-scrim) for overlays) so chat
turns and session rows remain readable across both modes.

Existing chat-view.test.ts assertions on assistant-turn layout
still hold.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature 2>&1 | grep -E "Good|signing" | head -2
```

Expected: `Good "<algorithm>" signature`.

---

## Task 9: Mark long-tail surfaces with `TODO: light-mode-audit`

**Files:**
- Modify: `src/styles/library.css`
- Modify: `src/styles/board.css`
- Modify: `src/app/mockup/mockup.css`

These ship in light mode looking ~95% right; the long tail is tracked as a follow-up issue.

- [ ] **Step 9.1: Add header marker comment to each file**

For `src/styles/library.css`, `src/styles/board.css`, and `src/app/mockup/mockup.css`: prepend (or insert below any existing top-of-file comment block) the following marker:

```css
/* TODO: light-mode-audit — this file ships hardcoded dark-mode color
   literals (oklch(1 0 0 / N%) / rgba(255,...)) that need migrating to
   color-mix(in oklch, var(--foreground) N%, transparent) for a clean
   light-mode appearance. Tracked in the light-mode pass-2 follow-up. */
```

- [ ] **Step 9.2: Verify the marker greps cleanly**

Run: `grep -l "TODO: light-mode-audit" src/styles/library.css src/styles/board.css src/app/mockup/mockup.css`
Expected: all three paths listed.

- [ ] **Step 9.3: Build sanity check**

Run: `pnpm build`
Expected: succeeds.

- [ ] **Step 9.4: Commit**

```bash
git add src/styles/library.css src/styles/board.css src/app/mockup/mockup.css
git commit -S -m "$(cat <<'EOF'
chore(themes): mark long-tail CSS files for pass-2 light-mode audit

library.css, board.css, and mockup.css still contain hardcoded
dark-only color literals that need migrating to --foreground-derived
color-mix for a fully clean light-mode appearance. Mark them with
a greppable TODO so the follow-up issue can target them precisely.
No behavior change in this commit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature 2>&1 | grep -E "Good|signing" | head -2
```

Expected: `Good "<algorithm>" signature`.

---

## Task 10: Final verification + signing sanity check

- [ ] **Step 10.1: Run all unit tests**

Run each of:

```
node --experimental-strip-types src/lib/theme-palettes.test.ts
node --experimental-strip-types src/components/theme-script.test.ts
node --experimental-strip-types src/components/mode-toggle.test.ts
node --experimental-strip-types src/app/globals.css.test.ts
node --experimental-strip-types src/components/chat-view.test.ts
```

Expected: each prints its `OK` line (or exits 0) with no assertion failures.

- [ ] **Step 10.2: Typecheck**

Run: `pnpm typecheck`
Expected: exits 0.

- [ ] **Step 10.3: Full build**

Run: `pnpm build`
Expected: succeeds (retry once with `rm -rf .next` if Turbopack flakes).

- [ ] **Step 10.4: Manual matrix smoke**

Run: `pnpm dev`. For each of the 8 themes × 2 modes (16 combinations), set localStorage to the combo, hard-refresh, and confirm:
1. No console errors.
2. No flash of opposite-mode palette on load.
3. Settings shows the right active card + mode.

Spot-check rather than exhaust: pick `coven/dark`, `coven/light`, `tide/light`, `slate/dark`, `ember/light` at minimum. Use the browser console: `localStorage.setItem("coven-theme", "<id>"); localStorage.setItem("coven-mode", "<mode>"); location.reload();`.

- [ ] **Step 10.5: Migration smoke**

In the dev server console, set localStorage to an old preset and reload:

```js
localStorage.setItem("coven-theme", "mood-c");
localStorage.removeItem("coven-mode");
location.reload();
```

After reload, confirm in the console:

```js
localStorage.getItem("coven-theme"); // "coven"  (rename ran)
localStorage.getItem("coven-mode");  // null     (mode falls back to "dark")
document.documentElement.dataset.theme; // "coven"
document.documentElement.dataset.mode;  // "dark"
```

Repeat for `sky → tide`, `orchid → dusk`, `midnight → slate`.

- [ ] **Step 10.6: Signing sanity over the branch**

Run: `git log origin/main..HEAD --pretty='%H %G?' | awk '$2 != "G" {print "UNSIGNED:", $0}'`
Expected: no output. If anything prints, those commits are unsigned — STOP and surface to the user. Do not push.

- [ ] **Step 10.7: Report status**

This task creates no commit. Report to the user:

- All N tests pass.
- All M commits on the branch signed.
- Full build green.
- Manual matrix and migration smoke complete.
- Pass-2 audit follow-up still needs an issue filed (see "Open follow-up" below).

---

## Open follow-up (not in this plan)

After this plan ships, file a GitHub issue titled "Light-mode pass-2 audit: long-tail CSS files" with body:

> Pass-1 of the light/dark mode rollout covered always-visible surfaces (`globals.css`, `sidebar-minimal.css`, `cave-chat.css`, `home-composer.css`, `sessions-view.css`).
>
> Pass-2 covers the long tail: `src/styles/library.css`, `src/styles/board.css`, `src/app/mockup/mockup.css`. Each file is marked with a `/* TODO: light-mode-audit */` comment at the top. Replace hardcoded `oklch(1 0 0 / N%)` and `rgba(255,…)` literals with `color-mix(in oklch, var(--foreground) N%, transparent)` (and `rgba(0,0,0,…)` overlays with `var(--backdrop-scrim)`) so these surfaces render cleanly in light mode.

This follow-up does NOT block shipping the main spec — light mode ships looking ~95% right today on these surfaces.

---

## Self-review summary

**Spec coverage:** Each spec section is implemented by a task:
- §A Storage & DOM attributes → Tasks 1, 2
- §B Theme ids → Task 1
- §C CSS structure → Tasks 3, 4
- §D 8 theme palettes → Task 4 (+ default in Task 3)
- §E Theme script → Task 2
- §F Settings UI → Tasks 5, 6
- §G CSS audit pass-1 → Tasks 7, 8; pass-2 marker → Task 9
- §H Default state + migration → Task 2 (rename), Task 10 (smoke)
- §I Files touched → all tasks combined match the spec's file list

**No placeholders:** Every code step shows the actual code to write or edit. No "TODO" outside the intentional `TODO: light-mode-audit` comment in Task 9.

**Type consistency:** `Mode`, `ThemeId`, `ActiveTheme`, `PresetTheme = ThemeId`, `THEME_IDS`, `THEME_META`, `getSwatches`, `LEGACY_THEME_RENAME`, `COVEN_THEME_KEY`, `COVEN_MODE_KEY`, `COVEN_CUSTOM_THEME_KEY` are defined in Task 1 and consumed identically in Tasks 2, 5, 6.
