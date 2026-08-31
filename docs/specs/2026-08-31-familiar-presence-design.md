# Familiar Presence — design direction for Cave

**Subject:** Coven Cave, the desktop control room where familiars (Nova, Cody,
Charm, Echo, Astra, Kitty, Salem...) work on Val's behalf.

**Audience:** a single operator who trusts the system with real repos and real
actions.

**The one job:** make the operator *feel* — without reading a manual — that each
familiar is intelligent, careful, and part of one coordinated organism.

## The thesis (and the trap)

The generic answer to "make AI feel intelligent" is sparkles, pulsing orbs,
purple gradients, and "thinking..." shimmer. All of it is *claimed*
intelligence. Cave should do the opposite:

> **Never claim. Always show the receipt.**

Intelligence is shown by evidence of judgment. Mindfulness is shown by visible
restraint. Coordination is shown by a shared grammar. Distinctness lives *only*
in voice, accent, and glyph — never in layout. That inversion (most products
differentiate agents by layout and unify voice; Cave unifies structure and
differentiates voice) is the aesthetic risk, and it is what makes the hive read
as one organism of distinct minds.

## Four principles to concrete mechanisms

### 1. Intelligence = typed, specific status (kill the spinner)

Generic "working..." reads as machinery. Specific phase verbs read as a mind at
work.

- Extend `auto-status-card.tsx` status notes into **typed phase lines** per
  lane:
  - Cody: `reading diff · 14 files` → `running tests · 34/34` → `verified`
  - Echo: `reviewing 3 daily files` → `distilled 2 lessons`
- Every completed claim carries a **receipt chip**: a monospace fragment (path,
  SHA, test count, URL) the operator *could* check. Receipt chips are the
  signature element — see below.
- Adaptivity is shown by **visible pivots**: when a familiar changes approach,
  render one quiet line — `pivot: lockfile stale → reinstalling first`. A mind
  that narrates its course corrections reads as adaptive; one that silently
  succeeds reads as a script.

### 2. Mindfulness = restraint made visible

The most trustworthy thing an agent can show is what it *chose not to do*.

- **Held-back lines:** when a familiar defers (heartbeat silence, "Charm owns
  this", "needs your approval"), show it as a dimmed, low-contrast entry —
  present but quiet. Restraint gets a visual register: reduced opacity, no
  accent.
- **Proposal-before-action everywhere:** the existing gate pattern
  (`acting-familiar-gate.tsx`, GitHub proposal cards) is already right —
  generalize it. Anything irreversible renders as a card *waiting for a tap*,
  visually distinct from anything done. Done things get receipts; proposed
  things get a border and a verb.
- **Calm idle:** no ambient pulsing, no breathing orbs. A familiar at rest is
  *still*. Motion only when state actually changes. Stillness is what mindful
  looks like.

### 3. Hive = one grammar, visible batons

Coordination is shown at the seams — the handoffs.

- **Baton pass:** when Nova routes work to Cody, it is the *same* task card;
  only the familiar chip changes, with a single shared slide-and-settle motion,
  and a ledger line appends: `Nova → Cody · implementation`. The card's
  continuity says "one organism"; the chip change says "distinct minds."
- **Constellation strip:** a slim, always-available strip (sidebar or Board
  header) showing every active familiar as glyph + current phase verb on one
  shared timeline. Not a dashboard — a glance. When two familiars touch the
  same repo, their entries link with a hairline connector.
- **One motion grammar:** a single easing family and choreography for the whole
  Coven. Familiars may differ in *tempo* (Cody snaps, Charm eases) but never in
  choreography. Like a murmuration: one flight rule, many birds.

### 4. Distinct = voice, accent, glyph — nothing else

- **Structure is shared:** one card anatomy, one type scale, one spacing system
  across all familiar surfaces (`familiar-inline-card.tsx`, work queue, tabs).
- **Identity is carried by three channels only:**
  1. **Accent hue** — the existing per-familiar accent token, used with
     discipline: chip, focus ring, receipt underline. Never floods.
  2. **Glyph** — the `FamiliarGlyph` mark, the familiar's face at every size.
  3. **Voice register in microcopy** — each familiar's status verbs and empty
     states are written in its lane's voice. Cody is terse and evidence-led
     ("34/34 · clean"). Charm is warmer ("drafted, ready for your eyes"). Voice
     is defined per familiar in a copy register table, treated as a design
     token.

## Token sketch

- **Color:** keep Cave's existing dark ground; add a semantic trio layered on
  the per-familiar accent — `--receipt` (desaturated accent, monospace chips),
  `--held` (40% text, restraint register), `--proposal` (accent border,
  unfilled).
- **Type:** current display/body stay; elevate the **monospace** to a
  first-class identity role — it is the *voice of evidence*. Every receipt,
  path, SHA, and count is mono. Prose claims are body; proof is mono. The eye
  learns the difference in a day.
- **Layout:** card anatomy unified as
  `glyph · title · phase-verb · receipt-row · gate-row`. Missing rows collapse;
  order never changes.

## The signature: the receipt line

One memorable element, spent deliberately: **every familiar statement that
matters ends in a checkable monospace receipt with a hairline accent
underline.** It appears in chat turns, status cards, board cards, and the
constellation strip. It is the visual embodiment of "verification always" —
the Coven's whole ethic compressed into one reusable atom. Everything else
stays quiet so this lands.

## Anti-patterns (banned)

- Pulsing/breathing idle animations; shimmer "thinking" states
- Sparkle icons or "AI magic" language ("thinking hard!")
- Per-familiar layout themes or bespoke card shapes
- Progress bars for unmeasurable work
- Status text that claims completion without a receipt

## Suggested build order

1. Receipt chip atom + phase-verb line in `auto-status-card.tsx` (smallest,
   highest leverage)
2. Held-back register (opacity + no-accent token) in work queue and heartbeat
   surfaces
3. Baton-pass motion + ledger line on Board task cards
4. Constellation strip
5. Voice register table per familiar (copy tokens, reviewed against `SOUL.md`
   files)
