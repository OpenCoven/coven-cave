# Sidepanel Peel-Reveal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the desktop nav is collapsed to its 56px rail, moving the cursor toward the left edge of the detail pane peels the page back (WebGL page-curl) revealing the sidebar beneath — on HTML-in-canvas browsers only; everywhere else stays byte-identical.

**Architecture:** Vendor the Canvas UI `Peel` registry component (exact Blaze precedent: transient shadcn scaffolding, provenance header, design-codemod pass). A new `ShellPeelReveal` wrapper gates on a local HTML-in-canvas probe + `usePrefersReducedMotion`; non-enhanced browsers render a `display: contents` pass-through, enhanced browsers keep `<Peel>` permanently mounted and toggle its geometry options (`reveal`/`zone` → 0) on `active` so the detail tree never re-parents. `shell.tsx` wraps the detail children with `active={navPeekEnabled} under={nav}`; the existing interactive frosted hover-peek is untouched.

**Tech Stack:** Next.js 15 / React 19.2.7 (`inert` boolean prop), vendored zero-dep React+WebGL2 file, repo node source-contract tests (`scripts/run-tests.mjs`), design gates (`pnpm lint`, `pnpm codemod:design`).

**Spec:** `docs/superpowers/specs/2026-07-24-sidepanel-peel-reveal-design.md` (versioned in this repo since cave-8zjr5). **Bead:** cave-3vgd. **Worktree:** `.worktrees/peel-sidepanel-reveal` (branch `peel-sidepanel-reveal`). All commands below run from the worktree root unless stated. Push after every commit (worktree-guard discipline). Commits are signed via the global git config; per `AGENTS.md`, do not add trailers crediting AI tools.

---

## File Structure

- **Create** `src/components/canvasui/Peel.tsx` — vendored registry payload + provenance header + codemod pass. Never hand-edited otherwise.
- **Create** `src/components/shell-peel-reveal.tsx` — the only file that knows about probing, reduced motion, option-zeroing, and context-loss recovery.
- **Create** `src/components/sidepanel-peel-reveal.test.ts` — source-contract test for CSS + wrapper + vendored file + shell wiring.
- **Modify** `src/styles/globals/shell-navigation.css` — one new block after the existing peek styles (~line 146).
- **Modify** `src/components/shell.tsx:880-895` — wrap the detail children.
- **Modify** `scripts/run-tests.mjs` (~line 408) — wire the new test into the `app` suite.

---

### Task 1: Vendor `Peel.tsx`

**Files:**
- Create: `src/components/canvasui/Peel.tsx`
- Transient (never committed): `components.json`

- [ ] **Step 1: Confirm clean worktree state**

Run: `git status --porcelain`
Expected: empty (`docs/superpowers/` is versioned since cave-8zjr5, so specs appear as ordinary tracked files).

- [ ] **Step 2: Write the transient shadcn config**

Create `components.json` at the worktree root (the registry item pins its own target `components/canvasui/Peel.tsx`; the aliases only let the CLI resolve `src/`):

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/app/globals.css",
    "baseColor": "neutral",
    "cssVariables": true
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib",
    "ui": "@/components/ui"
  }
}
```

- [ ] **Step 3: Install the registry component**

Run: `npx -y shadcn@latest add @canvas-ui/peel-react --yes`
Expected output ends with:

```text
✔ Created 1 file:
  - src/components/canvasui/Peel.tsx
```

- [ ] **Step 4: Delete the transient config**

Run: `rm components.json && git status --porcelain`
Expected: only `?? src/components/canvasui/Peel.tsx`.

- [ ] **Step 5: Add the provenance header**

Prepend to `src/components/canvasui/Peel.tsx`, above the existing `"use client";` line (mirrors `Blaze.tsx`):

```tsx
// Vendored from Canvas UI — https://canvasui.dev/docs/components/peel
// Registry: https://canvasui.dev/r/peel-react.json (item "peel-react", shadcn
// namespace @canvas-ui/peel-react), fetched 2026-07-24.
// License: MIT + Commons Clause v1.0, Copyright (c) 2026 David Haz —
// https://github.com/DavidHDev/canvas-ui/blob/main/LICENSE.md (permits use in
// applications/products; forbids selling or redistributing the components themselves).
// Zero runtime dependencies. Local delta: static JSX styles rewritten by
// scripts/codemods/tokenize-tsx-design.mjs (design gate) — re-run it after re-vendoring.
```

- [ ] **Step 6: Run the design auto-fixer**

Run: `pnpm codemod:design`
Expected: it reports rewriting `src/components/canvasui/Peel.tsx` (4 static JSX style objects — under layer, native content wrapper, fallback content wrapper, output canvas — become arbitrary-property utility classes, the same shape as `Blaze.tsx`'s `[position:relative]! [width:100%]!…`). No other files change.

- [ ] **Step 7: Verify the design gates pass**

Run: `pnpm lint`
Expected: `codemod:design:check` reports no drift; ESLint reports 0 problems. (Before the codemod this file failed with 4 × `coven-design/no-static-inline-style` — verified against the raw payload.)

- [ ] **Step 8: Commit and push**

```bash
git add src/components/canvasui/Peel.tsx
git commit -m "feat(shell): vendor Canvas UI Peel registry component (cave-3vgd)

Exact @canvas-ui/peel-react payload plus provenance header and the repo
design codemod pass (static JSX styles -> utility classes), matching the
Blaze vendoring precedent. Transient components.json used for the shadcn
CLI install and deleted; no scaffolding or dependencies adopted."
git push -u origin peel-sidepanel-reveal
```

---

### Task 2: CSS contract (test-first)

**Files:**
- Create: `src/components/sidepanel-peel-reveal.test.ts`
- Modify: `src/styles/globals/shell-navigation.css` (insert after the `@keyframes shellNavPeekIn` block that closes at line 146)

- [ ] **Step 1: Write the failing CSS contract test**

Create `src/components/sidepanel-peel-reveal.test.ts`:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(
  new URL("../styles/globals/shell-navigation.css", import.meta.url),
  "utf8",
);

// Plain mode (no HTML-in-canvas, or reduced motion) must be layout-invisible.
assert.match(
  css,
  /\.shell-peel-reveal--plain,\s*\.shell-peel-reveal--plain > \.shell-peel-scroll \{\s*display: contents;/,
  "plain peel wrappers are display: contents",
);

// Live mode reproduces .shell-detail's scroll contract (the vendored content
// wrapper is overflow: hidden, so scrolling moves inside the sheet).
assert.match(
  css,
  /\.shell-peel-reveal--live \{[\s\S]*?flex: 1;[\s\S]*?min-height: 0;[\s\S]*?position: relative;/,
  "live peel wrapper is a positioned flex child",
);
assert.match(
  css,
  /\.shell-peel-reveal--live \.shell-peel-scroll \{[\s\S]*?height: 100%;[\s\S]*?overflow-y: auto;[\s\S]*?flex-direction: column;/,
  "live peel scroll host reproduces the detail scroll contract",
);

// The revealed under-layer backing uses tokens and matches the 232px peek.
assert.match(
  css,
  /\.shell-peel-under \{[\s\S]*?width: 232px;[\s\S]*?background: var\(--bg-raised\);[\s\S]*?border-right: 1px solid var\(--border-hairline\);/,
  "under layer is an opaque token-backed 232px sheet",
);

console.log("sidepanel-peel-reveal.test.ts: ok");
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/components/sidepanel-peel-reveal.test.ts`
Expected: FAIL — `AssertionError` "plain peel wrappers are display: contents".

- [ ] **Step 3: Add the CSS block**

In `src/styles/globals/shell-navigation.css`, directly after the `@keyframes shellNavPeekIn { … }` block (line 146), insert:

```css
/* Peel-reveal (cave-3vgd): progressive-enhancement page-curl around the
   detail pane, revealing the sidebar when the collapsed rail is armed.
   Plain mode (every browser without experimental HTML-in-canvas, and any
   reduced-motion user) is layout-invisible via display: contents. Live mode
   becomes the box the vendored Peel canvases fill; .shell-peel-scroll
   reproduces .shell-detail's scroll contract because the vendor's content
   wrapper is overflow: hidden. The under sheet is opaque (--bg-raised) and
   232px wide to hand off seamlessly into the .shell-nav--peek overlay. */
.shell-peel-reveal--plain,
.shell-peel-reveal--plain > .shell-peel-scroll {
  display: contents;
}
.shell-peel-reveal--live {
  flex: 1;
  min-height: 0;
  position: relative;
}
.shell-peel-reveal--live .shell-peel-fill {
  height: 100%;
}
.shell-peel-reveal--live .shell-peel-scroll {
  height: 100%;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}
.shell-peel-under {
  position: absolute;
  inset: 0 auto 0 0;
  width: 232px;
  background: var(--bg-raised);
  border-right: 1px solid var(--border-hairline);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/components/sidepanel-peel-reveal.test.ts`
Expected: `sidepanel-peel-reveal.test.ts: ok`

- [ ] **Step 5: Verify the CSS codemod stays a no-op**

Run: `node scripts/codemods/tokenize-css.mjs --check 2>/dev/null || node scripts/codemods/tokenize-css.mjs`
Expected: no rewrite of `shell-navigation.css` (232px is intentionally off-scale — it matches the existing peek overlay width literal at line 132, which the codemod already tolerates; if the check flags it, mirror however line 132's `width: 232px` is annotated).

- [ ] **Step 6: Commit and push**

```bash
git add src/components/sidepanel-peel-reveal.test.ts src/styles/globals/shell-navigation.css
git commit -m "feat(shell): peel-reveal CSS contract (cave-3vgd)"
git push
```

---

### Task 3: `ShellPeelReveal` wrapper (test-first)

**Files:**
- Modify: `src/components/sidepanel-peel-reveal.test.ts` (append)
- Create: `src/components/shell-peel-reveal.tsx`

- [ ] **Step 1: Extend the contract test (failing)**

Append to `src/components/sidepanel-peel-reveal.test.ts`, above the final `console.log` line:

```ts
const wrapper = readFileSync(
  new URL("./shell-peel-reveal.tsx", import.meta.url),
  "utf8",
);
const vendored = readFileSync(
  new URL("./canvasui/Peel.tsx", import.meta.url),
  "utf8",
);

// The ~22 KB vendored WebGL file loads lazily and never renders on the server.
assert.match(
  wrapper,
  /const Peel = dynamic\(\(\) => import\("@\/components\/canvasui\/Peel"\), \{ ssr: false \}\)/,
  "vendored Peel is dynamically imported with ssr: false",
);

// Enhancement gates: local capability probe (false on the server) + reduced motion.
assert.match(
  wrapper,
  /useSyncExternalStore\(emptySubscribe, probeHtmlInCanvas, \(\) => false\)/,
  "capability probe returns false as the server snapshot",
);
assert.match(
  wrapper,
  /const enhanced = supported && !reducedMotion;/,
  "reduced motion disables the enhancement entirely",
);

// Permanent mount: `active` swaps geometry options, never mounts/unmounts Peel,
// so toggling the nav can't re-parent (and remount) the detail tree.
assert.match(
  wrapper,
  /OFF_OPTIONS = \{ reveal: 0, zone: 0 \}/,
  "inactive geometry collapses to zero via options",
);
assert.match(
  wrapper,
  /\{\.\.\.\(active \? LIVE_OPTIONS : OFF_OPTIONS\)\}/,
  "active drives options, not mounting",
);

// The revealed sidebar clone is decorative: hidden from AT and uninteractive.
assert.match(
  wrapper,
  /<div className="shell-peel-under" aria-hidden inert>/,
  "under layer is aria-hidden and inert",
);

// WebGL context loss re-mounts the vendored component, capped (cave-kbh1).
assert.match(wrapper, /key=\{glEpoch\}/, "epoch key re-mounts on context loss");
assert.match(
  wrapper,
  /MAX_CONTEXT_RESTARTS = 3/,
  "context-loss restarts are capped",
);

// Plain path renders the stable display:contents wrappers.
assert.match(
  wrapper,
  /className="shell-peel-reveal shell-peel-reveal--plain"/,
  "plain path renders the contents wrapper",
);

// Vendored file keeps its provenance and stays the module the wrapper imports.
assert.match(
  vendored,
  /Vendored from Canvas UI — https:\/\/canvasui\.dev\/docs\/components\/peel/,
  "vendored Peel carries the provenance header",
);
assert.match(vendored, /peel-react\.json/, "provenance cites the registry item");
assert.match(vendored, /export default Peel;/, "vendored Peel default-exports");
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/components/sidepanel-peel-reveal.test.ts`
Expected: FAIL — `ENOENT … shell-peel-reveal.tsx`.

- [ ] **Step 3: Create the wrapper**

Create `src/components/shell-peel-reveal.tsx`:

```tsx
"use client";

import dynamic from "next/dynamic";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";

// The ~22 KB vendored WebGL file loads only on HTML-in-canvas browsers.
const Peel = dynamic(() => import("@/components/canvasui/Peel"), { ssr: false });

/** Peel geometry while the collapsed rail arms the reveal: 232px of exposed
 *  under-layer matches the hover-peek overlay width; a 120px trigger strip
 *  (vs the vendor's 200 default) keeps casual mouse travel from curling. */
const LIVE_OPTIONS = { reveal: 232, zone: 120 } as const;
/** Nav open: geometry collapses to nothing via the vendor's live setOptions.
 *  The component stays mounted so toggling ⌘B never re-parents (and thereby
 *  remounts) the detail tree. */
const OFF_OPTIONS = { reveal: 0, zone: 0 } as const;

/** How many times a lost WebGL context earns a fresh mount before giving up —
 *  a crashing GPU/driver loop should not thrash remounts forever (mirrors
 *  cave-backdrop-blaze.tsx, cave-kbh1). */
const MAX_CONTEXT_RESTARTS = 3;

type ProbeCanvas = HTMLCanvasElement & { requestPaint?: () => void };
type ProbeContext = CanvasRenderingContext2D & {
  drawElementImage?: (element: Element, x: number, y: number) => void;
};

let htmlInCanvasProbe: boolean | null = null;
/** Local copy of the vendored supportsHtmlInCanvas() so the probe never pulls
 *  the 22 KB module into the bundle. Cached: capability is static per env. */
function probeHtmlInCanvas(): boolean {
  if (htmlInCanvasProbe !== null) return htmlInCanvasProbe;
  if (typeof document === "undefined") return false;
  const canvas = document.createElement("canvas") as ProbeCanvas;
  const ctx = canvas.getContext("2d") as ProbeContext | null;
  htmlInCanvasProbe = Boolean(
    ctx &&
      typeof ctx.drawElementImage === "function" &&
      typeof canvas.requestPaint === "function",
  );
  return htmlInCanvasProbe;
}

const emptySubscribe = () => () => {};

/**
 * Progressive peel-reveal around the shell's detail children (cave-3vgd).
 * When the desktop nav is collapsed to its rail (`active`), browsers with the
 * experimental HTML-in-canvas API peel the page back from the left edge as
 * the cursor approaches, revealing the sidebar (`under`) beneath — a
 * decorative tease that hands off to the interactive .shell-nav--peek
 * overlay. Everywhere else (Tauri WKWebView, Safari, Firefox, stock Chrome,
 * reduced-motion users) this renders display:contents wrappers: zero layout
 * impact, zero GPU or network cost, and the children are never re-parented
 * by `active` changes within a mode.
 */
export function ShellPeelReveal({
  active,
  under,
  children,
}: {
  active: boolean;
  under: ReactNode;
  children: ReactNode;
}) {
  const supported = useSyncExternalStore(emptySubscribe, probeHtmlInCanvas, () => false);
  const reducedMotion = usePrefersReducedMotion();
  const enhanced = supported && !reducedMotion;

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [glEpoch, setGlEpoch] = useState(0);

  // webglcontextlost fires on the vendor's output canvas and does not bubble,
  // but a capture-phase listener on the wrapper still sees it.
  useEffect(() => {
    if (!enhanced) return;
    const node = wrapRef.current;
    if (!node) return;
    const onContextLost = () => {
      setGlEpoch((epoch) => (epoch < MAX_CONTEXT_RESTARTS ? epoch + 1 : epoch));
    };
    node.addEventListener("webglcontextlost", onContextLost, true);
    return () => node.removeEventListener("webglcontextlost", onContextLost, true);
  }, [enhanced]);

  if (!enhanced) {
    return (
      <div className="shell-peel-reveal shell-peel-reveal--plain">
        <div className="shell-peel-scroll">{children}</div>
      </div>
    );
  }
  return (
    <div ref={wrapRef} className="shell-peel-reveal shell-peel-reveal--live">
      <Peel
        key={glEpoch}
        className="shell-peel-fill"
        side="left"
        mode="cursor"
        under={
          active ? (
            <div className="shell-peel-under" aria-hidden inert>
              {under}
            </div>
          ) : undefined
        }
        {...(active ? LIVE_OPTIONS : OFF_OPTIONS)}
      >
        <div className="shell-peel-scroll">{children}</div>
      </Peel>
    </div>
  );
}
```

- [ ] **Step 4: Run the contract test to verify it passes**

Run: `node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/components/sidepanel-peel-reveal.test.ts`
Expected: `sidepanel-peel-reveal.test.ts: ok`

- [ ] **Step 5: Run the design gates**

Run: `pnpm lint`
Expected: pass (no inline styles, no raw px text — the 232/120 are numeric props, not px literals).

- [ ] **Step 6: Commit and push**

```bash
git add src/components/shell-peel-reveal.tsx src/components/sidepanel-peel-reveal.test.ts
git commit -m "feat(shell): ShellPeelReveal progressive-enhancement wrapper (cave-3vgd)"
git push
```

---

### Task 4: Shell wiring (test-first)

**Files:**
- Modify: `src/components/sidepanel-peel-reveal.test.ts` (append)
- Modify: `src/components/shell.tsx:880-895` (+ one import)

- [ ] **Step 1: Extend the contract test (failing)**

Append above the final `console.log` line:

```ts
const shell = readFileSync(new URL("./shell.tsx", import.meta.url), "utf8");

// The peel arms exactly when the interactive hover-peek is armed, and the
// under layer is the same nav node the sidebar aside renders.
assert.match(
  shell,
  /<ShellPeelReveal active=\{navPeekEnabled\} under=\{nav\}>/,
  "shell arms the peel with navPeekEnabled and feeds it the nav",
);
assert.match(
  shell,
  /import \{ ShellPeelReveal \} from "@\/components\/shell-peel-reveal";/,
  "shell imports the wrapper",
);
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/components/sidepanel-peel-reveal.test.ts`
Expected: FAIL — "shell arms the peel with navPeekEnabled and feeds it the nav".

- [ ] **Step 3: Wire the shell**

In `src/components/shell.tsx`, add the import alongside the other `@/components/...` imports near the top of the file:

```tsx
import { ShellPeelReveal } from "@/components/shell-peel-reveal";
```

Then wrap the detail children (currently lines 880–895). Before:

```tsx
        <main className="shell-detail" id="shell-main-content" tabIndex={-1} ref={detailElRef}>
          <UpdateBannerTrigger />
          <OpenCovenToolsBannerTrigger />
          <CaveHomeMigrationBannerTrigger />
          <ShellBannerStrip />
          <DetailSplitHost
            primary={detail}
            secondaryTiles={splitTiles}
            secondarySide={splitSide}
            onClose={() => onCloseSplit?.()}
            onCloseTile={(id) => onCloseSplitTile?.(id)}
            onPromoteTile={(id) => onPromoteSplitTile?.(id)}
            onDropPage={(mode, side) => onDropSplitPage?.(mode, side)}
            enableDrop={!isMobile}
          />
        </main>
```

After:

```tsx
        <main className="shell-detail" id="shell-main-content" tabIndex={-1} ref={detailElRef}>
          {/* Peel-reveal (cave-3vgd): decorative page-curl toward the collapsed
              rail on HTML-in-canvas browsers; display:contents pass-through
              everywhere else. The interactive reveal remains the hover-peek. */}
          <ShellPeelReveal active={navPeekEnabled} under={nav}>
            <UpdateBannerTrigger />
            <OpenCovenToolsBannerTrigger />
            <CaveHomeMigrationBannerTrigger />
            <ShellBannerStrip />
            <DetailSplitHost
              primary={detail}
              secondaryTiles={splitTiles}
              secondarySide={splitSide}
              onClose={() => onCloseSplit?.()}
              onCloseTile={(id) => onCloseSplitTile?.(id)}
              onPromoteTile={(id) => onPromoteSplitTile?.(id)}
              onDropPage={(mode, side) => onDropSplitPage?.(mode, side)}
              enableDrop={!isMobile}
            />
          </ShellPeelReveal>
        </main>
```

(There is exactly one `navPeekEnabled` in scope — the existing derivation at line 388: `navPolicy === "remembered" && !isMobile && !navOpen`. Do not touch the peek state, handlers, or classes.)

- [ ] **Step 4: Run the contract test to verify it passes**

Run: `node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/components/sidepanel-peel-reveal.test.ts`
Expected: `sidepanel-peel-reveal.test.ts: ok`

- [ ] **Step 5: Verify the neighboring shell contracts still hold**

Run:

```bash
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/components/sidepanel-nav-peek.test.ts
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/components/shell-left-panels-fit.test.ts
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/components/shell-edge-rails.test.ts
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/components/shell-nav-memory.test.ts
```

Expected: each prints `…: ok`. If one asserts on the exact `<main className="shell-detail">…` children shape, read its assertion and adjust only that regex expectation — the peek/nav behavior itself must not change.

- [ ] **Step 6: Commit and push**

```bash
git add src/components/shell.tsx src/components/sidepanel-peel-reveal.test.ts
git commit -m "feat(shell): peel detail pane toward the collapsed rail on hover (cave-3vgd)"
git push
```

---

### Task 5: Wire into CI suites and run the full gates

**Files:**
- Modify: `scripts/run-tests.mjs` (~line 408)

- [ ] **Step 1: Register the test in the app suite**

In `scripts/run-tests.mjs`, directly after the line `"src/components/sidepanel-nav-peek.test.ts",` (~line 408), add:

```js
    "src/components/sidepanel-peel-reveal.test.ts",
```

- [ ] **Step 2: Verify the wiring guard**

Run: `pnpm check:tests-wired`
Expected: pass (an unlisted `*.test.ts` fails this in CI).

- [ ] **Step 3: Full design + lint gate**

Run: `pnpm lint`
Expected: pass.

- [ ] **Step 4: App test suite (includes the drift ratchet)**

Run: `node scripts/run-tests.mjs app`
Expected: all tests pass, including `src/lib/design-token-drift.test.ts` (the new CSS block is token-only apart from the peek-matching 232px) and the new contract test.

- [ ] **Step 5: Production build + bundle budget**

Run: `pnpm build && pnpm test:bundle`
Expected: build succeeds (React 19 accepts the `inert` boolean; the dynamic import splits the vendored file into a lazy chunk) and the bundle budget passes — the main bundle gains only the small wrapper; the 22 KB Peel chunk is lazy and never fetched on non-enhanced browsers.

- [ ] **Step 6: Commit and push**

```bash
git add scripts/run-tests.mjs
git commit -m "test(shell): wire sidepanel-peel-reveal contract into the app suite (cave-3vgd)"
git push
```

---

### Task 6: Manual native-path QA (optional), PR, merge, cleanup

- [ ] **Step 1 (optional, needs a flag-enabled Chromium): native path smoke**

```bash
pnpm dev  # note the port
# In a Chromium build with experimental web platform features enabled:
#   open http://127.0.0.1:<port>, collapse the nav (⌘B) on a desktop viewport
```

Verify: cursor approaching the detail pane's left edge curls the page revealing the sidebar beneath; reaching the rail floats the frosted peek over it continuously; opening the nav shows zero residual curl (`reveal/zone` 0); theme swap re-tints the shine; reduced-motion (OS setting) drops the effect entirely. If option-zeroing leaks visually, the spec's named fallback is hiding the output canvas via a `.shell-peel-reveal--live[data-peel-off]` class — implement only if observed.

- [ ] **Step 2: Open the PR**

```bash
gh pr create --base main --head peel-sidepanel-reveal \
  --title "Shell: peel-reveal the sidebar when the collapsed rail is hovered (cave-3vgd)" \
  --body "$(cat <<'EOF'
## Summary
Progressive enhancement: with the desktop nav collapsed to its 56px rail, moving the cursor toward the detail pane's left edge peels the page back (Canvas UI Peel, WebGL page-curl) revealing the sidebar beneath, handing off into the existing interactive frosted hover-peek. Renders only on browsers with Chromium's experimental HTML-in-canvas API; everywhere else — Tauri WKWebView, Safari, Firefox, stock Chrome, and all reduced-motion users — the DOM is a display:contents pass-through with zero layout/GPU/network cost.

- Vendors `@canvas-ui/peel-react` (exact registry payload + provenance header + design-codemod pass; transient `components.json`, no scaffolding adopted — Blaze precedent)
- `ShellPeelReveal` keeps `<Peel>` permanently mounted when enhanced and zeroes `reveal`/`zone` while the nav is open, so ⌘B never re-parents the detail tree; WebGL context loss re-mounts with a capped epoch (cave-kbh1 pattern)
- Revealed under-layer is `aria-hidden` + `inert` (decorative); the hover-peek remains the only interactive reveal
- Contract test `sidepanel-peel-reveal.test.ts` wired into the app suite

Design spec: docs/superpowers/specs/2026-07-24-sidepanel-peel-reveal-design.md
Bead: cave-3vgd
EOF
)"
```

- [ ] **Step 3: Wait for required checks**

Run: `gh pr checks --watch`
Expected: `Frontend build`, `Rust check`, `E2E (Playwright)`, `Cross-environment required`, `Sidecar runtime required`, `CodeQL` all pass (E2E runs headless Chromium without the experimental flag → plain path, unaffected).

- [ ] **Step 4: Squash-merge with an explicit message**

```bash
gh pr merge --squash --delete-branch \
  --subject "Shell: peel-reveal the sidebar when the collapsed rail is hovered (cave-3vgd) (#<PR>)" \
  --body "Vendored Canvas UI Peel as a progressive enhancement around the detail pane: HTML-in-canvas browsers curl the page toward the collapsed rail revealing the sidebar; all other environments render a display:contents pass-through. Interactive reveal remains the frosted hover-peek."
```

- [ ] **Step 5: Local cleanup + bead close**

```bash
cd /Users/buns/Documents/GitHub/OpenCoven/coven-cave
git worktree remove .worktrees/peel-sidepanel-reveal
git branch -D peel-sidepanel-reveal
git worktree list
bd update cave-3vgd --notes "Merged via PR #<PR> (squash). Verification: contract test in app suite, pnpm lint, build+bundle, required checks green. Native path manually smoke-tested where a flag-enabled Chromium was available."
bd close cave-3vgd
```

(The worktree guard allows removal once the branch is clean and pushed/merged; if it blocks, resolve the cited state rather than bypassing.)
