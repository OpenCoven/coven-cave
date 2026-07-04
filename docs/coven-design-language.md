# Coven design language

The consolidated reference for how Coven Cave looks, moves, speaks, and behaves —
written from the shipped product, with citations, so it stays verifiable. The
token contract itself lives in code (`src/app/globals.css:11-212`) and on the
live reference page at `/aesthetic`; per-surface decisions live in
`docs/specs/`. This document ties them together and codifies the rules that
were previously only implicit.

**When this doc and the code disagree, the code is right — then fix one of them.**

---

## 1. Brand foundations

- **Dark-first, lavender-inked.** The default theme ("Coven") is a dark UI on
  oklch hue **293** — the comment in the token contract says it directly:
  *"surfaces should read violet, not gray"* (`globals.css:37`). Light mode is a
  complete, AA-retuned override (`[data-mode="light"]`), not an afterthought —
  every one of the 16 theme palettes ships both modes.
- **One palette, two vocabularies.** Tokens exist under shadcn-style names
  (`--background`, `--card`, `--muted`) *and* semantic aliases (`--bg-base`,
  `--bg-raised`, `--border-hairline`, `--text-*`). They resolve to the same
  colors (`globals.css:19-22`). New CSS should prefer the semantic aliases.
- **All color is oklch**, and tints are derived, never hand-picked:
  `color-mix(in oklch, <token> N%, transparent)` (see §3).
- **The accent is presence, not call-to-action.** `--accent-presence`
  (`#9a8ecd` dark / `#6F62A8` light — "OpenCoven lavender") is *reserved for
  familiar presence dots and the health strip — not for primary CTAs*
  (`globals.css:24-26, 57-59`). The brand color signals that something is
  alive, not that something is clickable.
- **Desktop-app density.** Body baseline is **13px** (`--text-base`), labels
  go down to 10-11px, and `--text-muted` is deliberately tuned to
  `color-mix(… 55%, transparent)` because 40% failed AA at those sizes
  (`globals.css:82-85`). Density is a feature; illegibility is a bug.

## 2. Token contract (summary — authority is `globals.css` + `/aesthetic`)

### Surfaces (dark defaults)
| Token | Value | Use |
|---|---|---|
| `--bg-panel` | `oklch(0.10 0.020 293)` | deepest: shell / sidebar floor |
| `--bg-base` | `oklch(0.13 0.022 293)` | page background |
| `--bg-raised` | `oklch(0.165 0.025 293)` | cards, panels |
| `--bg-elevated` | `oklch(0.20 0.028 293)` | popovers, dropdowns |
| `--bg-hover` | `oklch(0.24 0.030 293)` | hover state |
| `--code-surface` | `oklch(0.12 0.012 280 / 92%)` | fixed "ink" for code |

Elevation is expressed by **stepping lightness up the same hue**, not by
shadows alone. A popover is lighter than a card is lighter than the page.

### Text
`--text-primary` (near-white) › `--text-secondary` (`oklch(0.66 0.018 293)`)
› `--text-muted` (55% foreground mix). Three tiers; don't invent a fourth.

### Semantic state
`--color-success` (green 158) · `--color-warning` (amber 78) ·
`--color-danger` (red 24) · `--color-info` (= accent). Each has a `-soft`
partner. Light mode retunes all of them for contrast — never hardcode a state
color.

### Structure
- Borders: `--border-hairline` (12% foreground mix) for nearly everything;
  `--border-strong` (22%) for inputs/emphasis. Because they derive from
  `--foreground`, they invert automatically in light mode.
- Radii: `--radius-control: 8px` · `--radius-card: 12px` ·
  `--radius-panel: 16px` · and the signature **999px pill** (§3).
- Spacing: 4px grid (`--space-1` … `--space-10`).
- Type: Geist Sans + JetBrains Mono; ladder `--text-2xs` (10px) →
  `--text-display` (28px); eyebrow tracking `0.08em` + uppercase for tiny
  labels.
- Motion: `--duration-fast: 120ms` / `base: 180ms` / `slow: 260ms` with the
  standard/emphasized/decelerate easings. Reduced-motion collapses all of it
  globally (`globals.css:294-306`).
- Focus: `--ring-focus` (55% accent mix), 2px, applied only on
  `:focus-visible` via the `.focus-ring` / `.focus-ring-inset` utilities.

### Theming
`data-theme` (16 palettes: coven, tide, grove, ember, bloom, dusk, mist, hex,
bane, slate, ghosty, claymorphism, claude, pastel-dreams, meatseeks, trucker)
× `data-mode` (dark/light) are orthogonal attributes on `:root`, hydrated by
`theme-script.tsx`. External shadcn themes import via tweakcn and are enriched
with the Cave's derived semantic tokens (`settings-shell.tsx` →
`enrichTweakcnTheme`). **Consequence: never hardcode a color; every surface
must survive all 32 palette×mode combinations.**

## 3. Signature idioms

These recur across every surface. Reuse them; don't reinvent.

### The 999px pill
The app's signature shape (44 uses in `globals.css` alone): chips
(`.ui-pill`), origin/initiator chips, the composer control pills, presence
and status dots, skeleton avatars, the empty-state icon circle. If a small
piece of metadata needs a container, it's probably a hairline-bordered pill.

### The tint recipe
State-colored badges/chips/banners always derive from one solid token:

```css
color:        var(--color-danger);                                     /* text: solid */
background:   color-mix(in oklch, var(--color-danger) 14%, transparent);  /* fill: 6–18% */
border-color: color-mix(in oklch, var(--color-danger) 38%, var(--border-hairline)); /* border: 30–45% */
```

Examples: board overdue chips (`board.css:378`), lifecycle badges
(`globals.css:1861-1902`), the flow failed badge, the host-status colors.
This is why every badge survives theme switches.

### Status dots
6px circles, colored by semantic tokens, often with a soft `box-shadow` halo:
familiar presence (`.shell-presence-dot`, accent), host online/offline
(`.cave-host-dot`, success/danger/muted), growth/run states. A dot means
live state; pair it with text (`online` / `offline`) when space allows —
color is never the only channel.

### Hairline cards & dashed affordances
Content sits on `--bg-raised` cards with `--border-hairline` and
`--radius-card`. **Dashed** hairlines mean "something can happen here":
empty columns, drop zones, quick-add triggers, the flow canvas coach. Solid
hairline = content; dashed hairline = invitation.

### Coaches & nudges
When a surface is empty-but-actionable, teach in place:
- Full-empty: `EmptyState` (`role="status"`, accent-tinted 48px icon circle,
  headline + subtitle + actions).
- Mid-canvas guidance: the flow coach pattern — floating dashed card,
  `backdrop-filter: blur(4px)`, concrete buttons, a `<kbd>` hint.
- Field-level warnings: warning-colored inline hints
  (`board-drawer-field-hint--nudge`) explaining what's blocked and how to fix
  it.
Every one of these states *what to do next*, not just what's missing.

### Popovers & modals
- Popover: the shared `ui/popover` scaffold — portal, auto-flip, Escape /
  outside-click / focus-return; `PopoverLabel` + `PopoverItem`
  (`menuitemradio` + trailing check for exclusive choices) + separators.
- Modal: breadcrumb header (`["Chat", "Connect a new host"]`, `›` separators,
  final segment bold), focus-trapped, footer split into PropertyPills (left)
  and Cancel + primary (right).

### Loading & failure
`SkeletonRows` shimmer for loading (falls to static 0.65 opacity under
reduced motion); `EmptyState` for nothing-here; `ErrorState` (`role="alert"`,
danger accent) for failure — with a retry action wherever retrying makes
sense.

## 4. Voice

The witchiness operates on **two levels, deliberately dosed**:

### Domain nouns (pervasive, load-bearing)
| Term | Meaning |
|---|---|
| **familiar** | an agent. Its identity contract is `SOUL.md` + `IDENTITY.md` + **`ward.toml`** (guardrails) + memory |
| **coven** | a multi-familiar group session; also the org/instance |
| **cave** | this app — the local control room (`~/.coven`, `cave-state.json`) |
| **sacrifice** | soft-delete a session (reversible; `sacrificedAt`) |
| **summon** | restore/unarchive a session |
| **ward** | a familiar's guardrail file |
| **grimoire** | the external docs portal (mind.opencoven.ai) |

These are API- and type-level names. Use them consistently; do not introduce
synonyms ("agent", "workspace", "restore") in UI copy where a domain noun
exists.

### UI flourish (sparse, concentrated)
The magic appears at **brand moments only**: the composer hero
(*"Summon something magical"*), the theme catalog register (*"Lavender-inked
grimoire. The house default; mind the runes."*), the delete/restore verbs.
The very next placeholder is plain (*"Describe a new task…"*). **Rule: one
flourish per surface, then back to utility.** A settings pane or an error
message is never in character.

### Working copy tone
Terse, sentence case, contractions, typographic punctuation ("Couldn't load
projects", curly quotes in search-empty states). Empty-state headlines are
short status fragments; subtitles always end in a concrete next step:
*"No projects yet — Add a project folder to group chats by codebase."*
Errors are gentle and specific, never blaming, and offer retry.

## 5. Iconography

Phosphor via a **two-bundle system** (`scripts/generate-icon-subset.mjs`,
wired into `prebuild`):
1. **Chrome bundle** — exactly the `ICON_NAMES` whitelist in
   `src/lib/icon.tsx` (~240 icons). `IconName` is a union type, so an
   unlisted name is a compile error.
2. **Glyph catalog** — the familiar-glyph picker set, one variant per base
   name, preferring `-fill`.

Weight conventions: `-bold` for chrome actions (plus, x, magnifying-glass,
gear), `-fill` for status/presence glyphs (check-circle, warning-circle,
paw-print), regular for inline content. Sizes come from the
`--icon-2xs..xl` ladder / `CAVE_ICON_SIZE` map — top chrome is pinned to
14px, inline dismiss to 12px.

**Adding an icon:** add to `ICON_NAMES`, run
`node scripts/generate-icon-subset.mjs`, commit the regenerated subset —
`icon-subset.test.ts` fails CI otherwise.

## 6. Motion & accessibility

Non-negotiables, all with existing primitives:

- **Announce state changes**: `useAnnouncer()` → the root `LiveRegionProvider`
  (polite `role="status"` + assertive `role="alert"`, auto-clearing at 250ms).
  Any mutation a screen-reader user would otherwise miss gets an
  `announce("Saved '<name>'.")`.
- **Focus is visible and returns home**: `.focus-ring`/`.focus-ring-inset` on
  interactive elements; popovers/modals restore focus to their trigger;
  deletes hand focus somewhere stable instead of dropping it on `<body>`.
- **Dialogs trap**: `useFocusTrap(active, ref, { onEscape })` for anything
  modal, including in-canvas panels.
- **Roles**: `role="status"` for empty/loading/pending, `role="alert"` for
  errors, `role="menu"`/`menuitemradio` for exclusive menus, `role="img"` +
  `aria-label` for meaning-bearing dots.
- **Reduced motion is honored twice**: globally (durations collapse) and per
  component (shimmers freeze, pulses stop). New animation needs its
  `prefers-reduced-motion` story at birth.
- **Color never carries meaning alone**: dots get labels, badges get words
  ("failed", "online"), accessible names fold in the visual-only chips.

## 7. Layout DNA

- **Tri-pane shell**: nav (240px, collapses to rail/peek) · list (260px) ·
  detail, resizable. The window never scrolls (`html,body { overflow:hidden }`);
  every pane owns its overflow.
- **Container queries over media queries**: surfaces respond to *their pane's*
  width (`@container composer (max-width: 480px)` …), because any surface can
  be split, docked, or narrowed independent of the viewport.
- **Heavy surfaces are lazy**: mode-gated views route through
  `lazy-surfaces.tsx` (`next/dynamic`, skeleton fallback) so the boot shell
  stays under the `bundle-budget.mjs` gate (650KB). A new heavy dependency
  belongs in a lazy chunk, full stop.
- **Compact by default, touch-safe on mobile**: 44px `--touch-target`,
  ≥16px inputs on touch (iOS zoom), safe-area insets tokenized.

## 8. Shipping checklist for a new surface

1. Tokens only — no hardcoded colors, radii, or font sizes; verify in dark
   *and* light, plus one non-default theme.
2. Reuse the primitives (`src/components/ui/`: Button, EmptyState, Skeleton,
   Popover, Modal, ViewHeader, SearchInput…) before writing new ones.
3. Empty, loading, and error states designed — each ending with a next step.
4. Announcer calls on mutations; focus rings; Escape/focus-return on anything
   that opens; reduced-motion story for anything that moves.
5. Container queries for narrow-pane behavior; lazy-load if the chunk is
   heavy; respect the bundle budget.
6. Copy: sentence case, terse, one flourish maximum, domain nouns not
   synonyms.
7. Source-text pin tests for the contracts you'd be sad to lose (this repo's
   convention — see the existing `*.test.ts` pin suites).

---

*Related: `/aesthetic` (live tokens) · `src/lib/theme-palettes.ts` (theme
roster + voice samples) · `docs/specs/*-design.md` (per-surface decisions) ·
`globals.css:11-212` (the annotated token contract).*
