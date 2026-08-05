# Accessible Solo-to-Coven Promotion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore a keyboard- and screen-reader-accessible way to promote the current solo Chat into a coven without restoring the removed avatar, `Solo` label, or permanent add button.

**Architecture:** `ChatView` continues to own promotion persistence, handoff, and announcements. It derives the eligible familiars once with `addableFamiliars` and passes them plus the existing callback into `SessionOverflowMenu`, which renders direct menu items under `Start a coven with`; rail drag/drop consumes the same eligibility set as an optional pointer shortcut.

**Tech Stack:** React, TypeScript, existing Popover primitives, Node source-contract tests, pnpm repository gates

---

### Task 1: Add the accessible Session options path

**Files:**
- Modify: `src/components/chat-header-chrome.test.ts`
- Modify: `src/components/chat-view.tsx`
- Modify: `src/components/chat-session-header.tsx`

- [ ] **Step 1: Write the failing accessibility contract**

In `src/components/chat-header-chrome.test.ts`, read the session-header source beside the existing fixtures:

```ts
const sessionHeader = readFileSync(new URL("./chat-session-header.tsx", import.meta.url), "utf8");
```

Add these assertions after the dead-CSS assertion:

```ts
assert.match(
  chatView,
  /const promotableFamiliars = useMemo\([\s\S]{0,300}?addableFamiliars\(familiars, familiar\.id\)[\s\S]{0,200}?\[familiar\.id, familiars\]/,
  "solo Chat must derive one stable eligible-familiar set for every promotion affordance",
);
assert.match(
  chatView,
  /<SessionOverflowMenu[\s\S]{0,900}?promotableFamiliars=\{promotableFamiliars\}[\s\S]{0,300}?onPromoteToCoven=\{promoteToCoven\}/,
  "Session options must receive the accessible promotion candidates and existing mutation",
);
assert.match(
  sessionHeader,
  /<PopoverBody role="menu" ariaLabel="Chat options">[\s\S]*promotableFamiliars\.length > 0[\s\S]*<PopoverLabel>Start a coven with<\/PopoverLabel>/,
  "Session options must expose coven promotion inside a named menu section",
);
assert.match(
  sessionHeader,
  /promotableFamiliars\.map\(\(candidate\) => \([\s\S]{0,700}?<PopoverItem[\s\S]{0,500}?onSelect=\{\(\) => onPromoteToCoven\(candidate\.id\)\}[\s\S]{0,300}?\{candidate\.display_name\}/,
  "each eligible familiar must be a keyboard-activatable promotion menu item",
);
```

- [ ] **Step 2: Run the focused contract and verify the intended failure**

Run:

```bash
node --experimental-strip-types src/components/chat-header-chrome.test.ts
```

Expected: FAIL on the first new assertion because `ChatView` does not yet derive `promotableFamiliars`. Fix test syntax or bounds if it errors for another reason; do not edit production code until the failure is specific.

- [ ] **Step 3: Derive and share promotion eligibility in ChatView**

Immediately before `promoteToCoven` in `src/components/chat-view.tsx`, add:

```ts
const promotableFamiliars = useMemo(
  () => addableFamiliars(familiars, familiar.id),
  [familiar.id, familiars],
);
const promotableFamiliarIds = useMemo(
  () => promotableFamiliars.map((candidate) => candidate.id),
  [promotableFamiliars],
);
```

In the drag-start effect and drop callback, replace each local `addableFamiliars(...).map(...)` with `promotableFamiliarIds`, and update their dependency arrays to use `promotableFamiliarIds` instead of `familiars` where appropriate.

Pass the shared accessible path into the existing header menu:

```tsx
<SessionOverflowMenu
  key={sessionId}
  projects={projects}
  projectId={projectIdDraft}
  onProjectChange={setProjectIdDraft}
  onAddProject={overflowAddProject.beginAddProject}
  sessionId={sessionId}
  hasTurns={turns.length > 0}
  onOpenDebug={openDebug}
  reflecting={reflecting}
  onReflect={familiar.id ? () => void reflectOnThread() : undefined}
  promotableFamiliars={promotableFamiliars}
  onPromoteToCoven={promoteToCoven}
  registerCurrentRoot={setupCandidateRoot ?? undefined}
  onRegisterCurrentRoot={
    setupCandidateRoot ? () => setProjectSetupRoot(setupCandidateRoot) : undefined
  }
/>
```

- [ ] **Step 4: Render direct promotion rows in Session options**

In `src/components/chat-session-header.tsx`, import `FamiliarIcon`:

```ts
import { FamiliarIcon } from "@/components/familiar-icon";
```

Extend `SessionOverflowMenu`'s props and inline type with:

```ts
promotableFamiliars,
onPromoteToCoven,
```

```ts
promotableFamiliars: Familiar[];
onPromoteToCoven: (familiarId: string) => void;
```

Give the existing body the menu role promised by its trigger, then append the conditional section after `sections.map(...)`:

```tsx
<PopoverBody role="menu" ariaLabel="Chat options">
  {sections.map((section, si) => (
    <Fragment key={si}>
      {si > 0 ? <PopoverSeparator /> : null}
      {section.map((item) => (
        <PopoverItem
          key={item.id}
          icon={item.icon}
          checked={item.checked}
          disabled={item.disabled}
          title={item.title}
          onSelect={handlers[item.id]}
        >
          {item.label}
        </PopoverItem>
      ))}
    </Fragment>
  ))}
  {promotableFamiliars.length > 0 ? (
    <>
      <PopoverSeparator />
      <PopoverLabel>Start a coven with</PopoverLabel>
      {promotableFamiliars.map((candidate) => (
        <PopoverItem
          key={candidate.id}
          leading={<FamiliarIcon familiar={candidate} size="sm" />}
          title={`Continue this chat in a coven with ${candidate.display_name}`}
          onSelect={() => onPromoteToCoven(candidate.id)}
        >
          {candidate.display_name}
        </PopoverItem>
      ))}
    </>
  ) : null}
</PopoverBody>
```

Do not add a new visible header button, a chained picker, new promotion state, or alternate persistence logic.

- [ ] **Step 5: Verify green focused and neighboring contracts**

Run:

```bash
node --experimental-strip-types src/components/chat-header-chrome.test.ts
node --experimental-strip-types src/components/chat-header-row.test.ts
node --experimental-strip-types src/components/chat-view.test.ts
pnpm typecheck
git diff --check
```

Expected: every command exits 0; the focused contract prints `chat-header-chrome.test.ts: ok`.

- [ ] **Step 6: Commit and push the independently verified behavior**

Review and stage only the three scoped files:

```bash
git diff -- src/components/chat-header-chrome.test.ts src/components/chat-view.tsx src/components/chat-session-header.tsx
git add src/components/chat-header-chrome.test.ts src/components/chat-view.tsx src/components/chat-session-header.tsx
git commit -m "fix(chat): restore accessible coven promotion"
git push origin fix/cave-cqll3-remove-solo-participants
```

### Task 2: Verify and land PR #4295

**Files:**
- Verify: `scripts/run-tests.mjs`
- Verify: `docs/superpowers/specs/2026-08-03-chat-chrome-removals-design.md`
- Verify: `docs/superpowers/plans/2026-08-04-accessible-solo-coven-promotion.md`
- Verify: `src/components/chat-header-chrome.test.ts`
- Verify: `src/components/chat-view.tsx`
- Verify: `src/components/chat-session-header.tsx`
- Update outside Git: Bead `cave-cqll3`, GitHub PR #4295

- [ ] **Step 1: Run the complete local merge gate**

Run sequentially from the managed worktree:

```bash
pnpm typecheck
pnpm lint
pnpm test:app
pnpm test:api
pnpm test:mobile
pnpm check:tests-wired
git diff --check origin/main...HEAD
```

Expected: every command exits 0. Do not run the app and API suites concurrently because the worktree-guard tests share Git state.

- [ ] **Step 2: Perform the native visual and keyboard smoke**

Run the foreground desktop wrapper:

```bash
bash scripts/dev-app.sh
```

In a solo chat with at least one other familiar:

- Confirm the avatar, `Solo` label, and dashed `+` remain absent.
- Focus Session options with the keyboard, open it, and confirm `Start a coven with` lists eligible familiars.
- Activate a familiar with the keyboard and confirm the existing thread opens in the resulting coven and announces the mutation.
- Confirm rail drag/drop still promotes with the same eligibility rule.
- Confirm no coven section renders when there is no eligible familiar.

Stop the wrapper with `Ctrl-C`. Record any unavailable native proof explicitly instead of claiming it.

- [ ] **Step 3: Reconcile current main and the exact PR head**

Run:

```bash
git fetch origin
git merge-tree --write-tree HEAD origin/main
git status --short --branch
```

If GitHub reports a real conflict, merge `origin/main` into this owned branch, resolve only the scoped files, rerun Steps 1-2, commit, and push. Being merely behind `main` is not a blocker.

- [ ] **Step 4: Update PR metadata and inspect every conversation through REST**

Update PR #4295's title/body to describe the CI wiring plus accessibility restoration and list only verification actually completed. Then page:

```bash
gh api repos/OpenCoven/coven-cave/pulls/4295/reviews --paginate
gh api repos/OpenCoven/coven-cave/pulls/4295/comments --paginate
gh api repos/OpenCoven/coven-cave/issues/4295/comments --paginate
```

Address every actionable comment in code, reply with the fixing commit where useful, and do not claim a conversation is resolved unless its issue is actually fixed. There were no REST-visible inline threads at plan time; recheck after the final push.

- [ ] **Step 5: Require all nine checks on the exact head**

Capture `git rev-parse HEAD`, then poll the REST check-runs endpoint for that SHA until these contexts are all completed successfully: Frontend build, Rust check, E2E (Playwright), Cross-environment Ubuntu/Windows/required, and Sidecar runtime Ubuntu/Windows/required. A pass tied to an earlier SHA does not count.

- [ ] **Step 6: Squash-merge and prove main contains the result**

After the exact head is green and conversations are clear:

```bash
gh pr merge 4295 --squash --delete-branch --subject "Restore accessible Chat coven promotion (#4295)" --body "Wire the auto-status source contract into CI and restore a keyboard-accessible solo-to-coven action in Session options without bringing back redundant header chrome."
git fetch origin main
git log origin/main --oneline -5
```

Do not use `--admin`. Confirm PR state through REST and confirm the squash subject appears on `origin/main`.

- [ ] **Step 7: Record delivery and retire only through the lifecycle gate**

Record the branch, managed worktree, final verification, exact CI head, PR, and merge commit in `cave-cqll3`. Run `pnpm beads:worktrees`; apply retirement only if it reports a complete maintenance transaction. Close the Bead only after merge proof.
