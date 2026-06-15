# A11y Composition PR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the three design-required a11y pieces that were explicitly deferred from the Keyboard PR — kanban keyboard drag-alternative, library reader heading nav, and xterm screen-reader mirror — each with a recommended design committed up-front and alternatives documented.

**Architecture:** Three logically-independent commits, every one approval-gated. Each commits to one specific pattern; alternatives are spelled out in the design preamble so they can be challenged at pre-flight before any code runs.

**Tech Stack:** Next.js 16 · React 19 · xterm.js · `node:test` source-inspection tests.

**Source spec:** `docs/superpowers/specs/2026-06-08-ux-audit.md` § "P0 — broken/blocking" (xterm SR fallback, board kanban mouse-only), § "P1 — significant rough edges" (library reader j/k).

---

## Design decisions (locked, but revisit at the pre-flight gate)

### Decision 1 — Kanban keyboard drag-alt: APG grab pattern (recommended)

**Chosen:** WAI-ARIA APG composite-widget grab pattern.
- `Space` on a focused card → "grab" mode. Card gets a visible "grabbed" affordance. Live-region announces *"Picked up '{title}'. Use arrow keys to move; Space to drop; Escape to cancel."*
- `ArrowLeft` / `ArrowRight` → cycle through columns. Announce *"Moving '{title}' over {column name}."*
- `Space` on target column → drop. Calls existing `onMoveStatus(id, targetStatus)`. Announce *"Moved '{title}' to {column name}."*
- `Escape` → cancel. No mutation. Announce *"Cancelled."*

**Alternative considered:** "Move to…" dropdown menu per card.
- *Pro:* simpler implementation; fewer keypresses (1 → menu, 1 → choice).
- *Con:* doesn't compose with the visual board model; user must mentally translate "this card to In Progress" into menu navigation. Power users prefer grab.
- *Verdict:* defer. Grab is the canonical pattern and integrates with the existing native-drag visual idiom.

### Decision 2 — Library reader heading nav: `j`/`k` + `ArrowDown`/`ArrowUp` (recommended)

**Chosen:** both Vim keys and arrow keys. `j` / `ArrowDown` jumps to the next `h1`/`h2`/`h3` inside the reader body; `k` / `ArrowUp` jumps to the previous. The active heading gets `aria-current="location"` for AT, `scrollIntoView({ block: "start" })` for visual, and a brief CSS flash for sighted users.

The heading list piggybacks on the existing `tocItems` state (`library-doc-preview.tsx:349`) — no separate scan.

**Alternative considered:** `n`/`p` (next/previous) instead of `j`/`k`.
- *Pro:* less Vim-coded; more accessible to non-keyboard-power-users.
- *Con:* `n` conflicts with browser "Find next" in many readers; `p` is unconventional.
- *Verdict:* `j`/`k` + arrows. Arrows cover the conventional case; `j`/`k` covers power users without claiming `n`/`p`.

### Decision 3 — xterm SR mirror: wrap `term.write`, polite live region, 50-line FIFO, debounced 250 ms (recommended)

**Chosen:**
- Wrap the existing `term.write(new Uint8Array(e.payload.bytes))` call (`bottom-terminal.tsx:139`) so we also decode bytes → text → strip ANSI → push to a React-state mirror buffer.
- Mirror keeps the last **50 lines** (FIFO). Beyond 50, the buffer would flood SR.
- Render the mirror inside an offscreen `<div role="region" aria-live="polite" aria-label="Terminal output">`. Polite = SR queues, doesn't interrupt.
- Debounce React state updates to **250 ms** chunks. Fast streams (`cargo build`, `pnpm install`) emit hundreds of bytes/second; updating React state per byte would melt the UI thread *and* spam SR.

**Alternative considered:** intercept via xterm's `onWriteParsed` event.
- *Pro:* no source-of-truth divergence; xterm parses the actual rendered text.
- *Con:* fires per parsed cell, not per chunk; even noisier than wrapping `term.write`. Would still need debounce.
- *Verdict:* wrap the call site. Simpler, in our code path, easy to debounce.

**Alternative considered:** announce-on-pause (only update mirror when output stops for N ms).
- *Pro:* much quieter for streaming output.
- *Con:* SR users miss real-time progress (e.g., live test runs).
- *Verdict:* debounced real-time is the safer default. Pause-only could ship later if users find debounced still too noisy.

**Strip ANSI:** strip CSI sequences (`/\x1b\[[0-9;]*[A-Za-z]/g`), OSC sequences (`/\x1b\][^\x07]*\x07/g`), and other C0 control chars except `\n`. Cursor-moves like `\x1b[2K` mid-line will leave artifacts in the mirror; acceptable — the mirror is supplementary, not lossless.

---

**Depends on:** PR #267 (foundations — `useAnnouncer`); PR `a11y-quickwins` recommended but not required (this plan uses `useAnnouncer` directly, doesn't depend on quickwins-era surfaces).

---

## Pre-flight

- [ ] **Confirm signing is configured**

```bash
git config --get user.signingkey
git config --get gpg.format
```

Expected: non-empty. If empty, stop.

- [ ] **Confirm foundations have landed**

```bash
git fetch origin main
git log origin/main --oneline | head -10 | grep -E "foundations|LiveRegion|useAnnouncer"
```

If you don't see foundations in main, stop and ask.

- [ ] **Create worktree**

```bash
git worktree add -b a11y-composition \
  /Users/buns/Documents/GitHub/OpenCoven/coven-cave-a11y-composition origin/main
cd /Users/buns/Documents/GitHub/OpenCoven/coven-cave-a11y-composition
```

- [ ] **Install + typecheck**

```bash
pnpm install
pnpm typecheck
```

- [ ] **Approval gate — confirm the three design decisions above and the scope**

Surface to user:
> "Worktree up at `<path>`. 3 commits planned, each with a specific design committed above the implementation. Want to revise any of the three design decisions before code runs?"

Wait for explicit go OR a design revision. If a design changes, update the relevant task before proceeding.

---

## File map

| File | Action | Why |
|---|---|---|
| `src/components/board-kanban.tsx` | modify | Add keyboard grab state + handlers + announcements + visual affordance. Native HTML5 DnD untouched. |
| `src/components/library-doc-preview.tsx` | modify | Add j/k + arrow nav over existing `tocItems`. `aria-current="location"` on active heading. |
| `src/components/bottom-terminal.tsx` | modify | Wrap `term.write` to mirror text → offscreen live region. ANSI strip + 50-line FIFO + 250 ms debounce. |
| `src/app/globals.css` | modify | Add `.board-kanban-card--grabbed` visual affordance + `.library-heading--active` flash. |
| `src/components/board-kanban-keyboard.test.ts` | create | source-grep invariants |
| `src/components/library-reader-keyboard.test.ts` | create | source-grep invariants |
| `src/components/bottom-terminal-sr-mirror.test.ts` | create | source-grep invariants |

Tests verify pattern; manual browser smoke verifies behaviour (with a real screen reader where possible).

---

## Task 1: Kanban keyboard drag-alternative

**Why:** Audit P0 — keyboard users can't move cards. Native HTML5 DnD is mouse-only.

**Files:**
- Modify: `src/components/board-kanban.tsx`
- Modify: `src/app/globals.css` (one rule: `.board-kanban-card--grabbed`)
- Create: `src/components/board-kanban-keyboard.test.ts`

### Step 1.1 — Inspect & confirm anchors

```bash
cd /Users/buns/Documents/GitHub/OpenCoven/coven-cave-a11y-composition
sed -n '70,100p' src/components/board-kanban.tsx
grep -n "onMoveStatus\|CardStatus\|cols\s*=\|COLS" src/components/board-kanban.tsx | head -10
```

Confirm: `onMoveStatus(id, status)` is the move callback, `cols` (or similar) is the column list with `{ id, title }`, `CardStatus` is the type. Adapt variable names below if different.

### Step 1.2 — Write the failing invariants

Create `src/components/board-kanban-keyboard.test.ts`:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./board-kanban.tsx", import.meta.url),
  "utf8",
);

// Consumes the foundations announcer.
assert.match(
  source,
  /import\s+\{[^}]*useAnnouncer[^}]*\}\s+from\s+["']@\/components\/ui\/live-region["']/,
  "imports useAnnouncer",
);
assert.match(source, /useAnnouncer\(\)/, "calls useAnnouncer()");

// Grab-mode state and key handlers.
assert.match(
  source,
  /(grabbedCardId|keyboardGrabbedId)/,
  "tracks the keyboard-grabbed card id in state",
);
assert.match(source, /key === " "|e\.key === " "/, "handles Space (grab/drop)");
assert.match(source, /key === "ArrowLeft"|key === "ArrowRight"/, "handles ArrowLeft/Right for column nav while grabbed");
assert.match(source, /key === "Escape"/, "handles Escape to cancel grab");

// Visual affordance class is applied when grabbed.
assert.match(
  source,
  /board-kanban-card--grabbed/,
  "applies the --grabbed class to the grabbed card",
);

// Announcements fire.
assert.match(source, /announce\(/, "calls announce(...) for grab/move/drop");

console.log("board-kanban-keyboard.test.ts OK");
```

### Step 1.3 — Run, confirm FAIL

```bash
npx --yes tsx --test src/components/board-kanban-keyboard.test.ts
```

### Step 1.4 — Implement keyboard grab in `board-kanban.tsx`

a. Imports:

```tsx
import { useCallback, useEffect, useState } from "react";
import { useAnnouncer } from "@/components/ui/live-region";
```

b. State and announcer near the top of the component (alongside existing `draggingId` state):

```tsx
const [grabbedCardId, setGrabbedCardId] = useState<string | null>(null);
const { announce } = useAnnouncer();
```

c. Helper to get column metadata. Assuming `cols: { id: CardStatus; title: string }[]` exists, define inside the component:

```tsx
const columnIndex = useCallback(
  (id: string) => cols.findIndex((c) => c.id === id),
  [cols],
);
```

d. Key handler effect — listens for Space/Arrow/Escape while a card is focused. The handler reads the focused card's id from `document.activeElement.dataset.cardId` to keep state coupling shallow:

```tsx
useEffect(() => {
  function onKey(e: KeyboardEvent) {
    const target = document.activeElement as HTMLElement | null;
    const focusedCardId = target?.dataset?.cardId ?? null;

    // Toggle grab on Space.
    if (e.key === " ") {
      if (grabbedCardId) {
        // Drop. Active element's card id is the destination column's current
        // card OR the column container itself.
        const dropTargetStatus =
          (target?.closest("[data-kanban-column]") as HTMLElement | null)
            ?.dataset?.kanbanColumn as CardStatus | undefined;
        const card = cards.find((c) => c.id === grabbedCardId);
        if (card && dropTargetStatus && card.status !== dropTargetStatus) {
          const col = cols.find((c) => c.id === dropTargetStatus);
          onMoveStatus(grabbedCardId, dropTargetStatus);
          announce(`Moved '${card.title}' to ${col?.title ?? dropTargetStatus}.`);
        } else if (card) {
          announce("Drop cancelled — same column.");
        }
        setGrabbedCardId(null);
        e.preventDefault();
        return;
      }
      // Grab.
      if (focusedCardId) {
        const card = cards.find((c) => c.id === focusedCardId);
        if (!card) return;
        setGrabbedCardId(focusedCardId);
        announce(
          `Picked up '${card.title}'. Use arrow keys to move; Space to drop; Escape to cancel.`,
        );
        e.preventDefault();
      }
      return;
    }

    // Escape cancels.
    if (e.key === "Escape" && grabbedCardId) {
      const card = cards.find((c) => c.id === grabbedCardId);
      setGrabbedCardId(null);
      announce(card ? `Cancelled moving '${card.title}'.` : "Cancelled.");
      e.preventDefault();
      return;
    }

    // Column nav while grabbed.
    if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && grabbedCardId) {
      const card = cards.find((c) => c.id === grabbedCardId);
      if (!card) return;
      const currentIdx = columnIndex(card.status);
      if (currentIdx < 0) return;
      const delta = e.key === "ArrowRight" ? 1 : -1;
      const nextIdx = Math.max(0, Math.min(cols.length - 1, currentIdx + delta));
      if (nextIdx === currentIdx) return;
      // We don't mutate until Space-drop. We move the *focus* to the column's
      // first card (or column header) so subsequent Space drops there.
      const nextCol = cols[nextIdx];
      const colEl = document.querySelector<HTMLElement>(
        `[data-kanban-column="${nextCol.id}"]`,
      );
      const firstCard = colEl?.querySelector<HTMLElement>("[data-card-id]");
      (firstCard ?? colEl)?.focus();
      announce(`Moving '${card.title}' over ${nextCol.title}.`);
      e.preventDefault();
    }
  }
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}, [grabbedCardId, cards, cols, columnIndex, onMoveStatus, announce]);
```

e. Add `data-kanban-column={col.id}` to each column container (the `<div>` or `<ul>` that holds the cards for a status):

```tsx
<div data-kanban-column={col.id} tabIndex={-1} className="...">
  {/* existing column content */}
</div>
```

f. Add `data-card-id={card.id}` to each card (already needs to be there for the key handler to read it). Confirm the existing card markup includes it; if not, add it to the `<li>` that wraps each card.

g. Apply the `--grabbed` class conditionally on the card:

```tsx
<li
  data-card-id={card.id}
  className={`board-kanban-card${grabbedCardId === card.id ? " board-kanban-card--grabbed" : ""}${isDragging ? " board-kanban-card--dragging" : ""}`}
  // ...existing draggable / onDragStart / onDragEnd / onClick props UNCHANGED
>
```

h. **Do NOT** touch the native HTML5 DnD handlers. The keyboard path is parallel.

### Step 1.5 — Add the `--grabbed` style to `globals.css`

Find the existing `.board-kanban-card` rule (grep `board-kanban-card` to anchor). After it, add:

```css
/* Composition PR — keyboard drag affordance.
   Visually distinct from --dragging so users can tell mouse-drag from
   keyboard-grab. Uses --ring-focus for the lift; box-shadow for the float. */
.board-kanban-card--grabbed {
  outline: var(--ring-width) solid var(--ring-focus);
  outline-offset: 2px;
  box-shadow: 0 8px 16px color-mix(in oklch, var(--accent-presence) 30%, transparent);
  transform: translateY(-1px);
}
```

### Step 1.6 — Run test, confirm PASS

```bash
npx --yes tsx --test src/components/board-kanban-keyboard.test.ts
```

### Step 1.7 — Typecheck + build

```bash
pnpm typecheck
pnpm build 2>&1 | tail -8
```

### Step 1.8 — Manual smoke

`pnpm dev`. Open `/board`, switch to kanban. Tab into a card. Verify the full flow:

1. Press `Space`. Card gets the `--grabbed` outline. (Run a screen reader if available; the live region announces *"Picked up '…'."*. Otherwise inspect the polite region's text node in DevTools.)
2. Press `ArrowRight`. Focus jumps to the first card of the next column (or the column container if empty). Announcement updates.
3. Press `ArrowLeft` / `ArrowRight` to land on the desired column.
4. Press `Space`. The card moves; mouse-DnD path unchanged.
5. Re-grab and press `Escape`. No mutation. Announcement *"Cancelled."*.
6. Mouse drag still works for the same card.

If any step regresses, stop. Note specifically: the `ArrowLeft`/`ArrowRight` will conflict if the focused card has its own arrow handling — verify by inspecting `onKeyDown` on the existing `<li>` markup; if it's there, the new effect must check `e.defaultPrevented` before acting.

### Step 1.9 — Approval gate, then commit

```bash
git add src/components/board-kanban.tsx \
        src/app/globals.css \
        src/components/board-kanban-keyboard.test.ts
git commit -S -m "$(cat <<'EOF'
feat(a11y): kanban keyboard grab + arrow-move + drop

Adopts the WAI-ARIA APG grab pattern as a parallel keyboard path to the
existing HTML5 DnD. Space toggles grab; arrows shift between columns
(focus follows); Space drops; Escape cancels. useAnnouncer announces
each transition. Native DnD unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature
```

---

## Task 2: Library reader heading nav (`j` / `k` / arrows)

**Why:** Audit P1 — no keyboard nav between headings inside a long doc. Users read with mouse-scroll only.

**Files:**
- Modify: `src/components/library-doc-preview.tsx`
- Modify: `src/app/globals.css` (one rule: `.library-heading--active` flash)
- Create: `src/components/library-reader-keyboard.test.ts`

### Step 2.1 — Inspect existing heading scan

```bash
sed -n '349,400p' src/components/library-doc-preview.tsx
```

Confirm: `tocItems` is an array of `{ id, level, text }` (or similar), built by scanning `mdRef.current.querySelectorAll<HTMLElement>("h1,h2,h3")`. `activeTocId` already exists. We'll reuse both for the keyboard nav.

### Step 2.2 — Write the failing invariants

Create `src/components/library-reader-keyboard.test.ts`:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./library-doc-preview.tsx", import.meta.url),
  "utf8",
);

// Handles j/k and ArrowDown/ArrowUp.
assert.match(source, /key === "j"/, "handles j (next heading)");
assert.match(source, /key === "k"/, "handles k (previous heading)");
assert.match(source, /key === "ArrowDown"/, "handles ArrowDown (next heading)");
assert.match(source, /key === "ArrowUp"/, "handles ArrowUp (previous heading)");

// Active heading marked with aria-current="location".
assert.match(
  source,
  /aria-current="location"|setAttribute\(\s*"aria-current",\s*"location"/,
  "marks active heading with aria-current=location",
);

// scrollIntoView with block:start so the heading lands at the top.
assert.match(
  source,
  /scrollIntoView\(\s*\{[\s\S]*?block:\s*["']start["']/,
  "scrolls heading to top of viewport",
);

console.log("library-reader-keyboard.test.ts OK");
```

### Step 2.3 — Run, confirm FAIL

```bash
npx --yes tsx --test src/components/library-reader-keyboard.test.ts
```

### Step 2.4 — Implement

a. Add an effect inside the reader (the modal that renders when `readerOpen` is true; uses `readerMdRef` per audit findings). The handler scopes to the reader — only fires when the reader is open and focus is within it:

```tsx
useEffect(() => {
  if (!readerOpen) return;
  const reader = readerMdRef.current;
  if (!reader) return;

  function jumpToHeading(direction: 1 | -1) {
    if (tocItems.length === 0) return;
    const currentIdx = tocItems.findIndex((t) => t.id === activeTocId);
    // If no active yet (top of doc), -1; next/-1 wraps to 0 or last.
    let nextIdx: number;
    if (currentIdx < 0) {
      nextIdx = direction === 1 ? 0 : tocItems.length - 1;
    } else {
      nextIdx = Math.max(0, Math.min(tocItems.length - 1, currentIdx + direction));
    }
    if (nextIdx === currentIdx) return; // already at the boundary
    const next = tocItems[nextIdx];
    const el = reader!.querySelector<HTMLElement>(`#${CSS.escape(next.id)}`);
    if (!el) return;
    el.scrollIntoView({ block: "start", behavior: "auto" });
    setActiveTocId(next.id);
    // Visual flash for sighted users.
    el.classList.add("library-heading--active");
    window.setTimeout(() => el.classList.remove("library-heading--active"), 800);
  }

  function onKey(e: KeyboardEvent) {
    // Don't steal keys from inputs.
    const t = e.target as HTMLElement;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) {
      return;
    }
    if (e.key === "j" || e.key === "ArrowDown") {
      e.preventDefault();
      jumpToHeading(1);
    } else if (e.key === "k" || e.key === "ArrowUp") {
      e.preventDefault();
      jumpToHeading(-1);
    }
  }

  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}, [readerOpen, tocItems, activeTocId]);
```

b. Add `aria-current` synchronization. When `activeTocId` changes, mark the heading element. Find the existing effect that updates `activeTocId` based on scroll position (~line 372–386) and inside it, after the `setActiveTocId(...)` calls, clear `aria-current` from all headings and set it on the active one:

```tsx
// Sync aria-current on the active heading element.
const all = mdRef.current?.querySelectorAll<HTMLElement>("h1,h2,h3") ?? [];
for (const h of all) {
  if (h.id === activeId) h.setAttribute("aria-current", "location");
  else h.removeAttribute("aria-current");
}
```

(Replicate the same pattern in the corresponding reader-mode effect with `readerMdRef`.)

c. **Do NOT** touch the existing TocPanel click behaviour or the scroll-spy logic. The keyboard nav delegates to the same `setActiveTocId` setter; the rest follows automatically.

### Step 2.5 — Add the `.library-heading--active` flash

Append to `src/app/globals.css` (near other library rules; grep `library-preview-md` to anchor):

```css
/* Composition PR — reader heading active flash.
   Brief visual cue when keyboard nav lands on a heading. */
@keyframes library-heading-flash {
  0%   { background: color-mix(in oklch, var(--accent-presence) 22%, transparent); }
  100% { background: transparent; }
}
.library-heading--active {
  animation: library-heading-flash 800ms ease-out;
  border-radius: 4px;
}
```

### Step 2.6 — Run test, confirm PASS

```bash
npx --yes tsx --test src/components/library-reader-keyboard.test.ts
```

### Step 2.7 — Typecheck + build

```bash
pnpm typecheck
pnpm build 2>&1 | tail -8
```

### Step 2.8 — Manual smoke

`pnpm dev`. Open `/library`, open any doc with multiple `h1`/`h2`/`h3` (the `2026-06-08-ui-ux-shell-ia-design.md` spec is a good test). Expand to reader. Verify:

1. Press `j`. View scrolls to the next heading; heading briefly flashes.
2. Press `j` again. Next heading.
3. Press `k`. Previous heading.
4. Press `ArrowDown` / `ArrowUp`. Same behaviour as `j` / `k`.
5. Focus a text input within the reader (if any exists). Press `j` — typing the letter "j" lands in the input. Keyboard nav doesn't steal from inputs.
6. Close the reader (Esc). Re-open. Heading nav still works.
7. Inspect the active heading element — confirm `aria-current="location"`.

### Step 2.9 — Approval gate, then commit

```bash
git add src/components/library-doc-preview.tsx \
        src/app/globals.css \
        src/components/library-reader-keyboard.test.ts
git commit -S -m "$(cat <<'EOF'
feat(a11y): library reader j/k + arrow heading navigation

Vim-style j/k and arrow keys jump between h1/h2/h3 headings in the
reader. Active heading gets aria-current="location" and a brief visual
flash. Inputs and contentEditable areas inside the reader are immune.
Reuses the existing tocItems + activeTocId state.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature
```

---

## Task 3: xterm screen-reader mirror

**Why:** Audit P0 — xterm.js canvas is opaque to AT. A SR mirror gives blind users a textual feed of recent PTY output.

**Files:**
- Modify: `src/components/bottom-terminal.tsx`
- Create: `src/components/bottom-terminal-sr-mirror.test.ts`

### Step 3.1 — Inspect

```bash
sed -n '135,160p' src/components/bottom-terminal.tsx
```

Confirm: the `term.write(new Uint8Array(e.payload.bytes))` call site (~line 139) and the wrap element where we'll add the mirror.

### Step 3.2 — Write the failing invariants

Create `src/components/bottom-terminal-sr-mirror.test.ts`:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./bottom-terminal.tsx", import.meta.url),
  "utf8",
);

// Mirror state buffer exists.
assert.match(
  source,
  /(mirrorBuffer|srMirror|mirror)\s*=\s*(useState|useRef)/,
  "tracks the SR mirror buffer in state or a ref",
);

// ANSI stripping is in place.
assert.match(
  source,
  /\\x1b\[[0-9;]\*\[A-Za-z\]|stripAnsi/,
  "strips CSI escape sequences before mirroring",
);

// Mirror is rendered as an offscreen live region.
assert.match(
  source,
  /role="region"[\s\S]{0,200}aria-live="polite"|aria-live="polite"[\s\S]{0,200}role="region"/,
  "renders a polite live region for the mirror",
);
assert.match(
  source,
  /className="sr-only"/,
  "mirror is visually hidden via .sr-only",
);

// Debounce / chunked update.
assert.match(
  source,
  /setTimeout|requestAnimationFrame|debounce/,
  "debounces or chunks the mirror state updates",
);

// FIFO line cap.
assert.match(
  source,
  /MIRROR_LINES|MAX_MIRROR|\.slice\(-50\)|\.slice\(-MIRROR/,
  "caps the mirror buffer to a small number of lines",
);

console.log("bottom-terminal-sr-mirror.test.ts OK");
```

### Step 3.3 — Run, confirm FAIL

```bash
npx --yes tsx --test src/components/bottom-terminal-sr-mirror.test.ts
```

### Step 3.4 — Implement

a. Near the top of the file, add a constant and an ANSI strip helper outside the component (or just below the existing imports):

```tsx
const MIRROR_LINES = 50;
const MIRROR_DEBOUNCE_MS = 250;

function stripAnsi(text: string): string {
  return text
    // CSI: ESC [ params letter
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
    // OSC: ESC ] ... BEL or ESC \
    .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, "")
    // Other C0 control chars except newline and tab.
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
}
```

b. Inside the `BottomTerminal` component, add the mirror state and a pending-buffer ref:

```tsx
const [mirrorLines, setMirrorLines] = useState<string[]>([]);
const pendingMirrorRef = useRef<string>("");
const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
const decoderRef = useRef<TextDecoder | null>(null);
if (!decoderRef.current) decoderRef.current = new TextDecoder("utf-8", { fatal: false });
```

c. Add a flush function and a "push" function:

```tsx
const flushMirror = useCallback(() => {
  flushTimerRef.current = null;
  const pending = pendingMirrorRef.current;
  pendingMirrorRef.current = "";
  if (!pending) return;
  setMirrorLines((prev) => {
    const combined = (prev.join("\n") + pending).split("\n");
    return combined.slice(-MIRROR_LINES);
  });
}, []);

const pushToMirror = useCallback((bytes: Uint8Array) => {
  if (!decoderRef.current) return;
  const text = stripAnsi(decoderRef.current.decode(bytes, { stream: true }));
  if (!text) return;
  pendingMirrorRef.current += text;
  if (flushTimerRef.current == null) {
    flushTimerRef.current = setTimeout(flushMirror, MIRROR_DEBOUNCE_MS);
  }
}, [flushMirror]);
```

d. Find the existing `term.write(new Uint8Array(e.payload.bytes))` call (~line 139). Wrap it:

```tsx
const bytes = new Uint8Array(e.payload.bytes);
term.write(bytes);
pushToMirror(bytes);
```

e. Clean up the debounce timer on unmount. Find the existing cleanup return (or add one inside the effect that opens the terminal):

```tsx
return () => {
  // ...existing cleanup
  if (flushTimerRef.current) {
    clearTimeout(flushTimerRef.current);
    flushTimerRef.current = null;
  }
};
```

f. Render the mirror as a sibling of the xterm wrap div, inside the same component return. Place AFTER the existing xterm wrap so DOM order is sensible:

```tsx
<>
  {/* existing xterm wrap div */}
  <div
    className="sr-only"
    role="region"
    aria-live="polite"
    aria-label="Terminal output"
  >
    {mirrorLines.map((line, i) => (
      <div key={i}>{line}</div>
    ))}
  </div>
</>
```

If the component already returns a single div, wrap in a fragment.

g. **Do NOT** rewire the existing `term.onData((data) => ...)` outbound path (line 156). That's user keypresses going TO the PTY, not output coming FROM it. The mirror only reflects output.

### Step 3.5 — Run test, confirm PASS

```bash
npx --yes tsx --test src/components/bottom-terminal-sr-mirror.test.ts
```

### Step 3.6 — Typecheck + build

```bash
pnpm typecheck
pnpm build 2>&1 | tail -8
```

### Step 3.7 — Manual smoke

`pnpm dev`. Open the bottom terminal (⌃`). Run something with output (`ls`, `echo hello`, `cargo build` if you want to stress test). Verify:

1. DOM has a `<div class="sr-only" role="region" aria-live="polite" aria-label="Terminal output">…</div>` sibling of the xterm wrap. Inspect its text content — recent lines should appear (stripped of ANSI).
2. Output is debounced — for fast streams, the DOM updates ~every 250 ms, not per-byte.
3. The mirror never exceeds ~50 lines.
4. ANSI escape sequences are absent from the mirror's text (no `\x1b[31m` etc.).
5. Visual xterm rendering is unchanged.
6. Run a screen reader (VoiceOver if available). Run a command. Confirm announcements of recent output. They should be polite (not interrupting). If output is overwhelming, that's a known tradeoff — record and surface to user; future PR can move to pause-only.

### Step 3.8 — Approval gate, then commit

```bash
git add src/components/bottom-terminal.tsx src/components/bottom-terminal-sr-mirror.test.ts
git commit -S -m "$(cat <<'EOF'
feat(a11y): xterm screen-reader mirror

Adds an offscreen polite live region that mirrors recent terminal output
for assistive tech. Wraps the existing term.write call to also decode +
strip ANSI + push to a 50-line FIFO buffer, debounced to 250 ms chunks.
Visual xterm rendering unchanged; user input path unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature
```

---

## Task 4: Verify, ask before push, ask before PR

**Default posture:** stop and ask. Push and PR each block on user OK.

### Step 4.1 — Run all tests + typecheck + build

```bash
cd /Users/buns/Documents/GitHub/OpenCoven/coven-cave-a11y-composition
pnpm typecheck
npx --yes tsx --test \
  src/components/board-kanban-keyboard.test.ts \
  src/components/library-reader-keyboard.test.ts \
  src/components/bottom-terminal-sr-mirror.test.ts
pnpm build 2>&1 | tail -8
```

Expected: 3/3 tests pass; typecheck + build clean.

### Step 4.2 — Verify every commit is signed

```bash
git log origin/main..HEAD --pretty='%H %G? %s' | awk '$2 != "G" {print "UNSIGNED:", $0}'
```

Expected: empty. If anything prints, rebase to sign:

```bash
git rebase --exec 'git commit --amend --no-edit -S' origin/main
```

### Step 4.3 — Approval gate, then push

Surface to user: commit list, all checks green, every commit signed. Ask: **"Push `a11y-composition` to origin?"** Wait for yes.

```bash
git push -u origin a11y-composition
```

### Step 4.4 — Approval gate, then open the PR

Draft body, show to user, ask: **"Open the PR with this body?"** Wait for yes.

```bash
gh pr create --title "feat(a11y): composition — kanban grab, reader nav, xterm SR mirror" --body "$(cat <<'EOF'
## Summary
The three design-required a11y pieces deferred from the keyboard PR. Each task commits to a specific pattern; alternatives were considered and documented in the plan.

- **Kanban keyboard grab** (APG pattern): `Space` grabs a focused card; arrows move between columns (focus follows); `Space` drops; `Escape` cancels. Each transition is announced via `useAnnouncer`. Native HTML5 DnD untouched — keyboard path is parallel.
- **Library reader heading nav**: `j` / `ArrowDown` jumps to next h1/h2/h3 inside the reader; `k` / `ArrowUp` jumps to previous. Active heading gets `aria-current="location"` + a brief CSS flash. Reuses existing `tocItems` state. Inputs inside the reader are immune from key capture.
- **xterm SR mirror**: wraps `term.write` to also decode + ANSI-strip + push into a 50-line FIFO. Rendered offscreen as `<div role="region" aria-live="polite" class="sr-only">`. State updates debounced to 250 ms chunks. Visual xterm rendering and outbound user input path are unchanged.

## Test plan
- [x] `pnpm typecheck` clean.
- [x] `pnpm build` clean.
- [x] 3/3 source-grep invariant tests pass.
- [x] Every commit signed.
- [ ] Manual: kanban grab/move/drop/cancel + native DnD both work; mirror updates in DOM as terminal runs commands; reader j/k flashes + scrolls.
- [ ] Manual SR (VoiceOver / NVDA): kanban announcements fire on grab/move/drop; mirror announces recent terminal output (politely).

## Source
- Audit: `docs/superpowers/specs/2026-06-08-ux-audit.md`.
- Plan: `docs/superpowers/plans/2026-06-08-a11y-composition.md`.
- Foundations PR: #267.

## Known tradeoffs
- xterm mirror uses debounced real-time (250 ms chunks). For very loud streams (`cargo build` rebuilds), this can still be noisy in a screen reader. If user feedback bears this out, a follow-up can switch to pause-only.
- Kanban grab fires events at `window` scope. If a future surface intercepts Space at a higher level, may need to check `e.defaultPrevented` before acting.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Return the PR URL. Do not merge.

---

## Self-review

**Spec coverage** — three audit items, each in its own task:

| Audit item | Task | Design committed |
|---|---|---|
| Board kanban is mouse-only drag | Task 1 | APG grab pattern (Space-grab → arrows → Space-drop → Esc-cancel) |
| xterm has zero SR fallback | Task 3 | Wrapped term.write → polite live region, 50-line FIFO, 250 ms debounce |
| Library reader has no j/k or arrow nav | Task 2 | j/k + arrows, aria-current=location, scrollIntoView + flash |

**Placeholder scan** — no TBDs. Each task's design is locked at the plan preamble; alternatives are documented for revisitation at pre-flight.

**Type consistency** — every `useAnnouncer` call uses the signature shipped in foundations: `const { announce } = useAnnouncer()`. `announce(msg, level?)`.

**Risk** — Task 1 (kanban) is the largest. The arrow-while-grabbed handler relies on focus moving to the next column's first card; if a column is empty, focus lands on the column container itself. Verified the column container gets `tabIndex={-1}` for this fallback. Manual smoke specifically exercises empty columns.

Task 3 (xterm mirror) has a known noise tradeoff for fast streams — explicitly called out in the PR body. Not a regression in shipped behaviour (mirror didn't exist before); it's a starting point that can be iterated.

**Test framing** — source-grep tests verify pattern landed. Behavioural verification is the manual browser smoke per task, including a screen-reader pass where available.

**Approval discipline** — three design decisions surfaced at the pre-flight gate. Every commit step gated. Push and PR each have their own explicit gate in Task 4.
