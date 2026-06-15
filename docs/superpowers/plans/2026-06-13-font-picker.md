# Font Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Settings → Appearance font picker that lets the user choose a sans (UI) and mono (code) family from the bundled catalog, applied live and persisted across reloads.

**Architecture:** A `font-storage` lib persists the chosen catalog `id` per slot in `localStorage` and applies it by overriding `--font-sans`/`--font-mono` on `<html>`. The 5 CSS files that read `--font-geist-*` directly are refactored to read those aliases (which default to Geist in `:root`). The no-FOUC boot script applies the saved fonts before paint. A `<FontSettings>` component drives the selection.

**Tech Stack:** Next.js (App Router), React, TypeScript, `next/font/google` (already wired in `src/app/fonts.ts`), `node:test` via `node --experimental-strip-types`.

**Spec:** `docs/superpowers/specs/2026-06-13-font-picker-design.md`

**Sign every commit with `-S`** (repo policy). Run tests with `node --experimental-strip-types --test <file>`. CI runs `pnpm test:app`.

**Key fact the plan relies on:** for every non-default catalog id the cssVar equals `--font-<id>` (e.g. `inter` → `--font-inter`). Only the two defaults break this (`geist` → `--font-geist-sans`, `geist-mono` → `--font-geist-mono`), and the default case is handled by *removing* the override. This lets the boot script derive the stack without importing the catalog.

---

## Task 1: `font-storage.ts` — persistence + apply

**Files:**
- Create: `src/lib/font-storage.ts`
- Test: `src/lib/font-storage.test.ts`

- [ ] **Step 1: Write the failing test**

`src/lib/font-storage.test.ts`:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import { fontStack, fontOptionById, DEFAULT_FONT_ID } from "./font-catalog.ts";
import {
  FONT_SANS_KEY,
  FONT_MONO_KEY,
  readFontPref,
  writeFontPref,
  applyFont,
} from "./font-storage.ts";

function setupDom() {
  const store = new Map();
  const props = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
  };
  globalThis.document = {
    documentElement: {
      style: {
        setProperty: (k, v) => props.set(k, v),
        removeProperty: (k) => props.delete(k),
      },
    },
  };
  return { store, props };
}

test("write then read round-trips a valid id", () => {
  setupDom();
  writeFontPref("sans", "inter");
  assert.equal(readFontPref("sans"), "inter");
  assert.equal(globalThis.window.localStorage.getItem(FONT_SANS_KEY), "inter");
});

test("unknown/garbage id reads back as the slot default", () => {
  const { store } = setupDom();
  store.set(FONT_SANS_KEY, "not-a-font");
  assert.equal(readFontPref("sans"), DEFAULT_FONT_ID.sans);
});

test("a mono id stored under the sans key falls back to default", () => {
  const { store } = setupDom();
  store.set(FONT_SANS_KEY, "fira-code"); // wrong slot
  assert.equal(readFontPref("sans"), DEFAULT_FONT_ID.sans);
});

test("applyFont(non-default) sets the var to the fontStack", () => {
  const { props } = setupDom();
  applyFont("sans", "inter");
  assert.equal(props.get("--font-sans"), fontStack(fontOptionById("inter")));
});

test("applyFont(default) removes the override", () => {
  const { props } = setupDom();
  applyFont("sans", "inter");
  applyFont("sans", DEFAULT_FONT_ID.sans);
  assert.equal(props.has("--font-sans"), false);
});

test("mono slot uses the mono key and --font-mono var", () => {
  const { props } = setupDom();
  writeFontPref("mono", "jetbrains-mono");
  applyFont("mono", "jetbrains-mono");
  assert.equal(readFontPref("mono"), "jetbrains-mono");
  assert.equal(props.get("--font-mono"), fontStack(fontOptionById("jetbrains-mono")));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test src/lib/font-storage.test.ts`
Expected: FAIL — `Cannot find module './font-storage.ts'`.

- [ ] **Step 3: Write minimal implementation**

`src/lib/font-storage.ts`:

```ts
/**
 * Persistence + application for the font picker.
 *
 * Stores a catalog id per slot in localStorage and applies the selection by
 * overriding the canonical --font-sans / --font-mono vars on <html>. The
 * default id removes the override so the :root alias (Geist) takes over.
 *
 * NOTE: the no-FOUC boot script in src/components/theme-script.tsx applies the
 * same vars before paint. It cannot import this module (it runs as an inline
 * string before module code resolves), so it derives the stack itself — keep
 * the key strings and the stack shape in sync with this file.
 */
import {
  DEFAULT_FONT_ID,
  fontOptionById,
  fontStack,
  type FontSlot,
} from "./font-catalog";

export const FONT_SANS_KEY = "cave:font:sans";
export const FONT_MONO_KEY = "cave:font:mono";

function keyFor(slot: FontSlot): string {
  return slot === "sans" ? FONT_SANS_KEY : FONT_MONO_KEY;
}

function varFor(slot: FontSlot): string {
  return slot === "sans" ? "--font-sans" : "--font-mono";
}

/** Stored id for the slot, validated against the catalog. Missing, unknown, or
 *  wrong-slot values fall back to the slot default. Never throws. */
export function readFontPref(slot: FontSlot): string {
  if (typeof window === "undefined") return DEFAULT_FONT_ID[slot];
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(keyFor(slot));
  } catch {
    /* private mode / disabled storage — ignore */
  }
  if (raw) {
    const opt = fontOptionById(raw);
    if (opt && opt.slot === slot) return raw;
  }
  return DEFAULT_FONT_ID[slot];
}

export function writeFontPref(slot: FontSlot, id: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(keyFor(slot), id);
  } catch {
    /* ignore */
  }
}

/** Point the slot's CSS var at the chosen family's stack. The default id (or an
 *  unknown id) removes the override so the :root Geist alias applies. */
export function applyFont(slot: FontSlot, id: string): void {
  if (typeof document === "undefined") return;
  const cssVar = varFor(slot);
  const root = document.documentElement;
  const opt = fontOptionById(id);
  if (id === DEFAULT_FONT_ID[slot] || !opt || opt.slot !== slot) {
    root.style.removeProperty(cssVar);
    return;
  }
  root.style.setProperty(cssVar, fontStack(opt));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test src/lib/font-storage.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/font-storage.ts src/lib/font-storage.test.ts
git commit -S -m "feat(typography): font-storage — persist + apply font selection"
```

---

## Task 2: CSS refactor to canonical vars + completeness test

**Files:**
- Modify: `src/app/globals.css` (lines 362, 728, 802, 1830, 2255, 3713, 3854, 3941 — do NOT touch the `:root` defs at 303–304)
- Modify: `src/styles/home-composer.css` (431, 446), `src/styles/board.css` (351), `src/styles/cave-chat.css` (1369, 1550), `src/styles/sidebar-minimal.css` (756)
- Test: `src/lib/font-css-vars.test.ts`

- [ ] **Step 1: Write the failing completeness test**

`src/lib/font-css-vars.test.ts`:

```ts
// @ts-nocheck
// The app must read --font-sans / --font-mono (which default to Geist in
// :root) so the font picker can override them. This fails if any of the five
// CSS files still reads --font-geist-* directly, except the :root alias defs.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const FILES = [
  "../app/globals.css",
  "../styles/home-composer.css",
  "../styles/board.css",
  "../styles/cave-chat.css",
  "../styles/sidebar-minimal.css",
];

// The two intentional references that define the defaults.
const ALIAS_DEF = /--font-(sans|mono):\s*var\(--font-geist-(sans|mono)\)/;

for (const rel of FILES) {
  const src = readFileSync(new URL(rel, import.meta.url), "utf8");
  src.split("\n").forEach((line, i) => {
    if (ALIAS_DEF.test(line)) return;
    assert.doesNotMatch(
      line,
      /var\(--font-geist-(sans|mono)\)/,
      `${rel}:${i + 1} reads --font-geist-* directly; use var(--font-sans|mono)`,
    );
  });
}

// And the :root defaults must still exist in globals.css.
const globals = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
assert.match(globals, /--font-sans:\s*var\(--font-geist-sans\)/, ":root --font-sans default must remain");
assert.match(globals, /--font-mono:\s*var\(--font-geist-mono\)/, ":root --font-mono default must remain");

console.log("font-css-vars.test.ts OK");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test src/lib/font-css-vars.test.ts`
Expected: FAIL — first assertion trips on a direct `var(--font-geist-mono)` read.

- [ ] **Step 3: Apply the refactor**

Replace all direct reads, then restore the `:root` alias definitions the blanket replace corrupted into self-references:

```bash
perl -0pi -e 's/var\(--font-geist-sans\)/var(--font-sans)/g; s/var\(--font-geist-mono\)/var(--font-mono)/g' \
  src/app/globals.css src/styles/home-composer.css src/styles/board.css src/styles/cave-chat.css src/styles/sidebar-minimal.css

# Restore the two :root default definitions (these MUST point at the raw vars).
perl -0pi -e 's/--font-sans:\s*var\(--font-sans\)/--font-sans: var(--font-geist-sans)/; s/--font-mono:\s*var\(--font-mono\)/--font-mono: var(--font-geist-mono)/' \
  src/app/globals.css
```

- [ ] **Step 4: Verify the refactor — test passes + no stray vars**

```bash
node --experimental-strip-types --test src/lib/font-css-vars.test.ts
# Belt-and-suspenders: only the two :root defs should remain
grep -rn -- "var(--font-geist-sans)\|var(--font-geist-mono)" src/app/globals.css src/styles/home-composer.css src/styles/board.css src/styles/cave-chat.css src/styles/sidebar-minimal.css
```
Expected: test PASS; grep prints exactly the two lines in `globals.css` (`--font-sans:` and `--font-mono:`).

- [ ] **Step 5: Commit**

```bash
git add src/app/globals.css src/styles/home-composer.css src/styles/board.css src/styles/cave-chat.css src/styles/sidebar-minimal.css src/lib/font-css-vars.test.ts
git commit -S -m "refactor(typography): read --font-sans/--font-mono aliases app-wide"
```

---

## Task 3: No-FOUC boot script applies saved fonts

**Files:**
- Modify: `src/components/theme-script.tsx` (extend the `THEME_SCRIPT` string body)
- Test: `src/components/font-boot.test.ts`

Background: `theme-script.tsx` is an inline `<script>` string run before paint. It cannot import, so it derives the stack itself. For non-default ids the cssVar is always `--font-<id>`, and the fallback chains are the two catalog constants (`SANS_FALLBACK`, `MONO_FALLBACK`) — inline them verbatim. Defaults are skipped (the `:root` alias already provides Geist). A kebab-case regex guards against injected localStorage values; an unknown-but-kebab id harmlessly resolves to an undefined var and falls back.

- [ ] **Step 1: Write the failing test**

`src/components/font-boot.test.ts`:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SANS_FALLBACK, MONO_FALLBACK } from "../lib/font-catalog.ts";

const src = readFileSync(new URL("./theme-script.tsx", import.meta.url), "utf8");

// Reads both font keys.
assert.match(src, /cave:font:sans/, "boot reads cave:font:sans");
assert.match(src, /cave:font:mono/, "boot reads cave:font:mono");

// Skips the defaults (handled by the :root alias).
assert.match(src, /"geist"/, "boot skips the sans default");
assert.match(src, /"geist-mono"/, "boot skips the mono default");

// Sets the canonical vars.
assert.match(src, /setProperty\(\s*["']--font-sans["']/, "boot sets --font-sans");
assert.match(src, /setProperty\(\s*["']--font-mono["']/, "boot sets --font-mono");

// Validates id shape (no CSS injection via localStorage).
assert.match(src, /\^\[a-z0-9-\]\+\$/, "boot validates id is kebab-case");

// Inlined fallbacks match the catalog constants verbatim (sync guard).
assert.ok(src.includes(SANS_FALLBACK), "inlined sans fallback matches catalog SANS_FALLBACK");
assert.ok(src.includes(MONO_FALLBACK), "inlined mono fallback matches catalog MONO_FALLBACK");

console.log("font-boot.test.ts OK");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test src/components/font-boot.test.ts`
Expected: FAIL — `cave:font:sans` not found in the script.

- [ ] **Step 3: Extend the boot script**

In `src/components/theme-script.tsx`, inside the `THEME_SCRIPT` template (after the existing theme/mode/custom block, still inside the `try`, before the closing `})();`), add:

```js
    // ── Fonts ── apply saved non-default families before paint (no flash).
    // Inlined from src/lib/font-catalog.ts (SANS_FALLBACK / MONO_FALLBACK) and
    // src/lib/font-storage.ts (keys + stack shape) — keep in sync.
    var SANS_FB = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    var MONO_FB = 'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';
    function applyFontVar(key, cssVar, fallback, deflt) {
      var id = localStorage.getItem(key);
      if (!id || id === deflt || !/^[a-z0-9-]+$/.test(id)) return;
      try { html.style.setProperty(cssVar, "var(--font-" + id + "), " + fallback); } catch (e) {}
    }
    applyFontVar("cave:font:sans", "--font-sans", SANS_FB, "geist");
    applyFontVar("cave:font:mono", "--font-mono", MONO_FB, "geist-mono");
```

Also extend the file's top doc comment to note the two new keys + inlined fallbacks are duplicated from the catalog/storage and must stay in sync.

> The `SANS_FB` / `MONO_FB` string literals must match `SANS_FALLBACK` / `MONO_FALLBACK` in `src/lib/font-catalog.ts` byte-for-byte — the test asserts this. If the catalog constants ever change, update both.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test src/components/font-boot.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/theme-script.tsx src/components/font-boot.test.ts
git commit -S -m "feat(typography): apply saved fonts in the no-FOUC boot script"
```

---

## Task 4: `<FontSettings>` component + wire into Appearance

**Files:**
- Create: `src/components/settings-fonts.tsx`
- Modify: `src/components/settings-shell.tsx` (import `FontSettings`; render inside `AppearanceSection`)
- Test: `src/components/settings-fonts.test.ts`

- [ ] **Step 1: Write the failing source test**

`src/components/settings-fonts.test.ts`:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./settings-fonts.tsx", import.meta.url), "utf8");
const shell = readFileSync(new URL("./settings-shell.tsx", import.meta.url), "utf8");

// Sources its options from the catalog, split by slot.
assert.match(src, /FONT_OPTIONS/, "FontSettings reads FONT_OPTIONS");
assert.match(src, /slot === "sans"/, "filters the sans slot");
assert.match(src, /slot === "mono"/, "filters the mono slot");

// A <select> per slot, wired to storage on change.
assert.match(src, /<select/, "renders selects");
assert.match(src, /writeFontPref/, "persists the choice");
assert.match(src, /applyFont/, "applies the choice live");

// Live preview uses the catalog stack.
assert.match(src, /fontStack\(/, "preview rendered with fontStack");

// Single reset to the catalog defaults.
assert.match(src, /DEFAULT_FONT_ID/, "reset targets the defaults");
assert.match(src, /Reset/, "exposes a reset control");

// Wired into the Appearance section.
assert.match(shell, /import \{ FontSettings \} from "\.\/settings-fonts"/, "shell imports FontSettings");
assert.match(shell, /<FontSettings\s*\/>/, "AppearanceSection renders <FontSettings />");

console.log("settings-fonts.test.ts OK");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test src/components/settings-fonts.test.ts`
Expected: FAIL — `Cannot ... settings-fonts.tsx` / no match.

- [ ] **Step 3: Create the component**

`src/components/settings-fonts.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import {
  DEFAULT_FONT_ID,
  FONT_OPTIONS,
  fontOptionById,
  fontStack,
  type FontSlot,
} from "@/lib/font-catalog";
import { applyFont, readFontPref, writeFontPref } from "@/lib/font-storage";

const SANS_OPTIONS = FONT_OPTIONS.filter((o) => o.slot === "sans");
const MONO_OPTIONS = FONT_OPTIONS.filter((o) => o.slot === "mono");

const PREVIEW: Record<FontSlot, string> = {
  sans: "The quick brown fox jumps over 0123",
  mono: "const x = 42; // 0123",
};

function FontField({
  slot,
  label,
  options,
  value,
  onChange,
}: {
  slot: FontSlot;
  label: string;
  options: typeof FONT_OPTIONS;
  value: string;
  onChange: (id: string) => void;
}) {
  const opt = fontOptionById(value) ?? fontOptionById(DEFAULT_FONT_ID[slot]);
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[12px] font-medium text-[var(--text-secondary)]">{label}</label>
      <select
        className="gh-select"
        style={{ maxWidth: "260px" }}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={`${label} font`}
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      <p
        className="text-[15px] text-[var(--text-primary)] truncate"
        style={{ fontFamily: opt ? fontStack(opt) : undefined }}
      >
        {PREVIEW[slot]}
      </p>
    </div>
  );
}

export function FontSettings() {
  const [sansId, setSansId] = useState<string>(DEFAULT_FONT_ID.sans);
  const [monoId, setMonoId] = useState<string>(DEFAULT_FONT_ID.mono);

  useEffect(() => {
    setSansId(readFontPref("sans"));
    setMonoId(readFontPref("mono"));
  }, []);

  const select = (slot: FontSlot, id: string) => {
    if (slot === "sans") setSansId(id);
    else setMonoId(id);
    writeFontPref(slot, id);
    applyFont(slot, id);
  };

  const reset = () => {
    select("sans", DEFAULT_FONT_ID.sans);
    select("mono", DEFAULT_FONT_ID.mono);
  };

  const isDefault =
    sansId === DEFAULT_FONT_ID.sans && monoId === DEFAULT_FONT_ID.mono;

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">Typography</h3>
        <p className="text-[11px] text-[var(--text-muted)]">
          Choose the interface and code fonts. Changes apply immediately.
        </p>
      </div>
      <div className="flex flex-col gap-4">
        <FontField slot="sans" label="Interface" options={SANS_OPTIONS} value={sansId} onChange={(id) => select("sans", id)} />
        <FontField slot="mono" label="Code &amp; terminal" options={MONO_OPTIONS} value={monoId} onChange={(id) => select("mono", id)} />
      </div>
      <div>
        <button
          type="button"
          onClick={reset}
          disabled={isDefault}
          className="rounded-md border border-[var(--border-hairline)] px-3 py-1.5 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Reset to default
        </button>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Wire it into `AppearanceSection`**

In `src/components/settings-shell.tsx`:

1. Add the import near the other component imports at the top:

```tsx
import { FontSettings } from "./settings-fonts";
```

2. Render it inside `AppearanceSection`'s returned markup, after the theme/mode/scale blocks and before the section closes (place it as the last child of the section's content container):

```tsx
        <FontSettings />
```

(Find the end of `AppearanceSection`'s JSX — add `<FontSettings />` as the final block inside its outermost content wrapper.)

- [ ] **Step 5: Run test to verify it passes**

Run: `node --experimental-strip-types --test src/components/settings-fonts.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck the new/changed files**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -iE "settings-fonts|settings-shell|font-storage" || echo "clean"`
Expected: `clean`.

- [ ] **Step 7: Commit**

```bash
git add src/components/settings-fonts.tsx src/components/settings-shell.tsx src/components/settings-fonts.test.ts
git commit -S -m "feat(typography): font picker UI in Settings → Appearance"
```

---

## Task 5: Full suite + manual e2e verification (pre-PR)

**Files:** none (verification only)

- [ ] **Step 1: Run the whole app test suite**

Run: `pnpm test:app`
Expected: PASS (includes the 4 new test files + the existing `font-settings`/`font-wiring` tests).

- [ ] **Step 2: Build (validates next/font + CSS)**

Run: `pnpm exec next build`
Expected: exit 0.

- [ ] **Step 3: Drive the app (Playwright) — confirm live apply + persistence**

Start a production server from this branch (`pnpm exec next start -p 3200` after the build, or use the running dev server if it serves this branch), then with Playwright:
1. Open `/settings#appearance`, dismiss onboarding (`localStorage["cave:onboarding:dismissed"]="1"`).
2. Select a non-default Interface font (e.g. `Inter`) and Code font (e.g. `JetBrains Mono`).
3. Assert `getComputedStyle(document.body).fontFamily` now leads with the chosen family (not Geist).
4. Reload → assert the selects still show the choices AND `getComputedStyle(document.documentElement).getPropertyValue('--font-sans')` is the Inter stack set before paint (no Geist flash).
5. Click **Reset to default** → assert `--font-sans`/`--font-mono` overrides are gone (`getPropertyValue` empty) and body reads Geist again.
6. Screenshot the Appearance section showing the picker + previews.

Expected: all assertions hold; screenshot shows distinct preview fonts.

- [ ] **Step 4: Clean up + open PR**

Stop the server, remove any temp worktree/scripts. Open the PR with `gh pr create` summarizing the feature and linking the spec; include the build + e2e evidence. Use the worktree-safe, signed flow from this repo's conventions.

---

## Self-Review

**Spec coverage:**
- Location (Appearance) → Task 4. Persistence (localStorage) → Task 1. Apply via `--font-sans/--font-mono` refactor → Tasks 1+2. No-FOUC boot → Task 3. UI (two dropdowns + preview + single reset) → Task 4. Testing (completeness grep, storage unit, FontSettings source, boot, manual e2e) → Tasks 1–5. All covered.

**Placeholder scan:** No TBD/TODO; every code step has complete code; the one "find the end of AppearanceSection" instruction is a locate-and-insert with the exact line to add.

**Type consistency:** `FontSlot`, `FONT_OPTIONS`, `fontStack`, `fontOptionById`, `DEFAULT_FONT_ID` are the real exports from `font-catalog.ts`. Storage exports (`readFontPref`/`writeFontPref`/`applyFont`/`FONT_SANS_KEY`/`FONT_MONO_KEY`) are defined in Task 1 and consumed unchanged in Tasks 4. The `--font-sans`/`--font-mono` var names and the `cave:font:sans`/`cave:font:mono` keys are consistent across Tasks 1, 3, 4. Boot fallbacks are asserted equal to the catalog constants (Task 3 test).

**Scope:** Single cohesive feature, one PR.
