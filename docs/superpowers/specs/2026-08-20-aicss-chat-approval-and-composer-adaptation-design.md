# Adapting the AICSS Approval Card and AI Agent Input into Cave chat

Status: design assessment, nothing implemented. Written against `main` in
`OpenCoven/coven-cave` (this file's tree), 2026-08-20.

Sources under evaluation:

- Approval Card — <https://www.aicss.dev/components/approval-card>
  (machine-readable source: `https://www.aicss.dev/r/approval-card?format=md`)
- AI Agent Input — <https://www.aicss.dev/components/ai-agent-input>
  (machine-readable source: `https://www.aicss.dev/r/ai-agent-input?format=md`)

Both ship as plain CSS modules + `lucide-react`, theme-aware via `[data-theme]`.

## Verdict up front

| Component | Verdict | Reason |
| --- | --- | --- |
| **Approval Card** | **Adapt — real gap** | Cave can *signal* it needs a human but cannot *take a structured decision* inline in the transcript. |
| **AI Agent Input** | **Do not port — harvest 2 behaviours** | Cave's composer is already a superset of it, except for inline skill pills, which cost a `contenteditable` rewrite. |

## 1. What Cave already has (verified in-tree)

### Composer

| AICSS capability | Cave equivalent |
| --- | --- |
| "Enhance prompt" pill, working state, abort | `src/components/composer-enhance.tsx` — `EnhanceControl` split control, `ENHANCE_INTENTS` menu, `phase === "loading"`, `onCancel` |
| Attach + `+` menu | `src/components/composer-plus-menu.tsx` → `src/components/composer-add-menu.tsx` (attach · projects · skills · connectors · dictation · call) |
| Model switch menu | `src/components/composer-options-menu.tsx` ("Model & tuning…", chained to the same trigger ref) |
| Slash-command palette | `src/lib/slash-skill.ts` — `skillSlashOptions`, `resolveSkillInvocation`, `buildSkillPrompt` |
| Attachment chips | `src/components/chat-attachment-cards.tsx` — `AttachmentList`, `InlineMediaAttachments` |

Cave's enhance is strictly richer (intents + long-press + caret segment vs. one
pill). The `+` menu is richer (hierarchical, with connectors and dictation).

**The one genuine delta:** AICSS renders selected skills as inline
`contenteditable=false` **pills inside the editor**. Cave's composer editor is a
plain `<textarea>` (`src/components/chat-view.tsx:7478`); skills are resolved
from text via `slash-skill.ts`.

### Approvals

| Need | Cave today |
| --- | --- |
| Signal "I need a human" | `<coven:attention reason="input\|approval\|credentials\|decision" />` → `src/lib/chat-attention-marker.ts`, consumed by `src/app/api/chat/send/route.ts:495` and projected into **sidebar attention** (`chat-attention-projection`, `chat-attention-lifecycle`, settlement in `chat-view.tsx:5190`) |
| Propose a remote write inline | `<coven:github-action …>` → renders a proposal card the user taps to fire; the directive explicitly forbids presenting it as already performed (`src/lib/coven-marker-directive.ts:20`) |
| Decide a staged daemon write | `src/components/proposal-approval.tsx` (546 lines) — full surface, list+detail, decision pinned below the evidence |
| **Decide a question / command / plan inline in the transcript** | **Missing.** |

That last row is the gap. `<coven:attention>` routes the human *back to the
thread* and then hands them prose. The familiar asks its three questions in
Markdown; the human free-types answers; nothing is structured, nothing is
replayable, and a partially-answered turn is indistinguishable from a chatty one.

### Existing specimen, not a solution

`src/components/ui/beautiful/ApprovalCard.tsx` (219 lines) already exists — but
it is a **vendored Beautiful UI showcase specimen** (MIT, see
`src/components/ui/beautiful/LICENSE` and `docs/beautiful-ui.md`) with hardcoded
demo questions, referenced only by `src/app/aesthetic/beautiful/page.tsx`. It is
not wired to chat and should stay a showcase. Build the chat card fresh.

## 2. Proposal: `<coven:approve>` — an inline decision marker

Model it on `<coven:github-action>`, which already establishes the pattern
"model proposes, card renders, human fires, nothing is claimed as done."

```
<coven:approve kind="questions" id="q-2f1a" …/>
<coven:approve kind="command" command="pnpm db:migrate" cwd="…" />
<coven:approve kind="plan" title="…" steps="…" />
```

Variant mapping onto the four existing attention reasons:

| AICSS variant | `<coven:attention reason>` | Cave surface it serves |
| --- | --- | --- |
| `questions` (≤3, options + "Other" free text) | `input`, `decision` | Any clarifying turn; replaces free-typed Q&A |
| `command` (command + cwd, Run / Skip) | `approval` | The desktop terminal / sidecar surface |
| `plan` (title, summary, steps, expand) | `approval` | Orchestration-ready `nextStep.requiresApproval`, which already **blocks dispatch outright** (`docs/orchestration-ready-tasks.md`) |

Answering posts back as the next user turn, so the transcript stays the record
and existing settlement logic clears sidebar attention unchanged. `credentials`
deliberately gets **no** card — a secret must never be typed into a
transcript-backed control.

## 3. What to reject from the upstream card

These are not style notes; each is a correctness or policy conflict.

1. **Auto-approve on a 30-second timer.** Upstream sets
   `AUTO_APPROVE_SECS = 30` and fires `onApprove?.()` when the countdown reaches
   zero for the `plan` variant. That is an **unattended approval**. It
   contradicts `nextStep.requiresApproval` blocking dispatch, and it contradicts
   the marker directive's "never present the action as already performed."
   **Drop it.** If an expiry is wanted, it must expire the card as *stale /
   declined*, never as approved.
2. **`rejectLabel` defaulting to `"View Plan"`.** The decline affordance is
   labelled as a navigation. Cave's copy contract (design language §10) requires
   action copy to name its action — use `Decline`, with `View plan` as a
   separate non-decision control.
3. **`lucide-react` icons and CSS modules.** Cave uses Phosphor via the `ph:`
   `ICON_NAMES` union in `src/lib/icon.tsx` (new icon ⇒ regenerate the subset)
   and tokens from `src/styles/globals/foundations.css`. Upstream also hardcodes
   brand hexes (e.g. `#d97757`), which the `coven-design/no-render-hex-color`
   ESLint gate rejects. Re-tokenising and re-iconing *is* most of the port cost.
4. **`ADVANCE_MS = 320` auto-advance on select.** Keep, but gate on
   `prefers-reduced-motion` and announce the step change through
   `useAnnouncer()` — otherwise the view moves out from under a screen reader.

Worth keeping as-is: `role="radiogroup"`, `aria-live="polite"` on the question
viewport, the measured slide (`offsetHeight`/`offsetTop`) rather than a fixed
height, and "Other" as a first-class option — a familiar's three options are
frequently all wrong.

## 4. What to harvest from AI Agent Input (instead of porting it)

1. **FLIP height animation on the enhance swap** — upstream captures frame
   height into `flipFrom` before replacing the text, then animates from it.
   Cave's enhance currently swaps textarea content and the composer jumps. Small,
   self-contained, directly applicable to `composer-enhance.tsx`.
2. **Keeping the enhance pill mounted through its exit** (`pillMounted` /
   `pillExiting`) so it leaves the way it arrives.

**Do not adopt the `contenteditable` editor.** Converting
`chat-view.tsx:7478` from `<textarea>` to a rich editor to gain skill pills
regresses IME composition, the native undo stack, paste handling, mobile
keyboards, dictation (which Cave wires through the `+` menu), and every
Playwright selector that fills the composer. If inline skill pills are wanted
later, they justify their own spec and their own risk budget.

## 5. Licensing

AICSS is by @kvnkld and published for copy-paste use, but this repository
already vendors third-party UI **with an explicit LICENSE file and a changes
log** (`src/components/ui/beautiful/LICENSE`, `docs/beautiful-ui.md`). Any
adapted AICSS code must follow the same pattern — attribution and license
recorded before it lands — or be re-implemented against Cave primitives. Given
§3 requires rewriting the icons, the CSS, the auto-approve behaviour and the
copy, **re-implementation against `src/components/ui/` primitives is the
cleaner path** and avoids the vendoring question entirely.

## 6. Suggested sequencing

1. `<coven:approve kind="questions">` only — parser beside
   `chat-attention-marker.ts`, renderer in `src/components/`, answers posted as
   the next user turn. Smallest useful slice; no new authority.
2. `kind="plan"` wired to `nextStep.requiresApproval`, **without** auto-approve.
3. `kind="command"` last — it grants execution authority, so it needs the
   `proposal-approval.tsx` discipline (the UI forwards a decision; the daemon
   re-validates, applies or refuses, and audits) rather than firing directly.
4. The two composer harvests in §4, independently, any time.

Each step is a separate PR under the design-system gates
(`pnpm lint`, `pnpm codemod:design:check`, `src/lib/design-token-drift.test.ts`)
plus a `prefers-reduced-motion` story and an announcer call.
