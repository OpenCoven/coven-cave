# Coven design language

The consolidated reference for how Coven Cave looks, moves, speaks, and behaves —
written from the shipped product, with citations, so it stays verifiable. The
token contract itself lives in code — `src/styles/globals/foundations.css` (the
annotated token contract) plus per-theme overrides in
`src/styles/globals/themes.css`; `src/app/globals.css` is only the import
facade over the `src/styles/globals/*` modules — and on the live reference page
at `/aesthetic`; per-surface decisions live in `docs/specs/`. This document
ties them together and codifies the rules that were previously only implicit.
Factual claims below (palette counts, token values, cited paths) are pinned by
`scripts/ui-consistency.test.mjs`, so drift fails CI instead of accumulating.

**Code is authoritative for implemented visual and token behavior.
Section 10 is authoritative for interface language; tracked product deviations
are migration debt, not precedent. Reconcile every mismatch rather than
letting it drift.**

---

## 1. Brand foundations

- **Dark-first, graphite-inked, lavender-accented.** The default theme
  ("Coven", palette v1.3) is a dark UI on charcoal-graphite surfaces — oklch
  hue **291** with chroma pared back to a whisper — so the app *"reads as
  ink-and-graphite, not a tinted gray"* (the token contract's own words,
  `src/styles/globals/foundations.css`), with the violet reserved for the
  brand accent. Light mode is a complete, AA-retuned override
  (`[data-mode="light"]`), not an afterthought — every one of the 21 theme
  palettes ships both modes.
- **One palette, two vocabularies.** Tokens exist under shadcn-style names
  (`--background`, `--card`, `--muted`) *and* semantic aliases (`--bg-base`,
  `--bg-raised`, `--border-hairline`, `--text-*`). They resolve to the same
  colors (`src/styles/globals/foundations.css`). New CSS should prefer the
  semantic aliases.
- **All color is oklch**, and tints are derived, never hand-picked:
  `color-mix(in oklch, <token> N%, transparent)` (see §3).
- **The accent is presence first, call-to-action sparingly.**
  `--accent-presence` (`#9386d0` dark / `#6859ac` light — "OpenCoven
  lavender") marks familiar presence — presence dots, the health strip — and
  may fill **at most one designated primary CTA per surface** (the New chat
  button is the shipped example, cave-xr5z) using the pre-audited trio
  `--accent-presence` + `--accent-presence-foreground` +
  `--accent-presence-hover` (WCAG-AA pair, cave-c7hy). Never for secondary
  buttons, links, or decorative color: the brand color signals that something
  is alive, or the one thing to do next.
- **Desktop-app density.** Body baseline is **13px** (`--text-base`), labels
  go down to 10-11px, and `--text-muted` is deliberately tuned to
  `color-mix(… 72%, transparent)` dark / 76% light because lower mixes failed
  AA at those sizes on the full palette roster (a11y audit 2026-07,
  `src/styles/globals/foundations.css`). Density is a feature; illegibility
  is a bug.

## 2. Token contract (summary — authority is `src/styles/globals/foundations.css` + `/aesthetic`)

### Surfaces (dark defaults)
| Token | Value | Use |
|---|---|---|
| `--bg-panel` | `oklch(0.205 0.004 291)` | deepest: shell / sidebar floor |
| `--bg-base` | `oklch(0.225 0.004 291)` | page background |
| `--bg-raised` | `oklch(0.245 0.005 291)` | cards, panels |
| `--bg-elevated` | `oklch(0.275 0.006 291)` | popovers, dropdowns |
| `--bg-hover` | `oklch(0.305 0.007 291)` | hover state |
| `--bg-subtle` | 72% raised-surface mix | inline fills: chips, keycaps, recent-search pills |
| `--bg-sunken` | 88% base-toward-black mix | recessed wells: sticky strips, modal inputs |
| `--code-surface` | `oklch(0.12 0.012 280 / 92%)` | fixed "ink" for code |

Elevation is expressed by **stepping lightness up the same hue**, not by
shadows alone. A popover is lighter than a card is lighter than the page.

### Text
`--text-primary` (near-white) › `--text-secondary` (`oklch(0.66 0.010 291)`)
› `--text-muted` (72% foreground mix dark / 76% light). Three tiers; don't
invent a fourth.

### Semantic state
`--color-success` (green 158) · `--color-warning` (amber 78) ·
`--color-danger` (red 24) · `--color-info` (= accent). Each has a `-soft`
partner. Light mode retunes all of them for contrast — never hardcode a state
color.

### Structure
- Borders: `--border-hairline` (12% foreground mix) for nearly everything;
  `--border-strong` (48% dark / 60% light) for inputs and interactive
  boundaries — it must hold ≥3:1 against the base surface (WCAG 1.4.11).
  Because they derive from `--foreground`, they invert automatically in light
  mode.
- Radii: `--radius-control: 8px` · `--radius-card: 12px` ·
  `--radius-panel: 16px` · and the signature **999px pill** (§3), tokenized as
  `--radius-pill` so it tracks the corner-radius appearance setting.
- Spacing: 4px grid (`--space-1` … `--space-10`).
- Type: EB Garamond (display/hero) + Inter (body/UI) + JetBrains Mono (code/labels) — Coven canon per OpenCoven DESIGN.md §4. Geist stays in the selectable catalog but is no longer the shipped default. Ladder: `--text-2xs` (10px) →
  `--text-display` (28px); eyebrow tracking `0.08em` + uppercase for tiny
  labels.
- Motion: `--duration-fast: 120ms` / `base: 180ms` / `slow: 260ms` with the
  standard/emphasized/decelerate easings. Reduced-motion collapses all of it
  globally (`src/styles/globals/foundations.css`).
- Focus: `--ring-focus` (a **solid** 55% accent / 45% foreground mix — a
  keyboard indicator must hit 3:1, WCAG 1.4.11/2.4.13; the translucent
  `--ring-focus-soft` is decoration only), 2px, applied only on
  `:focus-visible` via the `.focus-ring` / `.focus-ring-inset` utilities.

### Theming
`data-theme` (21 palettes: coven, tide, grove, ember, bloom, dusk, mist, hex,
bane, slate, ghosty, claymorphism, claude, codex, pastel-dreams, meatseeks,
trucker, snow, contrast, beacon, solstice)
× `data-mode` (dark/light) are orthogonal attributes on `:root`, hydrated by
`theme-script.tsx`. External shadcn themes import via tweakcn and are enriched
with the Cave's derived semantic tokens (`settings-shell.tsx` →
`enrichTweakcnTheme`). **Consequence: never hardcode a color; every surface
must survive all 42 palette×mode combinations.**

## 3. Signature idioms

These recur across every surface. Reuse them; don't reinvent.

### The 999px pill
The app's signature shape (90+ uses across the global stylesheets): chips
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

Examples: board overdue cards (`src/styles/board/kanban-inspector.css`),
lifecycle badges (`.ui-lifecycle-badge`, `src/styles/globals/primitives.css`),
the flow failed badge, the host-status colors. For inline danger alerts the
recipe ships pre-mixed as `--danger-bg` / `--danger-border` / `--danger-text`.
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
| **cave** | this app — the local control room (`~/.coven/cave`, `state.json`) |
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
   `src/lib/icon.tsx` (~300 icons). Names are `ph:`-prefixed
   (`<Icon name="ph:plus-bold" />`), and `IconName` is a union type, so an
   unlisted name is a compile error.
2. **Glyph catalog** — the familiar-glyph picker set, one variant per base
   name, preferring `-fill`.

Weight conventions: `-bold` for chrome actions (`ph:plus-bold`, `ph:x-bold`,
`ph:magnifying-glass-bold`, `ph:gear-six-bold`), `-fill` for status/presence
glyphs (`ph:check-circle-fill`, `ph:warning-circle-fill`,
`ph:paw-print-fill`), regular for inline content. Sizes come from the
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

## 8. Chrome discipline & progressive disclosure

Density (§1) is about how much *content* fits; chrome discipline is about how
little *machinery* is allowed to sit on top of it. Powerful ≠ busy: every
capability stays reachable, but visibility is earned, not granted.

### The chrome budget

A surface header (or toolbar) shows at most **three always-visible actions plus
one overflow**. Everything else moves down the disclosure ladder. Tab strips
count: two stacked strips on one surface is over budget — merge or demote one.
Badges are chrome too: a badge means **live state** (running, failed, unread);
static metadata is muted text, not a pill.

### The disclosure ladder

Place every control on the lowest rung it can live on, by
`frequency × destructiveness`:

1. **Always visible** — the surface's primary verb(s) and anything used
   constantly (search, the single CTA).
2. **Reveal on hover/focus** — per-row/per-card secondary actions. Use the
   shared `.reveal-scope` / `.reveal-on-hover` utilities
   (`src/styles/globals/foundations.css`), never ad-hoc opacity: they
   guarantee keyboard parity (`:focus-within` reveal),
   touch parity (permanently visible on coarse pointers), a11y-tree presence
   (opacity-hide only), and token-driven motion.
3. **Overflow menu** — occasional actions. Use
   `src/components/ui/overflow-menu.tsx`
   (`OverflowMenu`): the standard "⋯" trigger + `PopoverItem` menu with
   `aria-haspopup`/`aria-expanded`, auto-close on select, and the Popover
   scaffold's Escape/focus-return for free.
4. **⌘K only** — rare, global, or expert actions. Anything relocated off rungs
   1–3 **must** be registered in the command palette so it stays one keystroke
   away.

**Relocation, never removal.** Minimalism passes may move a control down the
ladder; deleting a capability needs its own decision. Every relocated control
stays reachable in ≤2 interactions.

### Quiet hierarchy

- **One hairline per boundary.** Where two panes or a card and its container
  meet, exactly one border owns the seam — no double hairlines.
- **Prefer surface steps to borders.** Inside a card, separate regions with
  the elevation ladder (§2) and spacing, not nested boxes.
- **Selection summons tools.** Bulk-action toolbars appear with selection and
  leave with it (`src/components/ui/selection-toolbar.tsx`), not as permanent
  chrome.
- **Panels open on demand, closed by default.** Inspectors, debug panes, and
  secondary rails start closed; opening is one action (toolbar, overflow, or
  ⌘K) and the state persists per the surface's conventions.

## 9. Shipping checklist for a new surface

1. Tokens only — no hardcoded colors, radii, or font sizes; verify in dark
   *and* light, plus one non-default theme. On-scale px literals are
   auto-fixable in CSS with `node scripts/codemods/tokenize-css.mjs` and in
   component TSX with `pnpm codemod:design`. CSS judgment cases remain
   down-only ratchets in `src/lib/design-token-drift.test.ts`; `pnpm lint`
   rejects raw pixel text classes, fully static JSX style objects, and
   hexadecimal render colors in components.
2. Reuse the primitives (`src/components/ui/`: Button, EmptyState, Skeleton,
   Popover, Modal, ViewHeader, SearchInput…) before writing new ones.
3. Chrome within budget (§8): ≤3 always-visible actions + one `OverflowMenu`;
   secondary row actions on `.reveal-on-hover`; relocated actions in ⌘K.
4. Empty, loading, and error states designed — each ending with a next step.
5. Announcer calls on mutations; focus rings; Escape/focus-return on anything
   that opens; reduced-motion story for anything that moves.
6. Container queries for narrow-pane behavior; lazy-load if the chunk is
   heavy; respect the bundle budget.
7. Copy follows §10: sentence case, persistent labels, canonical placeholders,
   actionable state copy, one flourish maximum, and domain nouns rather than
   synonyms.
8. Source-text pin tests for the contracts you'd be sad to lose (this repo's
   convention — see the existing `*.test.ts` pin suites).

## 10. Interface copy and field contract

The visual rules above and the language rules below form one interface
contract. Contextual prose stays with its surface; reusable components own
control semantics, state hierarchy, and accessibility.

### Vocabulary

- **Tasks** is the top-level user-facing noun in navigation, mobile tabs,
  headings, commands, empty states, and actions. Use **task board** when the
  kanban/table layout itself matters. Do not use bare **Board** as a
  destination.
- Use **task** instead of visible **card** unless describing card-shaped
  presentation. Internal card types and APIs do not need cosmetic renames.
- Use **chat** for a conversation people open and **session** only for
  execution, debugging, or connection contexts where the distinction matters.
- Keep the domain nouns in §4. Use **scheduled job** in ordinary interface
  copy; reserve **cron** for cron syntax and scheduler diagnostics.
- Use **project** for the user-facing codebase container. Use **working
  directory** or `cwd` only when the filesystem concept is the actual field.

### Action copy

- Use sentence case, active voice, and the action's real verb: **Save changes**,
  **Create task**, **Open settings**, **Retry**.
- Avoid generic **Submit**, **OK**, and **Confirm** when the actual operation is
  known.
- Keep one verb through the lifecycle: **Publish** → **Publishing…** →
  **Published**.
- Icon-only controls need state-aware accessible names. Toggle names describe
  the next action: **Pin chat** / **Unpin chat**.
- Name destructive objects and consequences. Prefer undo for reversible
  actions; use confirmation for irreversible actions.

### Field semantics

- Every editable control has a persistent visible label or an equally durable
  accessible name for a self-explanatory global control. A placeholder never
  replaces a persistent label.
- Put purpose in the label, constraints in help text, and repair instructions
  in the error slot. One string does not perform multiple jobs.
- Mark optional fields beside the label with **Optional**. Required controls
  use native required semantics rather than decorative asterisks.
- Connect help and errors with `aria-describedby` on React and equivalent
  native accessibility semantics. Invalid controls expose their invalid state
  programmatically.

### Placeholder grammar

Placeholders show an example, expected format, or input intent. They do not
repeat the label, hold required instructions, disguise a default value, or
carry a keyboard shortcut that disappears while typing.

- Search a known collection: `Search <items>…`
- Narrow a visible collection: `Filter <items>…`
- Open a deferred choice: `Choose <item>…`
- Create or compose: `Describe the task…`, `Message Sage…`, `Add a note…`
- Show format: `e.g., owner/repository` or `e.g., 0 9 * * 1-5`
- Secret input: `Paste personal access token`, paired with a provider-specific
  label

Use the single ellipsis character `…`, never three periods. Put optionality,
shortcut hints, and critical constraints in persistent text outside the
placeholder.

### State copy

- Name small loads: **Loading tasks…**, not bare **Loading…**. Use skeletons
  when the content shape is known.
- A true empty state has a short status headline, a concrete next step, and an
  action when the person can resolve it.
- A filtered empty state names the scope or query and offers **Clear filters**
  where appropriate.
- Never render a failed request as a convincing empty collection. Use
  **Couldn't load <object>**, safe diagnostic detail, and a concrete recovery
  action such as **Retry** or **Open settings**.
- Announcements and toasts use the same action vocabulary as the visible
  control.

---

*Related: `/aesthetic` (live tokens) · `src/lib/theme-palettes.ts` (theme
roster + voice samples) · `docs/specs/` (per-surface `*-design.md` decisions) ·
`src/styles/globals/foundations.css` (the annotated token contract) ·
`src/styles/globals/themes.css` (per-theme palettes) ·
`src/styles/globals/primitives.css` (shared `.ui-*` classes).*
