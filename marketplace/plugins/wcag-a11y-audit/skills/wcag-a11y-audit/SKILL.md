---
name: wcag-a11y-audit
description: Use when auditing or building any web/desktop UI for accessibility, wiring up ARIA/keyboard/focus, choosing color-contrast and target-size values, fixing screen-reader or focus-management bugs, honoring reduced-motion, or setting up automated a11y tests (axe-core, Playwright, jest-axe, eslint-plugin-jsx-a11y). This is the framework-agnostic WCAG 2.2 Level AA checklist and manual-testing playbook — reach for it whenever someone says "accessible", "a11y", "WCAG", "screen reader", "keyboard nav", "focus ring", "contrast", "ARIA", "compliance", or when a PR adds interactive components (modals, menus, tabs, drag-and-drop, forms, toasts) that must work without a mouse and with assistive tech.
---

# WCAG 2.2 AA Accessibility Audit

Framework-agnostic. WCAG 2.2 finalised as a W3C Recommendation **5 Oct 2023** (re-published edition **Dec 2024**); it adds 9 success criteria over 2.1 and **removes 4.1.1 Parsing**. **AA is the operative bar.**

## Use When
- Auditing an existing UI for accessibility, or gating a PR that adds interactive components.
- Building modals, menus, tabs, comboboxes, drag-and-drop, forms, toasts, or any custom widget.
- Deciding contrast values, target sizes, focus-ring styles, or ARIA usage.
- Fixing screen-reader, keyboard, or focus-management bugs.
- Wiring reduced-motion or setting up automated a11y tests (axe/Playwright/jest-axe/eslint-jsx-a11y).

## Guardrails
- **First Rule of ARIA:** if native HTML gives the semantics + keyboard behaviour, use it — don't re-implement with `role=` on a `<div>`. `<button>` > `<div role="button">`. **No ARIA is better than bad ARIA** (misused ARIA measurably *increases* AT errors).
- ARIA adds **zero** behaviour — no keyboard handling, no focus, no styling. If you add `role`/`aria-*`, you own the keyboard model, focus, and states too.
- **Automated tools catch only ~30–50% of issues.** Never claim "WCAG AA compliant" from a scan alone — always do the manual keyboard + screen-reader passes.
- Every interactive element needs an **accessible name**, a correct **role**, and current **state/value** (SC 4.1.2). Never put `aria-hidden="true"` or `role="presentation"` on a focusable element.
- Never ship `outline: none` without a visible replacement focus indicator (SC 2.4.7). Prefer `:focus-visible`.
- Do **not** audit against 4.1.1 Parsing — it's removed in 2.2.
- Color is never the *only* signal (SC 1.4.1). Contrast is a luminance ratio — measure it, don't eyeball it. (APCA is WCAG 3/future, not the 2.2 standard.)

## Default Flow

### 1. Frame by POUR
Organise findings under **Perceivable · Operable · Understandable · Robust**. Report each finding as: `SC id (level)` · principle · location(selector) · severity(blocker/serious/moderate/minor) · evidence(what keyboard/AT did) · concrete fix.

### 2. Structure & semantics (Perceivable/Robust)
- Real landmarks: one `<main>`, plus `<header><nav><aside><footer>`; label repeats (`aria-label`).
- Heading outline: one `<h1>`, no skipped levels (SC 1.3.1).
- Every image has meaningful `alt`; decorative → `alt=""` (SC 1.1.1). Real text, not images of text (1.4.5).
- Form controls have programmatic labels: `<label for>`, `<fieldset>/<legend>`, `autocomplete` tokens (1.3.1/1.3.5/3.3.2).

### 3. Keyboard pass (Operable) — unplug the mouse
- Everything reachable & operable via **Tab / Shift+Tab / Enter / Space / Arrows / Esc / Home / End** (SC 2.1.1).
- Logical focus order; **only `tabindex` 0 or -1** (never positive) (2.4.3).
- No keyboard traps (2.1.2); focus **restored** after closing modals/deleting rows.
- Custom `role="button"` fires on **both Enter and Space**; links on Enter only.
- **Drag-and-drop has a click/tap alternative** (★2.5.7).

### 4. Focus management
- Visible ring via `:focus-visible`, meeting **3:1 non-text contrast** (1.4.11 / 2.4.7).
- Focused control **not fully hidden** by sticky headers/footers/cookie bars (★2.4.11) — use `scroll-margin`.
- Modals: move focus in → **trap** (Tab cycles) → **Esc closes** → restore focus out. Prefer native `<dialog>` + `showModal()`; mark background `inert`.
- Composite widgets (tabs/toolbar/menu/radio/grid): **roving tabindex** (one `0`, rest `-1`, arrows move) *or* `aria-activedescendant`.
- Copy widget patterns + keyboard models from the **WAI-ARIA APG** — don't invent markup.

### 5. Screen-reader pass — VoiceOver (mac) or NVDA (Windows, free)
- Walk the primary task by **landmark + heading**; verify each control announces **name, role, state**.
- Dynamic updates announced without moving focus via live regions (SC 4.1.3):
  - `role="status"` / `aria-live="polite"` → toasts, "saved", result counts, inline validation.
  - `role="alert"` / `aria-live="assertive"` → **sparingly**, critical errors only.
  - The live container **must exist in the DOM before** you inject text.

### 6. Visual metrics (measure, don't guess)
- Text contrast **4.5:1** (normal) / **3:1** (large ≥24px or ≥18.66px bold) — SC 1.4.3.
- Non-text/UI-boundary/focus contrast **3:1** — SC 1.4.11.
- **Target size ≥24×24 CSS px** or adequate spacing (★2.5.8). *(In practice exceed it: 44pt iOS / 48dp Android for touch.)*
- Reflow at 320px, no 2-D scroll (1.4.10); usable at 200% zoom (1.4.4); survive text-spacing overrides (1.4.12).

### 7. Motion & seizure
- Nothing flashes **>3×/second** (SC 2.3.1).
- Auto-moving/updating content >5s has **pause/stop/hide** (SC 2.2.2).
- Honor `prefers-reduced-motion: reduce` — design motion reduced-first, opt into animation only on `no-preference`.

### 8. Forms & auth (Understandable)
- Errors identified in text + field named (3.3.1); fixes suggested (3.3.3); reversible/confirmed for legal/financial (3.3.4).
- **Redundant Entry** (★3.3.7): auto-fill or let users reuse same-session data ("same as billing").
- **Accessible Authentication** (★3.3.8): **no cognitive-test-only login** — allow paste in password fields, support password managers / passkeys / WebAuthn, offer OTP alternatives to puzzle CAPTCHAs.

### 9. Automated harness (regression layer, not proof)
```js
// Playwright + axe
import AxeBuilder from '@axe-core/playwright';
const results = await new AxeBuilder({ page })
  .withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa'])
  .analyze();
expect(results.violations).toEqual([]);
```
```js
// Component unit test
import { axe, toHaveNoViolations } from 'jest-axe';
expect.extend(toHaveNoViolations);
expect(await axe(container)).toHaveNoViolations();
```
- Author-time lint: **eslint-plugin-jsx-a11y** (React) / template a11y linters (Vue/Svelte/Angular).
- Reduced-motion guard:
```css
@media (prefers-reduced-motion: reduce){
  *,*::before,*::after{
    animation-duration:.01ms!important;animation-iteration-count:1!important;
    transition-duration:.01ms!important;scroll-behavior:auto!important;
  }
}
```

### 10. Manual sign-off checklist
Keyboard-only ✓ · Screen-reader (VO/NVDA) ✓ · 200%/400% zoom + reflow ✓ · Windows High Contrast / `forced-colors` ✓ · Reduced-motion ✓ · Color-off/color-blind ✓. Only then report conformance, stating exactly which manual passes were run.

## New in 2.2 (audit on top of a 2.1 baseline)
2.4.11 Focus Not Obscured (AA) · 2.5.7 Dragging Movements (AA) · 2.5.8 Target Size Min (AA) · 3.2.6 Consistent Help (A) · 3.3.7 Redundant Entry (A) · 3.3.8 Accessible Authentication Min (AA). **Removed:** 4.1.1 Parsing.

## References
W3C WCAG 2.2 (https://www.w3.org/TR/WCAG22/) · Quickref (https://www.w3.org/WAI/WCAG22/quickref/) · What's New (https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/) · ARIA APG (https://www.w3.org/WAI/ARIA/apg/) · Using ARIA 5 rules (https://www.w3.org/TR/using-aria/) · MDN Accessibility (https://developer.mozilla.org/en-US/docs/Web/Accessibility) · axe-core (https://github.com/dequelabs/axe-core) · Playwright a11y (https://playwright.dev/docs/accessibility-testing) · eslint-plugin-jsx-a11y (https://github.com/jsx-eslint/eslint-plugin-jsx-a11y).
