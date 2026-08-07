# Sidebar parity: Home ↔ Chat — implementation prompt

**Filed:** 2026-08-06 · **Status:** ready to implement · **Surface:** left siderail
**Baseline:** `84f6b461` (`fix(shell): keep the sidebar open when leaving Chat for Home` (#4404))

---

## The observed defect

Toggling the shell's Home / Chat section tabs visibly re-styles the *shared* top
of the siderail. The three elements that sit in the same place in both sections —
the familiar switcher ("All familiars"), the "New chat" button, and the panel
surface behind them — change font size, control height, corner radius, icon gap,
and background tint as you switch. The rail reads as two different apps stitched
together rather than one panel changing its contents.

Screenshot evidence (Home vs Chat, same window, same theme): the switcher and the
New-chat box are perceptibly taller with larger text in Home; the panel behind
them is a different shade; corner rounding differs.

## Root cause

`src/components/workspace.tsx:3111`

```ts
const contextualNav = navSection === "code" ? chatSidebar : sidebar;
```

The two sections do not render one component with different contents. They render
**two independent components with two independent stylesheets**:

| | Home (`navSection === "home"`) | Chat (`navSection === "code"`) |
|---|---|---|
| Component | `SidebarMinimal` (`src/components/sidebar-minimal.tsx`) | `WorkspaceSidebar` (`src/components/workspace-sidebar.tsx`) |
| Instantiated at | `workspace.tsx:3003` | `workspace.tsx:3058` |
| Class namespace | `.sidebar-*` | `.cnav__*` |
| Stylesheet | `src/styles/sidebar-minimal/shell-chrome.css`, `…/navigation-recents.css` | `src/styles/globals/shell-navigation.css` |

Both render the **same** underlying `FamiliarSwitcher` (Home reaches it through
the thin `FamiliarQuickSwitch` wrapper, `src/components/familiar-quick-switch.tsx`)
and both render a full-width "New chat" primary button — but each namespace
re-declares that shared chrome from scratch. The CSS even records the intent to
match, without a mechanism to enforce it. From `shell-chrome.css:163-169`:

> `/* … Matches .cnav__new on the Chat rail. */`

That comment is the whole parity contract today: a hand-copied set of values in
two files, with nothing failing when one side is edited and the other is not.
The pairs have already drifted.

### The drift, declaration by declaration

**"New chat" primary button** — `.sidebar-action-row` (`shell-chrome.css:136`,
`:170`) vs `.cnav__new` (`shell-navigation.css:328`):

| Property | Home | Chat | Effect |
|---|---|---|---|
| `border-radius` | `var(--radius-control)` | `10px` (hardcoded) | 8px vs 10px on the default theme — and `themes.css` overrides `--radius-control` to `7px`, `12px`, `16px`, `18px` on other palettes, so the gap grows to 8px on some themes while Chat stays pinned at 10px |
| `font-size` | `var(--text-base)` = 13px | `var(--text-sm)` = 12px | the label is a full step smaller in Chat |
| `gap` (icon→label) | `10px` | `5px` | different icon rhythm |
| height | `min-height: 34px` | `height: 34px` | agrees today; Chat's fixed height cannot grow with a longer label |
| fill / border / weight | `accent 9%` / `1px accent 24%` / `560` | identical | the parts that were copied correctly |

**Familiar switcher trigger** — `.sidebar-familiar-switch .familiar-switcher__trigger--labeled`
(`shell-chrome.css:83`) vs `.cnav__switcher .familiar-switcher__trigger--labeled`
(`shell-navigation.css:310`, `:315`):

| Property | Home | Chat | Effect |
|---|---|---|---|
| height | `min-height: 34px` | `height: 32px` | 2px jump on toggle; also breaks alignment with the 34px New-chat button directly below it |
| border | `2px solid var(--accent-presence)` | `1px` inherited + `border-color: color-mix(accent 58%, --border-hairline)` + `inset 0 0 0 1px` accent-16% shadow | solid accent outline vs. a muted mix — the most visible color difference |
| `border-radius` | `var(--radius-control)` | not overridden (falls back to the base trigger's own radius) | corner mismatch, theme-dependent |
| label type | `--text-base` / `600` | not overridden | the trigger label changes size and weight across the toggle |
| hover | `accent 20%` fill | not overridden | different hover feedback for the same control |

**Panel container** — `.sidebar-minimal` (`shell-chrome.css:6`) vs `.cnav`
(`shell-navigation.css:256`):

| Property | Home | Chat |
|---|---|---|
| background | `linear-gradient(180deg, color-mix(--bg-raised 55%, transparent), transparent 42%)` over `var(--bg-base)` | `color-mix(in oklch, var(--bg-raised) 92%, transparent)` |
| horizontal inset | `padding: 10px 6px` + per-row `padding: 7px 10px` | `--cnav-pad: 10px` applied per section |
| base `font-size` | `var(--text-base)` | not set (inherits) |

The panel surface itself changes shade on toggle, and content sits at a different
left inset in each section.

**Why the guardrails did not catch it.** `--radius-control` → `10px` and
`--text-base` → `--text-sm` are both *token-legal* — the design ESLint gate,
`pnpm codemod:design:check`, and `src/lib/design-token-drift.test.ts` check that
values come from the scale, not that two components that must look identical
picked the *same* value from it. There is no cross-component parity gate.

---

## What to build

Make the shared chrome **one implementation**, so parity is structural rather
than a comment. Do not "fix the numbers" — hand-syncing the two blocks reproduces
the same failure the next time either side is touched.

### Approach (recommended)

**Extract the rail header — switcher + primary action + panel surface — into one
shared component, rendered identically by both sections.**

1. Add `src/components/sidebar-rail-header.tsx` (name is a suggestion) owning:
   - the labeled `FamiliarSwitcher` trigger,
   - the full-width "New chat" button, with an optional trailing slot so Chat can
     keep its `⌘N` hint without forking the button,
   - the wrapper element that establishes the panel's horizontal inset.

   Props: `familiars`, `activeFamiliarId`, `selectedFamiliarIds`, `sessions`,
   `responseNeeded`, `onSelectFamiliar`, `onNewChat`, and an optional
   `newChatTrailing?: React.ReactNode`. Keep it presentational — no data fetching,
   no mode knowledge.

2. Give it one class namespace (e.g. `.rail-header__*`) in **one** stylesheet.
   Delete the now-dead declarations from both `shell-chrome.css` and
   `shell-navigation.css` rather than leaving them to shadow the new rules.

3. Render it from `SidebarMinimal` (replacing `.sidebar-familiar-switch` +
   `.sidebar-actions`, `sidebar-minimal.tsx:225-241`) and from `WorkspaceSidebar`
   (replacing `.cnav__header`'s switcher + `.cnav__quick`,
   `workspace-sidebar.tsx:578-600`).

   Section-specific chrome **stays where it is**: `WorkspaceSidebar` keeps its
   Home button and the Organize (`…`) popover in the header row; `SidebarMinimal`
   keeps its brand mark and account avatar. Only the three shared pieces move.

4. Unify the panel surface. Pick **one** background for the rail container and
   apply it to both — put it on the shell's nav panel element (the common
   ancestor of both sidebars) rather than duplicating it, so neither component
   can drift again. Same for the horizontal inset: one `--rail-pad` custom
   property, consumed by both.

5. Resolve every value to a **token**, not a copied literal. Specifically:
   `border-radius: var(--radius-control)` (never `10px`), `font-size:
   var(--text-base)`, `gap: var(--space-2)` or the existing `10px` grid step,
   `min-height: 34px` (not `height`). Where Home and Chat currently disagree,
   Home's values are the intended target — the comment at `shell-chrome.css:169`
   shows Chat was the source that Home was written to match, but Home is the
   default landing room and the one users see first.

### Acceptable fallback

If extraction proves too invasive for one PR, the minimum acceptable alternative
is a **shared CSS layer**: one `.rail-primary-action` / `.rail-scope-trigger`
class pair defined once in `primitives.css`, applied by *both* components, with
the per-namespace blocks reduced to positioning only. This still gives one source
of truth for the visual contract. Do **not** ship a PR that only edits numbers in
both files.

### Regression gate (required either way)

Add a test that fails when the pair drifts again — there is currently nothing
that would. Either:

- a unit test asserting both sidebars render the shared component / shared class
  (in the spirit of `src/components/workspace-sidebar-wiring.test.ts`), or
- a CSS-source assertion alongside `src/lib/design-token-drift.test.ts` pinning
  that the parity-critical declarations resolve from the same rule.

A Playwright check is also welcome but must stay daemon-less per
`COVEN_CAVE_E2E=1` (dismiss onboarding via `cave:onboarding:dismissed=1`, mock
APIs with `page.route(...)`).

---

## Acceptance criteria

1. Toggling Home ↔ Chat produces **no** change in the switcher's or New-chat
   button's height, font size, weight, corner radius, border treatment, or icon
   gap.
2. The panel background and left inset are identical in both sections.
3. The shared chrome is declared once. `grep` for the parity-critical properties
   returns one rule per property, not two.
4. Verified on **all 42 theme combinations** (12 palettes × light/dark,
   `data-theme` × `data-mode`) — this is where the hardcoded `10px` radius fails
   loudest, so check at least one palette from each `--radius-control` value
   (`7px`, `8px`, `12px`, `16px`, `18px`).
5. Verified at the rail's collapsed (56px icon rail) and drag-resized (~200px)
   widths; `.cnav` uses container queries, so confirm the extracted header
   behaves inside `container-name: cnav`.
6. A test fails if the two sidebars stop sharing the implementation.
7. `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm codemod:design:check`
   are green; the design-token drift baseline is **not** raised.

## Out of scope

- The thread list, recency buckets, search field, group/folder rows, and the
  Organize popover — different content, legitimately different UI.
- The nav row lists themselves (`.sidebar-folder-row` vs `.cnav__thread`).
- Merging `SidebarMinimal` and `WorkspaceSidebar` into one component.
- The mobile drawer and the iOS app.

## Required reading before starting

- [`docs/coven-design-language.md`](../coven-design-language.md) — binding
  contract; walk the §9 shipping checklist before opening the PR.
- [`AGENTS.md`](../../AGENTS.md) §"Design System" — tokens-only rule, the
  auto-fixers (`node scripts/codemods/tokenize-css.mjs`, `pnpm codemod:design`),
  and the state-tint `color-mix` recipe.
- `src/styles/globals/foundations.css` — the token contract
  (`--radius-control: 8px`, `--text-base: 13px`, `--text-sm: 12px`).
- `src/styles/globals/themes.css` — the 12 palettes that make the hardcoded
  radius a real bug rather than a 2px nitpick.

## Files in play

| File | Role |
|---|---|
| `src/components/workspace.tsx:3003,3058,3111` | the section swap |
| `src/components/sidebar-minimal.tsx:225-241` | Home's switcher + New chat |
| `src/components/workspace-sidebar.tsx:578-600` | Chat's header + quick row |
| `src/components/familiar-quick-switch.tsx` | thin wrapper; likely removable once the header is shared |
| `src/styles/sidebar-minimal/shell-chrome.css:6,83,131-183` | Home's declarations |
| `src/styles/globals/shell-navigation.css:256,280,310-380` | Chat's declarations |
| `src/lib/nav-section.ts` | which modes belong to which room (context; no change expected) |
