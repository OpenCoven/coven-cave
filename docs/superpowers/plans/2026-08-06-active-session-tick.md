# Active Session Tick Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the selected chat row's accent rail without a duplicate status tick.

**Architecture:** The selected-row accent rail remains the sole selection cue. A
scoped CSS override hides the existing tick only for `.cnav__thread.is-active`,
so markup, layout, and non-active status rendering remain unchanged.

**Tech Stack:** CSS, Node source-contract tests.

---

## File Structure

- Modify: `src/styles/globals/shell-navigation.css` — owns chat siderail row
  styles and the active-row accent rail.
- Test: `src/components/chat-session-chrome.test.ts` — pins the active-row tick
  contract.

### Task 1: Restore the selected-row tick contract

**Files:**
- Modify: `src/styles/globals/shell-navigation.css`
- Test: `src/components/chat-session-chrome.test.ts`

- [ ] **Step 1: Confirm the existing contract fails**

Run:

```bash
node scripts/run-tests.mjs app
```

Expected: `src/components/chat-session-chrome.test.ts` fails its assertion that
`.cnav__thread.is-active .cnav__tick` has `opacity: 0`.

- [ ] **Step 2: Add the minimal scoped CSS override**

Place this rule adjacent to the active `.cnav__thread` styles in
`src/styles/globals/shell-navigation.css`:

```css
.cnav__thread.is-active .cnav__tick {
  opacity: 0;
}
```

Do not change the tick markup, status classes, animation rules, or non-active
row styles.

- [ ] **Step 3: Verify the restored contract**

Run:

```bash
node scripts/run-tests.mjs app
```

Expected: `src/components/chat-session-chrome.test.ts` passes, including the
active-row tick assertion.

- [ ] **Step 4: Commit the implementation**

```bash
git add src/styles/globals/shell-navigation.css
git commit -m "fix(chat): hide active row status tick"
```
