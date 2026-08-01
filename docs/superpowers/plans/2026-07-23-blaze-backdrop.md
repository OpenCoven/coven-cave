# Blaze Animated Backdrop Style Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add "Blaze" (Canvas UI fire/sparks/smoke WebGL effect) as a second backdrop style alongside the image backdrop, selectable in Settings → Appearance → Backdrop, with colors derived from the live theme accent.

**Architecture:** The vendored zero-dependency `Blaze.tsx` renders inside the existing fixed z-0 backdrop layer when a new `style: "image" | "blaze"` preference selects it. All existing machinery (enablement, intensity → layer opacity, scrim, glass translucency, per-familiar image override) is reused unchanged. A small pure module derives `sparkColor`/`smokeColor` from `--accent-presence`.

**Tech Stack:** Next.js 16 / React 19, node source-contract tests (`scripts/run-tests.mjs`), design gates (`pnpm lint` = codemod check + design ESLint), pnpm.

**Spec:** `docs/superpowers/specs/2026-07-23-blaze-backdrop-design.md` (versioned in this repo since cave-8zjr5). **Bead:** cave-99s9. **Worktree:** `.worktrees/blaze-backdrop` (branch `blaze-backdrop`, already pushed? No — branch exists locally with no commits yet beyond origin/main).

**Working directory for ALL tasks:** `/Users/<someone>/Documents/GitHub/OpenCoven/coven-cave/.worktrees/blaze-backdrop`

**Conventions:** signed commits (`git commit -S`), Co-authored-by trailer:
`Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`

---

## File structure

| File | Responsibility |
| --- | --- |
| `src/components/canvasui/Blaze.tsx` (create) | Vendored Canvas UI component, verbatim + design-codemod pass |
| `src/lib/preferences-schema.ts` (modify) | `BACKDROP_STYLES` option set, `style` field: type, default, normalize, strict patch, legacy mirror/import |
| `src/lib/preferences-schema.test.ts` (modify) | Schema tests for `style` |
| `src/lib/cave-backdrop.ts` (modify) | Client `BackdropPrefs.style` plumbing |
| `src/lib/cave-backdrop.test.ts` (modify) | Source pins for the client plumbing |
| `src/lib/cave-backdrop-blaze-colors.ts` (create) | Pure accent→colors derivation + playground option constants |
| `src/components/cave-backdrop-blaze.tsx` (create) | Client component: lazy Blaze, reduced-motion skip, live accent tracking |
| `src/lib/cave-backdrop-blaze.test.ts` (create) | Unit tests (derivation) + source pins (component, layer, CSS, settings) |
| `src/components/cave-backdrop-layer.tsx` (modify) | Render Blaze when selected; suppress image accent; skip image fetch |
| `src/styles/backdrop.css` (modify) | Blaze fill classes + reduced-motion hide rule |
| `src/components/backdrop-settings.tsx` (modify) | Style segmented picker; image rows conditional |
| `scripts/run-tests.mjs` (modify) | Register the new test file in the app suite |

---

### Task 1: Vendor the Blaze component

**Files:**
- Create: `src/components/canvasui/Blaze.tsx`

- [ ] **Step 1: Fetch the registry payload and write the file**

```bash
cd /Users/<someone>/Documents/GitHub/OpenCoven/coven-cave/.worktrees/blaze-backdrop
curl -sL "https://canvasui.dev/r/blaze-react.json" -o /tmp/blaze-react.json
node -e "
const j = require('/tmp/blaze-react.json');
if (j.name !== 'blaze-react' || j.files[0].path !== 'components/canvasui/Blaze.tsx') throw new Error('unexpected registry payload');
require('fs').mkdirSync('src/components/canvasui', { recursive: true });
require('fs').writeFileSync('src/components/canvasui/Blaze.tsx', j.files[0].content);
console.log('wrote', j.files[0].content.length, 'chars');
"
```
Expected: `wrote 22363 chars` (length may drift slightly if upstream updates; that is fine).

- [ ] **Step 2: Add a provenance header**

Prepend above the `"use client";` line (comments before the directive are valid):

```tsx
// Vendored from Canvas UI — https://canvasui.dev/docs/components/blaze
// Registry: https://canvasui.dev/r/blaze-react.json (item "blaze-react"), fetched 2026-07-23.
// Zero runtime dependencies. Local delta: static JSX styles rewritten by
// scripts/codemods/tokenize-tsx-design.mjs (design gate) — re-run it after re-vendoring.
```

- [ ] **Step 3: Run the design codemod (sanctioned auto-fixer)**

```bash
node scripts/codemods/tokenize-tsx-design.mjs src/components/canvasui/Blaze.tsx
```
Expected: `[tokenize-tsx-design] rewrote src/components/canvasui/Blaze.tsx` — it converts the three static `style={{...}}` objects to arbitrary-property utility classes. The `style={{ position: "relative", ...style }}` wrapper stays (runtime-derived, allowed).

- [ ] **Step 4: Verify the gates and types**

```bash
node scripts/codemods/tokenize-tsx-design.mjs --check src/components/canvasui/Blaze.tsx \
  && pnpm exec eslint src/components/canvasui/Blaze.tsx --max-warnings=0 \
  && pnpm typecheck
```
Expected: `checked — 0 file(s) with drift`, no ESLint output, tsc exits 0. (If `pnpm typecheck` fails inside the vendored file, fix minimally with a `// @ts-expect-error` + comment rather than restructuring upstream code — but this was pre-verified to pass ESLint/codemod; typecheck is expected clean.)

- [ ] **Step 5: Commit**

```bash
git add src/components/canvasui/Blaze.tsx
git commit -S -m "Vendor Canvas UI Blaze component (cave-99s9)

Exact blaze-react registry payload + provenance header + the repo's design
codemod pass (static inline styles → utility classes). Zero dependencies;
WebGL2 with built-in reduced-motion, offscreen pause, and DPR capping.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 2: `style` field in the preferences schema (TDD)

**Files:**
- Modify: `src/lib/preferences-schema.ts`
- Test: `src/lib/preferences-schema.test.ts`

- [ ] **Step 1: Write the failing tests** — append at the end of `src/lib/preferences-schema.test.ts`:

```ts
// ── Backdrop style option set (cave-99s9) ────────────────────────────────────
// "image" is the compatible default; unknown styles normalize back to it, the
// strict patch path rejects them, and the legacy mirror round-trips the choice.
assert.equal(defaults.appearance.backdrop.style, "image");
{
  const normalized = normalizeCavePreferences({ appearance: { backdrop: { style: "blaze" } } });
  assert.equal(normalized.appearance.backdrop.style, "blaze");
  const coerced = normalizeCavePreferences({ appearance: { backdrop: { style: "confetti" } } });
  assert.equal(coerced.appearance.backdrop.style, "image", "unknown styles fall back to image");
}
{
  const patch = validatePreferencesPatch({ appearance: { backdrop: { style: "blaze" } } });
  assert.equal(patch.appearance?.backdrop?.style, "blaze");
  assert.throws(
    () => validatePreferencesPatch({ appearance: { backdrop: { style: "confetti" } } }),
    PreferencesValidationError,
    "unknown backdrop styles are rejected",
  );
}
{
  const prefs = createDefaultPreferences(true);
  prefs.appearance.backdrop.style = "blaze";
  const mirrored = preferencesToLegacyStorage(prefs);
  assert.equal(JSON.parse(mirrored["cave:backdrop:v1"]).style, "blaze", "legacy mirror carries the style");
  const imported = legacyStorageToPreferencesPatch(mirrored);
  assert.equal(imported.appearance?.backdrop?.style, "blaze", "legacy import restores the style");
}
```

(`defaults`, `normalizeCavePreferences`, `validatePreferencesPatch`, `PreferencesValidationError`, `createDefaultPreferences`, `preferencesToLegacyStorage`, `legacyStorageToPreferencesPatch` are already imported/defined at the top of that file.)

- [ ] **Step 2: Run to verify failure**

```bash
node --experimental-strip-types src/lib/preferences-schema.test.ts
```
Expected: FAIL — `defaults.appearance.backdrop.style` is `undefined`.

- [ ] **Step 3: Implement in `src/lib/preferences-schema.ts`** — six anchored edits:

3a. Below the `CaveBackdropImageMetadata` type (near line 67), add the option set, and add `style` to `CaveBackdropPreferences`:

```ts
/** Backdrop style option set — grows as animated styles land (cave-99s9). */
export const BACKDROP_STYLES = ["image", "blaze"] as const;
export type CaveBackdropStyle = (typeof BACKDROP_STYLES)[number];
```

```ts
export type CaveBackdropPreferences = {
  enabled: boolean;
  intensity: number;
  matchAccent: boolean;
  accentSeed: CaveBackdropAccentSeed | null;
  /** Which visual fills the layer: the stored image or the Blaze effect. */
  style: CaveBackdropStyle;
  /** Explicit per-familiar enablement (cave-kf8p); absent id = image-presence default. */
  familiars: Record<string, boolean>;
  image: CaveBackdropImageMetadata;
};
```

3b. In `createDefaultPreferences` (backdrop block near line 175), add `style: "image",` after `accentSeed: null,`.

3c. In `normalizeCavePreferences` (backdrop block near line 396), add after the `accentSeed` line:

```ts
        style: oneOf(backdrop.style, BACKDROP_STYLES, "image"),
```

3d. In `validatePreferencesPatch` (near line 596): extend the allowed-keys list and add the strict branch after the `accentSeed` branch:

```ts
      assertAllowedKeys(backdrop, ["enabled", "intensity", "matchAccent", "accentSeed", "style", "familiars", "image"], "appearance.backdrop");
```
```ts
      if (Object.hasOwn(backdrop, "style")) {
        backdropPatch.style = strictChoice(backdrop.style, BACKDROP_STYLES, "appearance.backdrop.style");
      }
```

3e. In `preferencesToLegacyStorage` (near line 809), add `style: appearance.backdrop.style,` inside the `"cave:backdrop:v1": JSON.stringify({...})` object.

3f. In `legacyStorageToPreferencesPatch` (near line 907, inside `if (isRecord(backdropRaw))`), add before the `if (Object.keys(backdrop).length > 0)` line:

```ts
    if (typeof backdropRaw.style === "string" && BACKDROP_STYLES.includes(backdropRaw.style as never)) {
      backdrop.style = backdropRaw.style as CaveBackdropStyle;
    }
```

(The `CavePreferencesPatch` backdrop type is `Partial<Omit<CaveBackdropPreferences, "image">>` — `style` joins it automatically.)

- [ ] **Step 4: Run tests to verify pass**

```bash
node --experimental-strip-types src/lib/preferences-schema.test.ts && node --experimental-strip-types src/lib/server/preferences-store.test.ts
```
Expected: both PASS (the store test guards patch/merge behavior downstream of the schema).

- [ ] **Step 5: Commit**

```bash
git add src/lib/preferences-schema.ts src/lib/preferences-schema.test.ts
git commit -S -m "Preferences: backdrop style option set (image | blaze) (cave-99s9)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 3: Client store plumbing in `cave-backdrop.ts` (TDD)

**Files:**
- Modify: `src/lib/cave-backdrop.ts`
- Test: `src/lib/cave-backdrop.test.ts`

- [ ] **Step 1: Write the failing source pins** — append at the end of `src/lib/cave-backdrop.test.ts` (it already imports `readFile` from `node:fs/promises`):

```ts
// ── Backdrop style plumbing (cave-99s9) ──────────────────────────────────────
// The client store mirrors the central style choice; the default stays the
// image so existing setups don't change visuals on upgrade.
{
  const src = await readFile(new URL("./cave-backdrop.ts", import.meta.url), "utf8");
  assert.match(src, /style: CaveBackdropStyle;/, "BackdropPrefs carries the style choice");
  assert.match(src, /style: "image",\n  familiars: \{\},/, "the default style is the image");
  assert.match(src, /style: central\.style,/, "readBackdropPrefs mirrors the central style");
}
```

- [ ] **Step 2: Run to verify failure**

```bash
node --experimental-strip-types src/lib/cave-backdrop.test.ts
```
Expected: FAIL on `BackdropPrefs carries the style choice`.

- [ ] **Step 3: Implement in `src/lib/cave-backdrop.ts`**

3a. Extend the type import (near line 30):

```ts
import {
  MAX_FAMILIAR_BACKDROPS,
  type CaveBackdropStyle,
  type CaveMode,
} from "@/lib/preferences-schema";
```

3b. In `BackdropPrefs` (after the `accentSeed` member):

```ts
  /** Which visual fills the layer: the stored image or the Blaze effect. */
  style: CaveBackdropStyle;
```

3c. In `DEFAULT_PREFS`, add `style: "image",` before `familiars: {},`.

3d. In `readBackdropPrefs`, add `style: central.style,` before `familiars: { ...central.familiars },`.

(`writeBackdropPrefs` spreads patches and posts the whole object to `updateAppPreferences` — no change needed. `applyBackdropToDocument` stays style-agnostic; the layer owns style behavior.)

- [ ] **Step 4: Run tests to verify pass**

```bash
node --experimental-strip-types src/lib/cave-backdrop.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cave-backdrop.ts src/lib/cave-backdrop.test.ts
git commit -S -m "Backdrop client store: style plumbing (cave-99s9)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 4: Accent-derived colors module + Blaze layer component (TDD)

**Files:**
- Create: `src/lib/cave-backdrop-blaze-colors.ts`
- Create: `src/components/cave-backdrop-blaze.tsx`
- Test: create `src/lib/cave-backdrop-blaze.test.ts`
- Modify: `scripts/run-tests.mjs` (register the test)

- [ ] **Step 1: Write the failing test** — create `src/lib/cave-backdrop-blaze.test.ts`:

```ts
// @ts-nocheck
// Blaze backdrop style (cave-99s9): unit tests for the accent → fire-color
// derivation, plus source pins for the component contract (reduced motion,
// lazy chunk, live theme tracking).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  blazeColorsFromAccent,
  BLAZE_FALLBACK_SMOKE,
  BLAZE_FALLBACK_SPARK,
  BLAZE_OPTIONS,
} from "./cave-backdrop-blaze-colors.ts";

// ── Smoke IS the accent; sparks sit 70% toward neutral grey ──────────────────
{
  const { sparkColor, smokeColor } = blazeColorsFromAccent("rgb(255, 0, 0)");
  assert.deepEqual(smokeColor, [1, 0, 0], "smoke takes the accent directly");
  const expected = [1 * 0.3 + 0.66 * 0.7, 0.66 * 0.7, 0.66 * 0.7];
  for (let i = 0; i < 3; i++) {
    assert.ok(Math.abs(sparkColor[i] - expected[i]) < 1e-6, "sparks mix 70% toward 0.66 grey");
  }
}

// ── The oklch syntax the theme tokens actually use parses in range ───────────
{
  const { sparkColor, smokeColor } = blazeColorsFromAccent("oklch(0.72 0.16 293)");
  assert.ok(smokeColor.every((c) => c >= 0 && c <= 1), "oklch accents land in 0–1 channels");
  assert.ok(sparkColor.every((c) => c >= 0 && c <= 1), "spark channels stay clamped");
}

// ── Unparseable accent → the exact Canvas UI playground values ───────────────
{
  const { sparkColor, smokeColor } = blazeColorsFromAccent("");
  assert.deepEqual(sparkColor, BLAZE_FALLBACK_SPARK);
  assert.deepEqual(smokeColor, BLAZE_FALLBACK_SMOKE);
}

// ── The exact playground option values (user-configured) ─────────────────────
assert.deepEqual(BLAZE_OPTIONS, {
  height: 0.75,
  distortion: 0.5,
  distortionScale: 1,
  speed: 0.5,
  sparks: 0.75,
  sparkDensity: 0.75,
  sparkSize: 0.75,
  layers: 5,
  smoke: 1,
  glow: 0.5,
});

// ── Component contract pins ──────────────────────────────────────────────────
const component = readFileSync(new URL("../components/cave-backdrop-blaze.tsx", import.meta.url), "utf8");
assert.match(
  component,
  /if \(reducedMotion \|\| accentCss === null\) return null;/,
  "reduced motion skips mounting the GPU loop entirely",
);
assert.match(
  component,
  /dynamic\(\(\) => import\("@\/components\/canvasui\/Blaze"\), \{ ssr: false \}\)/,
  "the vendored WebGL file stays out of the main bundle",
);
assert.match(
  component,
  /attributeFilter: \["data-theme", "data-mode", "style"\]/,
  "colors re-derive live on theme/mode/custom-accent changes",
);

console.log("cave-backdrop-blaze.test.ts: ok");
```

- [ ] **Step 2: Register the test** — in `scripts/run-tests.mjs`, in the `app` suite, directly after the line `"src/lib/cave-backdrop.test.ts",` (near line 736), insert:

```js
    "src/lib/cave-backdrop-blaze.test.ts",
```

- [ ] **Step 3: Run to verify failure**

```bash
node --experimental-strip-types src/lib/cave-backdrop-blaze.test.ts
```
Expected: FAIL — `Cannot find module … cave-backdrop-blaze-colors.ts`.

- [ ] **Step 4: Create `src/lib/cave-backdrop-blaze-colors.ts`**

```ts
/**
 * Blaze backdrop colors — derived from ONE theme token (cave-99s9).
 *
 * The smoke takes `--accent-presence` directly; the sparks sit 70% toward a
 * neutral grey so they read as pale embers over any of the 21 palettes × 2
 * modes (the same single-token philosophy as the app's state tints). When the
 * accent can't be parsed, the exact Canvas UI playground values apply.
 */

import { parseThemeColor } from "@/lib/theme-contrast";

export type BlazeRgb = [number, number, number];

/** Canvas UI playground values — fallback colors. */
export const BLAZE_FALLBACK_SPARK: BlazeRgb = [0.6314, 0.6314, 0.6902];
export const BLAZE_FALLBACK_SMOKE: BlazeRgb = [0.5451, 0.3608, 0.9647];

/** Exact effect options from the Canvas UI playground — do not tune casually;
 *  these are the user-approved look (spec 2026-07-23-blaze-backdrop-design). */
export const BLAZE_OPTIONS = {
  height: 0.75,
  distortion: 0.5,
  distortionScale: 1,
  speed: 0.5,
  sparks: 0.75,
  sparkDensity: 0.75,
  sparkSize: 0.75,
  layers: 5,
  smoke: 1,
  glow: 0.5,
} as const;

const SPARK_GREY = 0.66;
const SPARK_MIX = 0.7;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Derive the fire palette from the accent CSS color (any theme syntax). */
export function blazeColorsFromAccent(accentCss: string): {
  sparkColor: BlazeRgb;
  smokeColor: BlazeRgb;
} {
  const accent = parseThemeColor(accentCss);
  if (!accent) return { sparkColor: BLAZE_FALLBACK_SPARK, smokeColor: BLAZE_FALLBACK_SMOKE };
  const ember = (channel: number) => clamp01(channel * (1 - SPARK_MIX) + SPARK_GREY * SPARK_MIX);
  return {
    smokeColor: [clamp01(accent.r), clamp01(accent.g), clamp01(accent.b)],
    sparkColor: [ember(accent.r), ember(accent.g), ember(accent.b)],
  };
}
```

- [ ] **Step 5: Create `src/components/cave-backdrop-blaze.tsx`**

```tsx
"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { blazeColorsFromAccent, BLAZE_OPTIONS } from "@/lib/cave-backdrop-blaze-colors";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";

// The ~22 KB vendored WebGL file loads only when the Blaze style is shown.
const Blaze = dynamic(() => import("@/components/canvasui/Blaze"), { ssr: false });

function readAccentCss(): string {
  return getComputedStyle(document.documentElement).getPropertyValue("--accent-presence").trim();
}

/**
 * The animated backdrop visual (cave-99s9): Canvas UI Blaze rendered with no
 * wrapped content, so the output canvas carries pure fire/sparks/smoke behind
 * the app. Colors derive live from `--accent-presence` — theme and mode swaps
 * retint the fire without a remount (the vendored wrapper forwards prop
 * changes to the running instance). Reduced motion mounts nothing: no frozen
 * fire frame, no GPU spend (backdrop.css hides the layer as the CSS belt to
 * this suspender). No WebGL2 → the vendored component quietly renders nothing.
 */
export function CaveBackdropBlaze() {
  const reducedMotion = usePrefersReducedMotion();
  const [accentCss, setAccentCss] = useState<string | null>(null);

  // One observer covers every accent source: preset swaps rewrite
  // data-theme/data-mode; custom themes carry the accent as an inline style
  // property on <html>.
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setAccentCss(readAccentCss());
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["data-theme", "data-mode", "style"],
    });
    return () => observer.disconnect();
  }, []);

  if (reducedMotion || accentCss === null) return null;
  const { sparkColor, smokeColor } = blazeColorsFromAccent(accentCss);
  return (
    <div className="cave-backdrop-blaze" aria-hidden>
      <Blaze
        {...BLAZE_OPTIONS}
        sparkColor={sparkColor}
        smokeColor={smokeColor}
        className="cave-backdrop-blaze__fill"
      >
        {null}
      </Blaze>
    </div>
  );
}
```

- [ ] **Step 6: Run tests to verify pass**

```bash
node --experimental-strip-types src/lib/cave-backdrop-blaze.test.ts && node scripts/check-tests-wired.mjs
```
Expected: `cave-backdrop-blaze.test.ts: ok` and the wired-guard passes.

- [ ] **Step 7: Lint the new component**

```bash
pnpm exec eslint src/components/cave-backdrop-blaze.tsx --max-warnings=0 \
  && node scripts/codemods/tokenize-tsx-design.mjs --check src/components/cave-backdrop-blaze.tsx
```
Expected: clean (the component has no static inline styles — layout lives in `backdrop.css`, Task 5).

- [ ] **Step 8: Commit**

```bash
git add src/lib/cave-backdrop-blaze-colors.ts src/components/cave-backdrop-blaze.tsx src/lib/cave-backdrop-blaze.test.ts scripts/run-tests.mjs
git commit -S -m "Blaze backdrop visual: accent-derived colors + layer component (cave-99s9)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 5: Layer integration (TDD)

**Files:**
- Modify: `src/components/cave-backdrop-layer.tsx`
- Test: `src/lib/cave-backdrop-blaze.test.ts` (extend)

- [ ] **Step 1: Write the failing pins** — append to `src/lib/cave-backdrop-blaze.test.ts` (before the final `console.log`):

```ts
// ── Layer integration ────────────────────────────────────────────────────────
const layer = readFileSync(new URL("../components/cave-backdrop-layer.tsx", import.meta.url), "utf8");
assert.match(
  layer,
  /prefs\.style === "blaze" && !familiarImageShowing/,
  "a familiar's own image still overrides the Blaze style while active",
);
assert.match(
  layer,
  /\{blazeShowing && active \? <CaveBackdropBlaze \/> : null\}/,
  "the GPU loop unmounts whenever no backdrop surface is frontmost",
);
assert.match(
  layer,
  /data-backdrop-style=\{blazeShowing \? "blaze" : "image"\}/,
  "CSS can target the active backdrop style",
);
assert.match(
  layer,
  /prefs\.style === "image" &&\n\s*\(prefs\.enabled \|\|/,
  "image bytes are not fetched while the Blaze style is selected",
);
```

- [ ] **Step 2: Run to verify failure**

```bash
node --experimental-strip-types src/lib/cave-backdrop-blaze.test.ts
```
Expected: FAIL on the first layer pin.

- [ ] **Step 3: Implement in `src/components/cave-backdrop-layer.tsx`**

3a. Add the import after the existing `@/lib/cave-backdrop` import block:

```tsx
import { CaveBackdropBlaze } from "@/components/cave-backdrop-blaze";
```

3b. Replace the `wantsAppImage` assignment (keep the existing comment above it, and append one clause note):

```tsx
  // The app image is wanted when the app backdrop is on, or for any familiar
  // explicitly switched on — even one whose own image is showing, so the
  // fallback stays warm. Deliberately keyed on prefs alone (not the async
  // familiarUrl): gating on image absence would churn the fetch on every
  // mount and blank-flash when a familiar image is removed. With the Blaze
  // style selected the layer never paints the app image, so its bytes are
  // not fetched at all (cave-99s9).
  const wantsAppImage =
    prefs.style === "image" &&
    (prefs.enabled || (familiarId ? prefs.familiars[familiarId] === true : false));
```

3c. After the `effectiveEnabled` line, add:

```tsx
  // Blaze fills the layer app-wide; a familiar's own image (an explicit
  // per-familiar opt-in) still takes the layer over while it is showing.
  const blazeShowing =
    effectiveEnabled && prefs.style === "blaze" && !familiarImageShowing;
```

3d. Update the apply effect — Blaze joins the familiar-image branch in suppressing the sampled image accent (the theme accent must *drive* the fire, not be driven), and clears the image custom property:

```tsx
  useEffect(() => {
    const effectivePrefs =
      familiarImageShowing || blazeShowing
        ? { ...prefs, enabled: true, matchAccent: false, accentSeed: null }
        : { ...prefs, enabled: effectiveEnabled };
    applyBackdropToDocument(effectivePrefs, blazeShowing ? null : effectiveUrl);
    const observer = new MutationObserver(() => applyBackdropToDocument(effectivePrefs, undefined));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-mode", "data-theme"] });
    return () => observer.disconnect();
  }, [prefs, familiarImageShowing, blazeShowing, effectiveUrl, effectiveEnabled]);
```

3e. Replace the final return:

```tsx
  if (!effectiveEnabled) return null;
  return (
    <div
      className="cave-backdrop-layer"
      data-on={active ? "true" : "false"}
      data-backdrop-style={blazeShowing ? "blaze" : "image"}
      aria-hidden
    >
      {blazeShowing && active ? <CaveBackdropBlaze /> : null}
    </div>
  );
```

- [ ] **Step 4: Run tests to verify pass** — the new pins plus the pre-existing layer pins in `backdrop-scrim.test.ts` (which pin `effectiveUrl`, `effectiveEnabled`, and the `matchAccent: false, accentSeed: null` suppression — all still present):

```bash
node --experimental-strip-types src/lib/cave-backdrop-blaze.test.ts \
  && node --experimental-strip-types src/components/backdrop-scrim.test.ts \
  && pnpm exec eslint src/components/cave-backdrop-layer.tsx --max-warnings=0
```
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/cave-backdrop-layer.tsx src/lib/cave-backdrop-blaze.test.ts
git commit -S -m "Backdrop layer: render Blaze style behind Home/Chat (cave-99s9)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 6: Backdrop CSS for the Blaze style (TDD)

**Files:**
- Modify: `src/styles/backdrop.css`
- Test: `src/lib/cave-backdrop-blaze.test.ts` (extend)

- [ ] **Step 1: Write the failing pins** — append to `src/lib/cave-backdrop-blaze.test.ts` (before the final `console.log`):

```ts
// ── CSS: fill + reduced-motion hide ──────────────────────────────────────────
const css = readFileSync(new URL("../styles/backdrop.css", import.meta.url), "utf8");
assert.match(
  css,
  /\.cave-backdrop-blaze \{\n  position: absolute;\n  inset: 0;\n\}/,
  "the Blaze visual fills the fixed layer",
);
assert.match(
  css,
  /@media \(prefers-reduced-motion: reduce\) \{\n  html\[data-backdrop\] \.cave-backdrop-layer\[data-backdrop-style="blaze"\] \{\n    display: none;\n  \}\n\}/,
  "reduced motion hides the animated style entirely (no frozen fire frame)",
);
```

- [ ] **Step 2: Run to verify failure**

```bash
node --experimental-strip-types src/lib/cave-backdrop-blaze.test.ts
```
Expected: FAIL on the first CSS pin.

- [ ] **Step 3: Implement** — in `src/styles/backdrop.css`, insert after the readability-floor `::after` block (after line ~40, before the `html[data-backdrop-on] .shell-root` section):

```css
/* ── Blaze style (cave-99s9) ─────────────────────────────────────────────────
   The animated option: the vendored Canvas UI Blaze renders inside the same
   fixed layer the image uses, so enablement, the intensity opacity, the
   scrim above, and the glass contracts below all apply unchanged. The canvas
   is decorative and inert (aria-hidden; the layer already ignores pointers). */
.cave-backdrop-blaze {
  position: absolute;
  inset: 0;
}

.cave-backdrop-blaze__fill {
  width: 100%;
  height: 100%;
}

/* No frozen fire frame: reduced motion drops the animated style entirely
   (the component also skips mounting — this rule is the CSS belt to that
   suspender). The static image style is unaffected. */
@media (prefers-reduced-motion: reduce) {
  html[data-backdrop] .cave-backdrop-layer[data-backdrop-style="blaze"] {
    display: none;
  }
}
```

- [ ] **Step 4: Run tests to verify pass** (plus the CSS codemod stays a no-op — the drift ratchet requires it):

```bash
node --experimental-strip-types src/lib/cave-backdrop-blaze.test.ts \
  && node --experimental-strip-types src/components/backdrop-scrim.test.ts \
  && node --experimental-strip-types src/lib/design-token-drift.test.ts
```
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/styles/backdrop.css src/lib/cave-backdrop-blaze.test.ts
git commit -S -m "Backdrop CSS: Blaze fill + reduced-motion hide rule (cave-99s9)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 7: Settings — backdrop style picker (TDD)

**Files:**
- Modify: `src/components/backdrop-settings.tsx`
- Test: `src/lib/cave-backdrop-blaze.test.ts` (extend)

- [ ] **Step 1: Write the failing pins** — append to `src/lib/cave-backdrop-blaze.test.ts` (before the final `console.log`):

```ts
// ── Settings: the style picker and its enablement rules ──────────────────────
const settings = readFileSync(new URL("../components/backdrop-settings.tsx", import.meta.url), "utf8");
assert.match(settings, /ariaLabel="Backdrop style"/, "the style picker is a labeled segmented control");
assert.match(
  settings,
  /writeBackdropPrefs\(\{ style, enabled: true \}\);/,
  "choosing Blaze turns the backdrop on without needing an image",
);
assert.match(
  settings,
  /writeBackdropPrefs\(\{ style, enabled: previewUrl !== null \}\);/,
  "switching to Image stays on only when a stored image exists",
);
assert.match(
  settings,
  /\{prefs\.style === "image" \? \(/,
  "the image chooser and accent-match rows are image-style-only",
);
```

- [ ] **Step 2: Run to verify failure**

```bash
node --experimental-strip-types src/lib/cave-backdrop-blaze.test.ts
```
Expected: FAIL on `ariaLabel="Backdrop style"`.

- [ ] **Step 3: Implement in `src/components/backdrop-settings.tsx`**

3a. Add imports:

```tsx
import { Segmented } from "@/components/ui/settings-controls";
import { BACKDROP_STYLES, type CaveBackdropStyle } from "@/lib/preferences-schema";
```

3b. Add module-level label maps (below the imports, above the component):

```tsx
const STYLE_LABELS: Record<CaveBackdropStyle, string> = { image: "Image", blaze: "Blaze" };
const STYLE_TITLES: Record<CaveBackdropStyle, string> = {
  image: "A picture you choose shows behind Home and Chat",
  blaze: "Animated embers and smoke, tinted to your theme accent",
};
```

3c. Add the handler inside `BackdropSettings` (after `clearBackdrop`):

```tsx
  function setStyle(style: CaveBackdropStyle) {
    if (style === prefs.style) return;
    if (style === "blaze") {
      writeBackdropPrefs({ style, enabled: true });
      announce("Backdrop set to Blaze — embers and smoke follow your theme accent.");
      return;
    }
    writeBackdropPrefs({ style, enabled: previewUrl !== null });
    announce(
      previewUrl
        ? "Backdrop set to your image."
        : "Backdrop style set to Image — choose an image to turn it on.",
    );
  }
```

3d. Restructure the JSX. The returned card becomes: a header row (title + description + segmented picker), then the image row *only* for the image style, then the enabled block with Intensity always and Match-accent image-only. Full replacement of the `return (...)` body:

```tsx
  return (
    <div className="flex flex-col gap-3 px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="text-[length:var(--text-base)] font-medium text-[var(--text-primary)]">Backdrop</p>
          <p className="text-[length:var(--text-xs)] leading-relaxed text-[var(--text-muted)]">
            Shows behind Home and Chat — a picture of yours, or animated Blaze embers tinted to
            your theme.
          </p>
        </div>
        <Segmented
          ariaLabel="Backdrop style"
          options={BACKDROP_STYLES}
          value={prefs.style}
          onChange={setStyle}
          getLabel={(option) => STYLE_LABELS[option]}
          getTitle={(option) => STYLE_TITLES[option]}
        />
      </div>

      {prefs.style === "image" ? (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            aria-label={previewUrl ? "Replace backdrop image" : "Choose backdrop image"}
            className="focus-ring grid h-20 w-32 shrink-0 place-items-center overflow-hidden rounded-[var(--radius-card)] border border-dashed border-[var(--border-strong)] bg-[var(--bg-base)]/40 text-[length:var(--text-xs)] text-[var(--text-muted)] hover:border-[var(--accent-presence)]/60"
          >
            {previewUrl ? (
              <img src={previewUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <span>{busy ? "Reading…" : "Choose image"}</span>
            )}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/avif,image/heic,image/heif"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0] ?? null;
              if (file) void pickImage(file);
              e.target.value = "";
            }}
          />
          <p className="min-w-0 flex-1 text-[length:var(--text-xs)] leading-relaxed text-[var(--text-muted)]">
            The accent tints to the image’s dominant color, kept readable against your theme.
          </p>
          <div className="flex items-center gap-2">
            {previewUrl ? (
              <Button
                size="xs"
                variant="ghost"
                leadingIcon="ph:x"
                onClick={() => clearConfirm.trigger(() => void clearBackdrop())}
                disabled={busy}
              >
                {clearConfirm.armed ? "Really clear?" : "Clear"}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {prefs.enabled ? (
        <div className="flex flex-col gap-3 border-l border-[var(--border-hairline)] pl-3">
          <label className="flex items-center gap-3 text-[length:var(--text-sm)] text-[var(--text-secondary)]">
            <span className="w-16 shrink-0">Intensity</span>
            <input
              type="range"
              min={10}
              max={80}
              value={prefs.intensity}
              onChange={(e) => writeBackdropPrefs({ intensity: Number(e.target.value) })}
              className="cave-backdrop-intensity min-w-0 flex-1"
              aria-label="Backdrop intensity"
            />
            <span className="w-8 text-right font-mono text-[length:var(--text-xs)] text-[var(--text-muted)]">
              {prefs.intensity}
            </span>
          </label>
          {prefs.style === "image" ? (
            <label className="flex items-center justify-between gap-3 text-[length:var(--text-sm)] text-[var(--text-secondary)]">
              <span>Match accent to the image</span>
              <button
                type="button"
                role="switch"
                aria-checked={prefs.matchAccent}
                aria-label="Match accent to the image"
                onClick={() => writeBackdropPrefs({ matchAccent: !prefs.matchAccent })}
                className={`focus-ring rounded-[var(--radius-control)] border px-3 py-1 text-[length:var(--text-sm)] transition-colors ${
                  prefs.matchAccent
                    ? "border-[var(--accent-presence)] bg-[var(--accent-presence)]/15 text-[var(--text-primary)]"
                    : "border-[var(--border-hairline)] text-[var(--text-secondary)]"
                }`}
              >
                {prefs.matchAccent ? "On" : "Off"}
              </button>
            </label>
          ) : null}
        </div>
      ) : null}
    </div>
  );
```

(The `Backdrop`/description copy moves into the header row; the accent hint moves next to the chooser. The matchAccent switch markup is byte-identical to today's — the existing a11y pin in `a11y-audit-fixes.test.ts` keeps passing.)

- [ ] **Step 4: Run tests to verify pass**

```bash
node --experimental-strip-types src/lib/cave-backdrop-blaze.test.ts \
  && node --experimental-strip-types src/components/a11y-audit-fixes.test.ts \
  && node --experimental-strip-types src/components/settings-appearance.test.ts \
  && pnpm exec eslint src/components/backdrop-settings.tsx --max-warnings=0 \
  && node scripts/codemods/tokenize-tsx-design.mjs --check src/components/backdrop-settings.tsx
```
Expected: all PASS / clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/backdrop-settings.tsx src/lib/cave-backdrop-blaze.test.ts
git commit -S -m "Settings: backdrop style picker (Image | Blaze) (cave-99s9)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 8: Full gates, PR, merge, cleanup

**Files:** none new (verification, delivery)

- [ ] **Step 1: Full local gates**

```bash
cd /Users/<someone>/Documents/GitHub/OpenCoven/coven-cave/.worktrees/blaze-backdrop
pnpm lint && pnpm typecheck && node scripts/check-tests-wired.mjs
```
Expected: all clean.

- [ ] **Step 2: Targeted test sweep** (every touched suite file):

```bash
for t in src/lib/preferences-schema.test.ts src/lib/server/preferences-store.test.ts \
         src/lib/cave-backdrop.test.ts src/lib/cave-backdrop-blaze.test.ts \
         src/components/backdrop-scrim.test.ts src/components/a11y-audit-fixes.test.ts \
         src/components/settings-appearance.test.ts src/lib/design-token-drift.test.ts \
         src/lib/app-preferences.test.ts src/components/theme-script.test.ts; do
  node --experimental-strip-types "$t" || exit 1
done
```
Expected: every file passes. (`app-preferences.test.ts` and `theme-script.test.ts` cover the legacy-mirror consumers of `cave:backdrop:v1`.)

- [ ] **Step 3: Production build (CI parity — Frontend build is a required check)**

```bash
pnpm build
```
Expected: build + bundle budgets pass; the Blaze chunk is lazy so no page budget grows.

- [ ] **Step 4: Optional visual QA** — for a human-in-the-loop look, run `bash scripts/dev-app.sh` from the worktree in a foreground terminal, open Settings → Appearance → Backdrop, pick **Blaze**, visit Home and a Chat, flip a few themes and dark/light, check the fire retints; verify Reduce Motion (macOS setting) hides it.

- [ ] **Step 5: Push and open the PR**

```bash
git push -u origin blaze-backdrop
gh pr create --base main --head blaze-backdrop \
  --title "Backdrop: Blaze animated style (Canvas UI) behind Home/Chat" \
  --body "Adds a style picker to Settings → Appearance → Backdrop: **Image** (existing) or **Blaze** — the vendored zero-dependency Canvas UI fire/sparks/smoke WebGL effect (https://canvasui.dev/docs/components/blaze), rendered in the existing fixed backdrop layer.

- New \`appearance.backdrop.style\` preference (\"image\" | \"blaze\"), strict-validated, legacy-mirrored
- Colors derive from the live \`--accent-presence\` (smoke = accent, sparks 70% toward neutral) with the Canvas UI playground values as fallback; retints live across all 21 themes × 2 modes
- Exact playground options: height .75, distortion .5, distortionScale 1, speed .5, sparks .75, sparkDensity .75, sparkSize .75, layers 5, smoke 1, glow .5
- Reduced motion: layer hidden AND component unmounted (no frozen frame, no GPU); no WebGL2 → quietly empty
- Existing intensity/scrim/glass/per-familiar-override machinery reused unchanged; vendored file passes the design gates via the repo codemod
- Bead: cave-99s9 · Spec: docs/superpowers/specs/2026-07-23-blaze-backdrop-design.md (local)"
```

- [ ] **Step 6: Record evidence on the bead**

```bash
bd update cave-99s9 --notes "PR #<n> open; branch blaze-backdrop; local gates: lint/typecheck/targeted tests/build green. Awaiting required checks."
```

- [ ] **Step 7: Wait for required checks, then squash-merge**

```bash
gh pr checks <n> --watch
gh pr merge <n> --squash --delete-branch
```
All four required checks (Frontend build, Rust check, CodeQL, E2E (Playwright)) must be green. Squash message: keep the PR title + `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`.

- [ ] **Step 8: Local cleanup (worktree + branch)**

```bash
cd /Users/<someone>/Documents/GitHub/OpenCoven/coven-cave
git worktree remove .worktrees/blaze-backdrop
git branch -D blaze-backdrop
git worktree list
```

- [ ] **Step 9: Discard the staged shadcn experiment in the primary checkout (user-approved)** — ONLY these paths; `src-tauri/src/sidecar_discovery.rs` and `.beads/*` belong to other work and stay:

```bash
cd /Users/<someone>/Documents/GitHub/OpenCoven/coven-cave
git restore --staged --worktree components.json __shoot2.mjs src/app/globals.css src/app/layout.tsx src/lib/utils.ts package.json pnpm-lock.yaml src/components/canvasui/Blaze.tsx 2>/dev/null || true
rm -f components.json __shoot2.mjs
git status --short   # confirm only unrelated files remain
pnpm install         # prune the experiment's packages per the restored lockfile
```
Note: `git restore` of an added-then-restored path may leave the untracked file behind — hence the explicit `rm -f` for the two new files. If `src/components/canvasui/Blaze.tsx` reports a conflict with the merged version, `git checkout origin/main -- src/components/canvasui/Blaze.tsx` after `git pull`.

- [ ] **Step 10: Sync and close the bead**

```bash
git pull --rebase
bd close cave-99s9
bd dolt push || echo "report blocked sync"
```

---

## Self-review notes (spec coverage)

- Spec §1 vendored component → Task 1. §2 schema → Task 2. §3 client store → Task 3. §4 layer + colors + component → Tasks 4–5. §5 CSS → Task 6. §6 settings → Task 7. Error handling (WebGL null, parse fallback, reduced motion, offscreen, strict validation) → Tasks 4–6 code + Task 2 tests. Testing section → each task's test steps + Task 8 sweep. Delivery §1/§2 → Task 8. Out-of-scope items: no tasks (correct).
- Type names consistent: `CaveBackdropStyle` (schema, store, settings), `BLAZE_OPTIONS` / `blazeColorsFromAccent` / `BLAZE_FALLBACK_*` (colors module, component, tests), `blazeShowing` (layer + pins), `CaveBackdropBlaze` (component + layer).
