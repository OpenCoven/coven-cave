# Notification Dropdown Layering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the native-shell notification dropdown above workspace content only while it is open.

**Architecture:** Preserve the existing `NotificationBell` component and its local `z-50`. Conditionally elevate its native title-bar stacking context with `:has(.notification-bell__popover)`, using a layer above content but below drawers and global overlays.

**Tech Stack:** React 19, TypeScript, CSS, Next.js 16, Tauri 2, Node source-contract tests

---

## File Structure

- Modify `src/styles/globals/desktop-chrome.css`: transiently elevate the title-bar stacking context while the bell popover exists.
- Modify `src/components/shell-chrome-revamp.test.ts`: pin the conditional layering contract.

### Task 1: Raise the open notification dropdown above content

**Files:**
- Modify: `src/styles/globals/desktop-chrome.css`
- Test: `src/components/shell-chrome-revamp.test.ts`

- [ ] **Step 1: Write the failing regression test**

Add this assertion after the existing visible-overflow contract:

```ts
assert.match(
  desktopChrome,
  /\.shell-top:has\(\.notification-bell__popover\) \{[^}]*z-index: 140;/,
  "an open notification dropdown lifts its title-bar stacking context above shell content",
);
```

- [ ] **Step 2: Run the focused test and observe the failure**

Run:

```bash
node --experimental-strip-types src/components/shell-chrome-revamp.test.ts
```

Expected: FAIL because `desktop-chrome.css` does not yet conditionally elevate
`.shell-top`.

- [ ] **Step 3: Implement the minimal conditional layer**

Add immediately after the base `.shell-top` rule:

```css
.shell-top:has(.notification-bell__popover) {
  z-index: 140;
}
```

Document that Tauri title-bar glass creates the trapping stacking context and
that 140 remains below drawer/global-overlay layers.

- [ ] **Step 4: Run focused and proportional verification**

Run:

```bash
node --experimental-strip-types src/components/shell-chrome-revamp.test.ts
pnpm eslint src/components/shell-chrome-revamp.test.ts
pnpm codemod:design:check
git diff --check
```

Expected: all commands pass.

- [ ] **Step 5: Verify the native surface and inspect the final diff**

Run the Tauri shell with `bash scripts/dev-app.sh`, open Notifications, and
confirm the dropdown paints above the detail content. Then inspect:

```bash
git diff -- src/styles/globals/desktop-chrome.css src/components/shell-chrome-revamp.test.ts
git status --short
```

Expected: the dropdown is unobscured and the product diff contains only the
conditional CSS rule plus its regression assertion. Do not commit without
explicit maintainer authorization.
