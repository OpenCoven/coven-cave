# Familiar Selector Above Home and Chat Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Place the existing familiar selector in a full-width row above the Home destination tabs and Chat section tabs without changing selection behavior.

**Architecture:** Reuse `FamiliarQuickSwitch` rather than introducing a second selector. `HomeComposer` relocates its current single-familiar control, while `ChatSurface` adds the same control using its existing active-familiar state and selection callback. Small surface-scoped CSS rules make the labeled trigger fill the new context rows and preserve the existing mobile tab behavior.

**Tech Stack:** React, TypeScript, Tailwind utility classes, token-based CSS, Node source-contract tests.

---

## File structure

| File | Responsibility |
| --- | --- |
| `src/components/home-composer.tsx` | Relocate Home's existing familiar selector above the Chat/Task controls. |
| `src/components/chat-surface.tsx` | Render a familiar selector above Chat's section tabs and select through `onSetActiveFamiliar`. |
| `src/styles/home-composer/landing-composer.css` | Give the Home context row and its labeled selector full-row layout using design tokens. |
| `src/styles/cave-chat/auxiliary-surfaces.css` | Give Chat's context row and its labeled selector full-row layout without changing the shared Tabs primitive. |
| `src/components/home-composer-polish.test.ts` | Pin the Home selector-before-destination-tabs hierarchy and footer cleanup. |
| `src/components/chat-surface.test.ts` | Replace the retired no-header-selector contract with the new Chat header ordering and callback contract. |

### Task 1: Pin the Home and Chat layout contracts

**Files:**
- Modify: `src/components/home-composer-polish.test.ts`
- Modify: `src/components/chat-surface.test.ts`

- [ ] **Step 1: Write the failing Home source-contract assertions**

  In `home-composer-polish.test.ts`, add assertions that the familiar selector
  appears in the context row before `hc-dest-pills`, and that the footer contains
  `ComposerContextChips` without a `FamiliarQuickSwitch`:

  ```ts
  assert.match(
    source,
    /home-composer-familiar-context[\s\S]*?<FamiliarQuickSwitch[\s\S]*?cave-composer-utility-row[\s\S]*?hc-dest-pills hc-dest-pills--inline/,
    "the Home familiar selector establishes context before the Chat/Task tabs",
  );
  assert.doesNotMatch(
    source,
    /home-composer-toolbar__left[\s\S]*?<FamiliarQuickSwitch/,
    "the Home footer keeps context chips but no longer owns familiar selection",
  );
  ```

- [ ] **Step 2: Write the failing Chat source-contract assertions**

  In `chat-surface.test.ts`, replace the assertion that forbids
  `FamiliarSwitcher` with assertions for the shared wrapper, its callback, and
  its ordering ahead of `chat-scope-tabs`:

  ```ts
  assert.match(
    chatSurface,
    /chat-familiar-context[\s\S]*?<FamiliarQuickSwitch[\s\S]*?activeFamiliarId=\{activeFamiliarId\}[\s\S]*?onSelectFamiliar=\{\(id\) => \{[\s\S]*?onSetActiveFamiliar\(id\)[\s\S]*?\}\}[\s\S]*?chat-scope-tabs chat-scope-tabs--minimal/,
    "Chat establishes familiar context before its section tabs and reuses the active-familiar callback",
  );
  assert.match(
    chatSurface,
    /<FamiliarQuickSwitch[\s\S]*?labeled[\s\S]*?singleRequired/,
    "Chat uses the shared labeled single-familiar selector",
  );
  ```

- [ ] **Step 3: Run the two changed tests to verify they fail**

  Run:

  ```bash
  node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/components/home-composer-polish.test.ts
  node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/components/chat-surface.test.ts
  ```

  Expected: both commands fail because Home still renders the selector in its
  footer and Chat has no selector row.

- [ ] **Step 4: Commit the failing contract tests**

  ```bash
  git add src/components/home-composer-polish.test.ts src/components/chat-surface.test.ts
  git commit -m "test: define familiar selector tab hierarchy"
  ```

### Task 2: Relocate Home's selector into a full-width context row

**Files:**
- Modify: `src/components/home-composer.tsx`
- Modify: `src/styles/home-composer/landing-composer.css`
- Test: `src/components/home-composer-polish.test.ts`

- [ ] **Step 1: Move the existing selector markup**

  Insert this context row immediately before the existing
  `<div className="cave-composer-control-row">` inside
  `.cave-composer-controls`:

  ```tsx
  <div className="home-composer-familiar-context">
    <FamiliarQuickSwitch
      familiars={familiars}
      activeFamiliarId={selectedFamiliarId || null}
      sessions={sessions}
      onSelectFamiliar={(id) => {
        if (id) onSetActiveFamiliar(id);
      }}
      placement="top-start"
      labeled
      singleRequired
    />
  </div>
  ```

  Delete that exact `FamiliarQuickSwitch` block from
  `.home-composer-toolbar__left`; leave `ComposerContextChips` as the only
  footer child.

- [ ] **Step 2: Add token-based full-row Home layout rules**

  Add these rules after `.home-composer-toolbar__left` in
  `landing-composer.css`:

  ```css
  .home-composer-familiar-context {
    display: flex;
    min-width: 0;
    padding: var(--space-2) var(--space-3) 0;
  }

  .home-composer-familiar-context .familiar-quickswitch,
  .home-composer-familiar-context .familiar-switcher__trigger--labeled {
    width: 100%;
    max-width: none;
  }
  ```

  The rule deliberately overrides only the parent-scoped `width` and
  `max-width`, retaining the shared selector's button, focus, and menu styles.

- [ ] **Step 3: Run the Home source-contract test**

  Run:

  ```bash
  node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/components/home-composer-polish.test.ts
  ```

  Expected: `home-composer-polish.test.ts: ok`.

- [ ] **Step 4: Commit the Home placement**

  ```bash
  git add src/components/home-composer.tsx src/styles/home-composer/landing-composer.css src/components/home-composer-polish.test.ts
  git commit -m "feat(home): place familiar selector above tabs"
  ```

### Task 3: Add Chat's selector context row

**Files:**
- Modify: `src/components/chat-surface.tsx`
- Modify: `src/styles/cave-chat/auxiliary-surfaces.css`
- Test: `src/components/chat-surface.test.ts`
- Test: `src/components/chat-surface-mobile-command-center.test.ts`

- [ ] **Step 1: Import the shared selector**

  Add this import with the other component imports in
  `chat-surface.tsx`:

  ```ts
  import { FamiliarQuickSwitch } from "@/components/familiar-quick-switch";
  ```

- [ ] **Step 2: Stack the familiar context and existing section tabs**

  Replace the single top-level `chat-scope-tabs` header element with a
  shrink-free `chat-scope-header` wrapper. Its first child must be:

  ```tsx
  <div className="chat-familiar-context">
    <FamiliarQuickSwitch
      familiars={resolvedFamiliars}
      activeFamiliarId={activeFamiliarId}
      selectedFamiliarIds={selectedFamiliarIds}
      sessions={sessions}
      onSelectFamiliar={(id) => {
        if (id) onSetActiveFamiliar(id);
      }}
      labeled
      singleRequired
    />
  </div>
  ```

  Its second child is the existing `chat-scope-tabs chat-scope-tabs--minimal`
  element with unchanged `Tabs`, Group, and mobile code-rail controls. Keep
  the scope state untouched so selecting a familiar does not switch sections.

- [ ] **Step 3: Add scoped Chat layout rules**

  Add these rules to `src/styles/cave-chat/auxiliary-surfaces.css`:

  ```css
  .chat-familiar-context {
    display: flex;
    min-width: 0;
    padding: var(--space-2) var(--space-4);
    border-bottom: 1px solid var(--border-hairline);
  }

  .chat-familiar-context .familiar-quickswitch,
  .chat-familiar-context .familiar-switcher__trigger--labeled {
    width: 100%;
    max-width: none;
  }
  ```

  Move the border currently on the tab row to `chat-scope-header` only if
  needed to avoid a double divider. Preserve the mobile `chat-scope-tabs`
  sticky rule and its `top: 0` behavior.

- [ ] **Step 4: Run the Chat contract tests**

  Run:

  ```bash
  node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/components/chat-surface.test.ts
  node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/components/chat-surface-mobile-command-center.test.ts
  ```

  Expected: each command reports its `: ok` message; the mobile test continues
  to find the sticky, touch-sized section tab row.

- [ ] **Step 5: Commit the Chat placement**

  ```bash
  git add src/components/chat-surface.tsx src/styles/cave-chat/auxiliary-surfaces.css src/components/chat-surface.test.ts src/components/chat-surface-mobile-command-center.test.ts
  git commit -m "feat(chat): place familiar selector above tabs"
  ```

### Task 4: Verify the integrated layout

**Files:**
- Test: `src/components/home-composer-polish.test.ts`
- Test: `src/components/chat-surface.test.ts`
- Test: `src/components/chat-surface-mobile-command-center.test.ts`

- [ ] **Step 1: Run all focused contract tests**

  Run:

  ```bash
  node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/components/home-composer-polish.test.ts
  node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/components/chat-surface.test.ts
  node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/components/chat-surface-mobile-command-center.test.ts
  ```

  Expected: each test prints its success message.

- [ ] **Step 2: Run static validation**

  Run:

  ```bash
  pnpm typecheck
  pnpm lint
  ```

  Expected: both commands exit with status 0.

- [ ] **Step 3: Inspect both responsive surfaces**

  Run the application with `bash scripts/dev-app.sh`. In Home and Chat, verify
  that the labeled selector occupies its own full-width row immediately above
  the tab row, opens its existing menu, and changes the active familiar. At a
  narrow width, verify the Home destination tabs and Chat section tabs remain
  reachable and the Chat section row stays sticky.

- [ ] **Step 4: Commit final verification-only adjustments if needed**

  ```bash
  git add src/components/home-composer.tsx src/components/chat-surface.tsx src/styles/home-composer/landing-composer.css src/styles/cave-chat/auxiliary-surfaces.css src/components/home-composer-polish.test.ts src/components/chat-surface.test.ts src/components/chat-surface-mobile-command-center.test.ts
  git commit -m "test: verify familiar selector tab layout"
  ```
