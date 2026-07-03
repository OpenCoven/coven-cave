# Unified Project Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One shared project-selection UI and one shared add-project (register **and** grant) flow across chat, home, and the projects management surface; the code surface remembers its selected project.

**Architecture:** A new `src/components/project-picker.tsx` exports `useAddProjectFlow` (folder dialog → `addChatProject` register+grant) and `ProjectPicker` (Popover-based picker with filter, "No project", and "Add project…" rows). Chat empty state swaps its native select for the picker; the chat overflow menu and home composer gain "Add project…" via the shared flow; `projects-view` grants on create; comux persists `selectedProjectRoot` to localStorage.

**Tech Stack:** Next.js/React client components, existing `Popover*` primitives, `DirectoryPickerModal`, `addChatProject`, node:test source-text pin tests, `scripts/run-tests.mjs` suites.

**Spec:** `docs/specs/2026-07-03-unified-project-picker-design.md`

Constraints from pinned tests (do NOT break):
- `chat-surface-polish.test.ts:47` — class `cave-chat-empty-project` must stay in chat-view.tsx.
- `task-chat-cwd.test.ts:37,62` — `SessionOverflowMenu` must textually keep `<PopoverLabel>Project</PopoverLabel>` … `onProjectChange(NO_PROJECT_ID);` … `No project` … `projects.map((entry) => (` … `onSelect={() => {\n onProjectChange(entry.id)` inside the function.
- `task-chat-cwd.test.ts:72,77` — pins the empty-state `<option>` markup + `aria-label="Project for this chat"`: **update these pins** to the new picker markup, keep the aria-label.
- `home-composer.test.ts:42` — keep `aria-label="Choose project"` and `value={selectedProjectId}`.
- `projects-view.test.ts:188` — keep `onSubmit={handleCreate}`.
- `chat-view-polish.test.ts:345,350` — keep header order and `Debug session`/`Delete chat` inside `SessionOverflowMenu`.

---

### Task 1: Comux selected-project persistence

**Files:**
- Modify: `src/lib/comux-project-order.ts` (append after `writePinnedProjects`)
- Modify: `src/components/comux-view.tsx:503` state + `:520-523` mount effect
- Test: `src/components/comux-view-selected-project.test.ts` (new)

- [ ] **Step 1: Write the failing source-text test**

```ts
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const comux = readFileSync(join(here, "comux-view.tsx"), "utf8");
const order = readFileSync(join(here, "../lib/comux-project-order.ts"), "utf8");

test("selected project persists to localStorage (cave:comux:selectedProject)", () => {
  assert.match(order, /cave:comux:selectedProject/, "storage key exists");
  assert.match(order, /export function readSelectedProject\(\)/, "read helper exported");
  assert.match(order, /export function writeSelectedProject\(/, "write helper exported");
});

test("comux restores the stored selection after mount and writes on change", () => {
  assert.match(
    comux,
    /readSelectedProject\(\)/,
    "comux seeds selectedProjectRoot from storage (SSR-safe, after mount)",
  );
  assert.match(
    comux,
    /setSelectedProjectRoot\(\(current\) => current \?\? storedSelected\)/,
    "restore never clobbers a selection made before the effect ran",
  );
  assert.match(
    comux,
    /if \(selectedProjectRoot\) writeSelectedProject\(selectedProjectRoot\);/,
    "every selection change persists",
  );
});

console.log("comux-view-selected-project.test.ts OK");
```

- [ ] **Step 2: Run to verify it fails** — `node --test --experimental-strip-types src/components/comux-view-selected-project.test.ts` → FAIL (helpers missing).

- [ ] **Step 3: Implement helpers in `comux-project-order.ts`** (append; mirrors the file's read/write idiom):

```ts
// Last-selected project root — comux state was ephemeral, so a reload bounced
// the code surface back to projects[0] while pins/order survived. One root,
// same SSR-safe read-after-mount contract as the order/pins above.
const SELECTED_KEY = "cave:comux:selectedProject";

export function readSelectedProject(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(SELECTED_KEY);
  } catch {
    return null;
  }
}

export function writeSelectedProject(root: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SELECTED_KEY, root);
  } catch {
    /* quota / private mode — non-fatal */
  }
}
```

- [ ] **Step 4: Wire comux-view.** Extend the existing import from `@/lib/comux-project-order` with `readSelectedProject, writeSelectedProject`. In the mount effect (currently `setPinnedProjects(readPinnedProjects()); setProjectOrder(readProjectOrder());`):

```tsx
  useEffect(() => {
    setPinnedProjects(readPinnedProjects());
    setProjectOrder(readProjectOrder());
    const storedSelected = readSelectedProject();
    if (storedSelected) setSelectedProjectRoot((current) => current ?? storedSelected);
  }, []);
  useEffect(() => {
    if (selectedProjectRoot) writeSelectedProject(selectedProjectRoot);
  }, [selectedProjectRoot]);
```

Check the reconcile effect around comux-view.tsx:654-664 first — if it resets `selectedProjectRoot` when the root is absent from `projects`, leave it; the `?? projects[0]` fallback at :633 already tolerates a stale stored root.

- [ ] **Step 5: Run test to verify it passes.**
- [ ] **Step 6: Wire into `scripts/run-tests.mjs`** — add `"src/components/comux-view-selected-project.test.ts",` to the `app` array next to the other comux/code entries (inside `SUITES`, NOT the `ALIAS_LOADER` set — this test only reads files). Run `pnpm run check:tests-wired` (or the equivalent script) to confirm.
- [ ] **Step 7: Commit** — `git commit -S -m "feat(code): remember the selected project across reloads"` (verify `[feat/unified-project-picker <sha>]` in output; push -u immediately).

### Task 2: Shared `ProjectPicker` + `useAddProjectFlow`

**Files:**
- Create: `src/components/project-picker.tsx`
- Modify: `src/app/globals.css` (append `.cave-project-picker*` block)
- Test: `src/components/project-picker.test.ts` (new)

- [ ] **Step 1: Write the failing source-text test**

```ts
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "project-picker.tsx"), "utf8");
const css = readFileSync(join(here, "../app/globals.css"), "utf8");

test("add flow registers AND grants in one step via addChatProject", () => {
  assert.match(src, /export function useAddProjectFlow\(/, "shared flow exported");
  assert.match(src, /addChatProject\(\{/, "register+grant goes through the tested helper");
  assert.match(src, /shell_pick_directory/, "native folder dialog on desktop");
  assert.match(src, /DirectoryPickerModal/, "web fallback directory browser");
});

test("picker offers No project, the project list, and Add project…", () => {
  assert.match(src, /export function ProjectPicker\(/, "picker exported");
  assert.match(src, /onChange\(NO_PROJECT_ID\);/, "explicit No-project row");
  assert.match(src, /Add project…/, "proactive add affordance");
  assert.match(src, /aria-label="Filter projects"/, "filter input for long lists");
  assert.match(src, /aria-haspopup="dialog"/, "trigger announces the popover");
});

test("picker styles exist", () => {
  assert.match(css, /\.cave-project-picker__trigger/, "trigger styled");
  assert.match(css, /\.cave-project-picker__option-root/, "root subtitle styled");
});

console.log("project-picker.test.ts OK");
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Create `src/components/project-picker.tsx`:**

```tsx
"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/lib/icon";
import {
  Popover,
  PopoverBody,
  PopoverItem,
  PopoverLabel,
  PopoverSeparator,
} from "@/components/ui/popover";
import { DirectoryPickerModal } from "@/components/directory-picker-modal";
import { addChatProject } from "@/lib/chat-add-project";
import { NO_PROJECT_ID } from "@/lib/chat-projects";
import type { CaveProject } from "@/lib/cave-projects";
import { isTauri } from "@/lib/tauri-platform";

/** Sentinel `<option>` value for native selects that embed the add flow. */
export const ADD_PROJECT_ID = "__add-project__";

export type AddProjectFlow = {
  /** Open the folder chooser — native dialog on desktop, in-app browser on web. */
  beginAddProject: () => void;
  /** Render once near the caller's root: the web-fallback directory browser. */
  addProjectModal: ReactNode;
  adding: boolean;
  addError: string | null;
};

/**
 * The one shared add-project flow. Registering a root only makes the access
 * check resolve to a project id; the familiar still needs a grant — so this
 * always goes through addChatProject (register + grant, already unit-tested),
 * the same helper the chat 403-recovery uses. Every entry point is a direct
 * human click, which is what the grant route requires.
 */
export function useAddProjectFlow(args: {
  familiarId: string | null;
  createProject: (name: string, root: string) => Promise<CaveProject | null>;
  projects: CaveProject[];
  onAdded: (projectId: string) => void;
}): AddProjectFlow {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const registerRoot = async (dir: string) => {
    const root = dir.trim();
    if (!root) return;
    setAdding(true);
    setAddError(null);
    const existing = args.projects.find((project) => project.root === root);
    const result = await addChatProject({
      root,
      familiarId: args.familiarId,
      createProject: args.createProject,
      existingProjectId: existing?.id ?? null,
    });
    setAdding(false);
    if (result.ok) args.onAdded(result.projectId);
    else setAddError(result.error);
  };

  const beginAddProject = () => {
    if (isTauri()) {
      void (async () => {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          const picked = await invoke<string | null>("shell_pick_directory");
          if (picked) await registerRoot(picked);
        } catch {
          // Native dialog unavailable on this build — fall back to the web browser.
          setPickerOpen(true);
        }
      })();
      return;
    }
    setPickerOpen(true);
  };

  const addProjectModal = (
    <DirectoryPickerModal
      open={pickerOpen}
      onClose={() => setPickerOpen(false)}
      onSelect={(dir) => {
        setPickerOpen(false);
        void registerRoot(dir);
      }}
    />
  );

  return { beginAddProject, addProjectModal, adding, addError };
}

/**
 * Shared project picker: one trigger chip + popover for every surface that
 * lets the user choose the project a conversation runs in. Replaces the
 * per-surface mix of native selects and ad-hoc lists so selection reads the
 * same everywhere, and folds the add flow in so an empty registry is an
 * onboarding affordance instead of a dead end.
 */
export function ProjectPicker({
  projects,
  value,
  onChange,
  allowNoProject = false,
  familiarId = null,
  createProject,
  disabled = false,
  ariaLabel,
  className,
}: {
  projects: CaveProject[];
  /** Project id, NO_PROJECT_ID, or null (null falls back to the first project). */
  value: string | null;
  onChange: (id: string) => void;
  allowNoProject?: boolean;
  familiarId?: string | null;
  /** From the caller's useProjects(); presence enables the "Add project…" row. */
  createProject?: (name: string, root: string) => Promise<CaveProject | null>;
  disabled?: boolean;
  ariaLabel: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const selected =
    value === NO_PROJECT_ID
      ? null
      : (value ? projects.find((project) => project.id === value) ?? projects[0] : projects[0]) ??
        null;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter(
      (project) =>
        project.name.toLowerCase().includes(q) || project.root.toLowerCase().includes(q),
    );
  }, [projects, query]);

  const close = () => {
    setOpen(false);
    setQuery("");
  };

  const addFlow = useAddProjectFlow({
    familiarId,
    createProject: createProject ?? (async () => null),
    projects,
    onAdded: onChange,
  });

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`cave-project-picker__trigger focus-ring${className ? ` ${className}` : ""}`}
        onClick={() => (open ? close() : setOpen(true))}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        title={selected ? selected.root : "No project"}
      >
        <Icon name={selected ? "ph:folder-open" : "ph:folder"} width={14} aria-hidden />
        <span className="cave-project-picker__trigger-label">
          {selected ? selected.name : "No project"}
        </span>
        <Icon name="ph:caret-up-down-bold" width={10} aria-hidden />
      </button>
      <Popover
        open={open}
        onOpenChange={(next) => (next ? setOpen(true) : close())}
        anchorRef={triggerRef}
        placement="bottom-start"
        minWidth={260}
        className="cave-project-picker__popover"
        ariaLabel={ariaLabel}
      >
        <PopoverBody>
          {projects.length > 6 ? (
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter projects…"
              aria-label="Filter projects"
              className="cave-project-picker__filter focus-ring-inset"
            />
          ) : null}
          <PopoverLabel>Project</PopoverLabel>
          {allowNoProject ? (
            <PopoverItem
              icon={selected ? "ph:folder" : "ph:check"}
              active={!selected}
              onSelect={() => {
                onChange(NO_PROJECT_ID);
                close();
              }}
            >
              No project
            </PopoverItem>
          ) : null}
          {visible.map((entry) => (
            <PopoverItem
              key={entry.id}
              icon={entry.id === selected?.id ? "ph:check" : "ph:folder"}
              active={entry.id === selected?.id}
              onSelect={() => {
                onChange(entry.id);
                close();
              }}
            >
              <span className="cave-project-picker__option">
                <span className="cave-project-picker__option-name">{entry.name}</span>
                <span className="cave-project-picker__option-root">{entry.root}</span>
              </span>
            </PopoverItem>
          ))}
          {query.trim() && visible.length === 0 ? (
            <div className="cave-project-picker__none">No projects match</div>
          ) : null}
          {createProject ? (
            <>
              <PopoverSeparator />
              <PopoverItem
                icon="ph:plus"
                disabled={addFlow.adding}
                onSelect={() => {
                  close();
                  addFlow.beginAddProject();
                }}
              >
                {addFlow.adding ? "Adding project…" : "Add project…"}
              </PopoverItem>
            </>
          ) : null}
        </PopoverBody>
      </Popover>
      {addFlow.addError ? (
        <span className="cave-project-picker__error" role="alert">
          {addFlow.addError}
        </span>
      ) : null}
      {createProject ? addFlow.addProjectModal : null}
    </>
  );
}
```

- [ ] **Step 4: Append styles to `src/app/globals.css`:**

```css
/* ---- Shared project picker (chat empty state, and any surface that adopts it) —
   one trigger-chip + popover treatment for project selection; see
   docs/specs/2026-07-03-unified-project-picker-design.md ---- */
.cave-project-picker__trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 260px;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-2);
  color: var(--foreground);
  font-size: 12px;
  line-height: 1.2;
  cursor: pointer;
}
.cave-project-picker__trigger:hover:not(:disabled) {
  border-color: var(--border-strong);
  background: var(--surface-3);
}
.cave-project-picker__trigger:disabled {
  opacity: 0.55;
  cursor: default;
}
.cave-project-picker__trigger-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cave-project-picker__filter {
  width: calc(100% - 12px);
  margin: 4px 6px 6px;
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface-1);
  color: var(--foreground);
  font-size: 12px;
}
.cave-project-picker__option {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.cave-project-picker__option-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cave-project-picker__option-root {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10.5px;
  color: var(--muted-foreground);
}
.cave-project-picker__none {
  padding: 6px 10px;
  font-size: 12px;
  color: var(--muted-foreground);
}
.cave-project-picker__error {
  display: block;
  margin-top: 4px;
  font-size: 11.5px;
  color: var(--danger, #e5484d);
}
```

Verify the CSS custom properties used (`--border`, `--surface-2`, `--muted-foreground`, …) against the tokens actually defined in globals.css and substitute the project's real token names.

- [ ] **Step 5: Run the test to verify it passes.** Also `pnpm exec tsc --noEmit -p tsconfig.json` (or the repo's `typecheck` script) for the new file.
- [ ] **Step 6: Wire `"src/components/project-picker.test.ts",` into `SUITES.app` in `scripts/run-tests.mjs`** (next to `chat-add-project` / chat component tests; NOT in ALIAS_LOADER — it only reads files).
- [ ] **Step 7: Commit + push** — `git commit -S -m "feat(projects): shared ProjectPicker + one-step add-project flow"`.

### Task 3: Chat — empty state picker, overflow "Add project…"

**Files:**
- Modify: `src/components/chat-view.tsx` (`ChatEmptyState` ~L833-925, `SessionOverflowMenu` ~L932-1044, mount sites ~L4511-4579)
- Modify: `src/components/task-chat-cwd.test.ts` (~L72-83 empty-state pins)

- [ ] **Step 1: Update the pins in `task-chat-cwd.test.ts`** (the select-markup pin ~L72 and around): replace the `projects.map((project) => ( <option …` assertion with:

```ts
  assert.match(
    src,
    /<ProjectPicker[\s\S]*?value=\{projectId \?\? null\}[\s\S]*?onChange=\{onProjectChange\}[\s\S]*?allowNoProject/,
    "empty state renders the shared picker with an explicit No-project choice",
  );
```

Keep the `aria-label="Project for this chat"` pin (~L77) — it moves onto the picker trigger via `ariaLabel`. Adjust its regex if it anchored on `<select`. Run the file → expect FAIL (chat-view unchanged yet).

- [ ] **Step 2: Edit `ChatEmptyState`.** Add `createProject` to props; replace the `{onProjectChange && project && (…<select>…)}` block with the shared picker (keeps the pinned `cave-chat-empty-project` class; drops the `project &&` guard so no-project and zero-project states get the affordance):

```tsx
        {onProjectChange && (
          <div className="cave-chat-empty-project">
            <span className="cave-chat-empty-project-head">
              <Icon name="ph:folder-open" width={14} aria-hidden />
              <span className="cave-chat-empty-project-label">Project</span>
              <ProjectPicker
                projects={projects}
                value={projectId ?? null}
                onChange={onProjectChange}
                allowNoProject
                familiarId={familiar.id}
                createProject={createProject}
                ariaLabel="Project for this chat"
              />
            </span>
            {project ? <span className="cave-chat-empty-project-root">{project.root}</span> : null}
          </div>
        )}
```

Props type additions:

```tsx
  /** From useProjects() — enables the picker's "Add project…" row. */
  createProject?: (name: string, root: string) => Promise<CaveProject | null>;
```

Import `{ ProjectPicker, useAddProjectFlow }` from `@/components/project-picker` at the top of chat-view.tsx.

- [ ] **Step 3: Edit `SessionOverflowMenu`.** Add `onAddProject?: () => void` to props. Restructure the project section so "Add project…" shows even with zero projects, WITHOUT breaking the two pinned regexes (label→No-project→map order stays):

```tsx
          {projects.length > 0 || onAddProject ? (
            <>
              <PopoverLabel>Project</PopoverLabel>
              {projects.length > 0 ? (
                <>
                  <PopoverItem
                    icon={activeProject ? "ph:folder" : "ph:check"}
                    active={!activeProject}
                    onSelect={() => {
                      onProjectChange(NO_PROJECT_ID);
                      close();
                    }}
                  >
                    No project
                  </PopoverItem>
                  {projects.map((entry) => (
                    <PopoverItem
                      key={entry.id}
                      icon={entry.id === activeProject?.id ? "ph:check" : "ph:folder"}
                      active={entry.id === activeProject?.id}
                      onSelect={() => {
                        onProjectChange(entry.id);
                        close();
                      }}
                    >
                      {entry.name}
                    </PopoverItem>
                  ))}
                </>
              ) : null}
              {onAddProject ? (
                <PopoverItem
                  icon="ph:plus"
                  onSelect={() => {
                    onAddProject();
                    close();
                  }}
                >
                  Add project…
                </PopoverItem>
              ) : null}
              <PopoverSeparator />
            </>
          ) : null}
```

- [ ] **Step 4: Instantiate the shared flow in ChatView** (near the `useProjects()` call ~L2262):

```tsx
  // Shared add-project flow for the overflow menu: register + grant, then make
  // the new project this chat's next-send selection.
  const overflowAddProject = useAddProjectFlow({
    familiarId: familiar?.id ?? null,
    createProject,
    projects,
    onAdded: (projectId) => {
      setProjectIdDraft(projectId);
      reloadProjects();
    },
  });
```

Mount-site changes: pass `onAddProject={overflowAddProject.beginAddProject}` to `<SessionOverflowMenu>`, `createProject={createProject}` to `<ChatEmptyState>`, and render `{overflowAddProject.addProjectModal}` adjacent to the overflow-menu mount (inside the same fragment). Keep the pinned `projectId={projectIdDraft}` / `onProjectChange={setProjectIdDraft}` props untouched.

- [ ] **Step 5: Run the chat pin suites:**
`node --test --experimental-strip-types src/components/task-chat-cwd.test.ts src/components/chat-surface-polish.test.ts src/components/chat-view-polish.test.ts src/components/chat-sidebar-wiring.test.ts` → all PASS. (`chat-view.test.ts` needs the alias loader: run it via `node scripts/run-tests.mjs app` later or with `--import ./scripts/test-alias-register.mjs`.)
- [ ] **Step 6: Commit + push** — `git commit -S -m "feat(chat): shared project picker in empty state + proactive add-project in overflow"`.

### Task 4: Home composer — No-project + Add-project options

**Files:**
- Modify: `src/components/home-composer.tsx` (~L197 hook, ~L205-207 selectedProject, ~L224-227 reset effect, ~L1074-1094 select)
- Modify: `src/components/home-composer.test.ts` (add pins)

- [ ] **Step 1: Add failing pins to `home-composer.test.ts`:**

```ts
test("project select offers No project and Add project…", () => {
  assert.match(src, /<option value=\{NO_PROJECT_ID\}>No project<\/option>/, "explicit no-project choice");
  assert.match(src, /ADD_PROJECT_ID/, "add-project sentinel option");
  assert.match(src, /beginAddProject\(\)/, "sentinel opens the shared add flow");
});
```

(Match the file's existing test/assert idiom; `src` there already reads `./home-composer.tsx`.) Run → FAIL.

- [ ] **Step 2: Implement.** Imports: `NO_PROJECT_ID` from `@/lib/chat-projects`; `ADD_PROJECT_ID, useAddProjectFlow` from `@/components/project-picker`. Destructure `createProject` from the existing `useProjects({ familiarId: … })` call. Add the flow:

```tsx
  const addProjectFlow = useAddProjectFlow({
    familiarId: selectedFamiliarId || null,
    createProject,
    projects,
    onAdded: setSelectedProjectId,
  });
```

`selectedProject` derivation becomes null-aware (keep the `?? projects[0] ?? null` fallback for ordinary ids):

```tsx
  const selectedProject =
    selectedProjectId === NO_PROJECT_ID
      ? null
      : projects.find((project) => project.id === selectedProjectId) ?? projects[0] ?? null;
```

The reset effect (~L224-227) must treat the sentinel as valid — do not reset `selectedProjectId` when it equals `NO_PROJECT_ID`.

Select block: keep `aria-label="Choose project"` + `value={selectedProjectId}` (pinned); intercept the sentinel; stay enabled at zero projects so the add flow is reachable:

```tsx
              <select
                aria-label="Choose project"
                className="hc-familiar-select"
                value={selectedProjectId}
                onChange={(e) => {
                  const value = e.currentTarget.value;
                  if (value === ADD_PROJECT_ID) {
                    addProjectFlow.beginAddProject();
                    return;
                  }
                  setSelectedProjectId(value);
                }}
                disabled={sending}
              >
                {projects.length === 0 ? (
                  <option value="">No projects yet</option>
                ) : (
                  <>
                    <option value={NO_PROJECT_ID}>No project</option>
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </>
                )}
                <option value={ADD_PROJECT_ID}>＋ Add project…</option>
              </select>
```

Render `{addProjectFlow.addProjectModal}` once near the composer's other modals/overlays.

- [ ] **Step 3: Run `home-composer.test.ts`** → PASS (old pins included).
- [ ] **Step 4: Commit + push** — `git commit -S -m "feat(home): No-project choice + inline add-project in the composer"`.

### Task 5: Projects view — grant on create

**Files:**
- Modify: `src/components/projects-view.tsx` (`handleCreate` ~L265-280; import)
- Modify: `src/components/projects-view.test.ts` (add pin)

- [ ] **Step 1: Add failing pin:**

```ts
test("creating a project also grants it to the scoped familiar", () => {
  assert.match(
    src,
    /addChatProject\(\{[\s\S]*?familiarId: activeFamiliarId,[\s\S]*?existingProjectId: project\.id/,
    "register-then-grant goes through the tested helper, keyed to the fresh project",
  );
});
```

Run → FAIL.

- [ ] **Step 2: Implement.** `import { addChatProject } from "@/lib/chat-add-project";` and extend `handleCreate` (name stays — pinned as the form's onSubmit):

```tsx
  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = nameDraft.trim();
    const root = rootDraft.trim();
    if (!name || !root) return;
    setCreating(true);
    const project = await createProject(name, root);
    if (project && activeFamiliarId) {
      // Register alone leaves the project 403ing in chat for this familiar —
      // grant it here so "New project" is usable the moment it's created.
      const granted = await addChatProject({
        root,
        familiarId: activeFamiliarId,
        createProject,
        existingProjectId: project.id,
      });
      if (!granted.ok) setSessionError(`Project created, but grant failed: ${granted.error}`);
    }
    setCreating(false);
    if (!project) return;
    setNameDraft("");
    setRootDraft("");
    setShowForm(false);
    setCreatedProject(project);
    setExpanded(project.id, true);
    setQuery("");
  };
```

- [ ] **Step 3: Run `projects-view.test.ts`** → PASS.
- [ ] **Step 4: Commit + push** — `git commit -S -m "fix(projects): grant on create so new projects work in chat immediately"`.

### Task 6: Full verification

- [ ] `node scripts/run-tests.mjs app && node scripts/run-tests.mjs api && node scripts/run-tests.mjs mobile` (or the repo's `pnpm test:app` etc. — match `Frontend build`'s sequence: typecheck → check:tests-wired → test:app/api/mobile → build).
- [ ] `pnpm build` in the worktree.
- [ ] Visual sanity via the run-cave-app skill if time permits: chat empty state shows the picker (incl. a no-project chat), overflow menu shows "Add project…", home select lists No project / Add project.
- [ ] Fix anything found; commit + push each fix signed.

### Task 7: PR

- [ ] `git log origin/feat/unified-project-picker..HEAD --pretty='%H %G?'` — nothing unsigned; branch name verified in every commit output.
- [ ] `gh pr create --base main --head feat/unified-project-picker` with a body covering the five pain points fixed; wait for ALL SIX required checks (Frontend build, Rust check, CodeQL aggregate, E2E, Cross-environment required, Sidecar runtime required — aggregates report late); `gh pr view --json state` must be MERGED before any cleanup; then `git worktree remove` + `git branch -D`.

## Self-review notes

- Spec coverage: empty-state picker (T3), overflow add (T3), home options (T4), grant-on-create (T5), comux persistence (T1), shared component+flow (T2) — all design sections have tasks; "out of scope" items have none, by design.
- Types: `useAddProjectFlow` returns `AddProjectFlow`; `ProjectPicker.value: string | null`; `createProject` signature `(name, root) => Promise<CaveProject | null>` matches `use-projects.ts` everywhere it's threaded.
- Line numbers are anchors, not gospel — main moved (#2301-#2303); re-locate blocks by content before editing.
