# Onboarding funnel polish — first-run → first chat (design)

**Date:** 2026-07-12 · **Bead:** cave-uvv7 · **Status:** implemented in this branch

Autopilot review of the first-run funnel (wizard → Summoning Circle → first
chat). Assumptions stated inline; no interactive approval was available, so the
design errs toward small, reversible, convention-following changes.

## Funnel as shipped (verified by driving the real app)

1. Fresh machine → wizard auto-opens (gate: `shouldAutoOpenOnboarding`).
   Steps: OpenCoven tools → Coven home → runtime → daemon (+optional Git).
   One-click installs, manual commands, Salem help, troubleshooting, auto
   daemon-start. Finish CTA appears in the footer once `effectiveComplete`.
2. Finish → `closeOnboarding` walks a familiar-less user to the Familiars
   surface ("The circle awaits") — the user must click **Summon a familiar**.
3. Summoning Circle: vessel → name → form → summon → success stage with
   **Begin the first conversation** → chat.
4. Chat's empty state already offers starter chips ("What can you help me
   with?"), and the first completed reply stamps `cave:first-reply-at`.

Dead-end checks that PASSED (no change needed): Escape stays session-only;
"Skip for now" leaves recovery CTAs on the chat landing ("Open setup"),
Familiars empty state ("Run full setup"), and the circle's no-runtime notice
("Run setup"); StageSummon explains a sleeping daemon; status/harness polls
carry retry affordances and failure budgets.

## Findings and changes (5)

### 1. The finish CTA promises a summoning it doesn't start
"Open Cave — summon your familiar" lands on the Familiars page where the user
must find a second button. Worse, the walk itself (`closeOnboarding`) is gated
on the workspace's `daemonRunning`, a 5s poll that can lag the wizard's own
2s status — finishing right after the daemon auto-start can silently skip the
walk entirely (stale-false), stranding the user on Home with zero familiars.

**Change:** `finishOnboarding` calls `requestSummonFamiliar()` (existing
summon-events wiring: navigates to Familiars and latches the circle open)
when the wizard's own fresh status says the daemon is up and no familiars
exist. The footer CTA label drops the "— summon your familiar" suffix when
familiars already exist. Escape and "Skip for now" keep their current,
less-pushy behavior on purpose.

### 2. The wizard reads as a dead-ended infra checklist
Nothing tells the user that a 30-second summoning and a first chat follow the
infrastructure steps — "what am I setting up toward?" has no answer on-screen.

**Change:** a compact three-beat journey strip under the header — "Set up
Cave → Summon a familiar → First chat" — with the active beat highlighted
and completed beats ticked (derived from `effectiveComplete` and the
familiars step). Orientation only; not interactive.

### 3. Completion leaves the next action below the fold
When the last step ticks, the counter reads 4/4 but the finish CTA lives in
the footer of a long scrolling page — a "now what?" beat with no visible
next action (the live region announces completion, but nothing visual pulls
the eye).

**Change:** when `effectiveComplete` and the roster is empty, a success
banner renders at the top of the wizard (below the header) with the same
finish handler: "Setup complete — summon your familiar." The footer CTA
stays for consistency.

### 4. Blank-page paralysis at the circle's required description
Stage II requires "What it does" prose; Name has "Suggest" but the required
field offers nothing. First-time users stall exactly here.

**Change:** four identity presets (Code reviewer / Research assistant /
Project planner / Writing partner) as one-click chips above Role that fill
role + description (overwriting, like any template picker; `aria-pressed`
reflects the active preset). Name is untouched — it stays personal.

### 5. Success stage drops keyboard flow
After "Summon", the panel swaps to the success stage; the focused Summon
button unmounts and focus falls to the dialog body, so keyboard users
tab-hunt for "Begin the first conversation".

**Change:** autofocus the success stage's primary action on mount (falls
back to "Done" when no chat handler is wired). Enter then completes the
funnel: Summon ⏎ → Begin the first conversation ⏎.

## Non-goals
- Carrying the Home composer draft into the post-summon first chat (real seam,
  disproportionate plumbing; the draft survives on Home by design).
- Auto-sending an intro message on the first chat (the first words stay the
  user's; starter chips already exist).
- New test files (suite lists are hard-coded; existing guard tests are
  extended instead).

## Test plan
- Extend `src/components/onboarding-polish.test.ts` (finish-summons wiring,
  journey strip, top completion banner).
- Extend `src/components/familiar-summoning-circle.test.ts` (presets fill
  role+description, success autofocus).
- Extend `tests/onboarding-wizard.spec.ts` (complete-status machine shows the
  top banner; finish opens the Summoning Circle; journey strip visible).
- `pnpm build` + targeted suites; full e2e rides the PR's required checks.
