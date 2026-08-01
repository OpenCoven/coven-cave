# Canvas Editor Full Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-app Expand toggle and a native Full screen button to the Canvas sketch editor so a sketch can fill the editor body or the whole monitor.

**Architecture:** A pure Escape-precedence resolver lives in `src/lib/canvas-editor-escape.ts` (importable by tests; the component module can't be imported because it imports CSS). `CanvasEditor` gains `expanded` / `nativeFullscreen` / `fullscreenAvailable` state, two header icon buttons before the mode group, a `canvas-editor--expanded` root modifier class driven purely by CSS, and `requestFullscreen()` on the frame shell with `webkit`-prefixed fallbacks for WKWebView/Tauri.

**Tech Stack:** React 19 client component, plain CSS (semantic tokens), Phosphor icons via `src/lib/icon.tsx`, `node --test` with source-regex pins per repo convention.

**Spec:** `docs/superpowers/specs/2026-07-21-canvas-fullscreen-design.md` · **Bead:** cave-i0qt

**Working directory for ALL tasks:** `/Users/buns/Documents/GitHub/OpenCoven/coven-cave/.worktrees/feat-canvas-fullscreen` (branch `feat/canvas-fullscreen`, local-only until Task 5 pushes). All commits are signed (`-S`).

**One-time setup (before Task 1):**

```bash
cd /Users/buns/Documents/GitHub/OpenCoven/coven-cave/.worktrees/feat-canvas-fullscreen
pnpm install
```

Expected: completes in ~10s (pnpm CAS store). Needed for `pnpm typecheck` in Task 5.

---

## File Structure

- **Create** `src/lib/canvas-editor-escape.ts` — pure Escape-precedence resolver (one responsibility: the deterministic rule; no DOM).
- **Modify** `src/components/canvas-editor.tsx` — state, callbacks, header buttons, root class, frame-shell ref, rewritten Escape handler that delegates to the resolver.
- **Modify** `src/styles/canvas-editor.css` — view-controls button styles, `--expanded` overrides, `:fullscreen` chrome strip.
- **Modify** `src/lib/icon.tsx` — register `ph:frame-corners` in `ICON_NAMES`.
- **Modify (test)** `src/components/canvas-editor.test.ts` — behavioral tests for the resolver, updated Escape pin, new fullscreen wiring + CSS pins. Already registered in `scripts/run-tests.mjs` (line ~373), so no suite wiring needed.

---

### Task 1: Escape-precedence resolver (`src/lib/canvas-editor-escape.ts`)

**Files:**
- Create: `src/lib/canvas-editor-escape.ts`
- Test: `src/components/canvas-editor.test.ts` (append to existing file)

- [ ] **Step 1: Write the failing behavioral tests**

In `src/components/canvas-editor.test.ts`, add below the existing import block (after `import * as inspector from "../lib/canvas-inspector.ts";`):

```js
import { resolveEscapeAction } from "../lib/canvas-editor-escape.ts";
```

And append this section at the end of the file, just above the final `console.log("canvas editor wiring: ok");` line:

```js
// ── Escape precedence: field → selection → in-app expand ────────────────────
assert.equal(
  resolveEscapeAction({ fieldHasContent: true, hasSelection: true, expanded: true }),
  "none",
  "a non-empty field owns Escape outright",
);
assert.equal(
  resolveEscapeAction({ fieldHasContent: false, hasSelection: true, expanded: true }),
  "clear-selection",
  "selection clears before expand exits",
);
assert.equal(
  resolveEscapeAction({ fieldHasContent: false, hasSelection: false, expanded: true }),
  "exit-expand",
  "with nothing selected, Escape exits the expanded sketch",
);
assert.equal(
  resolveEscapeAction({ fieldHasContent: false, hasSelection: false, expanded: false }),
  "none",
  "Escape is a no-op when there is nothing to dismiss",
);
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node --experimental-strip-types --no-warnings --test src/components/canvas-editor.test.ts
```

Expected: FAIL — `Cannot find module '../lib/canvas-editor-escape.ts'`.

- [ ] **Step 3: Implement the resolver**

Create `src/lib/canvas-editor-escape.ts`:

```ts
// Escape-key precedence for the canvas sketch editor: fields own Escape while
// they hold content, then a component selection clears, then in-app expand
// exits. One deterministic resolver so the editor and its tests share the
// rule (the component module imports CSS, so tests import this instead).

export type CanvasEscapeAction = "none" | "clear-selection" | "exit-expand";

export function resolveEscapeAction(state: {
  fieldHasContent: boolean;
  hasSelection: boolean;
  expanded: boolean;
}): CanvasEscapeAction {
  if (state.fieldHasContent) return "none";
  if (state.hasSelection) return "clear-selection";
  if (state.expanded) return "exit-expand";
  return "none";
}
```

- [ ] **Step 4: Run the test to verify the new asserts pass**

```bash
node --experimental-strip-types --no-warnings --test src/components/canvas-editor.test.ts
```

Expected: PASS (`canvas editor wiring: ok` printed; `pass 1`).

- [ ] **Step 5: Commit**

```bash
git add src/lib/canvas-editor-escape.ts src/components/canvas-editor.test.ts
git commit -S -m "feat(canvas): add Escape-precedence resolver for sketch editor (cave-i0qt)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 2: Register the `ph:frame-corners` icon

**Files:**
- Modify: `src/lib/icon.tsx` (ICON_NAMES array, ~line 177)

- [ ] **Step 1: Add the icon name**

In `src/lib/icon.tsx`, find the entries:

```tsx
  "ph:flag",
  "ph:flag-fill",
```

and add the new name after them:

```tsx
  "ph:flag",
  "ph:flag-fill",
  "ph:frame-corners",
```

(Icon exists in Phosphor — verified in `node_modules/@iconify-json/ph/icons.json`.)

- [ ] **Step 2: Regenerate the bundled icon subset**

`ICON_NAMES` is backed by the generated `src/lib/ph-icons-subset.json` (the only collection registered with Iconify; `src/lib/icon-subset.test.ts` enforces sync):

```bash
node scripts/generate-icon-subset.mjs
node --experimental-strip-types --no-warnings --test src/lib/icon-subset.test.ts
```

Expected: test passes; `git status` shows only `src/lib/ph-icons-subset.json` changed.

- [ ] **Step 3: Commit**

```bash
git add src/lib/icon.tsx src/lib/ph-icons-subset.json
git commit -S -m "feat(icons): register ph:frame-corners for canvas full screen (cave-i0qt)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 3: Component wiring (state, Escape rewrite, header buttons)

**Files:**
- Modify: `src/components/canvas-editor.tsx`
- Test: `src/components/canvas-editor.test.ts`

- [ ] **Step 1: Update the stale Escape pin and add failing wiring pins**

In `src/components/canvas-editor.test.ts`, **replace** the existing Escape pin (the block under the comment `// Escape deselects, but never swallows Escape from a non-empty field.`):

```js
// Escape deselects, but never swallows Escape from a non-empty field.
assert.match(
  editor,
  /event\.key !== "Escape" \|\| !selectionRef\.current\) return;[\s\S]{0,400}?active\.value\.trim\(\)[\s\S]{0,120}?return;[\s\S]{0,200}?setSelection\(null\)/,
  "Escape clears the selection unless a field still holds content",
);
```

with:

```js
// Escape routes through the shared resolver: field → selection → expand.
assert.match(
  editor,
  /import \{ resolveEscapeAction \} from "@\/lib\/canvas-editor-escape";/,
  "the editor delegates Escape precedence to the shared resolver",
);
assert.match(
  editor,
  /event\.key !== "Escape"\) return;[\s\S]{0,500}?resolveEscapeAction\(\{/,
  "the keydown handler asks the resolver what Escape should do",
);
assert.match(
  editor,
  /action === "clear-selection"[\s\S]{0,300}?setSelection\(null\)[\s\S]{0,400}?action === "exit-expand"[\s\S]{0,200}?setExpanded\(false\)/,
  "selection clears before expand exits, matching the resolver order",
);
```

Then add a new pin section just above the `// ── Escape precedence` section added in Task 1:

```js
// ── Full screen: in-app expand + native fullscreen ──────────────────────────
assert.match(
  editor,
  /className=\{`canvas-editor\$\{expanded \? " canvas-editor--expanded" : ""\}`\}/,
  "the expanded state drives the root modifier class",
);
assert.match(editor, /aria-pressed=\{expanded\}/, "the expand toggle exposes pressed state");
assert.match(
  editor,
  /doc\.fullscreenEnabled \|\| doc\.webkitFullscreenEnabled/,
  "availability covers standard and WebKit-prefixed Fullscreen APIs",
);
assert.match(
  editor,
  /\{fullscreenAvailable \? \(/,
  "the native full screen button renders only when the API is available",
);
assert.match(
  editor,
  /addEventListener\("fullscreenchange", onFullscreenChange\);[\s\S]{0,120}?addEventListener\("webkitfullscreenchange", onFullscreenChange\)/,
  "fullscreenchange (incl. webkit) keeps the button state in sync",
);
assert.match(
  editor,
  /ref=\{frameShellRef\}/,
  "the frame shell (iframe + error overlay) is the fullscreen element",
);
```

- [ ] **Step 2: Run the test to verify the new pins fail**

```bash
node --experimental-strip-types --no-warnings --test src/components/canvas-editor.test.ts
```

Expected: FAIL — first failing assert: "the editor delegates Escape precedence to the shared resolver".

- [ ] **Step 3: Implement the component changes**

All edits in `src/components/canvas-editor.tsx`.

**3a — import the resolver.** After the line `import { buildCanvasCommentsRequest } from "@/lib/canvas-comments";` add:

```tsx
import { resolveEscapeAction } from "@/lib/canvas-editor-escape";
```

**3b — fullscreen DOM typings.** After the `type StyleKey = ...` line (module scope, near the other type aliases), add:

```tsx
// WKWebView (Tauri shell) still exposes only the webkit-prefixed Fullscreen
// API surface; these widen the DOM types for feature-detected fallbacks.
type FullscreenDocument = Document & {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => void;
};
type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => void;
};
```

**3c — state + refs.** After the line `const [announcement, setAnnouncement] = useState("");` add:

```tsx
  const [expanded, setExpanded] = useState(false);
  const [nativeFullscreen, setNativeFullscreen] = useState(false);
  const [fullscreenAvailable, setFullscreenAvailable] = useState(false);
```

After the line `const frameRef = useRef<HTMLIFrameElement | null>(null);` add:

```tsx
  const frameShellRef = useRef<HTMLDivElement | null>(null);
```

**3d — rewrite the Escape handler.** Replace the whole existing effect (comment included):

```tsx
  // Escape clears the selection — unless focus sits in a field that still has
  // content (conventional: Escape there belongs to the field/draft).
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || !selectionRef.current) return;
      const active = document.activeElement;
      if (
        (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)
        && active.value.trim()
      ) {
        return;
      }
      selectionRef.current = null;
      setSelection(null);
      setAnnouncement("Selection cleared.");
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
```

with:

```tsx
  // Escape precedence (shared resolver): a non-empty field owns Escape, then
  // the selection clears, then the in-app expanded sketch restores.
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      const active = document.activeElement;
      const fieldHasContent =
        (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)
        && Boolean(active.value.trim());
      const action = resolveEscapeAction({
        fieldHasContent,
        hasSelection: selectionRef.current !== null,
        expanded: expandedRef.current,
      });
      if (action === "clear-selection") {
        selectionRef.current = null;
        setSelection(null);
        setAnnouncement("Selection cleared.");
      } else if (action === "exit-expand") {
        setExpanded(false);
        setAnnouncement("Sketch restored.");
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
```

(Note: the `expandedRef` declaration + render-sync assignment sit immediately before the effect, mirroring how `modeRef`/`selectionRef` are render-synced at the top of the component.)

**3e — availability + change sync effect.** Directly after the rewritten Escape effect, add:

```tsx
  // Native fullscreen: detect availability once, and mirror fullscreenchange
  // (incl. the WebKit-prefixed event WKWebView fires) into button state.
  useEffect(() => {
    const doc = document as FullscreenDocument;
    setFullscreenAvailable(Boolean(doc.fullscreenEnabled || doc.webkitFullscreenEnabled));
    function onFullscreenChange() {
      const active = Boolean(doc.fullscreenElement ?? doc.webkitFullscreenElement);
      setNativeFullscreen(active);
      setAnnouncement(active ? "Entered full screen." : "Exited full screen.");
    }
    document.addEventListener("fullscreenchange", onFullscreenChange);
    document.addEventListener("webkitfullscreenchange", onFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", onFullscreenChange);
    };
  }, []);
```

**3f — toggle callbacks.** Directly after the effect from 3e, add:

```tsx
  const toggleExpanded = useCallback(() => {
    setExpanded(!expanded);
    setAnnouncement(!expanded ? "Sketch expanded." : "Sketch restored.");
  }, [expanded]);

  const toggleNativeFullscreen = useCallback(() => {
    const doc = document as FullscreenDocument;
    if (doc.fullscreenElement ?? doc.webkitFullscreenElement) {
      if (doc.exitFullscreen) void doc.exitFullscreen().catch(() => {});
      else doc.webkitExitFullscreen?.();
      return;
    }
    const shell = frameShellRef.current as FullscreenElement | null;
    if (!shell) return;
    if (shell.requestFullscreen) {
      void shell.requestFullscreen().catch(() => {
        setAnnouncement("Full screen was blocked.");
      });
    } else {
      shell.webkitRequestFullscreen?.();
    }
  }, []);
```

**3g — root modifier class.** Change:

```tsx
    <div className="canvas-editor">
```

to:

```tsx
    <div className={`canvas-editor${expanded ? " canvas-editor--expanded" : ""}`}>
```

**3h — header view controls.** In the header JSX, between `</span>` closing `canvas-editor__title` and the `canvas-editor__modes` span — i.e. change:

```tsx
        <span className="canvas-editor__title" title={artifact.title}>{artifact.title}</span>
        <span className="canvas-editor__modes" role="group" aria-label="Editor mode">
```

to:

```tsx
        <span className="canvas-editor__title" title={artifact.title}>{artifact.title}</span>
        <span className="canvas-editor__view-controls" role="group" aria-label="Sketch view">
          <button
            type="button"
            className={`canvas-editor__view focus-ring-inset${expanded ? " is-active" : ""}`}
            title={expanded ? "Exit expanded sketch" : "Expand sketch"}
            aria-label={expanded ? "Exit expanded sketch" : "Expand sketch"}
            aria-pressed={expanded}
            onClick={toggleExpanded}
          >
            <Icon name={expanded ? "ph:arrows-in-simple" : "ph:arrows-out-simple"} width={15} aria-hidden />
          </button>
          {fullscreenAvailable ? (
            <button
              type="button"
              className="canvas-editor__view focus-ring-inset"
              title={nativeFullscreen ? "Exit full screen" : "Enter full screen"}
              aria-label={nativeFullscreen ? "Exit full screen" : "Enter full screen"}
              onClick={toggleNativeFullscreen}
            >
              <Icon name="ph:frame-corners" width={15} aria-hidden />
            </button>
          ) : null}
        </span>
        <span className="canvas-editor__modes" role="group" aria-label="Editor mode">
```

**3i — frame-shell ref.** Change:

```tsx
          <div className="canvas-editor__frame-shell">
```

to:

```tsx
          <div className="canvas-editor__frame-shell" ref={frameShellRef}>
```

- [ ] **Step 4: Run the test to verify the pins pass**

```bash
node --experimental-strip-types --no-warnings --test src/components/canvas-editor.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/canvas-editor.tsx src/components/canvas-editor.test.ts
git commit -S -m "feat(canvas): in-app expand + native full screen for the sketch editor (cave-i0qt)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 4: CSS (view controls, expanded layout, :fullscreen chrome)

**Files:**
- Modify: `src/styles/canvas-editor.css`
- Test: `src/components/canvas-editor.test.ts`

- [ ] **Step 1: Add failing CSS pins**

In `src/components/canvas-editor.test.ts`, at the end of the `// ── Full screen` pin section from Task 3, add:

```js
const editorCss = readFileSync(new URL("../styles/canvas-editor.css", import.meta.url), "utf8");
assert.match(
  editorCss,
  /\.canvas-editor--expanded \.canvas-editor__aside \{\s*display: none;/,
  "expanding hides the inspector/design-chat aside",
);
assert.match(
  editorCss,
  /\.canvas-editor--expanded \.canvas-editor__frame-shell \{[^}]*width: 100%;/,
  "expanding removes the 900px frame cap",
);
assert.match(
  editorCss,
  /\.canvas-editor__frame-shell:fullscreen \{/,
  "native fullscreen strips the frame chrome",
);
```

- [ ] **Step 2: Run the test to verify the pins fail**

```bash
node --experimental-strip-types --no-warnings --test src/components/canvas-editor.test.ts
```

Expected: FAIL — "expanding hides the inspector/design-chat aside".

- [ ] **Step 3: Add the CSS**

In `src/styles/canvas-editor.css`:

**4a** — after the `.canvas-editor__done:hover` rule (end of the Header section), add:

```css
/* View controls: in-app expand toggle + native full screen. */
.canvas-editor__view-controls {
  display: inline-flex;
  height: 30px;
  border: 1px solid var(--border-hairline);
  border-radius: var(--radius-control);
  overflow: hidden;
  flex: none;
}
.canvas-editor__view {
  display: inline-flex;
  align-items: center;
  padding: 0 var(--space-2);
  border: 0;
  cursor: pointer;
  color: var(--text-muted);
  background: transparent;
  transition: color 0.12s ease, background 0.12s ease;
}
.canvas-editor__view:hover {
  color: var(--text-primary);
}
.canvas-editor__view.is-active {
  color: var(--accent-presence);
  background: color-mix(in oklch, var(--accent-presence) 12%, transparent);
  box-shadow: inset 0 0 0 1px var(--accent-presence);
}
```

**4b** — after the `.canvas-editor__error` rule (end of the Body section, before the Aside section), add:

```css
/* Expanded: the sketch fills the editor body; the aside and stage chrome go.
   Pure CSS off the root modifier so editor state survives the toggle. */
.canvas-editor--expanded .canvas-editor__aside {
  display: none;
}
.canvas-editor--expanded .canvas-editor__stage {
  padding: 0;
}
.canvas-editor--expanded .canvas-editor__frame-shell {
  width: 100%;
  border: 0;
  border-radius: 0;
  box-shadow: none;
}

/* Native fullscreen: the frame shell itself is the fullscreen element.
   Separate rules — an unsupported selector would invalidate a shared list. */
.canvas-editor__frame-shell:fullscreen {
  border: 0;
  border-radius: 0;
}
.canvas-editor__frame-shell:-webkit-full-screen {
  border: 0;
  border-radius: 0;
}
```

**4c** — extend the reduced-motion block at the bottom of the file. Change:

```css
@media (prefers-reduced-motion: reduce) {
  .canvas-editor__mode {
    transition: none;
  }
}
```

to:

```css
@media (prefers-reduced-motion: reduce) {
  .canvas-editor__mode,
  .canvas-editor__view {
    transition: none;
  }
}
```

- [ ] **Step 4: Run the test to verify everything passes**

```bash
node --experimental-strip-types --no-warnings --test src/components/canvas-editor.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/styles/canvas-editor.css src/components/canvas-editor.test.ts
git commit -S -m "feat(canvas): expanded + fullscreen styles for the sketch stage (cave-i0qt)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 5: Validation, push, PR

**Files:** none (verification + delivery)

- [ ] **Step 1: Typecheck**

```bash
pnpm typecheck
```

Expected: exits 0, no output errors.

- [ ] **Step 2: Run the app test suite**

```bash
pnpm test:app
```

Expected: all suites pass (this catches cross-file regressions and the check-tests-wired gate).

- [ ] **Step 3 (optional, manual): Visual check**

If a visual check is wanted, use the `run-cave-app` skill from the worktree to open Canvas → a sketch → verify: Expand fills the body and hides the rail, Esc restores (selection clears first), the frame-corners button enters/exits native fullscreen, and the button hides if the API is unavailable.

- [ ] **Step 4: Race check, push, open PR**

```bash
gh pr list --limit 15 --search "canvas fullscreen" --json number,title
git push -u origin feat/canvas-fullscreen
gh pr create --base main --head feat/canvas-fullscreen \
  --title "feat(canvas): in-app expand + native full screen for the sketch editor (cave-i0qt)" \
  --body "Adds two view controls to the Canvas sketch editor header, per the approved spec (docs/superpowers/specs/2026-07-21-canvas-fullscreen-design.md, untracked):

- **Expand** — in-app toggle: hides the 320px aside and the 900px frame cap so the sketch fills the editor body. Esc exits (selection-clear keeps Esc priority via a shared resolver). State (selection, drafts, comments, chat) survives the toggle.
- **Full screen** — native \`requestFullscreen()\` on the frame shell, with webkit-prefixed fallbacks for WKWebView/Tauri; hidden when the Fullscreen API is unavailable; \`fullscreenchange\` keeps the control in sync.

A11y: \`aria-pressed\` on the toggle, labelled icon buttons, announcements through the editor's existing live region.

Tests: behavioral coverage for \`resolveEscapeAction\` + source-regex pins for the wiring and CSS in \`canvas-editor.test.ts\`.

Bead: cave-i0qt"
```

Expected: PR opens; required checks `Frontend build`, `Rust check`, `CodeQL`, `E2E (Playwright)` start.

- [ ] **Step 5: Record evidence on the bead**

```bash
bd update cave-i0qt --notes "Implemented on feat/canvas-fullscreen (worktree .worktrees/feat-canvas-fullscreen). PR #<n>. Verified: canvas-editor.test.ts targeted run, pnpm typecheck, pnpm test:app. Awaiting required checks + merge."
```

- [ ] **Step 6: After checks go green — merge and clean up**

```bash
gh pr merge <n> --squash --delete-branch
cd /Users/buns/Documents/GitHub/OpenCoven/coven-cave
git worktree remove .worktrees/feat-canvas-fullscreen
git branch -D feat/canvas-fullscreen
git worktree list
bd close cave-i0qt
```

Expected: squash lands on `main`; worktree/branch gone; bead closed after merge.
