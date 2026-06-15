# A11y Quickwins PR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adopt the foundations primitives (`useFocusTrap`, `useAnnouncer`) and add the mechanical ARIA fixes the audit called out as P0 — without doing the design-required keyboard composition work (that's PR B).

**Architecture:** Six logically-cohesive commits, each one approval-gated. No new primitives; every fix consumes what PR #267 shipped. Pattern: source-grep tests for static invariants (import wired, attribute present) + manual browser smoke per surface for behaviour.

**Tech Stack:** Next.js 16 · React 19 · Tailwind v4 · `node:test` source-inspection tests.

**Source spec:** `docs/superpowers/specs/2026-06-08-ux-audit.md` § "P0 — broken / blocking" and § "Cross-cutting themes #1, #2, #6, #10".

**Out of scope (PR B "A11y Keyboard"):** glyph picker roving (~800 buttons + perf), kanban keyboard drag-alternative, xterm SR mirror (PTY stream hookup), board table keyboard nav, familiar studio `role="tab"` + roving, avatar rail roving, command-palette → browser-quickopen listbox unification, calendar TimeGrid arrow nav. Each gets its own brainstorm.

**Depends on:** PR #267 (`feat(ux): foundations`) merged to `main` or rebased onto. This plan assumes `useFocusTrap`, `useAnnouncer`, `<ErrorState>`, and the new tokens are available in `main`.

---

## Pre-flight

- [ ] **Confirm signing is configured** (CLAUDE.md hard rule)

```bash
git config --get user.signingkey
git config --get gpg.format
```

Expected: non-empty. If empty, stop and surface to user.

- [ ] **Confirm PR #267 has landed (or fast-forward main locally)**

```bash
git fetch origin main
git log origin/main --oneline | head -10 | grep -E "foundations|focus trap|live region"
```

If you see the foundations commits in `origin/main` history, proceed. If not, the user needs to merge #267 first OR this branch needs to start from `origin/ux-foundations` instead of `origin/main` and rebase later. Surface and ask.

- [ ] **Create worktree (sibling-dir convention)**

```bash
git worktree add -b a11y-quickwins \
  /Users/buns/Documents/GitHub/OpenCoven/coven-cave-a11y-quickwins origin/main
cd /Users/buns/Documents/GitHub/OpenCoven/coven-cave-a11y-quickwins
```

If the user has a project `cv-wt` / `.wt` claim flow, substitute the canonical invocation here.

- [ ] **Install deps + pre-flight typecheck**

```bash
pnpm install
pnpm typecheck
```

Expected: clean.

- [ ] **Approval gate — confirm scope before any code change**

Surface to user:
> "Worktree up at `<path>`. 6 commits planned: (1) useFocusTrap adoption in 5 modals, (2) command palette listbox semantics, (3) form-input labels (4 inputs), (4) chat transcript role=log + aria-live, (5) inbox-toast aria-live, (6) misc ARIA fixes (salem perch button, plugin badge label, sidebar collapse aria-expanded). Proceed?"

Wait for explicit go. Same approval gate applies to every commit, push, and PR below.

---

## File map

| File | Action | Why |
|---|---|---|
| `src/components/command-palette.tsx` | modify | useFocusTrap + listbox semantics |
| `src/components/board-inspector.tsx` | modify | useFocusTrap on the dialog div |
| `src/components/library-doc-preview.tsx` | modify | useFocusTrap on reader modal |
| `src/components/library-github-list.tsx` | modify | useFocusTrap on AttachTask + Handoff modals |
| `src/components/onboarding-overlay.tsx` | modify | useFocusTrap + Escape handler |
| `src/components/chat-view.tsx` | modify | textarea aria-label + transcript role=log/aria-live |
| `src/components/home-composer.tsx` | modify | textarea aria-label |
| `src/components/salem/salem-widget.tsx` | modify | search input aria-label + perch → real `<button>` |
| `src/components/library-doc-list.tsx` | modify | search input aria-label |
| `src/components/inbox-toast.tsx` | modify | `aria-live="polite"` + `aria-atomic="true"` |
| `src/components/plugin-card.tsx` | modify | status badge aria-label |
| `src/components/sidebar-minimal.tsx` | modify | collapse toggle aria-expanded |
| `src/components/command-palette.test.ts` | create | source-grep invariants |
| `src/components/modal-trap-adoption.test.ts` | create | one test asserting all 5 modal files import useFocusTrap |
| `src/components/labels-and-live-regions.test.ts` | create | source-grep for the ARIA additions |

Tests are **local invariant checks** — source-grep against the modified files. They prove the pattern landed, not the behaviour. Behaviour is verified by manual browser smoke per task (called out inline).

---

## Task 1: Adopt `useFocusTrap` in 5 modals/overlays

**Why first:** the highest-coverage win. Five surfaces gain proper focus-trap + Escape + return-focus behaviour with the same one-hook-call pattern, mirroring what `Modal` already does.

**Files:**
- Modify: `src/components/command-palette.tsx` (~line 120 effect block, ~line 307 dialog div)
- Modify: `src/components/board-inspector.tsx` (~line 770 dialog div)
- Modify: `src/components/library-doc-preview.tsx` (~line 504 createPortal child)
- Modify: `src/components/library-github-list.tsx` (~line 202 AttachTask, ~line 404 Handoff — two modals)
- Modify: `src/components/onboarding-overlay.tsx` (~line 483 root return)
- Create: `src/components/modal-trap-adoption.test.ts`

### Step 1.1 — Write the failing invariant test

Create `src/components/modal-trap-adoption.test.ts`:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const FILES = [
  "command-palette.tsx",
  "board-inspector.tsx",
  "library-doc-preview.tsx",
  "library-github-list.tsx",
  "onboarding-overlay.tsx",
];

for (const file of FILES) {
  const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");

  assert.match(
    source,
    /import\s+\{[^}]*useFocusTrap[^}]*\}\s+from\s+["']@\/lib\/use-focus-trap["']/,
    `${file} imports useFocusTrap from @/lib/use-focus-trap`,
  );

  // Must call the hook (not just import).
  assert.match(
    source,
    /useFocusTrap\(/,
    `${file} calls useFocusTrap(...)`,
  );

  // Must set tabIndex={-1} on at least one dialog/overlay div so the
  // empty-focusables fallback can land.
  assert.match(
    source,
    /tabIndex=\{-1\}|tabIndex={\s*-1\s*}/,
    `${file} sets tabIndex={-1} on the dialog/overlay container`,
  );
}

console.log("modal-trap-adoption.test.ts OK");
```

### Step 1.2 — Run test, confirm FAIL

```bash
cd /Users/buns/Documents/GitHub/OpenCoven/coven-cave-a11y-quickwins
npx --yes tsx --test src/components/modal-trap-adoption.test.ts
```

Expected: every file fails the import assertion (none import `useFocusTrap` yet).

### Step 1.3 — Adopt in `command-palette.tsx`

Read the current `src/components/command-palette.tsx` to confirm structure. There's a `role="dialog"` at ~line 307 and a keydown effect at ~line 120 that already handles Escape inline. Replace the inline keydown effect with `useFocusTrap`:

a. Add the import at the top with the other `@/lib/...` imports:

```tsx
import { useFocusTrap } from "@/lib/use-focus-trap";
```

b. Add a ref for the dialog. Find the existing `useRef` calls near the top of the component; add:

```tsx
const dialogRef = useRef<HTMLDivElement | null>(null);
```

c. Replace the inline Escape-handling `useEffect` (the one that listens for `e.key === "Escape"` and calls the close function) with a single hook call. Pass the existing close callback as `onEscape`:

```tsx
useFocusTrap(open, dialogRef, { onEscape: onClose });
```

(Substitute the actual prop names — if the component uses `setOpen` / `close` / `dismiss`, use that.)

d. Attach the ref + `tabIndex={-1}` to the dialog div at ~line 307:

```tsx
<div
  ref={dialogRef}
  role="dialog"
  aria-modal="true"
  aria-label="Command palette"
  tabIndex={-1}
  // ...existing className, onClick, etc.
>
```

e. Keep the existing arrow-key navigation through results — that's separate from focus trap. **Do NOT remove the result-navigation effect.** Only the Escape/Tab handling is what the hook subsumes.

### Step 1.4 — Adopt in `board-inspector.tsx`

The dialog at ~line 770:
```tsx
<div className={`board-drawer${closing ? " board-drawer--closing" : ""}`} role="dialog" aria-modal aria-label="Card inspector">
```

a. Add the import.
b. Add `const dialogRef = useRef<HTMLDivElement | null>(null);` near other refs in the component.
c. Add `useFocusTrap(open, dialogRef, { onEscape: onClose });` where `open` is whatever boolean controls whether the inspector renders and `onClose` is the existing close handler (verify the prop name when editing).
d. Update the dialog div:
```tsx
<div
  ref={dialogRef}
  className={`board-drawer${closing ? " board-drawer--closing" : ""}`}
  role="dialog"
  aria-modal
  aria-label="Card inspector"
  tabIndex={-1}
>
```

### Step 1.5 — Adopt in `library-doc-preview.tsx`

The createPortal at ~line 504 with `role="dialog"` at ~line 508.

a. Add the import.
b. Add `const dialogRef = useRef<HTMLDivElement | null>(null);` in the component body.
c. Add `useFocusTrap(readerOpen, dialogRef, { onEscape: handleClose });` (or whatever the close handler is; verify the variable names by reading the file).
d. Attach the ref + `tabIndex={-1}` to the dialog div inside the portal:
```tsx
<div
  ref={dialogRef}
  role="dialog"
  aria-modal="true"
  tabIndex={-1}
  // ...existing props
>
```

### Step 1.6 — Adopt in `library-github-list.tsx` (TWO modals)

The file has two `createPortal` blocks: AttachTaskModal at ~line 202 and HandoffModal at ~line 404.

a. Add the import once at the top.
b. For each portal: add a ref, call `useFocusTrap(isOpen, ref, { onEscape: onCancel })` (or whatever the props are — read each modal component to confirm), set `ref` + `tabIndex={-1}` on the dialog div, and ensure `role="dialog" aria-modal="true"` is set if missing.

**Two separate hook calls** — one per modal component in the file. Do not share a ref.

### Step 1.7 — Adopt in `onboarding-overlay.tsx`

This is a CSS-overlay (no portal). The outer return is at ~line 483. Find the outermost JSX node of the overlay (likely a `<div className="onb-overlay-...">` or similar wrapping all the onboarding content).

a. Add the import.
b. Add `const dialogRef = useRef<HTMLDivElement | null>(null);` near the top of `function OnboardingOverlay`.
c. The component receives `open` and `onDismiss` props (verified at line 146 of the existing file). Add:
```tsx
useFocusTrap(open, dialogRef, { onEscape: onDismiss });
```
d. On the outermost overlay div, add `ref={dialogRef}`, `role="dialog"`, `aria-modal="true"`, `aria-label="Onboarding"` (only if not already present), and `tabIndex={-1}`.

**Do NOT** modify the form-field inputs or any other internal structure — that's scope creep. The trap is the entire P0 fix here.

### Step 1.8 — Run test, confirm PASS

```bash
cd /Users/buns/Documents/GitHub/OpenCoven/coven-cave-a11y-quickwins
npx --yes tsx --test src/components/modal-trap-adoption.test.ts
```

Expected: `modal-trap-adoption.test.ts OK`.

### Step 1.9 — Typecheck + build

```bash
cd /Users/buns/Documents/GitHub/OpenCoven/coven-cave-a11y-quickwins
pnpm typecheck
pnpm build 2>&1 | tail -8
```

Expected: both clean.

### Step 1.10 — Manual smoke (5 surfaces)

```bash
pnpm dev
```

In a browser, verify for **each** of the 5 surfaces:

| Surface | How to open | Verify |
|---|---|---|
| Command palette | ⌘K | Focus lands on input; Tab cycles within dialog; Esc closes; focus returns to trigger |
| Board inspector | `/board` → click a card | Focus lands inside drawer; Tab cycles; Esc closes; focus returns to card |
| Library reader | `/library` → open a doc → expand to reader | Focus inside reader; Tab cycles; Esc closes; focus returns |
| GitHub Attach | `/library` → GitHub tab → "Attach to task" on any row | Tab cycles; Esc closes; focus returns to row |
| GitHub Handoff | `/library` → GitHub tab → "Handoff to familiar" | Same as above |
| Onboarding | first-run or trigger overlay manually | Tab cycles; Esc dismisses (this is new behaviour); focus returns to whatever opened it |

If any regress — STOP. Surface the regression to the user. Do not commit.

### Step 1.11 — Approval gate, then commit (signed)

Show diff `git diff --stat`, every modified file's diff, test pass output, smoke results. Wait for explicit user approval.

```bash
git add src/components/command-palette.tsx \
        src/components/board-inspector.tsx \
        src/components/library-doc-preview.tsx \
        src/components/library-github-list.tsx \
        src/components/onboarding-overlay.tsx \
        src/components/modal-trap-adoption.test.ts
git commit -S -m "$(cat <<'EOF'
feat(a11y): adopt useFocusTrap in 5 modals/overlays

Consumes the foundations primitive shipped in #267. Each surface gains
proper focus trap + Escape + return-focus, matching Modal's behaviour.

- Command palette: was missing Tab cycle and focus restore.
- Board inspector: was missing focus trap (focus could leak to board).
- Library reader: was missing focus trap.
- GitHub Attach + Handoff modals: were missing focus trap.
- Onboarding overlay: was missing focus trap AND Escape.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature
```

Verify: `Good "<algorithm>" signature` appears.

---

## Task 2: Command palette listbox semantics

**Why:** Audit P0 — input is unlabeled, results are `<ul><button>` with non-standard `aria-current="true"` instead of proper listbox/option/activedescendant. AT users get incoherent navigation.

**Files:**
- Modify: `src/components/command-palette.tsx`
- Create: `src/components/command-palette.test.ts`

### Step 2.1 — Write the failing invariants

Create `src/components/command-palette.test.ts`:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./command-palette.tsx", import.meta.url),
  "utf8",
);

// Input is labelled (aria-label OR aria-labelledby OR wrapped in <label>).
assert.match(
  source,
  /<input[\s\S]*?(aria-label|aria-labelledby)=/,
  "command palette input has an accessible name",
);

// Results container is a listbox.
assert.match(source, /role="listbox"/, "results container has role=listbox");

// Each item has role=option.
assert.match(source, /role="option"/, "each result item has role=option");

// Input is linked to listbox via aria-controls.
assert.match(source, /aria-controls=/, "input is linked to results via aria-controls");

// Active item announced via aria-activedescendant on input.
assert.match(source, /aria-activedescendant=/, "input uses aria-activedescendant for selection");

// The non-standard aria-current="true" pattern on result items is gone.
const liBlock = source.match(/role="option"[\s\S]*?>/g)?.[0] ?? "";
assert.doesNotMatch(
  liBlock,
  /aria-current="true"/,
  "results no longer use aria-current=true (use aria-selected via activedescendant)",
);

console.log("command-palette.test.ts OK");
```

### Step 2.2 — Run, confirm FAIL

```bash
cd /Users/buns/Documents/GitHub/OpenCoven/coven-cave-a11y-quickwins
npx --yes tsx --test src/components/command-palette.test.ts
```

Expected: at least 4 assertion failures.

### Step 2.3 — Refactor `command-palette.tsx`

Read the current file. Identify:
- The `<input ...>` for the query (around line 313 per audit).
- The results container (around line 324).
- The result `<button>` items.
- The state variable that tracks the active result index (likely `activeIndex` or similar).

Make these changes:

a. **Input — add aria-label and aria-controls and aria-activedescendant:**
```tsx
<input
  // ...existing props
  aria-label="Search and jump to anything"
  aria-controls="command-palette-listbox"
  aria-activedescendant={
    results.length > 0 ? `command-palette-option-${activeIndex}` : undefined
  }
  // do NOT also set aria-current on the input
/>
```

b. **Results container — make it a listbox:**
```tsx
<ul
  id="command-palette-listbox"
  role="listbox"
  className="..." // existing
>
```

c. **Result items — role=option with stable ids:**
```tsx
{results.map((result, i) => (
  <li key={result.id} role="option" id={`command-palette-option-${i}`} aria-selected={i === activeIndex}>
    <button
      // ...existing handlers
      // REMOVE aria-current from here
      // Keep tabIndex={-1} so the input retains keyboard focus
      tabIndex={-1}
    >
      {/* existing content */}
    </button>
  </li>
))}
```

(If the existing markup uses `<button>` directly without an `<li>` wrapper, adapt — put role=option on whichever element is the focusable result.)

d. **Confirm Visual: nothing changes visually.** The `aria-selected` attribute is purely semantic. Keep the existing CSS that styles the active result by some other means (`data-active`, internal state class) — don't depend on `aria-current` for styling. If the CSS does target `aria-current="true"`, replace with `[aria-selected="true"]`.

### Step 2.4 — Run test, confirm PASS

```bash
cd /Users/buns/Documents/GitHub/OpenCoven/coven-cave-a11y-quickwins
npx --yes tsx --test src/components/command-palette.test.ts
```

Expected: `command-palette.test.ts OK`.

### Step 2.5 — Typecheck + build

```bash
pnpm typecheck
pnpm build 2>&1 | tail -8
```

### Step 2.6 — Manual smoke

`pnpm dev`. Open ⌘K. Verify:
- Active result is visually highlighted (CSS still works).
- Arrow Up/Down moves the highlight.
- Enter activates the highlighted result.
- VoiceOver / NVDA (if available) announces the active option as you arrow through.
- Input retains focus throughout — Tab does NOT move focus to result buttons (because `tabIndex={-1}` on each button).

### Step 2.7 — Approval gate, then commit (signed)

Show diff + test + smoke. Wait for approval.

```bash
git add src/components/command-palette.tsx src/components/command-palette.test.ts
git commit -S -m "$(cat <<'EOF'
feat(a11y): command palette listbox semantics

Input gets aria-label, aria-controls linking to a proper role=listbox
results container, and aria-activedescendant pointing at the active
option. Result items become role=option with aria-selected. Replaces the
non-standard aria-current="true" pattern AT can't interpret.

Behaviour unchanged for sighted users; assistive tech now announces the
active option as the user arrows through results.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature
```

---

## Task 3: Form input labels (4 inputs)

**Why:** Audit P0 — chat textareas (chat-view + home-composer), salem search, library doc-list search all rely on placeholders only. Placeholders are not labels per WCAG.

**Files:**
- Modify: `src/components/chat-view.tsx` (textarea ~line 1002)
- Modify: `src/components/home-composer.tsx` (textarea ~line 235)
- Modify: `src/components/salem/salem-widget.tsx` (input ~line 176)
- Modify: `src/components/library-doc-list.tsx` (input ~line 63)
- Create: `src/components/labels-and-live-regions.test.ts`

### Step 3.1 — Write the failing invariants

Create `src/components/labels-and-live-regions.test.ts`:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(file: string) {
  return readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
}

// 1. chat-view.tsx textarea has an accessible name.
{
  const src = read("chat-view.tsx");
  assert.match(
    src,
    /<textarea[\s\S]*?aria-label="[^"]+"/,
    "chat-view textarea has aria-label",
  );
}

// 2. home-composer.tsx textarea has an accessible name.
{
  const src = read("home-composer.tsx");
  assert.match(
    src,
    /<textarea[\s\S]*?aria-label="[^"]+"/,
    "home-composer textarea has aria-label",
  );
}

// 3. salem-widget.tsx search input has an accessible name.
{
  const src = read("salem/salem-widget.tsx");
  assert.match(
    src,
    /<input[\s\S]*?aria-label="[^"]+"/,
    "salem search input has aria-label",
  );
}

// 4. library-doc-list.tsx search input has an accessible name.
{
  const src = read("library-doc-list.tsx");
  assert.match(
    src,
    /<input[\s\S]*?aria-label="[^"]+"/,
    "library doc-list search input has aria-label",
  );
}

// 5. chat-view.tsx transcript container is a log with aria-live.
{
  const src = read("chat-view.tsx");
  const threadBlock = src.match(/className="cave-chat-thread"[\s\S]{0,200}/)?.[0] ?? "";
  assert.match(threadBlock, /role="log"/, "chat thread has role=log");
  assert.match(threadBlock, /aria-live="polite"/, "chat thread has aria-live=polite");
}

// 6. inbox-toast.tsx root has aria-live + aria-atomic.
{
  const src = read("inbox-toast.tsx");
  assert.match(src, /aria-live="polite"/, "inbox-toast has aria-live=polite");
  assert.match(src, /aria-atomic="true"/, "inbox-toast has aria-atomic=true");
}

console.log("labels-and-live-regions.test.ts OK");
```

### Step 3.2 — Run, confirm FAIL (most assertions)

```bash
cd /Users/buns/Documents/GitHub/OpenCoven/coven-cave-a11y-quickwins
npx --yes tsx --test src/components/labels-and-live-regions.test.ts
```

Expected: all 6 assertions fail (chat-view transcript and inbox-toast are tested by later tasks but in the same file, so they'll fail here too — that's fine, they'll pass once tasks 4 & 5 land).

For Task 3, we only fix assertions 1–4. Assertions 5 and 6 stay red until tasks 4 and 5.

### Step 3.3 — Add `aria-label` to `chat-view.tsx` textarea

Find the textarea at ~line 1002:
```tsx
<textarea
  // ...existing props (ref, value, onChange, placeholder, etc.)
  aria-label="Message"
/>
```

If the textarea is inside a `<form>` with a `<label>` element nearby, use `aria-labelledby` pointing at the label's id instead. Otherwise `aria-label="Message"` is correct.

### Step 3.4 — Add `aria-label` to `home-composer.tsx` textarea

Find the textarea at ~line 235:
```tsx
<textarea
  // ...existing props
  aria-label="Ask anything"
/>
```

### Step 3.5 — Add `aria-label` to `salem-widget.tsx` input

Find the search input at ~line 176:
```tsx
<input
  // ...existing props
  aria-label="Search Salem docs"
/>
```

### Step 3.6 — Add `aria-label` to `library-doc-list.tsx` input

Find the search input at ~line 63:
```tsx
<input
  // ...existing props
  aria-label="Search documents"
/>
```

### Step 3.7 — Run test (4 of 6 should pass now)

```bash
npx --yes tsx --test src/components/labels-and-live-regions.test.ts
```

Expected: assertions 1–4 PASS; 5 (chat transcript role=log) + 6 (inbox-toast) still FAIL. That's intentional — they're landed by tasks 4 and 5. The whole test file stops at the first failure; partial success is fine for now.

### Step 3.8 — Typecheck + build

```bash
pnpm typecheck
pnpm build 2>&1 | tail -8
```

### Step 3.9 — Manual smoke

`pnpm dev`. For each modified surface, open DevTools and inspect the input/textarea. Confirm `aria-label="..."` is present in the rendered DOM. VoiceOver test (optional): toggle SR on, tab to the input, verify it announces the label.

### Step 3.10 — Approval gate, then commit (signed)

Show diff + test (note that 2 assertions still fail by design). Wait for approval.

```bash
git add src/components/chat-view.tsx \
        src/components/home-composer.tsx \
        src/components/salem/salem-widget.tsx \
        src/components/library-doc-list.tsx \
        src/components/labels-and-live-regions.test.ts
git commit -S -m "$(cat <<'EOF'
feat(a11y): aria-label on chat, salem, and library search inputs

Replaces placeholder-only inputs with explicit aria-labels so screen
readers announce the input's purpose. Affects: chat-view textarea,
home-composer textarea, salem search, library doc-list search.

(The labels-and-live-regions.test.ts file also tests assertions for
tasks 4 and 5; those still fail until those tasks land.)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature
```

---

## Task 4: Chat transcript `role="log"` + `aria-live="polite"`

**Why:** Audit P0 — streamed messages are not announced. Live-region semantics give screen readers a "feed" of new turns.

**Files:**
- Modify: `src/components/chat-view.tsx` (~line 885 — the `.cave-chat-thread` div)

### Step 4.1 — Apply the role + aria-live

Find the transcript container (look for `className="cave-chat-thread"`). Add:

```tsx
<div
  className="cave-chat-thread"
  role="log"
  aria-live="polite"
  aria-relevant="additions"
  aria-label="Conversation"
>
```

- `role="log"` is the semantic for an append-only message stream.
- `aria-live="polite"` queues new turns without interrupting current speech.
- `aria-relevant="additions"` says "only announce new content, not removals" — important because messages can re-render during streaming.
- `aria-label="Conversation"` gives the region a name.

### Step 4.2 — Run test, confirm PASS (assertion 5 now lands)

```bash
cd /Users/buns/Documents/GitHub/OpenCoven/coven-cave-a11y-quickwins
npx --yes tsx --test src/components/labels-and-live-regions.test.ts
```

Expected: 5 of 6 pass; assertion 6 (inbox-toast) still fails until Task 5.

### Step 4.3 — Typecheck + build

```bash
pnpm typecheck
pnpm build 2>&1 | tail -8
```

### Step 4.4 — Manual smoke

Open `pnpm dev`. With VoiceOver on (or just inspect the DOM), navigate to a chat. Send a message. Confirm:
- DOM shows `<div ... role="log" aria-live="polite">` on the thread.
- VoiceOver announces newly-streamed turns (if SR is running).
- No regression: existing send/scroll/streaming behaviour unchanged.

### Step 4.5 — Approval gate, then commit (signed)

```bash
git add src/components/chat-view.tsx
git commit -S -m "$(cat <<'EOF'
feat(a11y): chat transcript role=log + aria-live

Screen readers now announce new turns as they stream. aria-relevant
limits announcements to additions so re-renders during streaming don't
re-announce existing messages.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature
```

---

## Task 5: Inbox-toast `aria-live` + `aria-atomic`

**Why:** Audit P0 — toast has `role="status"` but no `aria-live`/`aria-atomic`, so AT may not finish reading before auto-dismiss at 8s.

**Files:**
- Modify: `src/components/inbox-toast.tsx` (~line 42)

### Step 5.1 — Add the attributes

Find the toast root `<div role="status" ...>` at ~line 42. Add two attributes:

```tsx
<div
  role="status"
  aria-live="polite"
  aria-atomic="true"
  // ...existing className, etc.
>
```

- `aria-live="polite"` ensures AT picks up the new toast as a live update.
- `aria-atomic="true"` says "read the whole region as a unit," so the headline + body are announced together rather than fragmented.

### Step 5.2 — Run test, confirm PASS (last assertion lands)

```bash
cd /Users/buns/Documents/GitHub/OpenCoven/coven-cave-a11y-quickwins
npx --yes tsx --test src/components/labels-and-live-regions.test.ts
```

Expected: `labels-and-live-regions.test.ts OK` — all 6 pass.

### Step 5.3 — Typecheck + build

```bash
pnpm typecheck
pnpm build 2>&1 | tail -8
```

### Step 5.4 — Manual smoke

`pnpm dev`. Trigger a toast (e.g., complete an inbox escalation). Confirm in DOM the toast div has `aria-live="polite"` and `aria-atomic="true"`. Visual rendering unchanged.

### Step 5.5 — Approval gate, then commit (signed)

```bash
git add src/components/inbox-toast.tsx
git commit -S -m "$(cat <<'EOF'
feat(a11y): inbox toast aria-live + aria-atomic

Toast had role=status but no live-region attributes — screen readers
might not pick up the announcement before the 8s auto-dismiss. Adding
aria-live=polite + aria-atomic=true ensures the whole toast is announced
as a unit, when it appears.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature
```

---

## Task 6: Misc ARIA fixes — Salem perch, plugin badge, sidebar collapse

**Why:** Three small audit P0/P1 fixes that don't fit a thematic category. Bundle to keep commit count tractable.

**Files:**
- Modify: `src/components/salem/salem-widget.tsx` (perch ~line 98)
- Modify: `src/components/plugin-card.tsx` (badge ~line 88)
- Modify: `src/components/sidebar-minimal.tsx` (collapse toggle)
- Create: `src/components/misc-aria-fixes.test.ts`

### Step 6.1 — Write the failing invariants

Create `src/components/misc-aria-fixes.test.ts`:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(file: string) {
  return readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
}

// 1. Salem perch is a real <button>, not a <div role="button">.
{
  const src = read("salem/salem-widget.tsx");
  // The perch trigger element should be a button element.
  // We check by absence: no `<div role="button"` for the perch.
  assert.doesNotMatch(
    src,
    /<div[\s\S]{0,200}role="button"[\s\S]{0,200}salem-perch/,
    "salem perch must not be a div role=button (use real <button>)",
  );
  // And a positive check: a <button> in the file with the perch class.
  assert.match(
    src,
    /<button[\s\S]{0,200}salem-perch/,
    "salem perch is a <button> element",
  );
}

// 2. Plugin card status badge has aria-label.
{
  const src = read("plugin-card.tsx");
  assert.match(
    src,
    /aria-label=\{?["`']?(?:Installed|Updating|Skill|status)/i,
    "plugin status badge has aria-label",
  );
}

// 3. Sidebar collapse toggle has aria-expanded.
{
  const src = read("sidebar-minimal.tsx");
  assert.match(
    src,
    /aria-expanded=\{/,
    "sidebar collapse toggle exposes aria-expanded",
  );
}

console.log("misc-aria-fixes.test.ts OK");
```

### Step 6.2 — Run, confirm FAIL

```bash
cd /Users/buns/Documents/GitHub/OpenCoven/coven-cave-a11y-quickwins
npx --yes tsx --test src/components/misc-aria-fixes.test.ts
```

Expected: 3 assertion failures.

### Step 6.3 — Convert Salem perch from `<div role="button">` to `<button>`

In `src/components/salem/salem-widget.tsx` at ~line 98, find the perch element. Currently it's a `<div role="button" tabIndex={0} onClick={...} onKeyDown={...}>`. Replace with:

```tsx
<button
  type="button"
  className="salem-perch ..." // keep existing classes
  onClick={...} // keep existing handler
  aria-label="Open Salem"
  // ...keep other a11y props (aria-pressed, etc.) if present
>
```

Remove `role="button"`, `tabIndex={0}`, and the `onKeyDown` handler that was emulating button-on-keypress (a real `<button>` handles Enter and Space natively).

If the perch has children (icon, label), keep them as-is inside the `<button>`.

### Step 6.4 — Add `aria-label` to plugin status badge

In `src/components/plugin-card.tsx` at ~line 88, find the status badge (likely a `<span>` showing "Installed" / "Updating" / "Skill"). The status is rendered visually but not announced. Compute a label from the same state:

```tsx
<span
  className="..." // existing badge class
  aria-label={`Status: ${statusText}`} // statusText = "Installed" / "Updating" / etc.
>
  {statusText}
</span>
```

If the visible text and the aria-label are identical, you can rely on the visible text and just drop the aria-label — BUT only if the badge is a `<span>` containing only the status word and nothing else (no icon-only states). Read the existing rendering to decide. If the badge uses an icon-only "installed checkmark" without a text node, `aria-label` is mandatory.

### Step 6.5 — Add `aria-expanded` to sidebar collapse toggle

In `src/components/sidebar-minimal.tsx`, find the collapse toggle. The audit pointed at `familiar-avatar-rail.tsx:232` but the toggle might live in either file. Search for the existing aria-label that says "Toggle sidebar":

```bash
grep -n "Toggle sidebar" src/components/sidebar-minimal.tsx src/components/familiar-avatar-rail.tsx
```

Add `aria-expanded={isExpanded}` (or whatever the collapsed-state variable is named) to the toggle button:

```tsx
<button
  type="button"
  aria-label="Toggle sidebar"
  aria-expanded={!collapsed} // or the appropriate state
  // ...existing handlers
>
```

`aria-expanded` is true when the sidebar is open, false when collapsed.

### Step 6.6 — Run test, confirm PASS

```bash
npx --yes tsx --test src/components/misc-aria-fixes.test.ts
```

Expected: `misc-aria-fixes.test.ts OK`.

### Step 6.7 — Typecheck + build

```bash
pnpm typecheck
pnpm build 2>&1 | tail -8
```

### Step 6.8 — Manual smoke

`pnpm dev`. Three checks:
- Salem perch: Tab to it from somewhere reachable. Confirm focus ring shows. Press Enter and Space — both should open Salem (real `<button>` handles both natively).
- Plugin card: open `/plugins` (or wherever plugin cards render). Inspect a badge in DevTools — confirm `aria-label` is set.
- Sidebar collapse: collapse and expand the sidebar (⌘B). Inspect the toggle button — `aria-expanded` should flip.

### Step 6.9 — Approval gate, then commit (signed)

```bash
git add src/components/salem/salem-widget.tsx \
        src/components/plugin-card.tsx \
        src/components/sidebar-minimal.tsx \
        src/components/misc-aria-fixes.test.ts
git commit -S -m "$(cat <<'EOF'
feat(a11y): salem perch as <button>, plugin badge label, sidebar aria-expanded

Three small audit P0/P1 fixes:
- Salem perch was a <div role="button"> with onKeyDown emulation. Real
  <button> handles Enter/Space natively and integrates with the focus
  ring system.
- Plugin status badge had no aria-label; status was colour-only to AT.
- Sidebar collapse toggle didn't announce its expanded state.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature
```

---

## Task 7: Verify, ask before push, ask before PR

**Default posture:** stop and ask. Verification is unconditional; push and PR each block on user OK.

### Step 7.1 — Run every test, full typecheck + build

```bash
cd /Users/buns/Documents/GitHub/OpenCoven/coven-cave-a11y-quickwins
pnpm typecheck
npx --yes tsx --test \
  src/components/modal-trap-adoption.test.ts \
  src/components/command-palette.test.ts \
  src/components/labels-and-live-regions.test.ts \
  src/components/misc-aria-fixes.test.ts
pnpm build 2>&1 | tail -8
```

Expected: 4 test files pass, typecheck + build clean.

### Step 7.2 — Verify every commit is signed

```bash
git log origin/main..HEAD --pretty='%H %G? %s' | awk '$2 != "G" {print "UNSIGNED:", $0}'
```

Expected: no output. If anything prints, **do not push**. Rebase to sign:

```bash
git rebase --exec 'git commit --amend --no-edit -S' origin/main
```

Then re-run the gate.

### Step 7.3 — Approval gate, then push

Surface to user:
- Commit list: `git log --oneline origin/main..HEAD`
- All tests + build + typecheck passed
- Every commit signed

Ask: **"Push `a11y-quickwins` to origin?"** Wait for explicit yes.

```bash
git push -u origin a11y-quickwins
```

### Step 7.4 — Approval gate, then open the PR

Draft the body locally. Show to user. Ask: **"Open the PR with this body?"** Wait for yes.

```bash
gh pr create --title "feat(a11y): quickwins — focus traps, listbox, labels, live regions" --body "$(cat <<'EOF'
## Summary
Adopts the foundations primitives from #267 across surfaces, and adds the mechanical ARIA fixes the audit (`docs/superpowers/specs/2026-06-08-ux-audit.md`) flagged as P0. No design-required keyboard composition in this PR — that's deferred to a follow-up.

- `useFocusTrap` adopted by: command palette, board inspector, library reader, GitHub Attach + Handoff modals, onboarding overlay.
- Command palette gains proper `role="listbox"` / `role="option"` semantics with `aria-activedescendant` (was `aria-current="true"`, which AT can't interpret).
- `aria-label` added to four placeholder-only inputs: chat-view textarea, home-composer textarea, salem search, library doc-list search.
- Chat transcript becomes `role="log" aria-live="polite" aria-relevant="additions"` so streamed turns announce.
- Inbox toast gains `aria-live="polite" aria-atomic="true"` so it's announced before auto-dismiss.
- Salem perch is now a real `<button>` (was `<div role="button">`); plugin status badge gains `aria-label`; sidebar collapse toggle gains `aria-expanded`.

## Test plan
- [x] `pnpm typecheck` clean.
- [x] `pnpm build` clean.
- [x] 4/4 source-grep invariant tests pass.
- [x] Every commit signed.
- [ ] Manual per-surface smoke: focus traps verified on all 5 modals; command palette listbox arrow nav works; labels appear in DOM; chat transcript announces in VoiceOver.

## Source
- Audit: `docs/superpowers/specs/2026-06-08-ux-audit.md` (gitignored).
- Plan: `docs/superpowers/plans/2026-06-08-a11y-quickwins.md` (gitignored).
- Foundations PR: #267.

## Deferred to "A11y Keyboard" PR (next)
Glyph picker roving, kanban keyboard drag-alt, xterm SR mirror, board table keyboard nav, familiar-studio `role="tab"` + roving, avatar rail roving, calendar TimeGrid arrow nav.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Return the PR URL. Do not merge.

---

## Self-review

**Spec coverage** — for each audit P0 item this PR claims to address:

| Audit P0 | Task |
|---|---|
| Chat transcript has no aria-live | Task 4 ✓ |
| Chat textareas have no label | Task 3 ✓ |
| Command palette input unlabeled; results aren't listbox | Tasks 1 + 2 ✓ |
| Salem & library search inputs have no labels | Task 3 ✓ |
| Onboarding overlay has no focus trap or Escape | Task 1 ✓ |
| Board inspector / filter popover lack focus trap | Task 1 (inspector). Filter popover deferred — it's a popover, not a modal; the wider "popover semantics" pass is PR B. |
| Plugin status badge color-only | Task 6 ✓ |
| Sidebar collapse no `aria-expanded` | Task 6 ✓ |
| Salem perch is `<div role="button">` | Task 6 ✓ |
| Inbox toast no aria-live | Task 5 ✓ |

Explicitly deferred (called out in PR body and plan scope): glyph picker (~800 buttons + perf), kanban drag-alt (design), xterm SR mirror (PTY stream wiring), board table keyboard nav, browser address-bar listbox (paired with command palette in PR B for one coherent listbox pattern), library reader j/k nav, plugin form labels.

**Placeholder scan** — no TBD / TODO / "similar to" placeholders. The worktree command in pre-flight notes the `cv-wt` placeholder pending user confirmation (same as the foundations plan).

**Type consistency** — all hook calls match the `useFocusTrap(active, ref, { onEscape })` signature from #267. No new types introduced.

**Line-number drift** — every cited line number is best-effort against the codebase at audit time (2026-06-08). The plan instructs the executor to read each file before editing and confirm the target. Source-grep tests don't depend on line numbers.

**Approval discipline** — every commit step gated on user OK. Push and PR each have their own explicit gates in Task 7.

**Test framing** — source-grep tests are local invariant checks (per the `reference-test-runner` memory). They prove the pattern landed; behavioural verification is the manual browser smoke per task.

**Risk** — Task 1 touches 5 modals in one commit. If a pattern bug surfaces (e.g., onboarding-overlay's `onDismiss` doesn't have a stable identity and the trap thrashes), it affects all 5. The trap-ref pattern is the same one Modal already uses in production via PR #267, which reduces this risk substantially — but the manual smoke in Step 1.10 is the safety net. Do not commit Task 1 if any of the 5 smokes regress.
