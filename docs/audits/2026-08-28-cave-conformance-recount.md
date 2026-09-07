# Cave conformance recount — 2026-08-28 (cave-ui5z)

**Bead:** cave-ui5z — "re-run Cave conformance counts after P1.5 chrome/contrast fix (PR #3152)"

**Purpose:** re-run the Cave conformance counts promised by the 2026-07-03 heuristic
audit scorecard after the P1.5 fixes (PR #3152, squash `efea45d8` on main 2026-07-14)
and the P3 token codemods, and record the measured numbers honestly.

## Scorecard status

The original scorecard at `research/synthesis/cave-ux-heuristic-audit-2026-07-03.md`
is **absent** from the checkout and has **no git history**: `git log --all` prints no
owning commit, no `research/` tree exists in any ref, and no backup copy exists.
The historical 70%→90% percentage cannot be reproduced from committed artifacts.

Per the closeout plan (`docs/superpowers/plans/2026-08-09-ux-conformance-audit-closeout.md`),
conformance is measured by the executable, ratcheted gates instead. This document
records those live measurements, exactly as run, so the recount is reproducible.

## Gates run (2026-08-28, base `de72ceb46`, worktree `docs/cave-ui5z-conformance-recount`)

Commands (each with `node --experimental-strip-types --import ./scripts/test-alias-register.mjs`):

| Gate | Result | Measured |
|---|---|---|
| `src/lib/theme-contrast-audit.test.ts` | PASS | 527 pairs across 12 themes × 2 modes, 0 failures; code-chrome **11 AA pairs** over worst-case light base, 0 failures |
| `src/lib/design-token-drift.test.ts` | PASS | ratchets font=137 space=1603 radius=231 hex=0 inline=285; codemod no-op over 140 css files |
| `pnpm codemod:design:check` | PASS | 0 file(s) with drift |
| `pnpm lint:design` | PASS | 0 warnings (`--max-warnings=0`) |
| `pnpm lint` | PASS | codemod:design:check + check:tokens:defined + check:test-clocks + lint:source all green |
| `src/lib/theme-palettes.test.ts` | PASS | OK |
| `src/lib/theme-token-hex.test.ts` | PASS | 6/6 pass |

## Scorecard rows

### P2-1 · Light-mode code/system chrome breaks (CHAT-D13-01) — RESOLVED, verified-with-counts

Pinned by the `theme-contrast-audit.test.ts` fixed-chrome section: **11 AA pairs**
(≥4.5:1) over the worst-case light base (opaque white), parsed from the live
`cave-md.css`/`cave-chat.css` declarations, including the derived micro-type inks
(`.cave-code-lang`, `.cave-ln`) and the diff `+/-` markers on their actual strips.
The `--code-chrome-*` token family is required to exist in `cave-md.css :root`;
theme `--text-*`/`--border-strong` inks no longer sit on the fixed dark chrome.

### P2-3 · Micro-type (9-10px) on 40%-alpha muted ink (CHAT-D13-02) — RESOLVED, verified-with-counts

- `--code-chrome-ink-faint` 40% → 72% (9.1:1 on the chrome surfaces).
- `.cave-ln` measured 2.2 → 5.7:1 (covered by the 11-pair chrome section).
- Opacity dimmers removed — `theme-contrast-audit.test.ts` asserts **no `opacity:`
  declaration** on `.cave-code-lang`, `.cave-code-filename`,
  `.cave-bubble-system-label--dim`, or `.cave-diff-meta` (the alpha-stacking that
  evaded the pre-fix automated scan).
- 9px stale chip → 10px.

### P3 · Codemod counts — now enforced baselines

The historical pre-codemod judgment counts (333 px text / ~250 inline styles /
134 spacing / ~40 hex / 9 radii) are superseded by the committed ratchets in
`src/lib/design-token-drift.test.ts`, measured live on this base:

| Category | Enforced baseline | Measured |
|---|---|---|
| off-scale font-size px | 138 | **137** |
| off-scale spacing px | 1608 | **1603** |
| off-scale radius px | 232 | **231** |
| render-CSS hex (token definitions excluded) | 0 | **0** |
| inline TSX style objects | 285 | **285** |

Counting rules live in the test: `hexOutsideDefinitions` excludes token-definition
lines (so the `--code-chrome-*` `:root` hexes, e.g. `#9a8ecd`, are definitions,
not render drift — matching the bead's counting note); `font-size: 16px` remains a
sanctioned literal (iOS anti-zoom floor). All measured values are at or below their
ratchets; the design ESLint plugin (`no-raw-px-text` / `no-static-inline-style` /
`no-render-hex-color`, cave-h59j) reports zero findings and `codemod:design:check`
reports zero drift.

## Still open

- **P2-2** (terminology — Charm naming) — uncarded, not addressed by P1.5.
- **P2-4** (signal overload) — uncarded, not addressed by P1.5.
- Bead note 2026-07-17 named cave-h59j (TSX/ESLint) and cave-gyh2 (render-CSS hex)
  as blockers for this recount; both have since closed (cave-h59j via PR #3494,
  cave-gyh2 via PR #3721 + follow-ups), which is why the recount is possible now.

## Reproduce

```bash
# in a worktree on main
node --experimental-strip-types --import ./scripts/test-alias-register.mjs src/lib/theme-contrast-audit.test.ts
node --experimental-strip-types --import ./scripts/test-alias-register.mjs src/lib/design-token-drift.test.ts
pnpm codemod:design:check
pnpm lint:design
```
