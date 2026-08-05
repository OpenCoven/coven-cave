# Adaptive Chat Context Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move project, worktree, branch, and model controls out of an active chat's composer and into its header while keeping the same controls in a footer below the new-chat composer.

**Architecture:** Extend the existing `ComposerContextChips` controller rather than introducing another context state model. The shared component will render independently anchored project, worktree, branch, and model controls; `ChatView` will mount it in exactly one adaptive location, while existing picker, access, model, and Git handlers remain authoritative.

**Tech Stack:** Next.js 16, React 19, TypeScript, tokenized CSS, Node source-contract tests, existing Project/Runtime/Git popovers.

---

## File map

- Modify `src/components/composer-context-pill.tsx`: split worktree from branch, preserve independent popover anchors, and expose a labelled control group suitable for header or composer placement.
- Modify `src/components/chat-view.tsx`: build the shared context node once and place it in the active header or new-chat footer without duplicating state or callbacks.
- Modify `src/styles/cave-composer.css`: keep shared chip styling and add the single-line overflow contract used by both placements.
- Modify `src/styles/cave-chat/activity.css`: size and position the active-chat context strip beneath `MetaLine`.
- Modify `src/styles/cave-chat/transcript.css`: preserve mobile visibility and touch behavior for the header context strip.
- Modify `src/components/chat-composer-footer-band.test.ts`: pin adaptive placement, control order, worktree/branch separation, and narrow-width behavior.
- Modify `src/components/chat-header-row.test.ts`: pin the active-header control group and ensure context is not duplicated in the active composer.
- Modify `src/components/chat-view-polish-header-composer.test.ts`: update the source contract from one unconditional footer mount to two conditional placements.
- Modify `src/components/chat-view-first-class.test.ts`: update the expected shared-control mount count and location assertions.
- Modify `src/components/composer-git-chip.test.ts`: pin separate worktree and branch triggers against the existing Git menu behavior.

### Task 1: Split worktree and branch into independent shared controls

**Files:**
- Modify: `src/components/composer-context-pill.tsx:35-80, 170-227, 230-362`
- Modify: `src/components/chat-composer-footer-band.test.ts:74-137`
- Modify: `src/components/composer-git-chip.test.ts`

- [ ] **Step 1: Write the failing source-contract tests**

Update `src/components/chat-composer-footer-band.test.ts` so the shared component is required to render project, worktree, branch, and model in that order:

```ts
assert.match(
  pill,
  /aria-label=\{`Project: \$\{projectLabel\} — change project`\}[\s\S]*?context\.worktree \? \([\s\S]*?aria-label=\{`Worktree: \$\{context\.worktree\} — open worktree actions`\}[\s\S]*?aria-label=\{`Branch: \$\{context\.branch\} — switch branch or create a worktree`\}[\s\S]*?aria-label=\{`Model: \$\{modelLabel\} — change model`\}/,
  "context controls should read Project / Worktree / Branch / Model in order",
);
assert.match(
  pill,
  /const worktreeRef = useRef<HTMLButtonElement \| null>\(null\)[\s\S]*?const branchRef = useRef<HTMLButtonElement \| null>\(null\)/,
  "worktree and branch should have independent trigger anchors",
);
assert.doesNotMatch(
  pill,
  /\{context\.worktree \? ` · \$\{context\.worktree\}` : ""\}/,
  "worktree should no longer be folded into the branch label",
);
```

Add matching assertions to `src/components/composer-git-chip.test.ts`:

```ts
assert.match(
  pill,
  /aria-label=\{`Worktree: \$\{context\.worktree\} — open worktree actions`\}/,
  "worktree-backed roots should expose a dedicated worktree control",
);
assert.match(
  pill,
  /menu === "worktree"[\s\S]*?<GitBranchMenuPopover/,
  "the worktree control should reuse the existing Git action popover",
);
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
node --experimental-strip-types src/components/chat-composer-footer-band.test.ts
node --experimental-strip-types src/components/composer-git-chip.test.ts
```

Expected: both commands fail because `ComposerContextView` has no `worktree` state and worktree is still text inside the branch button.

- [ ] **Step 3: Add a worktree view and independent anchor**

In `src/components/composer-context-pill.tsx`, extend the view type and refs:

```ts
export type ComposerContextView = null | "project" | "worktree" | "branch" | "model";

const projectRef = useRef<HTMLButtonElement | null>(null);
const worktreeRef = useRef<HTMLButtonElement | null>(null);
const branchRef = useRef<HTMLButtonElement | null>(null);
const modelRef = useRef<HTMLButtonElement | null>(null);
```

Keep `ComposerContextPickers` compatible with callers from the actions menu by treating both Git views as the existing Git popover:

```tsx
<GitBranchMenuPopover
  open={view === "worktree" || view === "branch"}
  onOpenChange={(open) =>
    onViewChange(open ? (view === "worktree" ? "worktree" : "branch") : null)
  }
  anchorRef={anchorRef}
  placement={context.config.popoverPlacement}
  projectRoot={context.root}
  onSwitched={context.reload}
  {...branchPopoverExtras(context)}
/>
```

- [ ] **Step 4: Render controls in the approved order**

Replace the button sequence in `ComposerContextChips` with:

```tsx
<button
  ref={projectRef}
  type="button"
  className="cave-context-chip focus-ring"
  disabled={props.disabled}
  aria-haspopup="dialog"
  aria-expanded={menu === "project"}
  aria-label={`Project: ${projectLabel} — change project`}
  title={
    context.selectedProject
      ? `${context.selectedProject.root}${projectAccess ? ` · ${projectAccess} access` : ""}`
      : context.emptyProjectLabel
  }
  onClick={() => setMenu((current) => (current === "project" ? null : "project"))}
>
  <span className="cave-context-chip__lead" aria-hidden>
    {context.selectedProject ? (
      <ProjectAvatar
        name={context.selectedProject.name}
        root={context.selectedProject.root}
        color={context.selectedProject.color}
        size="sm"
      />
    ) : (
      <Icon name="ph:folder" width={13} aria-hidden />
    )}
  </span>
  <span className="cave-context-chip__text">{projectLabel}</span>
  <Icon name="ph:caret-down" width={9} aria-hidden className="cave-context-chip__chevron" />
</button>

{context.hasGit && context.worktree ? (
  <button
    ref={worktreeRef}
    type="button"
    className="cave-context-chip focus-ring"
    disabled={props.disabled}
    aria-haspopup="menu"
    aria-expanded={menu === "worktree"}
    aria-label={`Worktree: ${context.worktree} — open worktree actions`}
    title={`Worktree: ${context.worktree} · ${context.dirtyLabel}`}
    onClick={() => setMenu((current) => (current === "worktree" ? null : "worktree"))}
  >
    <span className="cave-context-chip__lead" aria-hidden>
      <Icon name="ph:tree-structure" width={13} aria-hidden />
    </span>
    <span className="cave-context-chip__text">{context.worktree}</span>
    <Icon name="ph:caret-down" width={9} aria-hidden className="cave-context-chip__chevron" />
  </button>
) : null}

{context.hasGit ? (
  <button
    ref={branchRef}
    type="button"
    className="cave-context-chip focus-ring"
    disabled={props.disabled}
    aria-haspopup="menu"
    aria-expanded={menu === "branch"}
    aria-label={`Branch: ${context.branch} — switch branch or create a worktree`}
    title={`Branch: ${context.branch} · ${context.dirtyLabel}`}
    onClick={() => setMenu((current) => (current === "branch" ? null : "branch"))}
  >
    <span className="cave-context-chip__lead" aria-hidden>
      <Icon name="ph:git-branch" width={13} aria-hidden />
    </span>
    <span className="cave-context-chip__text">
      {context.branch}
      {context.count > 0 ? ` · +${context.count}` : ""}
    </span>
    <Icon name="ph:caret-down" width={9} aria-hidden className="cave-context-chip__chevron" />
  </button>
) : null}

<button
  ref={modelRef}
  type="button"
  className="cave-context-chip focus-ring"
  disabled={props.disabled || context.config.modelDisabled}
  aria-haspopup="dialog"
  aria-expanded={menu === "model"}
  aria-label={`Model: ${modelLabel} — change model`}
  title={`Runtime: ${context.runtimeName}${context.modelLabel ? ` · Model: ${context.modelLabel}` : ""}`}
  onClick={() => setMenu((current) => (current === "model" ? null : "model"))}
>
  <span className="cave-context-chip__lead cave-runtime-chip__logo" aria-hidden>
    <RuntimeLogo runtime={context.config.runtime} size={13} />
  </span>
  <span className="cave-context-chip__text">{modelLabel}</span>
  <Icon name="ph:caret-down" width={9} aria-hidden className="cave-context-chip__chevron" />
</button>
```

Use one Git popover instance per trigger so focus returns to the button that opened it:

```tsx
{context.hasGit && context.worktree ? (
  <GitBranchMenuPopover
    open={menu === "worktree"}
    onOpenChange={(open) => setMenu(open ? "worktree" : null)}
    anchorRef={worktreeRef}
    placement={context.config.popoverPlacement}
    projectRoot={context.root}
    onSwitched={context.reload}
    {...branchPopoverExtras(context)}
  />
) : null}
{context.hasGit ? (
  <GitBranchMenuPopover
    open={menu === "branch"}
    onOpenChange={(open) => setMenu(open ? "branch" : null)}
    anchorRef={branchRef}
    placement={context.config.popoverPlacement}
    projectRoot={context.root}
    onSwitched={context.reload}
    {...branchPopoverExtras(context)}
  />
) : null}
```

- [ ] **Step 5: Run the targeted tests**

Run:

```bash
node --experimental-strip-types src/components/chat-composer-footer-band.test.ts
node --experimental-strip-types src/components/composer-git-chip.test.ts
node --experimental-strip-types src/components/composer-actions-menu.test.ts
```

Expected: all three print their `: ok` success lines.

- [ ] **Step 6: Commit the shared-control change**

```bash
git add src/components/composer-context-pill.tsx \
  src/components/chat-composer-footer-band.test.ts \
  src/components/composer-git-chip.test.ts
git commit -m "feat(chat): split worktree and branch controls"
```

### Task 2: Mount context adaptively in ChatView

**Files:**
- Modify: `src/components/chat-view.tsx:6568-6604, 7144-7180, 7201-7327`
- Modify: `src/components/chat-header-row.test.ts:15-104, 172-184`
- Modify: `src/components/chat-view-polish-header-composer.test.ts`
- Modify: `src/components/chat-view-first-class.test.ts`

- [ ] **Step 1: Write failing adaptive-placement tests**

Replace the unconditional footer assertions in `src/components/chat-header-row.test.ts` with:

```ts
assert.match(
  source,
  /const chatContextControls = \([\s\S]*?<ComposerContextChips[\s\S]*?ariaLabel=\{inlineComposer \? "New chat context" : "Session context"\}/,
  "ChatView should build one shared context-control node",
);
assert.match(
  source,
  /\{inlineComposer \? \([\s\S]*?cave-composer-footer-band__cluster[\s\S]*?\{chatContextControls\}[\s\S]*?\) : null\}/,
  "new chats should render context in the composer footer",
);
assert.match(
  source,
  /\{!inlineComposer \? \([\s\S]*?cave-chat-header-context[\s\S]*?\{chatContextControls\}[\s\S]*?\) : null\}/,
  "active chats should render context beneath MetaLine",
);
assert.doesNotMatch(
  source,
  /<MetaLine[\s\S]*?<ComposerContextChips/,
  "the shared node should prevent duplicate picker state in the header",
);
```

Update `src/components/chat-view-polish-header-composer.test.ts` and
`src/components/chat-view-first-class.test.ts` to expect one component
construction and two conditional placements:

```ts
assert.equal(
  source.match(/<ComposerContextChips/g)?.length,
  1,
  "ChatView should construct the shared context controls once",
);
assert.match(source, /\{inlineComposer \? \([\s\S]*?\{chatContextControls\}/);
assert.match(source, /\{!inlineComposer \? \([\s\S]*?\{chatContextControls\}/);
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
node --experimental-strip-types src/components/chat-header-row.test.ts
node --experimental-strip-types src/components/chat-view-polish-header-composer.test.ts
node --experimental-strip-types src/components/chat-view-first-class.test.ts
```

Expected: failures show that context controls are still mounted unconditionally in the composer footer.

- [ ] **Step 3: Add a group label to the shared component**

Extend `ComposerContextProps` in `src/components/composer-context-pill.tsx`:

```ts
export type ComposerContextProps = {
  ariaLabel?: string;
  // existing fields remain unchanged
};
```

Wrap the controls and their popovers in a labelled group:

```tsx
return (
  <div
    className="cave-context-controls"
    role="group"
    aria-label={props.ariaLabel ?? "Chat context"}
  >
    {/* independent buttons and existing popovers */}
  </div>
);
```

Keep error text and the add-project modal inside this wrapper so each placement
retains the complete interaction flow.

- [ ] **Step 4: Build one shared context node in ChatView**

Immediately after `inlineComposer` and popover-placement derivation in
`src/components/chat-view.tsx`, create:

```tsx
const chatContextControls = (
  <ComposerContextChips
    projects={projects}
    projectValue={resolvedProjectId}
    onProjectChange={setProjectIdDraft}
    familiarId={familiar.id ?? null}
    createProject={createProject}
    createProjectOrThrow={createProjectOrThrow}
    runtime={modelHarness}
    modelValue={composerModelValue}
    modelOptions={composerModelOptions}
    onPickRuntime={handleSelectRuntime}
    onPickModel={handleSelectModel}
    promotableModel={promotableModel}
    onPromoteModelToDefault={handlePromoteModelToDefault}
    modelDisabled={busy}
    projectRoot={activeProjectRoot}
    onOpenUrl={onOpenUrl}
    registerCurrentRoot={setupCandidateRoot ?? undefined}
    onRegisterCurrentRoot={
      setupCandidateRoot ? () => setProjectSetupRoot(setupCandidateRoot) : undefined
    }
    popoverPlacement={composerPopoverPlacement}
    ariaLabel={inlineComposer ? "New chat context" : "Session context"}
  />
);
```

Do not derive a second project, model, or Git state for the header.

- [ ] **Step 5: Restrict composer context to new chats**

Change the composer footer in `src/components/chat-view.tsx` to:

```tsx
<div className="cave-composer-footer-band">
  {inlineComposer ? (
    <div className="cave-composer-footer-band__cluster">
      {chatContextControls}
    </div>
  ) : null}
  {linkedContextRow}
  {followUp.suggestions.length > 0 && !busy ? (
    <div className="cave-chat-followups">
      <FollowUpCards paths={followUp.suggestions} onActivate={handleFollowUp} />
    </div>
  ) : null}
</div>
```

The footer remains available for linked work and follow-up suggestions in an
active chat; only runtime context leaves it.

- [ ] **Step 6: Add the active header placement**

Immediately after `</MetaLine>` and before `</header>`, render:

```tsx
{!inlineComposer ? (
  <div className="cave-chat-header-context">
    {chatContextControls}
  </div>
) : null}
```

This keeps the context beneath the title row, avoids nesting interactive
controls inside the `role="status"` live region, and leaves all session action
buttons inside `MetaLine`.

- [ ] **Step 7: Run adaptive-placement tests**

Run:

```bash
node --experimental-strip-types src/components/chat-header-row.test.ts
node --experimental-strip-types src/components/chat-view-polish-header-composer.test.ts
node --experimental-strip-types src/components/chat-view-first-class.test.ts
node --experimental-strip-types src/components/chat-view.test.ts
```

Expected: all four print their success lines, including the project registration
and add-project wiring assertions.

- [ ] **Step 8: Commit adaptive placement**

```bash
git add src/components/composer-context-pill.tsx \
  src/components/chat-view.tsx \
  src/components/chat-header-row.test.ts \
  src/components/chat-view-polish-header-composer.test.ts \
  src/components/chat-view-first-class.test.ts
git commit -m "feat(chat): place context controls adaptively"
```

### Task 3: Add header and narrow-screen layout contracts

**Files:**
- Modify: `src/styles/cave-composer.css:1019-1082`
- Modify: `src/styles/cave-chat/activity.css:634-677`
- Modify: `src/styles/cave-chat/transcript.css:538-615`
- Modify: `src/components/chat-composer-footer-band.test.ts:148-171, 265-291`

- [ ] **Step 1: Add failing CSS contract tests**

Add these assertions to `src/components/chat-composer-footer-band.test.ts`:

```ts
assert.match(
  css,
  /\.cave-context-controls \{[\s\S]*?display: flex;[\s\S]*?overflow-x: auto;[\s\S]*?white-space: nowrap;/,
  "shared context controls should remain one horizontally scrollable line",
);
assert.match(
  activityCss,
  /\.cave-chat-header-context \{[\s\S]*?min-width: 0;[\s\S]*?overflow: hidden;/,
  "the active header should contain context overflow without widening the pane",
);
assert.match(
  transcriptCss,
  /@media \(max-width: 767px\)[\s\S]*?\.cave-chat-header-context[\s\S]*?\.cave-context-chip \{[\s\S]*?min-height: var\(--touch-target\);/,
  "mobile header context controls should retain touch targets",
);
```

Remove assertions that require all context chips to live in
`.cave-composer-footer-band__cluster`.

- [ ] **Step 2: Run the CSS contract test to verify it fails**

Run:

```bash
node --experimental-strip-types src/components/chat-composer-footer-band.test.ts
```

Expected: failure reports missing `.cave-context-controls` overflow and
`.cave-chat-header-context` containment rules.

- [ ] **Step 3: Add shared single-line overflow styling**

In `src/styles/cave-composer.css`, keep the existing cluster rule and add:

```css
.cave-context-controls {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  min-width: 0;
  max-width: 100%;
  overflow-x: auto;
  overflow-y: hidden;
  white-space: nowrap;
  scrollbar-width: thin;
  overscroll-behavior-inline: contain;
}

.cave-context-controls > .cave-context-chip {
  flex: 0 0 auto;
}
```

Keep existing tokenized hover, open, disabled, text truncation, and focus-ring
styles unchanged.

- [ ] **Step 4: Style active-header placement**

In `src/styles/cave-chat/activity.css`, add:

```css
.cave-chat-header-context {
  min-width: 0;
  overflow: hidden;
  padding-inline-start: calc(var(--space-6) + var(--space-2));
}

.cave-chat-header-context .cave-context-chip {
  height: var(--space-6);
  font-size: var(--text-xs);
}
```

The inline start offset aligns context after the familiar avatar without
altering `MetaLine` or introducing absolute positioning.

- [ ] **Step 5: Preserve mobile visibility and touch sizing**

In the existing mobile block in `src/styles/cave-chat/transcript.css`, keep the
header context visible even though `.cave-chat-meta-line` is hidden:

```css
.cave-chat-header-context {
  display: block;
  padding-inline-start: 0;
}

.cave-chat-header-context .cave-context-chip {
  min-height: var(--touch-target);
}
```

Do not add `.cave-chat-header-context` to the rule that hides
`.cave-chat-meta-line` and `.cave-chat-linked-context`.

- [ ] **Step 6: Run targeted UI source tests**

Run:

```bash
node --experimental-strip-types src/components/chat-composer-footer-band.test.ts
node --experimental-strip-types src/components/chat-header-row.test.ts
node --experimental-strip-types src/components/composer-git-chip.test.ts
node --experimental-strip-types src/components/chat-view-polish-header-composer.test.ts
node --experimental-strip-types src/components/chat-view-first-class.test.ts
```

Expected: every command prints its `: ok` line.

- [ ] **Step 7: Run type and design gates**

Run:

```bash
pnpm typecheck
pnpm lint
pnpm check:tests-wired
```

Expected: TypeScript exits cleanly, the design codemod/lint reports no
violations, and all modified tests are registered.

- [ ] **Step 8: Run the app test suite**

Run:

```bash
pnpm test:app
```

Expected: the app suite completes with zero failures.

- [ ] **Step 9: Inspect the real responsive UI**

Use the repository's `run-cave-app` skill to open:

1. A new chat and confirm project, worktree when applicable, branch, and model
   appear beneath rather than inside the writing surface.
2. An active chat and confirm those controls appear beneath the title and are
   absent from the composer.
3. A worktree-backed chat and confirm worktree and branch are both visible and
   independently clickable.
4. A narrow viewport and confirm the strip scrolls horizontally while each
   focused control remains visible.

Expected: placement changes exactly once at session creation, popovers anchor to
their own triggers, and the composer writing area does not shift unexpectedly.

- [ ] **Step 10: Commit layout and verification updates**

```bash
git add src/styles/cave-composer.css \
  src/styles/cave-chat/activity.css \
  src/styles/cave-chat/transcript.css \
  src/components/chat-composer-footer-band.test.ts
git commit -m "style(chat): finish adaptive context layout"
```

### Task 4: Prepare the PR-shaped handoff

**Files:**
- Modify: Bead `cave-qvh18` through `bd`

- [ ] **Step 1: Review the branch diff**

Run:

```bash
git status --short --branch
git diff --check origin/main...HEAD
git diff --stat origin/main...HEAD
```

Expected: only the approved spec, implementation plan, adaptive chat context
implementation, related styles, and targeted tests appear; `git diff --check`
prints nothing.

- [ ] **Step 2: Record verification and lifecycle evidence**

Run:

```bash
bd update cave-qvh18 --notes "Implemented adaptive chat context controls in managed worktree /Users/buns/Documents/GitHub/OpenCoven/coven-cave/.worktrees/cave-qvh18-adaptive-chat-context on branch docs/cave-qvh18-adaptive-chat-context. Verified targeted chat context/header/Git tests, pnpm typecheck, pnpm lint, pnpm check:tests-wired, pnpm test:app, and responsive new/active/worktree chat behavior."
```

Expected: `bd` confirms the issue update. Keep the Bead `in_progress` until the
branch is merged or explicit completion criteria permit closure.

- [ ] **Step 3: Push the branch for protected-PR transport**

Run:

```bash
git push -u origin docs/cave-qvh18-adaptive-chat-context
```

Expected: the remote branch is created and local status reports it tracking
`origin/docs/cave-qvh18-adaptive-chat-context`.

- [ ] **Step 4: Open the pull request**

Run:

```bash
gh pr create \
  --base main \
  --head docs/cave-qvh18-adaptive-chat-context \
  --title "Improve adaptive chat context controls" \
  --body "## Summary
- move active-chat project, worktree, branch, and model controls into the header
- keep the same independently clickable controls below the new-chat composer
- preserve worktree and branch visibility, picker safeguards, and narrow-screen access

## Verification
- targeted chat context/header/Git source tests
- pnpm typecheck
- pnpm lint
- pnpm check:tests-wired
- pnpm test:app
- responsive UI pass"
```

Expected: `gh` prints the new pull-request URL. Do not push directly to `main`.
