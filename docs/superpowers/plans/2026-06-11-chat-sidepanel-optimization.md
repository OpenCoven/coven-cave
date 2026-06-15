# Chat Sidepanel Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Optimize the ChatList component for narrow sidepanel widths (260-280px) by removing stats boxes and converting filter toggles to icon-only buttons, freeing 100-120px of vertical space.

**Architecture:** Remove non-essential vertical chrome (stats grid), compress header, convert filter buttons to icons with tooltips. The search input, + Chat button, and filter toggles remain but use significantly less space. All functionality preserved, layout optimized for narrow widths.

**Tech Stack:** React, TypeScript, Tailwind CSS (existing)

---

### Task 1: Remove Stats Boxes (Chats/Live/Projects Grid)

**Files:**
- Modify: `src/components/chat-list.tsx:480-502`

The stats grid displays 3 boxes showing chat count, live count, and project count. These consume ~80px of vertical space and provide information that's visible by looking at the chat list itself.

- [ ] **Step 1: Remove the stats grid section**

Locate lines 480-502 in `chat-list.tsx` (the `{/* Stats row */}` section with the 3-column grid). Delete the entire section:

```tsx
// DELETE THIS ENTIRE SECTION (lines 480-502):
        {/* Stats row */}
        <div className={`${familiar ? "pt-4" : "mt-3"} grid grid-cols-3 gap-1.5 px-4`}>
          <div className="group rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)]/30 px-2.5 py-2 transition-colors hover:border-[var(--accent-presence)]/25 hover:bg-[var(--bg-raised)]/60">
            <div className="flex items-center gap-1.5">
              <Icon name="ph:chats" width={11} className="text-[var(--text-muted)]" />
              <p className="text-[10px] font-medium uppercase tracking-[0.1em] text-[var(--text-muted)]">Chats</p>
            </div>
            <p className="mt-1 font-mono text-[15px] font-semibold text-[var(--text-primary)]">{mine.length}</p>
          </div>
          <div className="group rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)]/30 px-2.5 py-2 transition-colors hover:border-[var(--accent-presence)]/25 hover:bg-[var(--bg-raised)]/60">
            <div className="flex items-center gap-1.5">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${runningCount > 0 ? "animate-pulse bg-[var(--color-success)]" : "bg-[var(--text-muted)]"}`} />
              <p className="text-[10px] font-medium uppercase tracking-[0.1em] text-[var(--text-muted)]">Live</p>
            </div>
            <p className={`mt-1 font-mono text-[15px] font-semibold ${runningCount > 0 ? "text-[var(--color-success)]" : "text-[var(--text-primary)]"}`}>{runningCount}</p>
          </div>
          <div className="group rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)]/30 px-2.5 py-2 transition-colors hover:border-[var(--accent-presence)]/25 hover:bg-[var(--bg-raised)]/60">
            <div className="flex items-center gap-1.5">
              <Icon name="ph:folder" width={11} className="text-[var(--text-muted)]" />
              <p className="text-[10px] font-medium uppercase tracking-[0.1em] text-[var(--text-muted)]">Projects</p>
            </div>
            <p className="mt-1 font-mono text-[15px] font-semibold text-[var(--text-primary)]">{projectCount}</p>
          </div>
        </div>
```

Replace it with a single line that adds minimal spacing:
```tsx
        {/* Stats removed for sidepanel optimization */}
```

- [ ] **Step 2: Verify the section was removed**

Open `src/components/chat-list.tsx` and confirm lines 480-502 are gone and the search row (previously line 504-573) is now at line ~481. The header should now flow directly from the identity row (if shown) to the search/filter row.

- [ ] **Step 3: Commit**

```bash
git add src/components/chat-list.tsx
git commit -S -m "$(cat <<'EOF'
feat(chat-list): remove stats boxes for sidepanel optimization

Frees ~80px of vertical space by removing the 3-box grid showing
Chats/Live/Projects counts. This information is visible by examining
the chat list itself, so the stat boxes provide limited value in a
narrow sidepanel context.

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Simplify Header — Remove Identity Row Margin/Padding When Narrow

**Files:**
- Modify: `src/components/chat-list.tsx:420-477`

The identity row (avatar, name, role, + Chat button) provides useful info in all-familiars mode but takes space. We'll keep it but reduce its vertical margin when in narrow sidepanel context.

- [ ] **Step 1: Reduce padding on identity row**

Find the identity row section (around line 420-477, the `{!familiar && (...)` block). Change the padding from `px-4 pb-0 pt-4` to `px-4 pb-0 pt-2`:

**Before:**
```tsx
        {!familiar && (
        <div className="px-4 pb-0 pt-4">
```

**After:**
```tsx
        {!familiar && (
        <div className="px-4 pb-0 pt-2">
```

- [ ] **Step 2: Reduce gap in avatar/name flex container**

On the line `<div className="flex min-w-0 items-start gap-3">`, change `gap-3` to `gap-2`:

**Before:**
```tsx
          <div className="flex min-w-0 items-start gap-3">
```

**After:**
```tsx
          <div className="flex min-w-0 items-start gap-2">
```

- [ ] **Step 3: Reduce subtitle margin**

Find the line `<p className="mt-0.5 truncate...` and change `mt-0.5` to `mt-0`:

**Before:**
```tsx
              <p className="mt-0.5 truncate text-[11px]...
```

**After:**
```tsx
              <p className="mt-0 truncate text-[11px]...
```

- [ ] **Step 4: Verify layout still looks correct**

The identity row should now be more compact without breaking the layout. The avatar, name, and button should still align properly.

- [ ] **Step 5: Commit**

```bash
git add src/components/chat-list.tsx
git commit -S -m "$(cat <<'EOF'
refactor(chat-list): tighten padding on identity row

Reduce pt from 4 to 2, gap from 3 to 2, and subtitle mt from 0.5 to 0
to save vertical space in narrow sidepanel mode while keeping the
identity section visually coherent.

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Convert Unreads & Archived Buttons to Icon-Only

**Files:**
- Modify: `src/components/chat-list.tsx:528-559`

Replace the text-labeled buttons with icon-only buttons and add tooltips. The Unreads button shows a circle or filled dot; the Archived button shows an archive icon. Both get `title` attributes for tooltips.

- [ ] **Step 1: Replace Unreads button with icon-only version**

Find the Unreads button (around line 528-542) and replace it:

**Before:**
```tsx
          <button
            type="button"
            onClick={() => setUnreadsOnly((v) => !v)}
            className={[
              "focus-ring flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-medium transition-colors",
              unreadsOnly
                ? "border-[color-mix(in_oklch,var(--color-success)_40%,transparent)] bg-[color-mix(in_oklch,var(--color-success)_15%,transparent)] text-[var(--color-success)]"
                : "border-[var(--border-hairline)] text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text-secondary)]",
            ].join(" ")}
          >
            {unreadsOnly
              ? <span className="h-2 w-2 rounded-full bg-[var(--color-success)]" />
              : <Icon name="ph:circle" width={12} />}
            Unreads
          </button>
```

**After:**
```tsx
          <button
            type="button"
            onClick={() => setUnreadsOnly((v) => !v)}
            title={unreadsOnly ? "Show all chats" : "Show unreads only"}
            aria-label={unreadsOnly ? "Show all chats" : "Show unreads only"}
            className={[
              "focus-ring grid h-8 w-8 shrink-0 place-items-center rounded-lg border transition-colors",
              unreadsOnly
                ? "border-[color-mix(in_oklch,var(--color-success)_40%,transparent)] bg-[color-mix(in_oklch,var(--color-success)_15%,transparent)] text-[var(--color-success)]"
                : "border-[var(--border-hairline)] text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text-secondary)]",
            ].join(" ")}
          >
            {unreadsOnly
              ? <span className="h-2 w-2 rounded-full bg-[var(--color-success)]" />
              : <Icon name="ph:circle" width={12} />}
          </button>
```

Key changes:
- Remove `gap-1.5` and `px-2.5` (text-padding)
- Change `flex` to `grid place-items-center` for better centering
- Add `w-8` to make it square (same as h-8)
- Add `title` and `aria-label` attributes
- Remove the "Unreads" text

- [ ] **Step 2: Replace Archived button with icon-only version**

Find the Archived button (around line 544-559) and replace it:

**Before:**
```tsx
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            aria-pressed={showArchived}
            aria-label={showArchived ? "Hide archived chats" : "Show archived chats"}
            title={showArchived ? "Hide archived chats" : "Show archived chats"}
            className={[
              "focus-ring flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-medium transition-colors",
              showArchived
                ? "border-[color-mix(in_oklch,var(--accent-presence)_40%,transparent)] bg-[color-mix(in_oklch,var(--accent-presence)_15%,transparent)] text-[var(--accent-presence)]"
                : "border-[var(--border-hairline)] text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text-secondary)]",
            ].join(" ")}
          >
            <Icon name="ph:archive" width={12} aria-hidden />
            Archived
          </button>
```

**After:**
```tsx
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            aria-pressed={showArchived}
            aria-label={showArchived ? "Hide archived chats" : "Show archived chats"}
            title={showArchived ? "Hide archived chats" : "Show archived chats"}
            className={[
              "focus-ring grid h-8 w-8 shrink-0 place-items-center rounded-lg border transition-colors",
              showArchived
                ? "border-[color-mix(in_oklch,var(--accent-presence)_40%,transparent)] bg-[color-mix(in_oklch,var(--accent-presence)_15%,transparent)] text-[var(--accent-presence)]"
                : "border-[var(--border-hairline)] text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text-secondary)]",
            ].join(" ")}
          >
            <Icon name="ph:archive" width={12} aria-hidden />
          </button>
```

Key changes:
- Remove `gap-1.5`, `px-2.5`, and `text-[11px] font-medium`
- Change `flex items-center` to `grid place-items-center`
- Add `w-8` to make it square
- Remove the "Archived" text (icon + aria-label/title is enough)

- [ ] **Step 3: Adjust search row spacing**

Find the search row container (around line 505, `<div className="mt-3 flex items-center gap-2...`). The gap and spacing should already be reasonable, but verify `gap-2` is in place. If it says `gap-3` or higher, change it to `gap-2`:

```tsx
        <div className="mt-3 flex items-center gap-2 px-4 pb-3">
```

(If it's already `gap-2`, no change needed.)

- [ ] **Step 4: Verify button sizes and spacing**

The search input should still flex and fill space, and the icon-only buttons should be tightly grouped. Check that at narrow widths (280px), the buttons don't wrap.

- [ ] **Step 5: Commit**

```bash
git add src/components/chat-list.tsx
git commit -S -m "$(cat <<'EOF'
feat(chat-list): convert filter buttons to icon-only

Replace Unreads and Archived toggle buttons with icon-only versions
(8x8 grid with centered icon). Add title and aria-label for accessibility.
This saves ~60px of horizontal space and reduces visual clutter.

Search row now flows better on narrow sidepanels (260-280px width).

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Reduce Spacing Throughout Header Section

**Files:**
- Modify: `src/components/chat-list.tsx:417-574` (header section)

Audit the header for any remaining excess padding/margins and tighten them. Focus on gaps between elements.

- [ ] **Step 1: Reduce gap in search row buttons**

The search row has multiple flex items. Find the outer container `<div className="mt-3 flex items-center gap-2 px-4 pb-3">`. Verify `gap-2` is set. If there's a gap between the search input and the buttons, it should be `gap-2`. 

Check the gap inside the search label (the `<label>` wrapper for the search input) — it should have `gap-2` as well:

```tsx
            <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg...">
```

If it says `gap-3` or `gap-2.5`, change to `gap-2`.

- [ ] **Step 2: Reduce header section top margin**

Find the `<header className="agent-panel-dossier...">` line. The header may have a `mb-` or margin class. Ensure there's no excessive top margin on the section itself. The padding/margins within should be tight.

Verify the `agent-panel-dossier` styles in `src/app/globals.css` don't have excess padding. We'll check this in Task 5.

- [ ] **Step 3: Verify no extra gaps between header elements**

Walk through the header section (lines 417-574) and confirm:
- Identity row and search row flow closely (no large gap between them)
- Search row items (search input, icon buttons, + Chat button) are tightly packed
- All padding uses `px-4` and `py-3` or tighter (no `py-4`)

If you find a `py-4`, change to `py-3`. If you find `gap-3` in flex containers, change to `gap-2`.

- [ ] **Step 4: Commit**

```bash
git add src/components/chat-list.tsx
git commit -S -m "$(cat <<'EOF'
refactor(chat-list): tighten spacing in header section

Ensure consistent gap-2 in flex containers, reduce padding where
appropriate. Removes visual breathing room to maximize space for the
chat list in narrow sidepanel mode.

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Check and Optimize CSS in globals.css

**Files:**
- Read/Modify: `src/app/globals.css` (search for `.agent-panel-dossier` and `.chat-list-dossier`)

The CSS classes for the chat list header might have excess padding or margins. Verify and optimize.

- [ ] **Step 1: Search for chat-list dossier styles**

Run:
```bash
grep -n "agent-panel-dossier\|chat-list-dossier\|chat-list-surface" src/app/globals.css
```

- [ ] **Step 2: Check for excess padding**

Open `src/app/globals.css` and find the `.agent-panel-dossier` or `.chat-list-dossier` class. If it has padding like `padding: 1rem;` or similar, consider reducing it. The Tailwind classes in the JSX handle most padding (e.g., `px-4 py-3`), so CSS padding is often redundant.

If the CSS class has something like:
```css
.agent-panel-dossier {
  padding: 1rem;
}
```

Remove it or reduce to:
```css
.agent-panel-dossier {
  /* padding handled by Tailwind classes in JSX */
}
```

- [ ] **Step 3: Check for margins**

Look for any `margin` properties on `.chat-list-dossier` or related classes. Remove margins that add vertical space.

- [ ] **Step 4: Verify right-panel-tabs spacing (from right-sidebar-fit test)**

From the test we read earlier, there's a `.right-panel-tabs` class. Verify it doesn't have excess padding:

```bash
grep -A 3 "right-panel-tabs\|right-panel-tab" src/app/globals.css | head -20
```

If any of these have padding > 0.5rem, consider reducing to match the compact goal.

- [ ] **Step 5: Commit if changes were made**

If you made changes to `globals.css`:

```bash
git add src/app/globals.css
git commit -S -m "$(cat <<'EOF'
refactor(styles): optimize css padding for sidepanel headers

Remove or reduce excess padding/margins in .agent-panel-dossier and
.chat-list-dossier to align with compact sidepanel layout.

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>
EOF
)"
```

If no changes were needed, just note that the CSS is already optimized and move on.

---

### Task 6: Test the Layout at Narrow Widths

**Files:**
- Test in browser: `http://localhost:3000`

Verify the sidepanel chat view works correctly at narrow widths (260-280px) and that all functionality is preserved.

- [ ] **Step 1: Open the app in browser**

Navigate to `http://localhost:3000` and ensure the chat panel is visible.

- [ ] **Step 2: Resize the chat panel to ~280px width**

Using the browser's inspector or by dragging the panel divider in the app, make the chat panel approximately 280px wide. The layout should:
- Not wrap or break any buttons
- Show the search input without truncation
- Display the icon-only buttons (Unreads, Archived) without wrapping
- Show the "+ Chat" button (or icon-only if you converted it) on the same line

- [ ] **Step 3: Verify stats box removal**

Confirm the 3-box stats grid (Chats/Live/Projects) is completely gone. The header should now flow directly to the search row.

- [ ] **Step 4: Test button interactions**

- Click the Unreads icon-only button — it should toggle, and hovering should show a tooltip.
- Click the Archived icon-only button — it should toggle, and hovering should show a tooltip.
- Click the search input and type a query — search should work.
- Click the "+ Chat" button — should create a new chat.

- [ ] **Step 5: Test on mobile/narrow view**

If the app has a mobile view, test it there too. The chat panel should look the same as the narrowed desktop view.

- [ ] **Step 6: Commit a test verification note (optional)**

If you want to document the testing, you can commit a note:

```bash
git commit --allow-empty -S -m "$(cat <<'EOF'
test: verified sidepanel chat optimization at 280px width

- Stats boxes removed, vertical space freed
- Icon-only buttons (Unreads, Archived) functioning with tooltips
- Search input, filters, and + Chat button all accessible
- No layout breaks or wrapping at target width

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Run Test Suite to Confirm No Regressions

**Files:**
- Test: `src/components/*.test.ts` (chat-list related tests if they exist)

Ensure the component changes don't break any existing tests.

- [ ] **Step 1: Find chat-list test file**

Run:
```bash
find src/components -name "*chat-list*test*" -type f
```

If a test file exists, run it:
```bash
node --experimental-strip-types <test-file-path>
```

If no dedicated test file exists, check if chat-list is tested in another file:

```bash
grep -r "ChatList\|chat-list" src/components/*.test.ts | head -5
```

- [ ] **Step 2: Run the full test suite**

Run:
```bash
pnpm test:app
```

Ensure all tests pass. If any fail, investigate and fix the JSX/logic.

- [ ] **Step 3: Verify no visual regressions**

Reload `http://localhost:3000` in the browser and manually check that the chat panel looks correct and functions as expected. Look for:
- No broken layout or missing elements
- Proper spacing and alignment
- Icon buttons showing correctly
- Search and filters working

- [ ] **Step 4: Commit**

If all tests pass and no fixes were needed:

```bash
git commit --allow-empty -S -m "$(cat <<'EOF'
test: chat-list optimization passes test suite

All tests passing. No visual regressions detected at 280px width.

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Summary

This plan optimizes the ChatList sidepanel for narrow widths by:

1. **Removing stats boxes** (~80px vertical savings)
2. **Tightening header padding** (pt from 4→2, gap from 3→2)
3. **Converting filter buttons to icon-only** (~60px horizontal savings, cleaner look)
4. **Reducing overall spacing** (gap-2 throughout, py-3 instead of py-4)
5. **Verifying CSS alignment** (removing excess padding from globals.css)
6. **Testing at target width** (280px, 260-300px range)
7. **Confirming no regressions** (test suite + manual verification)

**Result:** Chat sidepanel is now optimized for 260-280px width with ~100-120px of recovered vertical space and cleaner visual design.
