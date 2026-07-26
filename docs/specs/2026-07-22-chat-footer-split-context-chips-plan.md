# Chat Footer Split Context Chips — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the chat composer footer's combined "Project · Model · branch" pill with three separate chips (project · model · branch), shared with the home composer's existing split grammar.

**Architecture:** `ComposerContextPill` becomes `ComposerContextChips` — the split-chip rendering is the only mode; the hub popover and `ComposerContextActionRows` retire. A new branch chip (repo-rooted chats only) opens `GitBranchMenuPopover`, which gains optional "Open PR #N" / "Open Git changes" footer rows so the hub's git actions survive. `.cave-context-chip` CSS moves from home-scoped `landing-composer.css` to shared `cave-composer.css`.

**Tech Stack:** Next.js/React (TSX), plain CSS token sheets, node:test source-pin tests (`--experimental-strip-types`), Playwright e2e.

**Spec:** `docs/specs/2026-07-22-chat-footer-split-context-chips-design.md` · **Bead:** cave-g21f · **Worktree:** `.worktrees/feat-chat-footer-split-chips` (branch `feat/chat-footer-split-chips`)

**Repo context an engineer needs:**
- Tests here are mostly *source pins*: they `readFileSync` a component and regex-assert its grammar. When a design decision changes, the pins are rewritten to describe the new grammar — update them deliberately, never loosen them to `.*`.
- Targeted test run: `node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types --no-warnings --test <files…>` from the worktree root. Full suite: `pnpm test:app`. Types: `pnpm typecheck`.
- `main` is protected; land via PR with green `Frontend build`, `Rust check`, `CodeQL`, `E2E (Playwright)`. Sign commits (`-S`). Push after every commit.
- All files below are relative to the worktree root.

---

### Task 1: GitBranchMenuPopover gains optional PR + Git-changes rows

**Files:**
- Modify: `src/components/composer-git-chip.tsx:103-117` (props), `:294-308` (rows)
- Test: `src/components/composer-git-chip.test.ts`

- [ ] **Step 1: Add failing pins**

Append to `src/components/composer-git-chip.test.ts` just above the final `console.log` line:

```ts
// ── The branch menu carries PR + changes rows (post-hub grammar, cave-g21f) ──
// The footer's branch chip opens this menu directly; the PR link and the
// Git-changes drill-through that used to live in the pill's hub ride along as
// optional footer rows so nothing regresses.
assert.match(
  chip,
  /pr\?: BranchPr \| null;[\s\S]*?onOpenPr\?: \(url: string\) => void;[\s\S]*?onOpenChanges\?: \(\) => void;/,
  "the branch menu takes optional PR/changes rows so the footer chip keeps hub parity",
);
assert.match(
  chip,
  /\{pr \|\| onOpenChanges \? <PopoverSeparator \/> : null\}/,
  "the extra rows sit behind a separator and render only when provided",
);
assert.match(
  chip,
  /closeMenu\(\);\s*\n\s*onOpenPr\?\.\(pr\.url\);[\s\S]{0,120}?Open PR #\{pr\.number\}/,
  "the PR row closes the menu and defers to the host's URL opener",
);
assert.match(
  chip,
  /closeMenu\(\);\s*\n\s*onOpenChanges\(\);[\s\S]{0,120}?Open Git changes/,
  "the changes row closes the menu and fires the host's drill-through",
);
```

- [ ] **Step 2: Run to verify the new pins fail**

```bash
cd .worktrees/feat-chat-footer-split-chips
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types --no-warnings --test src/components/composer-git-chip.test.ts
```
Expected: FAIL on "the branch menu takes optional PR/changes rows…" (the earlier pins still pass).

- [ ] **Step 3: Implement the props**

In `src/components/composer-git-chip.tsx`, extend the `GitBranchMenuPopover` signature (lines 103-117):

```tsx
export function GitBranchMenuPopover({
  open,
  onOpenChange,
  anchorRef,
  projectRoot,
  onSwitched,
  pr,
  onOpenPr,
  onOpenChanges,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  /** Repo root the menu operates on (undefined disables everything). */
  projectRoot: string | undefined;
  /** Called after a successful branch switch (e.g. reload the status poll). */
  onSwitched?: () => void;
  /** Optional footer rows (post-hub grammar, cave-g21f): the branch's PR… */
  pr?: BranchPr | null;
  /** …opened via the host's URL handler… */
  onOpenPr?: (url: string) => void;
  /** …and the Git-changes drill-through. */
  onOpenChanges?: () => void;
}) {
```

- [ ] **Step 4: Implement the rows**

Still in `composer-git-chip.tsx`, immediately after the `creating ? (form) : (New worktree… PopoverItem)` conditional closes (after line ~303, before the `{menuError ? …}` block):

```tsx
        {pr || onOpenChanges ? <PopoverSeparator /> : null}
        {pr ? (
          <PopoverItem
            icon="ph:git-pull-request"
            title={`Open PR #${pr.number} (${pr.isDraft ? "draft" : pr.state.toLowerCase()})`}
            onSelect={() => {
              closeMenu();
              onOpenPr?.(pr.url);
            }}
          >
            Open PR #{pr.number}
          </PopoverItem>
        ) : null}
        {onOpenChanges ? (
          <PopoverItem
            icon="ph:git-diff"
            onSelect={() => {
              closeMenu();
              onOpenChanges();
            }}
          >
            Open Git changes
          </PopoverItem>
        ) : null}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types --no-warnings --test src/components/composer-git-chip.test.ts
```
Expected: PASS (`composer-git-chip.test.ts: ok`).

- [ ] **Step 6: Commit and push**

```bash
git add src/components/composer-git-chip.tsx src/components/composer-git-chip.test.ts
git commit -S -m "feat(composer): optional PR + Git-changes rows in the branch menu (cave-g21f)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
git push -u origin feat/chat-footer-split-chips
```

---

### Task 2: Chips-only context component + chat/home rewiring + CSS move + pin updates

This is one atomic commit: the component rename breaks every consumer and pin at once, so all of it moves together. Steps are ordered so the band test acts as the failing spec.

**Files:**
- Modify: `src/components/composer-context-pill.tsx` (full rewrite below)
- Modify: `src/components/chat-view.tsx:72` (import), `:5903-5928` (band)
- Modify: `src/components/home-composer.tsx:55` (import), `:1087-1117` (band)
- Modify: `src/components/composer-plus-menu.tsx:48` (comment only)
- Modify: `src/styles/cave-composer.css:963-1019` (pill → chips), `:1080-1084` (mobile)
- Modify: `src/styles/home-composer/landing-composer.css:301-339` (delete moved rules)
- Test (rewrite): `src/components/chat-composer-footer-band.test.ts`
- Test (pin updates): `composer-runtime-chip.test.ts`, `composer-git-chip.test.ts`, `project-picker.test.ts`, `composer-actions-menu.test.ts`, `chat-view-first-class.test.ts`, `chat-view-polish-header-composer.test.ts`, `chat-header-row.test.ts`, `composer-density.test.ts`, `home-composer.test.ts`, `home-composer-polish.test.ts`

- [ ] **Step 1: Rewrite the band test as the failing spec**

Replace the sections of `src/components/chat-composer-footer-band.test.ts` between the control-row pins (keep lines 1-56 as they are, but update line 53) and the measure/send/mobile pins (keep lines 121-204 unchanged). The full replacement for lines 53 and 57-119:

Line 53 becomes:

```ts
assert.doesNotMatch(controlRow, /<ComposerContextChips/, "the context chips live in the footer band, not the control row");
```

Lines 57-119 become:

```ts
// ── The footer band is the panel's last section, after the control row ──────
assert.match(
  source,
  /className="cave-composer-control-row"[\s\S]*?className="cave-composer-footer-band"/,
  "the footer band renders after the composer controls, inside the panel",
);
assert.match(
  source,
  /className="cave-composer-footer-band">\s*\n\s*<div className="cave-composer-footer-band__cluster">\s*\n\s*<ComposerContextChips[\s\S]*?<\/div>\s*\n\s*\{linkedContextRow\}\s*\n\s*<\/div>/,
  "the band leads with the context-chips cluster, then the linked-context strip (tasks · GitHub · link/create)",
);

// ── Split chips (cave-g21f): project · model · branch as separate controls ──
assert.match(
  source,
  /<ComposerContextChips\s*\n\s*projects=\{projects\}\s*\n\s*projectValue=\{resolvedProjectId\}\s*\n\s*onProjectChange=\{setProjectIdDraft\}\s*\n\s*allowNoProject/,
  "the chips show the RESOLVED project selection (draft → task project → session cwd) and write the draft",
);
assert.match(
  source,
  /createProject=\{createProject\}[\s\S]{0,600}?projectRoot=\{activeProjectRoot\}[\s\S]{0,120}?onOpenUrl=\{onOpenUrl\}/,
  "the chips fold in the add-project flow and the git/PR context (register + grant, branch, PR open)",
);
assert.doesNotMatch(
  source,
  /cave-composer-footer-band__context|<ProjectPicker\b|<ComposerRuntimeChip|<ComposerGitChip|<ComposerContextPill\b/,
  "neither the legacy picker cluster nor the combined pill render — the chips are the band's context grammar",
);

// ── Each chip opens its own picker; the hub popover is gone ─────────────────
assert.match(
  pill,
  /aria-label=\{`Project: \$\{projectLabel\} — change project`\}[\s\S]*?aria-label=\{`Model: \$\{modelLabel\} — change model`\}[\s\S]*?aria-label=\{`Branch: \$\{context\.branch\} — switch branch or create a worktree`\}/,
  "the chips read Project / Model / Branch as separately labelled controls in order",
);
assert.match(pill, /context\.hasGit \? \(/, "the branch chip elides for git-less composers (home, no-project chats)");
assert.doesNotMatch(
  pill,
  /"hub"|<PopoverLabel>|ComposerContextActionRows|splitControls/,
  "the combined pill's hub popover, action rows, and the splitControls flag are retired",
);
assert.match(
  pill,
  /<GitBranchMenuPopover[\s\S]*?\{\.\.\.branchPopoverExtras\(context\)\}/,
  "the branch chip's menu carries the PR + Git-changes rows (hub parity)",
);

// ── The header no longer hosts the linked-context strip ─────────────────────
const header = source.match(/<header className="cave-chat-linear-header[\s\S]*?<\/header>/)?.[0] ?? "";
assert.ok(header, "chat header is present");
assert.doesNotMatch(
  header,
  /linkedContextRow/,
  "the header renders MetaLine only — the linked-context strip stays in the band",
);

// ── Band chrome: attached underside strip, one tone deeper ──────────────────
assert.match(
  css,
  /\.cave-composer-footer-band \{[\s\S]*?border-top: 1px solid var\(--border-hairline\);[\s\S]*?background: color-mix\(in oklch, var\(--bg-base\) 62%, transparent\);/,
  "the band is the darker hairline-topped strip clipped into the panel's bottom corners",
);

// ── Chip chrome: shared quiet 28px chips in the composer sheet ──────────────
assert.match(
  css,
  /\.cave-composer-footer-band__cluster \{[\s\S]{0,200}?min-width: 0;[\s\S]{0,120}?flex: 1 1 auto;/,
  "the band's chip cluster flexes and allows shrinking so three chips coexist with the linked strip",
);
assert.match(
  css,
  /\.cave-context-chip \{[\s\S]{0,400}?height: 28px;[\s\S]{0,300}?border-radius: var\(--radius-control\);\s*\n\s*background: transparent;\s*\n\s*color: var\(--text-secondary\);\s*\n\s*font-size: var\(--text-sm\);/,
  "the context chips are the quiet 28px control-radius family, defined in the shared composer sheet",
);
assert.match(
  css,
  /\.cave-context-chip\[aria-expanded="true"\] \{[\s\S]{0,200}?--accent-presence/,
  "an open chip shows the accent open-state (pill parity)",
);
assert.doesNotMatch(css, /\.cave-context-pill/, "the combined pill's CSS is retired with it");
```

Note the update inside the retained pill header comment at the top of the test file (lines 2-8): rewrite the comment paragraph to describe the chips grammar, e.g.:

```ts
// Source pins for the chat composer's context grammar after the 2026-07-22
// split (cave-g21f): the footer band carries project · model · branch as
// three separate chips (ComposerContextChips) on the left — each opening its
// own picker — and the linked-work strip (tasks · GitHub · link/create) on
// the right. The grouped ComposerActionsMenu keeps its four groups. The
// write surface stays minimal: textarea, then attach · voice · grouped menu ·
// circular send.
```

- [ ] **Step 2: Run to verify the spec fails**

```bash
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types --no-warnings --test src/components/chat-composer-footer-band.test.ts
```
Expected: FAIL (chips not implemented yet).

- [ ] **Step 3: Rewrite `src/components/composer-context-pill.tsx`**

Replace the entire file with:

```tsx
"use client";

import "@/styles/cave-composer.css";

// ComposerContextChips — the composer footer's context controls (cave-g21f):
// project, model, and (for repo-rooted chats) branch ride as separate,
// individually labelled chips. Each opens its own picker popover anchored to
// the chip itself (ProjectPickerPopover, ComposerRuntimePopover,
// GitBranchMenuPopover), so every existing flow — project switching +
// add-project, runtime/model switching, branch switch / new worktree / PR
// open / git-changes drill-through — stays one click away. This replaced the
// combined "Project · Model · branch" pill and its hub popover (2026-07-22)
// on both the chat and home composers.

import { useMemo, useRef, useState, type RefObject } from "react";
import { Icon } from "@/lib/icon";
import { ProjectAvatar } from "@/components/project-avatar";
import { ProjectPickerPopover, useAddProjectFlow } from "@/components/project-picker";
import {
  ComposerRuntimePopover,
  runtimeModelLabel,
} from "@/components/composer-runtime-chip";
import { GitBranchMenuPopover, useBranchPr } from "@/components/composer-git-chip";
import { RuntimeLogo, runtimeDisplayName } from "@/components/runtime-logo";
import { useChangesSummary } from "@/lib/use-changes-summary";
import { NO_PROJECT_ID } from "@/lib/chat-projects";
import { sortProjectsAlphabetically, type CaveProject } from "@/lib/cave-projects-types";
import type { CreateProjectOptions } from "@/lib/chat-add-project";
import type { RuntimeModelOption } from "@/lib/runtime-models";

export type ComposerContextView = null | "project" | "model" | "branch";

export type ComposerContextProps = {
  projects: CaveProject[];
  /** Project id, NO_PROJECT_ID, or null (null falls back to the first project). */
  projectValue: string | null;
  onProjectChange: (id: string) => void;
  allowNoProject?: boolean;
  familiarId?: string | null;
  /** From the caller's useProjects(); presence enables the "Add project…" row. */
  createProject?: (
    name: string,
    root: string,
    options?: CreateProjectOptions,
  ) => Promise<CaveProject | null>;
  runtime: string;
  modelValue: string;
  modelOptions: RuntimeModelOption[];
  onPickRuntime: (runtime: string) => void;
  onPickModel: (id: string) => void;
  /** Chat disables model switching while streaming (runtime-chip parity). */
  modelDisabled?: boolean;
  /** Enables the branch chip for repo-rooted chats (undefined/non-repo
   *  roots elide it, git-chip parity). */
  projectRoot?: string;
  /** Opens the branch PR in the app's browser pane; falls back to window.open. */
  onOpenUrl?: (url: string) => void;
  disabled?: boolean;
};

export type ComposerContextController = ReturnType<typeof useComposerContextActions>;

export function useComposerContextActions(config: ComposerContextProps) {
  const sortedProjects = useMemo(
   () => sortProjectsAlphabetically(config.projects),
   [config.projects],
  );
  const selectedProject =
   config.projectValue === NO_PROJECT_ID
     ? null
     : (config.projectValue
         ? sortedProjects.find((project) => project.id === config.projectValue) ?? sortedProjects[0]
         : sortedProjects[0]) ?? null;

  const addFlow = useAddProjectFlow({
   familiarId: config.familiarId ?? null,
   createProject: config.createProject ?? (async () => null),
   projects: config.projects,
   onAdded: config.onProjectChange,
  });

  const runtimeName = runtimeDisplayName(config.runtime);
  const modelLabel = runtimeModelLabel(config.modelValue, config.modelOptions);

  const root = config.projectRoot?.trim() ? config.projectRoot : undefined;
  const { loaded, notARepo, branch, count, worktree, reload } = useChangesSummary(
    root,
    Boolean(root),
  );
  const pr = useBranchPr(root, branch);
  const hasGit = Boolean(root && loaded && !notARepo && branch);

  const dirtyLabel =
    count > 0 ? `${count} uncommitted change${count === 1 ? "" : "s"}` : "clean";
  const summary = [
    selectedProject ? selectedProject.name : "No project",
    modelLabel ?? runtimeName,
  ].join(" · ");

  return {
   config,
   sortedProjects,
   selectedProject,
   addFlow,
    runtimeName,
    modelLabel,
    root,
    loaded,
    notARepo,
    branch,
    count,
    worktree,
    reload,
    pr,
    hasGit,
    dirtyLabel,
    summary,
  };
}

// The branch menu's footer rows (PR · Git changes) — shared by the footer's
// branch chip and the actions-menu "Branch…" flow so both keep parity with
// the retired hub's git section.
function branchPopoverExtras(context: ComposerContextController) {
  return {
    pr: context.pr,
    onOpenPr: (url: string) => {
      if (context.config.onOpenUrl) context.config.onOpenUrl(url);
      else window.open(url, "_blank", "noopener,noreferrer");
    },
    onOpenChanges: () => window.dispatchEvent(new CustomEvent("cave:changes-open")),
  };
}

export function ComposerContextPickers({
  view,
  onViewChange,
  anchorRef,
  context,
}: {
  view: ComposerContextView;
  onViewChange: (view: ComposerContextView) => void;
  anchorRef: RefObject<HTMLElement | null>;
  context: ComposerContextController;
}) {
  return (
    <>
      <ProjectPickerPopover
        open={view === "project"}
        onOpenChange={(open) => onViewChange(open ? "project" : null)}
        anchorRef={anchorRef}
        projects={context.config.projects}
        value={context.config.projectValue}
        onChange={context.config.onProjectChange}
        allowNoProject={context.config.allowNoProject}
        onAddProject={context.config.createProject ? context.addFlow.beginAddProject : undefined}
        addingProject={context.addFlow.adding}
        ariaLabel="Choose project"
      />
      <ComposerRuntimePopover
        open={view === "model"}
        onOpenChange={(open) => onViewChange(open ? "model" : null)}
        anchorRef={anchorRef}
        runtime={context.config.runtime}
        modelValue={context.config.modelValue}
        modelOptions={context.config.modelOptions}
        onPickRuntime={context.config.onPickRuntime}
        onPickModel={context.config.onPickModel}
      />
      <GitBranchMenuPopover
        open={view === "branch"}
        onOpenChange={(open) => onViewChange(open ? "branch" : null)}
        anchorRef={anchorRef}
        projectRoot={context.root}
        onSwitched={context.reload}
        {...branchPopoverExtras(context)}
      />
      {context.addFlow.addError ? (
        <span className="cave-project-picker__error" role="alert">
          {context.addFlow.addError}
        </span>
      ) : null}
      {context.config.createProject ? context.addFlow.addProjectModal : null}
    </>
  );
}

export function ComposerContextChips(props: ComposerContextProps) {
  const [menu, setMenu] = useState<ComposerContextView>(null);
  const projectRef = useRef<HTMLButtonElement | null>(null);
  const modelRef = useRef<HTMLButtonElement | null>(null);
  const branchRef = useRef<HTMLButtonElement | null>(null);
  const context = useComposerContextActions(props);
  const projectLabel = context.selectedProject?.name ?? "No project";
  const modelLabel = context.modelLabel ?? context.runtimeName;

  return (
    <>
      <button
        ref={projectRef}
        type="button"
        className="cave-context-chip focus-ring"
        disabled={props.disabled}
        aria-haspopup="dialog"
        aria-expanded={menu === "project"}
        aria-label={`Project: ${projectLabel} — change project`}
        title={context.selectedProject?.root ?? "No project selected"}
        onClick={() => setMenu((c) => (c === "project" ? null : "project"))}
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
      <button
        ref={modelRef}
        type="button"
        className="cave-context-chip focus-ring"
        disabled={props.disabled || context.config.modelDisabled}
        aria-haspopup="dialog"
        aria-expanded={menu === "model"}
        aria-label={`Model: ${modelLabel} — change model`}
        title={`Runtime: ${context.runtimeName}${context.modelLabel ? ` · Model: ${context.modelLabel}` : ""}`}
        onClick={() => setMenu((c) => (c === "model" ? null : "model"))}
      >
        <span className="cave-context-chip__lead cave-runtime-chip__logo" aria-hidden>
          <RuntimeLogo runtime={context.config.runtime} size={13} />
        </span>
        <span className="cave-context-chip__text">{modelLabel}</span>
        <Icon name="ph:caret-down" width={9} aria-hidden className="cave-context-chip__chevron" />
      </button>
      {context.hasGit ? (
        <button
          ref={branchRef}
          type="button"
          className="cave-context-chip focus-ring"
          disabled={props.disabled}
          aria-haspopup="menu"
          aria-expanded={menu === "branch"}
          aria-label={`Branch: ${context.branch} — switch branch or create a worktree`}
          title={`Branch: ${context.branch} · ${context.dirtyLabel}${context.worktree ? ` · Worktree: ${context.worktree}` : ""}`}
          onClick={() => setMenu((c) => (c === "branch" ? null : "branch"))}
        >
          <span className="cave-context-chip__lead" aria-hidden>
            <Icon name="ph:git-branch" width={13} aria-hidden />
          </span>
          <span className="cave-context-chip__text">
            {context.branch}
            {context.count > 0 ? ` · +${context.count}` : ""}
            {context.worktree ? ` · ${context.worktree}` : ""}
          </span>
          <Icon name="ph:caret-down" width={9} aria-hidden className="cave-context-chip__chevron" />
        </button>
      ) : null}

      <ProjectPickerPopover
        open={menu === "project"}
        onOpenChange={(open) => setMenu(open ? "project" : null)}
        anchorRef={projectRef}
        projects={context.config.projects}
        value={context.config.projectValue}
        onChange={context.config.onProjectChange}
        allowNoProject={context.config.allowNoProject}
        onAddProject={context.config.createProject ? context.addFlow.beginAddProject : undefined}
        addingProject={context.addFlow.adding}
        ariaLabel="Choose project"
      />
      <ComposerRuntimePopover
        open={menu === "model"}
        onOpenChange={(open) => setMenu(open ? "model" : null)}
        anchorRef={modelRef}
        runtime={context.config.runtime}
        modelValue={context.config.modelValue}
        modelOptions={context.config.modelOptions}
        onPickRuntime={context.config.onPickRuntime}
        onPickModel={context.config.onPickModel}
      />
      {context.hasGit ? (
        <GitBranchMenuPopover
          open={menu === "branch"}
          onOpenChange={(open) => setMenu(open ? "branch" : null)}
          anchorRef={branchRef}
          projectRoot={context.root}
          onSwitched={context.reload}
          {...branchPopoverExtras(context)}
        />
      ) : null}
      {context.addFlow.addError ? (
        <span className="cave-project-picker__error" role="alert">
          {context.addFlow.addError}
        </span>
      ) : null}
      {context.config.createProject ? context.addFlow.addProjectModal : null}
    </>
  );
}
```

What changed vs. the old file: `ComposerContextPill` (hub + split branches) → `ComposerContextChips` (chips only, plus the branch chip); `ComposerContextActionRows` deleted; `splitControls` and `ariaLabel` props deleted; `branchPopoverExtras` added and threaded into both `GitBranchMenuPopover` mounts; the `ui/popover` import removed (nothing in the file uses it now); the chips fragment gains the `addError` span the old split mode was missing.

- [ ] **Step 4: Rewire the chat footer band**

In `src/components/chat-view.tsx`:

Line 72, the import becomes:

```tsx
import { ComposerContextChips } from "@/components/composer-context-pill";
```

Lines 5903-5928 (comment + band) become:

```tsx
            {/* Footer band — the darker strip attached to the panel's
                underside carries the context chips (project · model · branch
                as separate controls, cave-g21f; each opens its own picker) on
                the left and the linked-work strip (tasks · GitHub ·
                link/create) on the right. */}
            <div className="cave-composer-footer-band">
              <div className="cave-composer-footer-band__cluster">
                <ComposerContextChips
                  projects={projects}
                  projectValue={resolvedProjectId}
                  onProjectChange={setProjectIdDraft}
                  allowNoProject
                  familiarId={familiar.id ?? null}
                  createProject={createProject}
                  runtime={modelHarness}
                  modelValue={composerModelValue}
                  modelOptions={composerModelOptions}
                  onPickRuntime={handleSelectRuntime}
                  onPickModel={handleSelectModel}
                  modelDisabled={busy}
                  projectRoot={activeProjectRoot}
                  onOpenUrl={onOpenUrl}
                />
              </div>
              {linkedContextRow}
            </div>
```

⚠️ The band-test regex in Step 1 expects `<ComposerContextChips` on the line after the cluster div and `{linkedContextRow}` after the cluster's `</div>` — match this indentation shape exactly.

- [ ] **Step 5: Rewire the home composer**

In `src/components/home-composer.tsx`:

Line 55, the import becomes:

```tsx
import { ComposerContextChips } from "@/components/composer-context-pill";
```

Lines 1087-1117 (the two stale comment blocks + band) become:

```tsx
        {/* Footer toolbar — a clean bottom bar inside the composer. The left
            cluster carries project + model as two SEPARATE labelled chips
            (shared ComposerContextChips grammar with the chat composer,
            cave-g21f; home passes no git root, so no branch chip). The
            segmented Chat/Task control and attach live in the control row
            above. Send hugs bottom-right, vertically aligned. */}
        <div className="cave-composer-footer-band home-composer-toolbar">
          <div className="home-composer-toolbar__left">
            <ComposerContextChips
              projects={projects}
              projectValue={selectedProjectId || null}
              onProjectChange={setSelectedProjectId}
              allowNoProject
              familiarId={selectedFamiliarId || null}
              createProject={createProject}
              runtime={selectedRuntime}
              modelValue={selectedModelId}
              modelOptions={runtimeModelOptions}
              onPickRuntime={handleSelectRuntime}
              onPickModel={handleSelectModel}
              disabled={sending}
            />
          </div>
        </div>
```

Also update the comment at `src/components/composer-plus-menu.tsx:48` from "mirrors the footer-band context pill" to "mirrors the footer-band context chips".

- [ ] **Step 6: Move the chip CSS into the shared sheet**

In `src/styles/cave-composer.css`, replace lines 963-1019 (the comment + `.cave-context-pill` block through `.cave-context-pill__chevron`) with:

```css
/* Footer context chips (cave-g21f) — project · model · branch ride as
   separate quiet controls in the footer band; each opens its own picker
   anchored to the chip. Shared by the chat and home composers. */
.cave-composer-footer-band__cluster {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex: 1 1 auto;
}

.cave-context-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 13rem;
  min-width: 0;
  height: 28px;
  padding: 0 var(--space-2);
  border: 1px solid transparent;
  border-radius: var(--radius-control);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  font-weight: 450;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease;
}

.cave-context-chip:hover:not(:disabled) {
  background: color-mix(in oklch, var(--foreground) 6%, transparent);
  color: var(--text-primary);
}

.cave-context-chip[aria-expanded="true"] {
  border-color: color-mix(in oklch, var(--accent-presence) 45%, var(--border-strong));
  background: color-mix(in oklch, var(--accent-presence) 10%, transparent);
  color: var(--text-primary);
}

.cave-context-chip:disabled {
  cursor: default;
  opacity: 0.55;
}

.cave-context-chip__lead {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  color: var(--text-muted);
}

.cave-context-chip__text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cave-context-chip__chevron {
  flex-shrink: 0;
  color: var(--text-muted);
  opacity: 0.7;
}
```

In the same file's `@media (max-width: 767px)` block, replace the `.cave-context-pill { … }` rule (lines ~1080-1084) with:

```css
  .cave-context-chip {
    height: var(--touch-target);
    min-height: var(--touch-target);
    max-width: 9rem;
    -webkit-tap-highlight-color: transparent;
  }
```

In `src/styles/home-composer/landing-composer.css`, delete lines 301-339 (`.cave-context-chip` base rules through `.cave-context-chip__chevron` — now shared) but **keep** the home-scoped container query at lines 341-343:

```css
@container (max-width: 620px) {
  .cave-context-chip { max-width: 46%; height: var(--touch-target); }
}
```

(Home's card is the `container-type: inline-size` context — landing-composer.css:173 — so this query only ever fires on home; the chat composer has no container and uses the shared media rule instead.)

- [ ] **Step 7: Run the band spec — expect PASS**

```bash
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types --no-warnings --test src/components/chat-composer-footer-band.test.ts
```
Expected: PASS.

- [ ] **Step 8: Update the remaining source pins**

Each edit below is a pin whose decision changed. Exact edits, file by file:

**`src/components/composer-runtime-chip.test.ts`**
- Line 25 regex: `/<ComposerContextPill[\s\S]*?runtime=…/` → `/<ComposerContextChips[\s\S]*?runtime=\{selectedRuntime\}[\s\S]*?modelValue=\{selectedModelId\}[\s\S]*?modelOptions=\{runtimeModelOptions\}[\s\S]*?onPickRuntime=\{handleSelectRuntime\}[\s\S]*?onPickModel=\{handleSelectModel\}/` (message: "the home composer's context chips host the runtime picker from its own model state").
- Line 30 regex: `<ComposerContextPill` → `<ComposerContextChips`; message: "the chips anchor the composer footer band".
- Lines 33-37 (ActionRows export pin): replace with

```ts
assert.match(
  contextPill,
  /aria-label=\{`Model: \$\{modelLabel\} — change model`\}/,
  "the model chip is a separately labelled control (split grammar, cave-g21f)",
);
```
- Lines 48-52 (wrapper pin): replace the regex with `/const context = useComposerContextActions\(props\);[\s\S]*?<ComposerRuntimePopover[\s\S]*?onPickModel=\{context\.config\.onPickModel\}/` (message: "the chips mount the shared runtime popover from the same context controller").
- Line 86 regex: `<ComposerContextPill` → `<ComposerContextChips`.

**`src/components/composer-git-chip.test.ts`**
- Lines 14-17 comment: describe the chips grammar ("branch/PR/change actions ride the branch chip's GitBranchMenuPopover; ComposerContextPickers keeps the actions-menu flow").
- Line 30 (ActionRows pin): replace with

```ts
assert.match(pill, /function branchPopoverExtras\(context: ComposerContextController\)/, "the PR/changes rows are built once and shared by the chip and the actions-menu flow");
```
- Lines 41-45 (wrapper pin): replace regex with `/const context = useComposerContextActions\(props\);[\s\S]*?<GitBranchMenuPopover[\s\S]*?\{\.\.\.branchPopoverExtras\(context\)\}/` (message: "the chips mount the branch menu with the PR/changes extras on the chip anchor").

**`src/components/project-picker.test.ts`**
- Line 42: `<ComposerContextPill` → `<ComposerContextChips`; message: "home composer's context chips host the shared project picker".
- Lines 52-56 (ActionRows project-row pin): replace with

```ts
assert.match(
  contextPill,
  /aria-label=\{`Project: \$\{projectLabel\} — change project`\}[\s\S]*?<ProjectPickerPopover/,
  "the project chip is a labelled control that opens the shared ProjectPickerPopover",
);
```
- Lines 57-61 (`<ComposerContextPickers` mount pin): the pill file no longer mounts it — repoint the pin at the surviving consumer:

```ts
const actionsMenu = readFileSync(new URL("./composer-actions-menu.tsx", import.meta.url), "utf8");
assert.match(
  actionsMenu,
  /<ComposerContextPickers[\s\S]*?context=\{context\}/,
  "the actions menu still threads the shared context into the extracted pickers",
);
```

**`src/components/composer-actions-menu.test.ts`**
- Line 141 (`export function ComposerContextActionRows` pin) and lines 142-146 (`itemSemantic?: PopoverItemSemantic` pin): delete both; replace with

```ts
assert.match(context, /export\s+function\s+ComposerContextChips/);
```
- Line 213: `assert.match(home, /<ComposerContextPill/);` → `assert.match(home, /<ComposerContextChips/);`

**`src/components/chat-view-first-class.test.ts`**
- Line 150: count `source.match(/<ComposerContextChips/g)?.length === 1`; message: "the context chips mount exactly once — in the footer band".
- Line 156 regex → `/className="cave-composer-footer-band">\s*\n\s*<div className="cave-composer-footer-band__cluster">\s*\n\s*<ComposerContextChips/` (message: "the context chips live in the footer band, not the control row").

**`src/components/chat-view-polish-header-composer.test.ts`**
- Line 157 regex → same cluster-aware regex as above.
- Line 179 count pin → `<ComposerContextChips` count === 1.
- Update the comment at lines 154-155 and 177-178 ("context pill" → "context chips").

**`src/components/chat-header-row.test.ts`**
- Line 66 regex → `/className="cave-composer-footer-band">\s*\n\s*<div className="cave-composer-footer-band__cluster">\s*\n\s*<ComposerContextChips[\s\S]*?\{linkedContextRow\}/` (message: "the footer band carries the context chips and the linked-context strip").

**`src/components/composer-density.test.ts`**
- Line 25: `/<ComposerContextPill/` → `/<ComposerContextChips/` (the doesNotMatch on the control-row slice).

**`src/components/home-composer.test.ts`**
- Line 94 regex: `<ComposerContextPill` → `<ComposerContextChips` (rest unchanged).
- Line 472 regex: trailing `<ComposerContextPill` → `<ComposerContextChips`.
- Line 477 (utility-row doesNotMatch): `<ComposerContextPill` → `<ComposerContextChips`.

**`src/components/home-composer-polish.test.ts`**
- Line 78 regex: `<ComposerContextPill` → `<ComposerContextChips`; update the comment above it ("context pill (Project · Model)" → "context chips (Project · Model)").

- [ ] **Step 9: Run the full affected batch**

```bash
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types --no-warnings --test \
  src/components/chat-composer-footer-band.test.ts \
  src/components/composer-git-chip.test.ts \
  src/components/composer-runtime-chip.test.ts \
  src/components/project-picker.test.ts \
  src/components/composer-actions-menu.test.ts \
  src/components/chat-view-first-class.test.ts \
  src/components/chat-view-polish-header-composer.test.ts \
  src/components/chat-header-row.test.ts \
  src/components/composer-density.test.ts \
  src/components/home-composer.test.ts \
  src/components/home-composer-polish.test.ts
```
Expected: all PASS. If a regex misses, diff the pinned pattern against the actual source shape — fix the pin's whitespace expectations, never the assertion's meaning.

- [ ] **Step 10: Typecheck**

```bash
pnpm typecheck
```
Expected: clean. (Catches any missed `ComposerContextPill`/`ariaLabel`/`splitControls` stragglers.)

- [ ] **Step 11: Grep for stragglers**

```bash
grep -rn "ComposerContextPill\|ComposerContextActionRows\|splitControls\|cave-context-pill" src/ tests/ --include="*.ts" --include="*.tsx" --include="*.css"
```
Expected: only `tests/composer-runtime-chip.spec.ts` hits (Task 3) and historical mentions in comments you intentionally rewrote (should be none in src/).

- [ ] **Step 12: Commit and push**

```bash
git add -A src/components src/styles
git commit -S -m "feat(chat): split footer context pill into project · model · branch chips (cave-g21f)

The chat composer footer band now carries three separate, individually
labelled chips (ComposerContextChips) instead of the combined pill + hub
popover; the branch chip opens the branch menu directly with PR and
Git-changes rows. Chip CSS moves to the shared composer sheet; home keeps
its two-chip rendering through the same component.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
git push
```

---

### Task 3: E2E — drive the model chip instead of the hub pill

**Files:**
- Modify: `tests/composer-runtime-chip.spec.ts:93-128`

- [ ] **Step 1: Update the spec**

In the first test (lines 96-104), replace:

```ts
    const pill = page.getByRole("button", { name: "Chat context: project, model, and branch" });
    await expect(pill).toBeVisible({ timeout: 45_000 });
    // toContainText retries — the pill settles once model-state hydrates.
    await expect(pill).toContainText("GPT-5.5", { timeout: 15_000 });

    await pill.click();
    // Hub popover → Model section row opens the Runtime/Model picker.
    await page.getByRole("menuitem", { name: /Codex · GPT-5\.5/ }).click();
```

with:

```ts
    const modelChip = page.getByRole("button", { name: /change model/ });
    await expect(modelChip).toBeVisible({ timeout: 45_000 });
    // toContainText retries — the chip settles once model-state hydrates.
    await expect(modelChip).toContainText("GPT-5.5", { timeout: 15_000 });

    // Split chips (cave-g21f): the model chip opens the picker directly.
    await modelChip.click();
```

In the second test (lines 119-128), replace:

```ts
    const pill = page.getByRole("button", { name: "Chat context: project, model, and branch" });
    await expect(pill).toBeVisible({ timeout: 45_000 });
    await expect(pill).toContainText("GPT-5.5", { timeout: 15_000 });
```
with:

```ts
    const pill = page.getByRole("button", { name: /change model/ });
    await expect(pill).toBeVisible({ timeout: 45_000 });
    await expect(pill).toContainText("GPT-5.5", { timeout: 15_000 });
```
and delete the hub line `await page.getByRole("menuitem", { name: /Codex · GPT-5\.5/ }).click();` that follows `await pill.click();` (keep `await pill.click();`). The later assertions (`toContainText("Claude Opus")`, `toContainText("Claude Sonnet 5")`) stay — the chip text is the model label.

Also update the describe title on line 93: `"composer runtime picker (context pill)"` → `"composer runtime picker (context chips)"`.

- [ ] **Step 2: Run the spec locally**

```bash
pnpm e2e:install
pnpm exec playwright test tests/composer-runtime-chip.spec.ts
```
Expected: PASS (the config's webServer starts Next automatically; allow several minutes cold). If the local run is environment-blocked, say so in the PR and rely on the required `E2E (Playwright)` check.

- [ ] **Step 3: Commit and push**

```bash
git add tests/composer-runtime-chip.spec.ts
git commit -S -m "test(e2e): drive the split model chip instead of the hub pill (cave-g21f)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
git push
```

---

### Task 4: Full validation, PR, merge, cleanup

- [ ] **Step 1: Full app suite + typecheck**

```bash
pnpm test:app && pnpm typecheck
```
Expected: all suites pass. Fix any missed pin (the failure message names the file and decision).

- [ ] **Step 2: Manual smoke (optional but recommended)**

`bash scripts/dev-app.sh` from the worktree, open a repo-rooted chat: footer band shows three chips; project chip → project popover; model chip → runtime/model radios; branch chip → branch list with PR + "Open Git changes" rows; home shows two chips, unchanged. Ctrl-C when done.

- [ ] **Step 3: Update the bead + open the PR**

```bash
bd update cave-g21f --notes "branch feat/chat-footer-split-chips, worktree .worktrees/feat-chat-footer-split-chips; verified: pnpm test:app, pnpm typecheck, targeted playwright spec"
gh pr create --base main --head feat/chat-footer-split-chips \
  --title "feat(chat): split footer context pill into project · model · branch chips (cave-g21f)" \
  --body "Separates project and model selection in the chat composer footer (home parity) and gives git context its own chip.

- ComposerContextPill → ComposerContextChips: split chips are the only mode; hub popover + ComposerContextActionRows retired
- New branch chip (repo-rooted chats) opens GitBranchMenuPopover, which gains PR + Open-Git-changes rows (hub parity, also reachable from the actions-menu Branch… flow)
- .cave-context-chip CSS moved to shared cave-composer.css; .cave-context-pill CSS retired
- Source pins + e2e updated to the new grammar

Spec: docs/specs/2026-07-22-chat-footer-split-context-chips-design.md
Plan: docs/specs/2026-07-22-chat-footer-split-context-chips-plan.md
Bead: cave-g21f"
```

- [ ] **Step 4: Pre-merge race check** (parallel sessions race this repo)

```bash
gh pr list --limit 15
bd list --status in_progress | head -20
```
Expected: no other open PR touching the composer footer. If one exists, reconcile before merging.

- [ ] **Step 5: Merge once the 4 required checks are green, then clean up**

```bash
gh pr checks <PR#> --watch
gh pr merge <PR#> --squash --delete-branch
cd /Users/buns/Documents/GitHub/OpenCoven/coven-cave
git worktree remove .worktrees/feat-chat-footer-split-chips
git branch -D feat/chat-footer-split-chips
git worktree list
bd close cave-g21f
```

(Note: bot pushes — Copilot Autofix / copilot-swe-agent — sometimes land on fresh PRs within minutes; `git pull` and re-review the net diff before merging if any appear.)
