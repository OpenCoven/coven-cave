# Coven Cave — Interface Redesign Spec

Grounded in the shipped token contract (`src/styles/globals/foundations.css`), the Coven design language doc (§1–§10), and `src/lib/keyboard-shortcuts.ts`. Values quoted from source are marked **(shipped)**; new values are marked **(new)**.

## Executive summary

- **Core diagnosis:** four competing "resume work" surfaces (Running-activity popover, ⌘K recents, Sessions list, "Pick up existing work") plus an unbounded chat-switcher, all keyed on raw prompt text — the app has quantity but no *identity* for a session and no *priority* for the user.
- **One fix unlocks most of it:** a canonical **Session** record with a generated ≤40-char title, a one-line metadata spec, and a six-state status taxonomy. Every list, popover and card renders the same `SessionRow`; truncation, status colour and ordering become one implementation.
- **Consolidate to two resume surfaces:** the Sessions pane (browse) and ⌘K (jump). The activity popover becomes a **Needs you** inbox (awaiting/blocked only); the home "Pick up" strip and the chat-switcher dropdown are deleted.
- **Legibility:** imagery moves to a hero band above a 92%-opaque `--bg-base` well, never behind body text; overlays get a 55% scrim + 12px blur and an opaque `--bg-elevated` panel — background text can no longer bleed through.
- **Attention without alarm:** red is reserved for *failed*. "Awaiting you" is amber, ordered by wait-time × ownership, capped at one section with a real count; badges show only actionable counts (never `99+` rituals).

---

## 1. Diagnosis

| # | Pri | Issue | Heuristic violated | User cost |
|---|---|---|---|---|
| 1 | P0 | Rows identified by raw prompt text cut mid-word ("Persistent blo… -windows-acl") | Recognition over recall; match between system and real world | Users can't tell 15 awaiting items apart; wrong-session opens, re-reading transcripts to orient |
| 2 | P0 | Photographic background behind body text, chips and hero panel at ~40% opacity | Aesthetic & minimalist design; WCAG 1.4.3 | Contrast varies per pixel; hero copy and recent-chat cards fall below 4.5:1 over the cat's fur |
| 3 | P0 | Overlay scrims too weak — drawer transcript reads through the Running-activity popover | Visibility of system status; figure/ground | Two text layers overlap; popover rows misread; eye strain |
| 4 | P0 | Chat-switcher dropdown: unbounded, unstyled, mixes chats / signals / branches / PR states | Consistency; recognition; chunking | Viewport-height list with 20+ undifferentiated strings; unusable at 200 sessions |
| 5 | P1 | Four overlapping "resume work" surfaces | Consistency & standards; minimalism | Users don't know which is authoritative; each has different ordering and truncation |
| 6 | P1 | Two composers visible (hero + drawer) with no focus indication | Visibility of system status; error prevention | Messages sent to the wrong familiar/thread; hesitation before every send |
| 7 | P1 | Ad hoc status language (COMPLETED, Still waiting, Left hanging, done, red/green dots) | Consistency; colour-only meaning | Same state has 3 spellings; red-tinted rows read as *errors* when they are *waiting* |
| 8 | P1 | Counts without action ("9+", "156 running", "Rituals 99+", "1 / 123") | Visibility of status; signal vs noise | Badges are permanent, so they stop meaning anything; nothing tells the user what *needs* them |
| 9 | P2 | Density/radius/type drift — mono eyebrows, sans body, serif titles, pills and rounded-rects mixed at the same level | Consistency | Perceived unpolish; harder to scan because shape no longer encodes meaning |
| 10 | P2 | Hero eyebrow "NEW CHAT · CODY · DEEP NIGHT IN THE CAVE" + prompt + repo line in three type systems | Aesthetic & minimalist design | Flourish budget blown (design-language §4: one flourish per surface) |

---

## 2. Information architecture

### Canonical model

```
Session  (the one unit every list renders)
├─ kind:      chat | task | ritual-run
├─ title:     generated ≤40 chars, user-editable, stable after first generation
├─ familiar:  Cody | Nova | Thoth …
├─ context:   { project, repo, branch?, pr? }
├─ status:    running | awaiting | blocked | completed | failed | idle
├─ signals[]: derived facts (Low signal score, Persistent blocker…) — NEVER sessions
└─ times:     startedAt, lastActivityAt, awaitingSince?
```

- **Chat** — a Session with `kind=chat`, human-paced. Lives in the Sessions pane.
- **Task** — a Session with `kind=task`, autonomous, has steps and a run header. Same pane, filtered by kind; the Tasks board (⌘3) is a *view* of the same records, not a second list.
- **Ritual** — a *definition* (schedule + workflow). Its executions are Sessions with `kind=ritual-run` and appear in Sessions only when they need a human (awaiting/blocked/failed), per README ("Routine success stays quiet").
- **Signal** — a derived annotation on a Session (`Persistent blocker · 1 signal`). Rendered as a chip inside the row's metadata line. Never a row, never a list entry.

### Surfaces: keep / merge / delete

| Surface today | Decision | Rationale |
|---|---|---|
| Sessions pane (list) | **Keep — the browse surface.** Groups: Pinned · Needs you · Running · Recent (Today / Yesterday / 7d / 30d) | Only surface with room for status + metadata |
| ⌘K palette recents | **Keep — the jump surface.** Recents = last 6 sessions by `lastActivityAt`, same `SessionRow` compact variant | Palette is for typing a name; it needs titles to work at all |
| Running-activity popover (156 items) | **Merge → "Needs you" inbox.** Shows only awaiting/blocked/failed; running count shown as text in footer with link to Sessions › Running | A 156-row popover is a list, not a popover |
| Home "Pick up existing work" strip + `1/123` pager | **Delete.** Home shows ≤3 *Needs you* items or nothing | Duplicates Sessions with worse truncation |
| Chat-switcher dropdown (drawer title) | **Delete.** Replace with ⌘K scoped to the drawer (`⌘K` while drawer focused pre-filters `kind` and project) | Unbounded flat list can't scale |
| Home recent-chat cards | **Delete.** | Third copy of recents |

Result: **two** resume surfaces (browse, jump) plus **one** attention surface (Needs you). Every other "recent" list is gone.

---

## 3. Title & truncation system

### Title generation (≤40 chars)
1. If the prompt starts with an imperative verb, keep the verb phrase up to the first clause boundary (`,` `—` `:` `until` `so that`) — e.g. *"Review and audit the codebase"*.
2. Strip URLs, quoted skill names (`"issue-to-merged-pr"` → *issue-to-merged-pr*), and leading "Task:" / "Run this as".
3. If a GitHub issue/PR is referenced, title = `#<n> <issue title>` (fetched), fallback `Issue #<n>`.
4. Hard cap 40 chars at a word boundary; append nothing (no ellipsis — the cap is the design, not an overflow).
5. Generated once at session start; regenerated only if the first user turn is edited. Users can rename; renamed titles never auto-regenerate.
6. Collision rule: if two sessions in the same group share a title, append ` · 2`, ` · 3`.

### Metadata line (one line, 12px, `--text-secondary`)
```
{familiar} · {repo-or-project} [· {branch}] · {status word} · {relative time}
Cody · coven-cave · fix/cave-9jt60…windows-acl · Awaiting you · 4d
```
- Omit segments that repeat the pane's current filter (inside the Cody filter, drop *Cody*).
- Signals render after status as a hairline pill: `1 blocker`.
- Max two hidden segments; the row never wraps in Compact, may wrap to 2 lines in Comfortable.

### Middle truncation (branches, PRs, paths)
- Branch: keep first segment + `/` + first 6 chars, `…`, last 12 chars → `fix/cave-9…windows-acl`. Minimum visible 22 chars.
- PR: `PR #5385 · merged` — number and state are never truncated; PR title is dropped before the number is.
- Path/URL: keep host and final segment: `github.com/…/sdk/issues/41`.
- Row title itself uses **end** truncation with CSS `text-overflow: ellipsis` only as a safety net (titles are already ≤40).

### Hover / expand
- Hover 400ms → tooltip with full title, full first prompt line (≤240 chars), and untruncated branch/PR; tooltip width 360px, `--bg-elevated`, hairline border.
- Focused row + `Space` → inline expansion of the metadata line to full text (keyboard parity).
- 500-char prompts: never rendered in a list. Full prompt only in the transcript.

---

## 4. Layout specs

Spacing scale: 4 / 8 / 12 / 16 / 24 / 32 (`--space-1 … --space-8`). Breakpoints are *pane* container queries, but shell behaviour by window width:

| Window | Nav | List pane | Detail | Right drawer |
|---|---|---|---|---|
| 1280 | 56px rail (icons, labels on hover) | 260px | flex ≥ 640 | overlay, 420px, scrim |
| 1600 | 240px | 280px | flex ≥ 720 | docked 400px |
| 2000+ | 240px | 300px | flex, content max-width 880 centred | docked 460–520px (drag) |

Drawer collapses to overlay when `detail < 640px`.

### 4.1 Home (empty state)
```
┌ nav 240 ─┬──────────────────────── detail (flex) ────────────────────────┐
│          │  ▒▒▒▒▒▒▒▒▒▒ hero band: imagery, 200px tall, 0 text ▒▒▒▒▒▒▒▒▒▒ │
│          │  gradient → --bg-base at 200px (opaque below)                  │
│          │                                                                │
│          │        ┌──────── well max-width 760, padding 32 ────────┐      │
│          │        │ What are we casting today?      (28px Garamond) │      │
│          │        │ Cody · coven-cave               (13px secondary)│      │
│          │        │ ┌──────────── composer 100% ──────────────────┐ │      │
│          │        │ │ Message Cody…                     min-h 88  │ │      │
│          │        │ │ [Cody ▾][Chat|Task][GPT-6 Astra ▾]    [↑ ↵] │ │      │
│          │        │ └─────────────────────────────────────────────┘ │      │
│          │        │ NEEDS YOU · 3                     (11px eyebrow)│      │
│          │        │ ● #41 Windows ACL revert · Cody · Awaiting · 4d │      │
│          │        │ ● Capability gap review · Nova · Blocked · 2d   │      │
│          │        │ ● Discord poll announce · Thoth · Failed · 5d   │      │
│          │        │                      Open Needs you (⇧⌘A)  →   │      │
│          │        └─────────────────────────────────────────────────┘      │
└──────────┴────────────────────────────────────────────────────────────────┘
```
- Hero band height 200 (1600px window) / 160 (1280) / 240 (2000+). Image has `object-position: 50% 30%`; the band contains **no text** — the eyebrow flourish ("Deep night in the cave") sits as an 11px label at the top-left of the well, the single flourish for the surface.
- Well: `--bg-base` at 100% opacity, `--radius-panel`, no border; it overlaps the band by 40px so the image reads as "behind" the room.
- Needs-you block: max 3 rows, 44px each; hidden entirely when count is 0 (no empty section).

### 4.2 Chat + drawer split (1600)
```
┌ nav 240 ┬ sessions 280 ┬──────── transcript (flex, prose 66ch) ────────┬ drawer 400 ┐
│         │ [Search ⌘F ] │ ┌ ViewHeader 48 ─────────────────────────────┐│ ┌ header 48┐│
│         │ PINNED 2     │ │ ● #41 Windows ACL revert   [Completed]  ⋯ ││ │ Task ⋯ ✕ ││
│         │ NEEDS YOU 15 │ ├ run header 36 (collapsed) ─────────────────┤│ ├──────────┤│
│         │ RUNNING 12   │ │ ▸ Last run · 152 steps · 1h 02m · 7 done   ││ │ steps    ││
│         │ TODAY 2      │ ├────────────────────────────────────────────┤│ │ (scroll) ││
│         │ YESTERDAY 1  │ │  transcript, 16px/1.55, max-width 66ch     ││ │          ││
│         │ 7 DAYS 2     │ │                                            ││ │          ││
│         │              │ ├ composer (single, focused) ────────────────┤│ │          ││
│         │              │ │ Message Cody…                              ││ │  no      ││
│         │              │ │ [Cody ▾][GPT-6 Astra ▾]       [Tools][↑]  ││ │ composer ││
└─────────┴──────────────┴────────────────────────────────────────────────┴────────────┘
```
- **One composer per window.** The drawer is a *run inspector* (steps, tool calls, metadata) and has no composer. To message a task, the transcript composer is used; its header pill reads `→ Cody · #41 Windows ACL revert` so the destination is always named.
- Focused composer: 2px `--ring-focus` + `--bg-raised`; unfocused: `--bg-sunken` and 60% opacity controls.
- Transcript measure 66ch (design-language §7), body 15px/1.55 in Comfortable, 14px/1.5 in Compact.

### 4.3 Sessions list pane
- Width 260–320 (drag). Header 48: search input (⌘F), density toggle in overflow.
- Group header 28px: 11px eyebrow, `letter-spacing .08em`, count as muted text (not a pill) — `NEEDS YOU · 15`.
- Row heights: **Compact 44** (title 13 + meta 11, 1 line), **Comfortable 56** (title 14 + meta 12).
- Row anatomy (left→right): 6px status dot (col 20) · familiar mark 20px (col 28) · title/meta (flex) · relative time 11px mono (col 36) · reveal-on-hover actions (pin, ⋯).
- Group collapse persists; groups > 8 rows show `Show 9 more` as a 36px row.
- Virtualised list; 200+ items is the tested case.

### 4.4 Needs-you popover (replaces Running activity)
```
┌─ 420 × max 560 ────────────────────────────────┐
│ Needs you · 15                     Mark all seen│ sticky header 44
├─────────────────────────────────────────────────┤
│ ● #41 Windows ACL revert         Awaiting · 4d  │ 44 rows, internal scroll
│   Cody · fix/cave-9…windows-acl · 1 blocker     │
│ ● …                                             │
├─────────────────────────────────────────────────┤
│ 12 running · 3 idle           Open Sessions  →  │ sticky footer 40
└─────────────────────────────────────────────────┘
```
- Anchored to the toolbar button, 8px offset, `--bg-elevated`, `--radius-card`, hairline border, shadow `0 12px 32px rgb(0 0 0 / .45)`.
- Body: `max-height: min(560px, 100vh − 96px)`, `overflow-y: auto`, `scroll-padding-top: 44px`.
- Order: blocked → failed → awaiting, then by `awaitingSince` ascending (longest wait first).
- Empty state: `EmptyState` "Nothing needs you" + "12 sessions running quietly."

### 4.5 Command palette
- Width 640, top offset 12vh, `max-height: 70vh`. Input row 56 (16px text). Scope segmented row 40: `All · Chats · Tasks · Rituals · Memory · Actions` with counts as muted text.
- Results: section eyebrow 28 + rows 44 (compact `SessionRow`), max 6 per section before "Show all in Sessions".
- `Go to` rows: 40px, label 13px sans (not mono), shortcut keycap right-aligned.
- Footer 36 sticky: `↑↓ navigate · ↵ open · ⇧↵ open in drawer · esc`.
- Scrim: see §5.

---

## 5. Design tokens

### Surfaces (shipped, dark)
| Token | Value | Role |
|---|---|---|
| `--bg-panel` | `oklch(0.205 0.004 291)` | shell / nav floor |
| `--bg-base` | `oklch(0.225 0.004 291)` | page, Home well |
| `--bg-raised` | `oklch(0.245 0.005 291)` | cards, focused composer |
| `--bg-elevated` | `oklch(0.275 0.006 291)` | popovers, palette, tooltips |
| `--bg-hover` | `oklch(0.305 0.007 291)` | hover rows |
| `--bg-sunken` | 88% base→black | unfocused composer, sticky strips |
| `--accent-presence` | `#9386d0` | presence, focus ring base, ONE primary CTA |

### Status set (new — solid text/dot colour on `--bg-raised`, all ≥ 4.5:1)
| Status | Token | Value (dark) | Word | Dot | Fill (14%) |
|---|---|---|---|---|---|
| running | `--status-running` = `--accent-presence` | `#9386d0` | Running | pulsing (reduced-motion: static) | no |
| awaiting | `--status-awaiting` = `--color-warning` | `oklch(0.83 0.13 78)` | Awaiting you | solid | yes, on row |
| blocked | `--status-blocked` (new) | `oklch(0.80 0.12 55)` | Blocked | solid | yes, on row |
| completed | `--status-completed` = `--color-success` | `oklch(0.78 0.14 158)` | Completed | solid | badge only |
| failed | `--status-failed` = `--color-danger` | `oklch(0.74 0.18 24)` | Failed | solid | badge only |
| idle | `--status-idle` = `--text-muted` | 72% fg | Idle | hollow ring | no |

Rule: **row tint only for awaiting/blocked**; failed is a badge, never a tinted row (a row-wide red field is what produced the alarm wall). Tint recipe is the shipped one: fill 14%, border 38% of the status token.

### Type
| Role | Size/line | Family |
|---|---|---|
| display | 28/34 | EB Garamond 500 |
| title-lg | 18/24 | Inter 600 |
| body | 13/20 (Compact) · 14/22 (Comfortable) | Inter 400 |
| transcript | 14/1.5 · 15/1.55 | Inter 400 |
| meta | 11/16 · 12/16 | Inter 400, `--text-secondary` |
| eyebrow | 11/16, `.08em`, uppercase | Inter 500 |
| mono label | 11/16 | JetBrains Mono (time, shortcuts, branch) |

### Radii · borders · focus
`--radius-control 8` (buttons, inputs) · `--radius-card 12` (rows-as-cards, popovers) · `--radius-panel 16` (Home well, drawer) · `--radius-pill 999` (chips, dots, badges). Hairline `--border-hairline` (12% fg) for structure; `--border-strong` (48% fg) on inputs. Focus: 2px solid `--ring-focus`, offset 2px, `:focus-visible` only; inside tinted rows the ring sits *inside* (`.focus-ring-inset`).

### Scrim, blur, imagery (new)
| Layer | Value |
|---|---|
| Modal/palette scrim | `oklch(0.12 0.01 291 / 0.55)` + `backdrop-filter: blur(12px)` |
| Popover (non-modal) | no scrim; panel is **100% opaque** `--bg-elevated` |
| Drawer-as-overlay (<1600) | scrim `/ 0.35`, blur 8px |
| Hero band → well | gradient `transparent → --bg-base` over last 80px of band |
| Reduced-transparency | scrim → `/ 0.85`, blur 0; all translucent panels → opaque |

**Imagery rule:** photographs may appear (a) in the Home hero band, (b) as familiar avatars, (c) in Marketplace cards. Never behind text with more than 11px eyebrow weight, never behind inputs or list rows, never under a popover. The 40%-opaque hero panel is retired.

---

## 6. Component redesigns

**Session row** — Before: 2-line row, raw prompt end-truncated, red row tint, "Still waiting" in red, familiar initials pill, time right. After: status dot → familiar mark → *generated title* (13/600) → metadata line (11, secondary) with middle-truncated branch and signal pill → mono time. Tint only for awaiting/blocked (amber 14%). Hover reveals pin/⋯. 44/56px.

**Status badge** — Before: uppercase `✓ COMPLETED` pill in green outline, plus separate dots and free-text. After: one `LifecycleBadge` per session: dot + sentence-case word, 11px, pill, tint recipe; six words only. Badge appears in headers; rows use dot + word in meta.

**Metadata chip cluster** — Before: three rounded-rect chips `Effective model: gpt-6-astra` etc. After: a single `PropertyPill` row inside the run header: `gpt-6-astra · familiar default · github/coven-cave`; each pill is hairline, 11px, key hidden, value shown, key on hover. Chrome budget: ≤3 pills + overflow.

**Count badge** — Before: `68`, `99+`, `9+`, permanent. After: badges show **actionable** counts only (awaiting+blocked+failed). Cap at `99`, then `99+` only in the Needs-you header. Rituals nav shows no count (definitions aren't work); Tasks shows only its awaiting count. Running count is muted text in the Sessions header, never a badge.

**Composer** — Before: two composers, Chat/Task tabs inside, model pill on a second row, Tools tab floating on the border. After: one composer; header pill names destination (`→ Cody · #41…`); bottom bar left→right: familiar `▾`, mode segmented `Chat | Task`, model `▾`; right: Tools, mic, send. Focus ring on container. Min-height 88, max 40vh, then internal scroll.

**Collapsible run header** — Before: `steps 152 · active 1h 02m` strip + separate "Last run 7 done ✕" strip. After: one 36px strip: `▸ Last run · 152 steps · 1h 02m · 7 done · Completed`; expands to the step list inside the drawer; `✕` removed (the strip persists; collapse is the dismiss).

---

## 7. Attention model

- **Definition:** a session *needs you* when `status ∈ {awaiting, blocked, failed}` and the user hasn't opened it since `awaitingSince`.
- **Ordering:** blocked > failed > awaiting; within a class by `awaitingSince` ascending; pinned items float to top of their class.
- **Single destination:** the Needs-you popover (⇧⌘A, toolbar bell). Home shows the top 3; Sessions has a *Needs you* group. Same rows, same order, same data.
- **Badge rules:** toolbar badge = needs-you count; nav Tasks badge = needs-you count for tasks; opening a session clears it from the count. No badge ever shows *total* volume.
- **Notification rule (per README):** one notification per run/mission, updated in place, cleared on resolution.
- **No alarm wall:** amber tint at 14% for awaiting/blocked rows only; failed gets a red *badge*; group header count is muted text. Maximum visual weight in a list: one tinted group.

---

## 8. Keyboard & a11y

| Keys | Action | Status |
|---|---|---|
| ⌘K | Command palette | shipped |
| ⌘N | New chat | shipped |
| ⌘1–⌘5 | Home / Chat / Tasks / Rituals / Browser | shipped |
| ⌘9 | Projects | shipped |
| ⌘B · ⌘\ · ⇧⌘B | Toggle nav · list pane · right drawer | shipped |
| ⌘F | Focus sessions search | shipped |
| ⌥1–⌥9 · ⌘↑/↓ | Select / cycle familiar | shipped |
| **⇧⌘A** | Open Needs-you popover | **new** |
| **⌘⇧K** | Palette scoped to current project (replaces chat-switcher) | **new** — migration: dropdown trigger becomes a button that opens this |
| **J / K, ↵, Space** | Sessions pane: next/prev row, open, expand metadata | **new** |
| **⌘, / ⌘.** | Density Compact / Comfortable | **new** |
| **⌥⌘D** | Toggle drawer as inspector | **new** — replaces ⌥↵ split behaviour? No: ⌥↵ unchanged |

- **Focus order:** nav → sessions search → sessions list → transcript header → transcript → composer → drawer. `Tab` moves between panes; arrows move within lists. Focus never lands on `<body>` after a close.
- **Icon-only buttons:** `aria-label` state-aware (`Pin chat` / `Unpin chat`, `Open Needs you, 15 items`). Status dots `role="img" aria-label="Awaiting you"`.
- **Reduced motion:** running-dot pulse → static; skeleton shimmer → 0.65 static; popover fade → instant.
- **Reduced transparency:** all blur off, scrims 85%, hero band gradient replaced by a hard edge.

---

## 9. Density modes

| Property | Compact | Comfortable |
|---|---|---|
| Session row | 44 | 56 |
| Body text | 13/20 | 14/22 |
| Transcript | 14/1.5 | 15/1.55 |
| Group header | 28 | 32 |
| Composer min-height | 72 | 88 |
| Popover row | 44 | 52 |
| Chip height | 20 | 24 |

Set once at `:root` (`data-density`); components read tokens, never per-view props. A view cannot override density (lint rule: no `data-density` below root).

---

## 10. Roadmap

**Phase 1 — Legibility & truncation (2–3 wks)**
Title generator + metadata line · middle-truncation util · Home hero band + opaque well · scrim/blur tokens · opaque popovers · single status taxonomy words · retire red row tint.

**Phase 2 — IA consolidation (3–4 wks)**
Unified `SessionRow` · delete Pick-up strip, recent cards, chat-switcher · Running-activity → Needs-you · palette recents on `SessionRow` · drawer loses composer, gains destination pill · virtualised sessions list.

**Phase 3 — Attention model & polish (2–3 wks)**
Actionable-only badges · ⇧⌘A, J/K, density shortcuts · notification in-place updates · density tokens + lint · reduced-transparency fallbacks · tooltip/expand behaviour.

---

## QA checklist

- [ ] No list row renders more than 40 chars of title; branches middle-truncate to ≥22 visible chars.
- [ ] Every status word is one of: Running, Awaiting you, Blocked, Completed, Failed, Idle.
- [ ] Only awaiting/blocked rows carry a tint; failed rows carry a badge, no tint.
- [ ] No text sits over a photograph except the 11px eyebrow; hero well is 100% `--bg-base`.
- [ ] Popovers are opaque `--bg-elevated`; palette scrim is 55% + 12px blur; drawer text is not visible through any popover.
- [ ] Exactly one composer is mounted per window; its header names the destination.
- [ ] Nav badges show actionable counts only; Rituals shows none.
- [ ] Needs-you popover: sticky header/footer, internal scroll, `max-height ≤ 560`.
- [ ] 200 sessions: list scrolls at 60fps (virtualised), grouped, no viewport-height dropdowns.
- [ ] All status text ≥ 4.5:1 on `--bg-raised` in dark and light; focus ring ≥ 3:1.
- [ ] `prefers-reduced-motion` and reduced-transparency both change output.
- [ ] Shipped shortcuts (⌘K, ⌘N, ⌘1–⌘5, ⌘9, ⌘B, ⌘\, ⇧⌘B, ⌘F) unchanged; new ones listed in the shortcuts sheet.

## Three riskiest assumptions

1. **Generated titles are good enough to replace prompt text.** Test: label 50 real sessions with the generator, ask 5 users to find a named session in the list; success ≥ 90% in < 5s, else add issue-title fetch earlier in the pipeline.
2. **Removing the drawer composer won't break the "reply to a task while reading another chat" flow.** Test: log how often the drawer composer is used today with a *different* session focused in the main pane; if > 10% of drawer sends, keep a drawer composer but only when the drawer is the focused pane, with the destination pill.
3. **Users accept "running" leaving the badge.** Test: A/B the Needs-you badge vs total-count badge for two weeks; measure time-to-open for awaiting items and popover open rate; keep whichever lowers median wait time on awaiting sessions.
