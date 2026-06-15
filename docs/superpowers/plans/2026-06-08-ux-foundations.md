# UX Foundations PR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the shared primitives — focus trap, roving tabindex, live region, reduced-motion hook, error-state component, and missing design tokens — that every subsequent UX polish PR will consume.

**Architecture:** Three reusable hooks in `src/lib/`, one global announcer wired at `app/layout.tsx`, one new UI primitive in `src/components/ui/`, and surgical token additions in `src/app/globals.css`. The hook for focus trapping is also adopted by the existing `Modal` (refactor, no behaviour change) to prove it works end-to-end before the broader polish PR consumes it.

**Tech Stack:** Next.js 16 (App Router) · React 19 · Tailwind v4 · `node:test` source-inspection style for tests (matches existing repo convention — see `globals.css.test.ts`, `onboarding-polish.test.ts`).

**Source spec:** `docs/superpowers/specs/2026-06-08-ux-audit.md` § "Cross-cutting themes" + § "Suggested order of attack" → Foundations PR.

**Out of scope:** Applying these primitives to other surfaces (command palette, board, library reader, glyph picker, onboarding, etc.). That's the *A11y P0 PR* next in the sequence.

---

## Pre-flight

- [ ] **Confirm signing is configured** (global CLAUDE.md rule — never skip)

```bash
git config --get user.signingkey
git config --get gpg.format
```

Expected: both return non-empty. If either is empty, stop and surface to the user.

- [ ] **Sync main and create the worktree using the project's worktree flow**

```bash
git fetch origin main
git checkout main && git pull --ff-only origin main
```

Then create the worktree via the project's `cv-wt` / `.wt` claim flow (see `scripts/` or the user's worktree CLI). Substitute the canonical invocation here — this plan was authored without the exact command in hand. If the project flow is unavailable, fall back to the documented sibling-worktree convention:

```bash
# Fallback only — confirm with the user first:
git worktree add -b ux-foundations \
  /Users/buns/Documents/GitHub/OpenCoven/coven-cave-ux-foundations main
cd /Users/buns/Documents/GitHub/OpenCoven/coven-cave-ux-foundations
```

Per the canary half of the flow, claim the branch in whatever tracking surface the project uses (Linear ticket, `claim` script, or a brief note to the user) before touching code.

- [ ] **Install / verify dev tooling inside the worktree**

```bash
pnpm install
pnpm typecheck
```

Expected: clean typecheck. If anything is red on a fresh checkout, fix or surface before starting.

- [ ] **Approval gate — confirm scope with the user before any code change**

Before Task 1, surface to the user:
> "Worktree is up at `<path>`. Tasks 1–7 will land ~6 signed commits — tokens, four hooks, LiveRegion mount in `layout.tsx`, ErrorState primitive, Modal refactor. Proceed?"

Wait for explicit go-ahead. Do not silently start. Same gate applies to every commit, push, and PR step below.

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `src/lib/use-prefers-reduced-motion.ts` | create | React hook reading `prefers-reduced-motion` with SSR-safe default |
| `src/lib/use-prefers-reduced-motion.test.ts` | create | source-grep test |
| `src/lib/use-focus-trap.ts` | create | hook: save/restore focus, Tab cycle within container, optional Escape |
| `src/lib/use-focus-trap.test.ts` | create | source-grep test |
| `src/lib/use-roving-tabindex.ts` | create | hook: arrow/Home/End nav across items, single tabindex=0 |
| `src/lib/use-roving-tabindex.test.ts` | create | source-grep test |
| `src/components/ui/live-region.tsx` | create | `<LiveRegionProvider>` + `useAnnouncer()` context |
| `src/components/ui/live-region.test.ts` | create | source-grep test |
| `src/components/ui/error-state.tsx` | create | mirror of `EmptyState` with `role="alert"` + retry slot |
| `src/components/ui/error-state.test.ts` | create | source-grep test |
| `src/components/ui/modal.tsx` | modify (lines 24–82) | consume `useFocusTrap` instead of inline trap |
| `src/app/layout.tsx` | modify (line ~41) | wrap children in `<LiveRegionProvider>` |
| `src/app/globals.css` | modify (multiple targeted edits) | new tokens + selection rule + light-mode `--ring-focus` derivation + tokenised scrollbar |
| `src/app/globals.css.test.ts` | modify | assert new tokens + corrected derivation |

Tests follow the repo's **source-grep convention**: read the source file with `readFileSync` and `assert.match` against expected patterns. They are **local invariant checks** — they prove the *pattern* (e.g., "the hook subscribes to a media-query change event") exists in the source, not that the runtime behaviour is correct.

**CI does not execute these tests** (see `reference-test-runner` memory). The runner is `npx --yes tsx --test <paths>`; the engineer running this plan executes them as part of each task's verification step.

**Behavioural verification is the manual browser check.** For each interactive primitive (`useFocusTrap`, `useRovingTabIndex`, `LiveRegion`) the plan includes a manual smoke test below the source-grep test. Treat the source tests as guardrails against regression of the *pattern*; treat the browser smoke as proof of *behaviour*. A real-DOM test harness (jsdom or Playwright component) is a follow-up — out of scope for this PR.

---

## Task 1: Tokens & light-mode `--ring-focus` derivation

**Why first:** every primitive that follows uses `var(--ring-focus)` and `var(--opacity-disabled)`. Get the foundation right, then build on it.

**Files:**
- Modify: `src/app/globals.css:200-201` (light `--ring-focus` derivation), `:root { ... }` block (add `--opacity-disabled`, `--scrollbar-thumb`, `--scrollbar-track`), end of `:root` selector group (add global `::selection` rule), `globals.css:3673` (consume `--scrollbar-thumb` in salem)
- Modify: `src/app/globals.css.test.ts`

- [ ] **Step 1.1: Extend `globals.css.test.ts` with failing assertions**

Open `src/app/globals.css.test.ts` and append at the end of file (before any final `console.log`):

```ts
// --- Foundations PR tokens ------------------------------------------------

// (a) Light-mode --ring-focus derives from --accent-presence, not a hex literal.
const lightBlockRaw = css.match(/:root\[data-mode="light"\]\s*\{([\s\S]*?)\}/)?.[1] ?? "";
assert.match(
  lightBlockRaw,
  /--ring-focus\s*:\s*color-mix\(in oklch,\s*var\(--accent-presence\)/,
  "light --ring-focus must derive from --accent-presence (no hex)",
);
assert.doesNotMatch(
  lightBlockRaw,
  /--ring-focus\s*:\s*color-mix\(in oklch,\s*#/,
  "light --ring-focus must not hardcode a hex literal",
);

// (b) Disabled opacity token exists on :root.
assert.match(
  css,
  /--opacity-disabled\s*:\s*0\.4/,
  "--opacity-disabled token defined on :root",
);

// (c) Scrollbar tokens exist on :root.
assert.match(css, /--scrollbar-thumb\s*:/, "--scrollbar-thumb token defined on :root");
assert.match(css, /--scrollbar-track\s*:/, "--scrollbar-track token defined on :root");

// (d) Salem scrollbar consumes the token, not raw rgba.
assert.doesNotMatch(
  css,
  /scrollbar-color:\s*rgba\(124,\s*77,\s*255,\s*0\.3\)/,
  "salem must not use the hardcoded purple rgba scrollbar (use var(--scrollbar-thumb))",
);

// (e) Global ::selection rule exists and uses --accent-presence.
assert.match(
  css,
  /::selection\s*\{[\s\S]*?background:\s*color-mix\(in oklch,\s*var\(--accent-presence\)/,
  "::selection rule must exist and derive from --accent-presence",
);

console.log("globals.css.test.ts (foundations) OK");
```

- [ ] **Step 1.2: Run the test and confirm it fails**

```bash
npx --yes tsx --test src/app/globals.css.test.ts
```

Expected: failures on (a) light hex, (b) missing `--opacity-disabled`, (c) missing scrollbar tokens, (d) salem rgba still present, (e) no `::selection` rule.

- [ ] **Step 1.3: Add the tokens to `:root` in `globals.css`**

In `src/app/globals.css`, find the `:root {` block (around line 30) and append these tokens before the closing brace (keep alphabetical order if the file uses one, otherwise group with other state tokens near `--ring-focus`):

```css
  /* Foundations PR — disabled state */
  --opacity-disabled: 0.4;

  /* Foundations PR — scrollbar tokens (consumed by all themed scrollbars) */
  --scrollbar-thumb: color-mix(in oklch, var(--accent-presence) 30%, transparent);
  --scrollbar-track: transparent;
```

- [ ] **Step 1.4: Add the global `::selection` rule**

Immediately after the `:root` block closes (and before `:root[data-mode="light"]`), add:

```css
/* Foundations PR — themed text selection.
   Derived from --accent-presence so every theme inherits without override. */
::selection {
  background: color-mix(in oklch, var(--accent-presence) 40%, transparent);
  color: var(--foreground);
}
```

- [ ] **Step 1.5: Fix light-mode `--ring-focus` to derive from `--accent-presence`**

In `src/app/globals.css`, replace lines 200–201 exactly:

```css
  --ring-focus: color-mix(in oklch, var(--accent-presence) 55%, transparent);
  --ring-focus-soft: color-mix(in oklch, var(--accent-presence) 30%, transparent);
```

Leave the 7 named-theme overrides (lines 2215–2400) alone — they explicitly override `--accent-presence` per theme, so they correctly cascade.

- [ ] **Step 1.6: Tokenise the salem scrollbar**

In `src/app/globals.css` at line 3673, replace:

```css
  scrollbar-color: rgba(124, 77, 255, 0.3) transparent;
```

with:

```css
  scrollbar-color: var(--scrollbar-thumb) var(--scrollbar-track);
```

- [ ] **Step 1.7: Re-run the test, confirm PASS**

```bash
npx --yes tsx --test src/app/globals.css.test.ts
```

Expected: all assertions pass, "globals.css.test.ts (foundations) OK" prints.

- [ ] **Step 1.8: Typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 1.9: Approval gate, then commit (signed)**

Show the user the diff (`git diff --stat` plus `git diff src/app/globals.css.test.ts`) and the test output. Wait for explicit approval before running the commit below.

```bash
git add src/app/globals.css src/app/globals.css.test.ts
git commit -S -m "$(cat <<'EOF'
feat(tokens): scrollbar, disabled, ::selection + light ring-focus derivation

Foundations for the UX polish sweep:
- Add --opacity-disabled, --scrollbar-thumb, --scrollbar-track tokens.
- Add themed ::selection rule derived from --accent-presence.
- Light-mode --ring-focus now derives from --accent-presence instead of
  hardcoding #6F62A8 (which de-synced from the brand color).
- Salem scrollbar consumes the token instead of raw purple rgba.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Verify the commit signed:

```bash
git log -1 --show-signature
```

Expected: `Good "<algorithm>" signature` in the output. If "signing failed" appears, stop and surface to the user.

---

## Task 2: `usePrefersReducedMotion()` hook

**Why:** JS-driven motion (smooth `scrollIntoView`, three.js orbit, salem widget animations) bypasses CSS `@media (prefers-reduced-motion)`. Components need a runtime signal to gate it.

**Files:**
- Create: `src/lib/use-prefers-reduced-motion.ts`
- Create: `src/lib/use-prefers-reduced-motion.test.ts`

- [ ] **Step 2.1: Write the failing test**

Create `src/lib/use-prefers-reduced-motion.test.ts`:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./use-prefers-reduced-motion.ts", import.meta.url),
  "utf8",
);

// Hook is named and exported.
assert.match(
  source,
  /export function usePrefersReducedMotion\(\)\s*:\s*boolean/,
  "hook exports usePrefersReducedMotion() returning boolean",
);

// SSR-safe: must guard window before matchMedia.
assert.match(
  source,
  /typeof window === "undefined"/,
  "hook must guard typeof window for SSR safety",
);

// Reads the canonical media query.
assert.match(
  source,
  /\(prefers-reduced-motion:\s*reduce\)/,
  "hook reads the prefers-reduced-motion: reduce query",
);

// Subscribes to changes (the user can toggle the OS preference live).
assert.match(
  source,
  /addEventListener\(\s*"change"/,
  "hook subscribes to MediaQueryList change events",
);
assert.match(
  source,
  /removeEventListener\(\s*"change"/,
  "hook cleans up the listener on unmount",
);

console.log("use-prefers-reduced-motion.test.ts OK");
```

- [ ] **Step 2.2: Run, confirm failure**

```bash
npx --yes tsx --test src/lib/use-prefers-reduced-motion.test.ts
```

Expected: ENOENT — file does not exist.

- [ ] **Step 2.3: Implement the hook**

Create `src/lib/use-prefers-reduced-motion.ts`:

```ts
"use client";

import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Live boolean for the OS-level reduced-motion preference. Returns false on
 * the server and during the first render in the browser; flips synchronously
 * after mount if the user has the preference set. Subscribes to changes so
 * toggling the OS setting takes effect without reload.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia(QUERY);
    setReduced(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return reduced;
}
```

- [ ] **Step 2.4: Run, confirm pass**

```bash
npx --yes tsx --test src/lib/use-prefers-reduced-motion.test.ts
```

Expected: "use-prefers-reduced-motion.test.ts OK".

- [ ] **Step 2.5: Typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 2.6: Approval gate, then commit (signed)**

Show the user `git diff --stat` + the test pass output. Wait for explicit approval.

```bash
git add src/lib/use-prefers-reduced-motion.ts src/lib/use-prefers-reduced-motion.test.ts
git commit -S -m "$(cat <<'EOF'
feat(lib): add usePrefersReducedMotion() hook

Runtime signal for JS-driven motion (smooth scroll, three.js orbit, salem
animations) that bypasses CSS @media queries. SSR-safe, live-updating.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature
```

Expected: `Good "<algorithm>" signature`. Surface the commit hash + signature line to the user before moving to the next task — do not chain tasks silently.

---

## Task 3: `useFocusTrap()` hook + refactor `Modal` to consume it

**Why:** `Modal` already implements focus trap + restore inline (`modal.tsx:24–82`). Extracting it gives the upcoming a11y PR the same trap for command palette, board inspector, library reader, GitHub modals, glyph picker, and onboarding — no per-component reinvention.

**Files:**
- Create: `src/lib/use-focus-trap.ts`
- Create: `src/lib/use-focus-trap.test.ts`
- Modify: `src/components/ui/modal.tsx` (replace inline trap with hook call)

- [ ] **Step 3.1: Write the failing test**

Create `src/lib/use-focus-trap.test.ts`:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./use-focus-trap.ts", import.meta.url),
  "utf8",
);

// Exports the hook.
assert.match(
  source,
  /export function useFocusTrap\s*\(/,
  "hook exports useFocusTrap(...)",
);

// Saves and restores prior focus.
assert.match(source, /document\.activeElement/, "captures document.activeElement on activate");
assert.match(
  source,
  /returnFocusRef\.current\?\.focus\(\)/,
  "restores focus on deactivate",
);

// Listens for Tab and Escape.
assert.match(source, /e\.key === "Tab"/, "intercepts Tab to cycle within container");
assert.match(source, /e\.key === "Escape"/, "intercepts Escape (caller decides what to do)");

// Queries focusables (re-queries on each Tab — DOM may change).
assert.match(
  source,
  /querySelectorAll<HTMLElement>\(FOCUSABLE\)/,
  "re-queries focusables on each Tab event",
);

// Exports the shared FOCUSABLE selector for consumers who want to use it directly.
assert.match(source, /export const FOCUSABLE\s*=/, "exports FOCUSABLE selector constant");

// Stable callback handling: onEscape must be stored in a ref so the effect
// doesn't tear down and re-run (and clobber returnFocusRef) when the caller
// passes an inline arrow.
assert.match(
  source,
  /onEscapeRef\s*=\s*useRef/,
  "stores onEscape in a ref to avoid effect re-runs on callback identity change",
);

// onEscape must NOT appear in the trap effect's dep array.
const trapEffect = source.match(/useEffect\(\s*\(\)\s*=>\s*\{[\s\S]*?\},\s*\[([^\]]*)\]\s*\)/g) ?? [];
const trapDeps = trapEffect.find((b) => b.includes('e.key === "Tab"')) ?? "";
assert.doesNotMatch(
  trapDeps,
  /\bonEscape\b/,
  "trap effect deps must not include onEscape (use a ref instead)",
);

// Fallback: focus the container itself if it has no focusable child.
assert.match(
  source,
  /container\.focus\(\)/,
  "trap focuses the container as a fallback when no focusable child exists",
);

console.log("use-focus-trap.test.ts OK");
```

- [ ] **Step 3.2: Run, confirm failure**

```bash
npx --yes tsx --test src/lib/use-focus-trap.test.ts
```

Expected: ENOENT.

- [ ] **Step 3.3: Implement the hook**

Create `src/lib/use-focus-trap.ts`:

```ts
"use client";

import { useEffect, useRef, type RefObject } from "react";

export const FOCUSABLE = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

type Options = {
  /** Called on Escape. Caller usually closes the dialog. Identity-stable
   *  internally (we keep it in a ref) so passing an inline arrow is fine. */
  onEscape?: () => void;
  /** Focus the first focusable element on activate (default true). If no
   *  focusable child exists, focuses the container itself — caller MUST give
   *  the container `tabIndex={-1}` so this is reachable. */
  focusFirst?: boolean;
};

/**
 * Trap focus inside `containerRef` while `active` is true. Saves the
 * previously-focused element on activate→deactivate and restores it on
 * deactivate. Tab/Shift+Tab cycle through focusable descendants. Escape
 * calls onEscape.
 *
 * `onEscape` is stored in a ref so the effect deps don't include it — that
 * prevents tear-down/re-run loops when callers pass an inline arrow each
 * render. (Without this, returnFocusRef gets re-captured on every render and
 * deactivate restores focus to inside the modal, not to the trigger.)
 */
export function useFocusTrap(
  active: boolean,
  containerRef: RefObject<HTMLElement | null>,
  { onEscape, focusFirst = true }: Options = {},
) {
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const onEscapeRef = useRef(onEscape);

  // Keep the latest callback reachable from the keydown handler without
  // making it a useEffect dep.
  useEffect(() => {
    onEscapeRef.current = onEscape;
  }, [onEscape]);

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    returnFocusRef.current = (document.activeElement as HTMLElement) ?? null;

    if (focusFirst) {
      const first = container.querySelector<HTMLElement>(FOCUSABLE);
      if (first) {
        first.focus();
      } else {
        // Fallback: focus the container so Tab/Esc still hit. Caller must
        // set tabIndex={-1} on the container element for this to land.
        container.focus();
      }
    }

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onEscapeRef.current?.();
        return;
      }
      if (e.key !== "Tab" || !container) return;
      const focusables = Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter((el) => !el.hasAttribute("disabled"));
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const activeEl = document.activeElement as HTMLElement | null;
      if (e.shiftKey && activeEl === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && activeEl === last) {
        e.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      returnFocusRef.current?.focus();
    };
  }, [active, containerRef, focusFirst]); // intentionally no onEscape
}
```

- [ ] **Step 3.4: Run hook test, confirm pass**

```bash
npx --yes tsx --test src/lib/use-focus-trap.test.ts
```

Expected: "use-focus-trap.test.ts OK".

- [ ] **Step 3.5: Refactor `Modal` to consume the hook**

In `src/components/ui/modal.tsx`, replace the entire block from line 24 through line 82 (the `FOCUSABLE` constant + the inline `useEffect` trap) with:

```tsx
import { useFocusTrap } from "@/lib/use-focus-trap";
```

at the top of the file (alongside the existing imports), and replace the body's effect block with:

```tsx
  useFocusTrap(open, dialogRef, { onEscape: onClose });
```

The full file (`modal.tsx`) after the edit reads:

```tsx
"use client";

import { useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/lib/icon";
import { useFocusTrap } from "@/lib/use-focus-trap";

type ModalProps = {
  open: boolean;
  onClose: () => void;
  breadcrumb?: ReactNode[];
  footerPills?: ReactNode;
  footerActions?: ReactNode;
  children: ReactNode;
  wide?: boolean;
  dismissOnBackdrop?: boolean;
  ariaLabel?: string;
};

export function Modal({
  open,
  onClose,
  breadcrumb,
  footerPills,
  footerActions,
  children,
  wide,
  dismissOnBackdrop = true,
  ariaLabel,
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useFocusTrap(open, dialogRef, { onEscape: onClose });

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="ui-modal-backdrop"
      onClick={dismissOnBackdrop ? onClose : undefined}
      role="presentation"
    >
      <div
        ref={dialogRef}
        className={`ui-modal${wide ? " ui-modal--wide" : ""}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        tabIndex={-1}
      >
        {breadcrumb ? (
          <header className="ui-modal-header">
            <div className="ui-modal-header-breadcrumb">
              {breadcrumb.map((segment, i) => (
                <span key={i} className="contents">
                  {i > 0 ? (
                    <span className="ui-modal-header-breadcrumb-sep" aria-hidden>
                      ›
                    </span>
                  ) : null}
                  {i === breadcrumb.length - 1 ? <strong>{segment}</strong> : <span>{segment}</span>}
                </span>
              ))}
            </div>
            <button
              type="button"
              className="ui-modal-close focus-ring"
              onClick={onClose}
              aria-label="Close"
            >
              <Icon name="ph:x" width={14} />
            </button>
          </header>
        ) : null}

        <div className="ui-modal-body">{children}</div>

        {footerPills || footerActions ? (
          <footer className="ui-modal-footer">
            <div className="ui-modal-footer-pills">{footerPills}</div>
            <div className="ui-modal-footer-actions">{footerActions}</div>
          </footer>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
```

- [ ] **Step 3.6: Typecheck**

```bash
pnpm typecheck
```

Expected: clean (the refactor is a behaviour-preserving extraction).

- [ ] **Step 3.7: Smoke-test Modal in the dev server**

```bash
pnpm dev
```

Open any surface that uses `<Modal>` (e.g., New Card modal at `/board`). Tab through the modal, Shift+Tab back, press Escape. Confirm:
- Focus lands on the first focusable on open.
- Tab cycles forward, wrapping at last.
- Shift+Tab cycles backward, wrapping at first.
- Escape closes.
- After close, focus returns to the trigger button.

If any of these regress, stop and debug before committing — the extraction must be behaviour-preserving.

- [ ] **Step 3.8: Approval gate, then commit (signed)**

Surface to the user: hook diff, Modal diff, manual smoke result. Wait for explicit approval — Modal is shipped UI, this is the highest-blast-radius commit in the PR.

```bash
git add src/lib/use-focus-trap.ts src/lib/use-focus-trap.test.ts src/components/ui/modal.tsx
git commit -S -m "$(cat <<'EOF'
feat(lib): extract useFocusTrap() hook; Modal consumes it

Pulls Modal's inline focus-trap into a reusable hook so the upcoming a11y
PR can apply the same trap to command palette, board inspector, library
reader, GitHub modals, glyph picker, and onboarding without per-component
reinvention. Modal behaviour is unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature
```

---

## Task 4: `useRovingTabIndex()` hook

**Why:** The audit found sequential-tab traps in glyph picker (~800 buttons), familiar studio tabs, avatar rail, kanban columns, and eval-loop track filter. One hook fixes all of them.

**Files:**
- Create: `src/lib/use-roving-tabindex.ts`
- Create: `src/lib/use-roving-tabindex.test.ts`

- [ ] **Step 4.1: Write the failing test**

Create `src/lib/use-roving-tabindex.test.ts`:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./use-roving-tabindex.ts", import.meta.url),
  "utf8",
);

// Exports the hook and an Orientation type.
assert.match(
  source,
  /export function useRovingTabIndex\s*\(/,
  "hook exports useRovingTabIndex(...)",
);
assert.match(
  source,
  /"horizontal"\s*\|\s*"vertical"\s*\|\s*"both"/,
  "Orientation supports horizontal, vertical, both",
);

// Handles all four arrows + Home + End.
for (const key of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"]) {
  assert.match(
    source,
    new RegExp(`"${key}"`),
    `hook handles ${key}`,
  );
}

// Manages tabindex: 0 on active, -1 on rest.
assert.match(
  source,
  /tabIndex\s*=\s*-1|setAttribute\(\s*"tabindex"/,
  "hook sets tabindex on items",
);

// Loop is opt-in (default false to match WAI-ARIA APG composite-widget guidance).
assert.match(
  source,
  /loop\s*[:=]\s*(false|boolean)/,
  "hook exposes loop option, default false",
);

// Filters disabled items so the tab stop never lands on one.
assert.match(
  source,
  /hasAttribute\(\s*"disabled"\s*\)|:not\(\[disabled\]\)/,
  "filters disabled items out of the rove set",
);

// Filters hidden items (offsetParent === null) so the tab stop is visible.
assert.match(
  source,
  /offsetParent/,
  "filters hidden items out of the rove set",
);

// Clamps activeIndex when the item list shrinks.
assert.match(
  source,
  /activeRef\.current\s*>=\s*items\.length|Math\.min\(\s*items\.length\s*-\s*1/,
  "clamps activeIndex when the item list shrinks",
);

console.log("use-roving-tabindex.test.ts OK");
```

- [ ] **Step 4.2: Run, confirm failure**

```bash
npx --yes tsx --test src/lib/use-roving-tabindex.test.ts
```

Expected: ENOENT.

- [ ] **Step 4.3: Implement the hook**

Create `src/lib/use-roving-tabindex.ts`:

```ts
"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

export type Orientation = "horizontal" | "vertical" | "both";

type Options = {
  /** Container element holding the items. */
  containerRef: RefObject<HTMLElement | null>;
  /** CSS selector for the items inside the container. */
  itemSelector: string;
  /** Which arrow keys move focus. Default "both". */
  orientation?: Orientation;
  /** Wrap from last → first / first → last. Default false. */
  loop?: boolean;
};

/**
 * Roving tabindex per WAI-ARIA APG. One item in the set has tabindex=0 (the
 * "tab stop"), every other is tabindex=-1. Arrow keys move the tab stop and
 * focus the new item. Home/End jump to ends. The container is the keydown
 * target — items themselves don't need handlers.
 *
 * Returns `setActiveIndex` so the caller can programmatically jump (e.g.,
 * after selecting an item to restore the tab stop).
 */
export function useRovingTabIndex({
  containerRef,
  itemSelector,
  orientation = "both",
  loop = false,
}: Options) {
  const [activeIndex, setActiveIndex] = useState(0);
  const activeRef = useRef(0);
  activeRef.current = activeIndex;

  const getItems = useCallback((): HTMLElement[] => {
    const container = containerRef.current;
    if (!container) return [];
    return Array.from(container.querySelectorAll<HTMLElement>(itemSelector))
      // Don't rove onto disabled controls.
      .filter((el) => !el.hasAttribute("disabled"))
      // Don't rove onto hidden elements. offsetParent === null catches
      // display:none and visibility:hidden ancestors. We keep the currently
      // focused element in the set even if hidden, to avoid yanking focus
      // mid-keystroke if a list animation hides it for a frame.
      .filter((el) => el.offsetParent !== null || el === document.activeElement);
  }, [containerRef, itemSelector]);

  // Sync tabindex on items whenever they change or active moves. Also clamp
  // activeIndex if the list shrunk below it — without this, a dynamic list
  // can leave the tab stop out of range (next ArrowDown lands on nothing).
  useEffect(() => {
    const items = getItems();
    if (items.length === 0) return;
    if (activeRef.current >= items.length) {
      const clamped = items.length - 1;
      setActiveIndex(clamped);
      return; // State update re-triggers this effect; let it land properly.
    }
    items.forEach((item, i) => {
      item.tabIndex = i === activeRef.current ? 0 : -1;
    });
  }, [getItems, activeIndex]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const horiz = orientation !== "vertical";
    const vert = orientation !== "horizontal";

    function move(delta: number) {
      const items = getItems();
      if (items.length === 0) return;
      let next = activeRef.current + delta;
      if (loop) {
        next = (next + items.length) % items.length;
      } else {
        next = Math.max(0, Math.min(items.length - 1, next));
      }
      setActiveIndex(next);
      items[next]?.focus();
    }

    function jumpTo(i: number) {
      const items = getItems();
      if (items.length === 0) return;
      const next = Math.max(0, Math.min(items.length - 1, i));
      setActiveIndex(next);
      items[next]?.focus();
    }

    function onKey(e: KeyboardEvent) {
      switch (e.key) {
        case "ArrowDown":
          if (!vert) return;
          e.preventDefault();
          move(1);
          break;
        case "ArrowUp":
          if (!vert) return;
          e.preventDefault();
          move(-1);
          break;
        case "ArrowRight":
          if (!horiz) return;
          e.preventDefault();
          move(1);
          break;
        case "ArrowLeft":
          if (!horiz) return;
          e.preventDefault();
          move(-1);
          break;
        case "Home":
          e.preventDefault();
          jumpTo(0);
          break;
        case "End":
          e.preventDefault();
          jumpTo(getItems().length - 1);
          break;
      }
    }

    container.addEventListener("keydown", onKey);
    return () => container.removeEventListener("keydown", onKey);
  }, [containerRef, getItems, loop, orientation]);

  return { activeIndex, setActiveIndex };
}
```

- [ ] **Step 4.4: Run, confirm pass**

```bash
npx --yes tsx --test src/lib/use-roving-tabindex.test.ts
```

Expected: "use-roving-tabindex.test.ts OK".

- [ ] **Step 4.5: Manual behavioural smoke (source tests can't prove focus actually moved)**

This hook isn't yet adopted by any surface, so smoke-test via a throwaway harness. Add to `src/app/dev/page.tsx` (a dev-only route, already present) a quick mount:

```tsx
// Add temporarily; remove before commit.
function RovingHarness() {
  const ref = useRef<HTMLDivElement>(null);
  useRovingTabIndex({ containerRef: ref, itemSelector: "button", orientation: "vertical" });
  return (
    <div ref={ref} style={{ display: "flex", flexDirection: "column", gap: 4, padding: 24 }}>
      {["one", "two", "three", "four"].map((s) => (
        <button key={s}>{s}</button>
      ))}
    </div>
  );
}
```

Run `pnpm dev`, open `/dev`, Tab into the group, press ArrowDown / ArrowUp / Home / End. Confirm focus moves and only one button has `tabindex=0` at a time (`document.activeElement.tabIndex`, plus `document.querySelectorAll('[tabindex="0"]')` in DevTools).

**Remove the harness from `src/app/dev/page.tsx` before committing** — this is verification scaffolding, not shipped code.

- [ ] **Step 4.6: Typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 4.7: Approval gate, then commit (signed)**

Show diff + test output + manual smoke result. Wait for approval.

```bash
git add src/lib/use-roving-tabindex.ts src/lib/use-roving-tabindex.test.ts
git commit -S -m "$(cat <<'EOF'
feat(lib): add useRovingTabIndex() hook

WAI-ARIA APG roving-tabindex primitive. Single tab stop, arrow + Home/End
navigation, opt-in loop. Consumers next PR: glyph picker, familiar studio
tabs, avatar rail, kanban columns, eval-loop track filter.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature
```

---

## Task 5: `<LiveRegionProvider>` + `useAnnouncer()` + root mount

**Why:** Chat stream, toasts, optimistic errors, salem replies, multi-select count, settings save feedback — none announce to assistive tech. One global announcer fixes them all.

**Files:**
- Create: `src/components/ui/live-region.tsx`
- Create: `src/components/ui/live-region.test.ts`
- Modify: `src/app/layout.tsx`
- Modify: `src/app/globals.css` (add `.sr-only` utility if not present)

- [ ] **Step 5.1: Confirm `.sr-only` doesn't already exist**

```bash
grep -n "\.sr-only\b" src/app/globals.css || echo "ABSENT"
```

If "ABSENT" prints, Step 5.6 will add it. If a `.sr-only` rule is found, skip Step 5.6.

- [ ] **Step 5.2: Write the failing test**

Create `src/components/ui/live-region.test.ts`:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./live-region.tsx", import.meta.url),
  "utf8",
);

// Exports the provider and the hook.
assert.match(
  source,
  /export function LiveRegionProvider\s*\(/,
  "exports LiveRegionProvider",
);
assert.match(
  source,
  /export function useAnnouncer\s*\(\s*\)/,
  "exports useAnnouncer() hook",
);

// Renders two regions with proper aria-live levels.
assert.match(source, /aria-live="polite"/, "renders polite region");
assert.match(source, /aria-live="assertive"/, "renders assertive region");
assert.match(source, /role="status"/, "polite region has role=status");
assert.match(source, /role="alert"/, "assertive region has role=alert");

// Visually hidden via the sr-only class.
assert.match(
  source,
  /className="sr-only"/,
  "regions are visually hidden via sr-only",
);

// Clears between announcements so repeats are announced.
assert.match(
  source,
  /setTimeout\(/,
  "clears the message after a short delay so repeats re-announce",
);

// Cleans up pending timeouts on unmount.
assert.match(
  source,
  /clearTimeout\(\s*politeClear\.current\s*\)/,
  "clears pending polite timeout on unmount",
);
assert.match(
  source,
  /clearTimeout\(\s*assertiveClear\.current\s*\)/,
  "clears pending assertive timeout on unmount",
);

// useAnnouncer throws/warns when used outside the provider.
assert.match(
  source,
  /useAnnouncer must be used within a LiveRegionProvider|throw new Error/,
  "useAnnouncer guards against missing provider",
);

console.log("live-region.test.ts OK");
```

- [ ] **Step 5.3: Run, confirm failure**

```bash
npx --yes tsx --test src/components/ui/live-region.test.ts
```

Expected: ENOENT.

- [ ] **Step 5.4: Implement the component**

Create `src/components/ui/live-region.tsx`:

```tsx
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type AnnounceLevel = "polite" | "assertive";

type AnnouncerContextValue = {
  announce: (message: string, level?: AnnounceLevel) => void;
};

const AnnouncerContext = createContext<AnnouncerContextValue | null>(null);

/**
 * Mount once at the root. Renders two visually-hidden live regions (polite
 * and assertive). The polite region is for status updates; the assertive
 * region is for errors and time-critical alerts.
 *
 * Messages are cleared 250ms after being set so re-announcing the same
 * string actually triggers an AT announcement (regions debounce identical
 * strings otherwise).
 */
export function LiveRegionProvider({ children }: { children: ReactNode }) {
  const [polite, setPolite] = useState("");
  const [assertive, setAssertive] = useState("");
  const politeClear = useRef<ReturnType<typeof setTimeout> | null>(null);
  const assertiveClear = useRef<ReturnType<typeof setTimeout> | null>(null);

  const announce = useCallback((message: string, level: AnnounceLevel = "polite") => {
    if (!message) return;
    if (level === "assertive") {
      if (assertiveClear.current) clearTimeout(assertiveClear.current);
      setAssertive(message);
      assertiveClear.current = setTimeout(() => setAssertive(""), 250);
    } else {
      if (politeClear.current) clearTimeout(politeClear.current);
      setPolite(message);
      politeClear.current = setTimeout(() => setPolite(""), 250);
    }
  }, []);

  // Cancel any pending clear so we don't fire setState on an unmounted tree.
  useEffect(() => {
    return () => {
      if (politeClear.current) clearTimeout(politeClear.current);
      if (assertiveClear.current) clearTimeout(assertiveClear.current);
    };
  }, []);

  return (
    <AnnouncerContext.Provider value={{ announce }}>
      {children}
      <div
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {polite}
      </div>
      <div
        className="sr-only"
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
      >
        {assertive}
      </div>
    </AnnouncerContext.Provider>
  );
}

/**
 * `const { announce } = useAnnouncer()` then call `announce("Saved.")` or
 * `announce("Failed to save", "assertive")`. Throws if no provider is in
 * scope — that's a programmer error to catch early.
 */
export function useAnnouncer(): AnnouncerContextValue {
  const ctx = useContext(AnnouncerContext);
  if (!ctx) {
    throw new Error("useAnnouncer must be used within a LiveRegionProvider");
  }
  return ctx;
}
```

- [ ] **Step 5.5: Run, confirm pass**

```bash
npx --yes tsx --test src/components/ui/live-region.test.ts
```

Expected: "live-region.test.ts OK".

- [ ] **Step 5.6: If `.sr-only` was absent in Step 5.1, add it to `globals.css`**

Append to `src/app/globals.css` (after the existing utility rules):

```css
/* Foundations PR — visually-hidden utility for screen-reader-only content.
   Standard pattern: positioned offscreen, zero size, but still in the
   accessibility tree. */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
```

- [ ] **Step 5.7: Mount the provider in `app/layout.tsx`**

Edit `src/app/layout.tsx`. Add the import:

```tsx
import { LiveRegionProvider } from "@/components/ui/live-region";
```

Wrap the children inside `<ShellBannersProvider>` so the announcer sits at the root of the rendered tree. The relevant body becomes:

```tsx
      <body className="h-full flex flex-col">
        <ShellBannersProvider>
          <LiveRegionProvider>
            <SidecarAuthBridge />
            <SidecarAuthMonitor />
            {children}
            <SalemWidget />
          </LiveRegionProvider>
        </ShellBannersProvider>
      </body>
```

- [ ] **Step 5.8: Typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 5.9: Smoke-test the provider**

```bash
pnpm dev
```

Open DevTools, navigate to any page, run in the console:

```js
document.querySelectorAll('[aria-live]').forEach(n => console.log(n.getAttribute('aria-live'), n.role))
```

Expected: at least two entries — one `polite/status`, one `assertive/alert`.

- [ ] **Step 5.10: Approval gate, then commit (signed)**

Show diff + smoke output (the `[aria-live]` console check). Wait for approval — touches `layout.tsx`, app-wide change.

```bash
git add src/components/ui/live-region.tsx src/components/ui/live-region.test.ts src/app/layout.tsx src/app/globals.css
git commit -S -m "$(cat <<'EOF'
feat(ui): LiveRegionProvider + useAnnouncer() + .sr-only utility

Mount one announcer at the root for the whole app. Consumers next PR:
chat transcript, inbox-toast, board optimistic errors, salem replies,
multi-select count, settings save feedback.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature
```

---

## Task 6: `<ErrorState>` primitive

**Why:** Every surface improvises its own error state. `EmptyState` already exists (`src/components/ui/empty-state.tsx`) — add the matching error variant with `role="alert"` and a retry slot so library/board/familiar studio/settings consume one component.

**Files:**
- Create: `src/components/ui/error-state.tsx`
- Create: `src/components/ui/error-state.test.ts`
- Modify: `src/app/globals.css` (add `.ui-error-state*` classes mirroring `.ui-empty-state*`)

- [ ] **Step 6.1: Inspect the existing `.ui-empty-state` classes for parity**

```bash
grep -n "ui-empty-state" src/app/globals.css | head -10
```

Note the surrounding rules — you'll mirror their layout for `.ui-error-state` with a danger accent.

- [ ] **Step 6.2: Write the failing test**

Create `src/components/ui/error-state.test.ts`:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./error-state.tsx", import.meta.url),
  "utf8",
);

// Exports the component and props type.
assert.match(source, /export function ErrorState\s*\(/, "exports ErrorState");
assert.match(source, /export type ErrorStateProps/, "exports ErrorStateProps");

// role="alert" so failures announce.
assert.match(source, /role="alert"/, "ErrorState uses role=alert");

// Has icon, headline, subtitle, actions (retry-friendly).
for (const slot of ["icon", "headline", "subtitle", "actions"]) {
  assert.match(
    source,
    new RegExp(`\\b${slot}\\b`),
    `ErrorState exposes ${slot}`,
  );
}

// Default icon is the danger/warning glyph (ph:warning or ph:warning-circle).
assert.match(
  source,
  /ph:warning/,
  "ErrorState defaults to a warning icon if none supplied",
);

console.log("error-state.test.ts OK");
```

- [ ] **Step 6.3: Run, confirm failure**

```bash
npx --yes tsx --test src/components/ui/error-state.test.ts
```

Expected: ENOENT.

- [ ] **Step 6.4: Implement the component**

Create `src/components/ui/error-state.tsx`:

```tsx
"use client";

import type { ReactNode } from "react";
import { Icon, type IconName } from "@/lib/icon";

export type ErrorStateProps = {
  /** Icon name. Defaults to `ph:warning` if omitted. */
  icon?: IconName;
  headline: ReactNode;
  subtitle?: ReactNode;
  /** Retry / fallback action button(s). Use <Button>. */
  actions?: ReactNode;
  compact?: boolean;
  className?: string;
};

export function ErrorState({
  icon = "ph:warning",
  headline,
  subtitle,
  actions,
  compact,
  className,
}: ErrorStateProps) {
  const classes = ["ui-error-state", compact ? "ui-error-state--compact" : "", className ?? ""]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={classes} role="alert">
      <div className="ui-error-state-icon" aria-hidden>
        <Icon name={icon} width={20} />
      </div>
      <div className="ui-error-state-headline">{headline}</div>
      {subtitle ? <div className="ui-error-state-subtitle">{subtitle}</div> : null}
      {actions ? <div className="ui-error-state-actions">{actions}</div> : null}
    </div>
  );
}
```

- [ ] **Step 6.5: Add `.ui-error-state` styles to `globals.css`**

Find the `.ui-empty-state {` rule block (use Step 6.1 line numbers). Immediately after the empty-state rules, append:

```css
/* Foundations PR — ErrorState primitive (mirrors .ui-empty-state layout
   with a danger accent). role="alert" announces via assistive tech. */
.ui-error-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 32px 24px;
  text-align: center;
  color: var(--text-secondary);
}
.ui-error-state--compact {
  padding: 16px 12px;
  gap: 4px;
}
.ui-error-state-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: color-mix(in oklch, var(--color-danger) 12%, transparent);
  color: var(--color-danger);
}
.ui-error-state-headline {
  font-size: var(--text-base);
  color: var(--text-primary);
  font-weight: 600;
}
.ui-error-state-subtitle {
  font-size: var(--text-sm);
  color: var(--text-secondary);
  max-width: 36ch;
}
.ui-error-state-actions {
  margin-top: 8px;
  display: flex;
  gap: 8px;
}
```

- [ ] **Step 6.6: Run test, confirm pass**

```bash
npx --yes tsx --test src/components/ui/error-state.test.ts
```

Expected: "error-state.test.ts OK".

- [ ] **Step 6.7: Typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 6.8: Approval gate, then commit (signed)**

Show diff + test output. Wait for approval.

```bash
git add src/components/ui/error-state.tsx src/components/ui/error-state.test.ts src/app/globals.css
git commit -S -m "$(cat <<'EOF'
feat(ui): ErrorState primitive

Companion to EmptyState. role="alert", retry slot, danger-tinted icon
chip. Library, board, familiar studio, settings will adopt next PR
to replace per-surface improvised error UIs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature
```

---

## Task 7: Verify, then ask before push, ask before PR

**Default posture:** stop and ask. Do not push or open a PR without explicit user approval. The verification steps below are unconditional; the push and PR steps each block on a user OK.

- [ ] **Step 7.1: Final typecheck + run every new/touched test**

```bash
pnpm typecheck
npx --yes tsx --test \
  src/app/globals.css.test.ts \
  src/lib/use-prefers-reduced-motion.test.ts \
  src/lib/use-focus-trap.test.ts \
  src/lib/use-roving-tabindex.test.ts \
  src/components/ui/live-region.test.ts \
  src/components/ui/error-state.test.ts
```

Expected: clean typecheck; every test prints its "... OK" line and exits 0.

- [ ] **Step 7.2: Run the production build to catch SSR / use-client mishaps**

```bash
pnpm build
```

Expected: success. `LiveRegionProvider` is a client component (uses `"use client"`); the hooks are too. If the build complains about hooks-in-server-components, double-check the directive on the new files.

- [ ] **Step 7.3: Verify every commit on this branch is signed**

```bash
git log origin/main..HEAD --pretty='%H %G?' | awk '$2 != "G" {print "UNSIGNED:", $0}'
```

Expected: no output. If any commit prints, **do not push**. Rebase with sign:

```bash
git rebase --exec 'git commit --amend --no-edit -S' origin/main
```

Then re-run the check.

- [ ] **Step 7.4: Approval gate, then push**

Surface to the user:
- the full commit list (`git log --oneline origin/main..HEAD`)
- typecheck + build + every test passed
- every commit signed (Step 7.3 output empty)

Then ask explicitly: **"Push `ux-foundations` to origin?"** Wait for yes. Do NOT push silently.

```bash
git push -u origin ux-foundations
```

- [ ] **Step 7.5: Approval gate, then open the PR**

Draft the PR body locally first and show it to the user. Ask: **"Open the PR with this body?"** Wait for yes. If the user wants edits to the title/body, apply them, re-show, and re-ask.

```bash
gh pr create --title "feat(ux): foundations — focus trap, roving tabindex, live region, error state, tokens" --body "$(cat <<'EOF'
## Summary
- Adds shared primitives that the upcoming UX polish sweep will consume across every surface.
- `useFocusTrap`, `useRovingTabIndex`, `usePrefersReducedMotion` hooks; `LiveRegionProvider` + `useAnnouncer`; `<ErrorState>` primitive.
- Token additions: `--opacity-disabled`, `--scrollbar-thumb`/`--scrollbar-track`, themed `::selection`.
- Fixes: light-mode `--ring-focus` derives from `--accent-presence` (was hardcoded `#6F62A8`); salem scrollbar tokenised (was raw purple rgba).
- Refactors `Modal` to consume `useFocusTrap` (behaviour-preserving).
- No user-visible surface change. Followup PR (a11y P0) applies the primitives.

## Spec
`docs/superpowers/specs/2026-06-08-ux-audit.md` § "Suggested order of attack" → PR 1.

## Test plan
- [x] Every new file has a co-located source-grep test (`npx --yes tsx --test ...`).
- [x] `pnpm typecheck` clean.
- [x] `pnpm build` clean.
- [x] Manual: `Modal` smoke test in `/board` — Tab/Shift+Tab cycle, Esc closes, focus restores.
- [x] Manual: `document.querySelectorAll('[aria-live]')` returns the polite + assertive regions on every route.
- [x] Manual: `:root[data-mode="light"]` `--ring-focus` cascades from `--accent-presence` (verified by switching themes in `/aesthetic`).
- [x] All commits signed (`git log %G?` shows `G`).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Return the PR URL to the user and stop. Do not merge.

---

## Self-review

**Spec coverage** — for each Foundations PR item in the audit's "Suggested order of attack":
- `useFocusTrap` hook → Task 3 ✓
- `<LiveRegion>` component → Task 5 ✓
- `useRovingTabIndex` hook → Task 4 ✓
- `<EmptyState>` / `<ErrorState>` primitives → EmptyState already exists; ErrorState in Task 6 ✓
- `--scrollbar-thumb` → Task 1 ✓
- `--opacity-disabled` → Task 1 ✓
- `::selection` → Task 1 ✓
- Light-mode `--ring-focus` derivation → Task 1 ✓
- `usePrefersReducedMotion` (added — JS-driven motion needs runtime gating that CSS can't reach) → Task 2 ✓

**Placeholder scan** — no TBD / TODO / "similar to" / "add error handling" placeholders. **Exception:** the worktree command in pre-flight is intentionally a placeholder pending confirmation of the user's `cv-wt` / `.wt` claim+canary flow; a documented fallback (sibling worktree) is provided.

**Type consistency** — `FOCUSABLE` exported from `use-focus-trap.ts`, removed from `modal.tsx`. `useAnnouncer` return type `{ announce: (msg, level?) => void }` is consistent across provider and hook. `Orientation` type name consistent.

**Token names verified against `globals.css`:** `--foreground`, `--accent-presence`, `--text-primary`, `--text-secondary`, `--text-muted`, `--color-success`, `--color-warning`, `--color-danger`, `--ring-focus`, `--ring-focus-soft`, `--ring-width` all confirmed present at the lines the plan cites. No drift.

**Note on `.ui-btn-spinner` reduced-motion** — the audit flagged this, but the `@media (prefers-reduced-motion: reduce)` block at `globals.css:218` already uses `*, *::before, *::after { animation-duration: 0.001ms !important }` which catches `.ui-btn-spinner`. The audit assertion was incorrect; no fix needed. The reduced-motion *concern* is real for **JS-driven** animation (smooth scroll, three.js orbit), which `usePrefersReducedMotion` covers — those component-level adoptions are in the next PR.

**Correctness hardening (v2 patches from review feedback):**
- `useFocusTrap` stores `onEscape` in a ref, omits it from effect deps — prevents the tear-down loop where an inline-arrow `onEscape` causes `returnFocusRef` to be re-captured from inside the modal, then restore on close lands focus inside the closing modal instead of on the trigger.
- `useFocusTrap` focuses the container itself if no focusable child exists (`Modal` gets `tabIndex={-1}` on the dialog to make this land).
- `useRovingTabIndex` filters disabled (`hasAttribute("disabled")`) and hidden (`offsetParent === null`) items so the tab stop never lands on an unreachable element.
- `useRovingTabIndex` clamps `activeIndex` when the list shrinks — prevents the out-of-range tab stop after a dynamic list update.
- `LiveRegionProvider` clears pending `setTimeout`s on unmount.

**Approval discipline** — every commit step is gated on user OK (diff + test output shown). Push and PR each have their own explicit gate in Task 7. No silent commit/push.

**Test framing** — source-grep tests are explicitly labelled "local invariant checks" in the file map and pre-flight. They prove the pattern; they do not prove behaviour. Behavioural verification is the manual browser smoke in each interactive primitive's task (Modal smoke in 3.7, Roving harness in 4.5, LiveRegion DOM check in 5.9). A real-DOM test harness is a follow-up, called out as out of scope.
