# Siderail parity: one header across Home and Chat

**Landed:** 2026-08-06 · **Surface:** left siderail · **PR:** #4405

## The defect

Toggling the shell's Home / Chat section tabs visibly restyled the *shared* top
of the siderail. The familiar switcher ("All familiars"), the "New chat" button,
and the panel behind them changed font size, control height, corner radius, icon
gap and background tint — and the whole column sat at a different vertical
offset. The rail read as two different apps stitched together rather than one
panel changing its contents.

## Why it happened

`workspace.tsx` does not render one sidebar with different contents. It swaps
between two independent components with two independent stylesheets:

| | Home (`navSection === "home"`) | Chat (`navSection === "code"`) |
|---|---|---|
| Component | `SidebarMinimal` | `WorkspaceSidebar` |
| Class namespace | `.sidebar-*` | `.cnav__*` |
| Stylesheet | `styles/sidebar-minimal/shell-chrome.css` | `styles/globals/shell-navigation.css` |

Both rendered the same underlying `FamiliarSwitcher` and the same full-width
primary action, but each namespace re-declared that chrome by hand. The entire
parity contract was a comment — `/* … Matches .cnav__new on the Chat rail. */` —
with nothing failing when one side was edited and the other was not.

**The design gates could not catch it.** Every drifted value was *token-legal*.
The design ESLint rules, `pnpm codemod:design:check` and
`src/lib/design-token-drift.test.ts` all verify that values come from the scale;
none of them verifies that two components which must look identical picked the
*same* value from it. That gap is the actual bug — the visual drift was a
symptom.

### What had drifted

**Horizontal / visual** — `.sidebar-action-row` vs `.cnav__new`, and the two
switcher-trigger overrides:

| Property | Home | Chat |
|---|---|---|
| `border-radius` | `var(--radius-control)` | `10px`, hardcoded |
| `font-size` | `--text-base` (13px) | `--text-sm` (12px) |
| icon gap | `10px` | `5px` |
| switcher height | `min-height: 34px` | `height: 32px` |
| switcher border | `2px solid var(--accent-presence)` | muted `color-mix` + inset shadow |
| panel background | `--bg-base` gradient | `color-mix(--bg-raised 92%)` |

The radius is the one worth singling out: `themes.css` moves
`--radius-control` to 7px, 12px, 16px and 18px across the twelve palettes while
Chat stayed pinned at 10px, so the two rails disagreed by a *different* amount on
most of the 42 theme combinations.

**Vertical** — found only after the horizontal work, and the more visible of the
two in practice:

- `.sidebar-minimal { gap: 10px }` — a blanket flex-column gap between every
  top-level band. `.cnav` has no equivalent, so each band in Home sat 10px below
  its twin in Chat (measured against the switcher box: 15px from the section tabs
  to the header in Home, 5px in Chat).
- `.sidebar-minimal { padding: 10px 0 }` — `.cnav` declares no padding at all,
  so even with the gaps equalised, Home's entire column started 10px lower.

**Inset** — the rails also disagreed on their content inset (6px in Home, 10px in
Chat), and within Home the nav rows sat outside the header because
`.sidebar-nav-scroll` ended with a `padding` shorthand that silently overrode an
earlier `padding-inline`.

## What shipped

**One component.** `SidebarRailHeader` (`src/components/sidebar-rail-header.tsx`)
owns the labeled switcher and the full-width primary action, with one
`.rail-header` namespace in one sheet (`styles/globals/rail-header.css`). Both
sections render it. Chat keeps its `⌘N` hint through the button's trailing slot
rather than forking the button — forking is what let the two drift.
Section-specific chrome stays with its own sidebar: Chat's Organize menu and
grouping tabs, Home's brand mark and account avatar.

**One inset.** `--rail-pad` is declared once on the shared `.shell-nav` ancestor.
Every band in both rails reads it: the section tabs, the header, the nav scroll
and the footer in Home; the tabs row, search wrap and group labels in Chat via
`--cnav-pad`, which is now just `var(--rail-pad)`.

**One surface.** The panel background belongs to `.shell-nav`. Both
`.sidebar-minimal` and `.cnav` render transparent over it, so toggling cannot
change the rail's shade.

**One vertical rhythm.** Neither container contributes anything vertically — no
column gap, no block padding — so both rails start at the same offset. The
spacing between bands comes from the shared pieces instead: `.rail-header`'s
bottom margin and `.nav-sections`' own margin, identical in both rooms by
construction.

## The invariant, and the gate that holds it

`src/components/sidebar-rail-header.test.ts` is the check that was missing. It
asserts *structure* rather than numbers, so it keeps holding as the design
evolves:

- both sidebars import and render `SidebarRailHeader`, and neither mounts
  `FamiliarSwitcher` or a New-chat button directly;
- neither section's stylesheet declares a `.rail-header*` selector, and the
  retired forks (`.cnav__new`, `.cnav__switcher`, `.cnav__quick`,
  `.sidebar-familiar-switch`, the `.sidebar-actions` CTA) stay retired;
- the parity-critical properties resolve from the shared rule — radius from
  `var(--radius-control)` and never a literal, `min-height` rather than a pinned
  `height`, `--text-base` on both labels;
- neither rail container declares a column gap or block padding.

Two notes for anyone extending it. It parses declared values rather than
pattern-matching them: a lookahead placed after `\s*` backtracks and passes
silently, which is how the first version of the vertical assertion reported green
against the very padding it was written to catch. And its "retired fork"
assertions are anchored to selector lines (`^…{`), because both stylesheets carry
prose that names the retired classes.

## Notes from the work

- **The drift ratchet moved down**, not up: `offScaleSpacingPx` 1654 → 1646 and
  `offScaleRadiusPx` 233 → 231, banked in the same PR. Replacing hand-copied
  literals with tokens is what did it.
- **Verifying this by screenshot is unreliable.** Synthetic clicks do not reach
  the Tauri webview, so "Home vs Chat" captures can silently be the same section
  twice, and naive pixel scans latch onto the panel gradient rather than control
  borders. Reading the CSS the dev server actually serves
  (`/_next/static/chunks/*.css`) is the check that works — it is also what
  revealed that an orphaned dev server on port 3000 was serving stale CSS,
  which made a correct fix look broken across several rounds of review.

## Out of scope

The thread list, recency buckets, group rows and the Organize popover: different
content, legitimately different UI. Merging `SidebarMinimal` and
`WorkspaceSidebar` into one component. The mobile drawer and the iOS app.
