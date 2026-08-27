# Canvas GitHub Import Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dense Canvas GitHub importer with a progressive, truthful flow that asks for a file URL first, automatically connects a compatible Cave project, and requests a local checkout only when registration is necessary.

**Architecture:** Keep the existing single-file import and provenance pipeline; do not add repository cloning or imply that a branch or pull request is created during import. Extract client-safe file/project compatibility rules into a pure module, use those rules in both the API route and modal, then verify the interaction with source-contract tests and daemon-less Playwright.

**Tech Stack:** Next.js App Router, React 19, TypeScript, shared `Modal`/`Button`/`StandardSelect` primitives, Tauri directory dialog, Node test runner, Playwright.

---

## Scope and interaction contract

This is one UI subsystem and does not need to be split into separate plans.

The shipped behavior must follow these rules:

- The dialog title is **Import GitHub file** because the backend imports one file, not a repository.
- The initial state shows only the explanation and **GitHub file URL** field.
- A valid supported blob URL reveals a compact file summary and project section.
- Invalid URLs and unsupported extensions fail beside the URL field before submission.
- Projects already linked to the repository are preferred automatically.
- Unlinked projects remain selectable because the existing mutation can link them.
- Projects linked to another repository are omitted instead of being selectable and failing later.
- If no linked project exists, default to **Register local checkout**.
- Registration asks only for the local checkout path; the project name is the GitHub repository name.
- The desktop app offers **Browse…** through `shell_pick_directory`; browser builds retain the typed path field.
- The copy says Canvas does not clone repositories.
- The primary action says **Load `<filename>`**, because the next screen still requires **Add to Canvas**.
- Loading, error, focus trapping, Escape/backdrop gating, announcements, provenance, and project-link mutations retain their current behavior.
- The old `GitHub file → Cave project → Sketch branch → Pull request` strip is removed because no branch or pull request is created by this action.

## File structure

| File | Responsibility |
|---|---|
| `src/lib/canvas-github-import.ts` | Pure supported-file and compatible-project decisions shared by route and modal. |
| `src/lib/canvas-github-import.test.ts` | Unit coverage for extensions, project partitioning, default choice, and filename derivation. |
| `src/app/api/canvas/github-source/route.ts` | Reuse the shared supported-file predicate; preserve fetch/auth/size behavior. |
| `src/components/canvas-github-import-modal.tsx` | Progressive disclosure, automatic project choice, compact source summary, native folder browse, submission. |
| `src/components/canvas-github-import-modal.test.ts` | Source contract for truthful copy, disclosure wiring, accessibility, and removed misleading workflow. |
| `src/styles/chat-canvas.css` | Compact source/project cards, folder row, hints, errors, responsive behavior. |
| `src/components/canvas-github-import-styles.test.ts` | Token and responsive source contract for the modal styles. |
| `tests/canvas-github-import.spec.ts` | End-to-end linked-project and new-project flows with mocked APIs. |
| `scripts/run-tests.mjs` | Register the three new app-suite unit/source-contract tests. |

### Task 1: Centralize import compatibility rules

**Files:**
- Create: `src/lib/canvas-github-import.ts`
- Create: `src/lib/canvas-github-import.test.ts`
- Modify: `src/app/api/canvas/github-source/route.ts:1-40`
- Modify: `scripts/run-tests.mjs` in the `app` suite list

- [ ] **Step 1: Write the failing pure-model test**

Create `src/lib/canvas-github-import.test.ts`:

```ts
import assert from "node:assert/strict";

import {
  CREATE_CANVAS_IMPORT_PROJECT,
  canvasGitHubImportFileName,
  canvasImportProjectGroups,
  defaultCanvasImportProjectChoice,
  isSupportedCanvasGitHubFile,
} from "./canvas-github-import.ts";
import type { CaveProject } from "./cave-projects-types.ts";
import type { GitHubFileLocation } from "./github-repo-link.ts";

const source: GitHubFileLocation = {
  owner: "OpenCoven",
  repo: "coven-cave",
  ref: "main",
  filePath: "src/App.tsx",
  repoUrl: "https://github.com/OpenCoven/coven-cave",
  sourceUrl: "https://github.com/OpenCoven/coven-cave/blob/main/src/App.tsx",
};

const project = (
  id: string,
  name: string,
  repoUrl?: string,
): CaveProject => ({
  id,
  name,
  root: `/work/${id}`,
  ...(repoUrl ? { repoUrl } : {}),
  createdAt: "2026-08-24T00:00:00.000Z",
  updatedAt: "2026-08-24T00:00:00.000Z",
});

assert.equal(isSupportedCanvasGitHubFile("page.html"), true);
assert.equal(isSupportedCanvasGitHubFile("page.htm"), true);
assert.equal(isSupportedCanvasGitHubFile("src/App.jsx"), true);
assert.equal(isSupportedCanvasGitHubFile("src/App.tsx"), true);
assert.equal(isSupportedCanvasGitHubFile("README.md"), false);
assert.equal(isSupportedCanvasGitHubFile("src/App.ts"), false);

const linked = project(
  "linked",
  "Coven Cave",
  "https://github.com/opencoven/coven-cave",
);
const unlinked = project("unlinked", "Local checkout");
const mismatched = project(
  "other",
  "Other repository",
  "https://github.com/OpenCoven/other",
);

assert.deepEqual(
  canvasImportProjectGroups([mismatched, unlinked, linked], source),
  {
    linked: [linked],
    unlinked: [unlinked],
  },
);
assert.equal(
  defaultCanvasImportProjectChoice([mismatched, unlinked, linked], source),
  "linked",
);
assert.equal(
  defaultCanvasImportProjectChoice([mismatched, unlinked], source),
  CREATE_CANVAS_IMPORT_PROJECT,
);
assert.equal(canvasGitHubImportFileName(source), "App.tsx");

console.log("canvas GitHub import model: ok");
```

- [ ] **Step 2: Register the test and verify it fails**

Add this path beside the other Canvas app tests in `scripts/run-tests.mjs`:

```js
"src/lib/canvas-github-import.test.ts",
```

Run:

```bash
node --experimental-strip-types src/lib/canvas-github-import.test.ts
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `canvas-github-import.ts`.

- [ ] **Step 3: Implement the pure model**

Create `src/lib/canvas-github-import.ts`:

```ts
import {
  sortProjectsAlphabetically,
  type CaveProject,
} from "./cave-projects-types.ts";
import {
  gitHubRepoSlug,
  type GitHubFileLocation,
} from "./github-repo-link.ts";

export const CREATE_CANVAS_IMPORT_PROJECT = "__create_canvas_import_project__";

const SUPPORTED_CANVAS_GITHUB_FILE = /\.(?:html?|jsx|tsx)$/i;

export type CanvasImportProjectGroups = {
  linked: CaveProject[];
  unlinked: CaveProject[];
};

export function isSupportedCanvasGitHubFile(filePath: string): boolean {
  return SUPPORTED_CANVAS_GITHUB_FILE.test(filePath);
}

export function canvasGitHubImportFileName(
  source: GitHubFileLocation,
): string {
  return source.filePath.split("/").at(-1) || source.repo;
}

export function canvasImportProjectGroups(
  projects: CaveProject[],
  source: GitHubFileLocation,
): CanvasImportProjectGroups {
  const sourceSlug = `${source.owner}/${source.repo}`.toLowerCase();
  const linked: CaveProject[] = [];
  const unlinked: CaveProject[] = [];

  for (const project of sortProjectsAlphabetically(projects)) {
    if (!project.repoUrl) {
      unlinked.push(project);
      continue;
    }
    if (gitHubRepoSlug(project.repoUrl)?.toLowerCase() === sourceSlug) {
      linked.push(project);
    }
  }

  return { linked, unlinked };
}

export function defaultCanvasImportProjectChoice(
  projects: CaveProject[],
  source: GitHubFileLocation,
): string {
  return (
    canvasImportProjectGroups(projects, source).linked[0]?.id ??
    CREATE_CANVAS_IMPORT_PROJECT
  );
}
```

- [ ] **Step 4: Reuse the supported-file predicate in the API route**

In `src/app/api/canvas/github-source/route.ts`, add:

```ts
import { isSupportedCanvasGitHubFile } from "@/lib/canvas-github-import";
```

Delete:

```ts
const SUPPORTED_FILE = /\.(?:html?|jsx|tsx)$/i;
```

Replace:

```ts
if (!SUPPORTED_FILE.test(parsed.filePath)) {
```

with:

```ts
if (!isSupportedCanvasGitHubFile(parsed.filePath)) {
```

- [ ] **Step 5: Run the focused tests**

Run:

```bash
node --experimental-strip-types src/lib/canvas-github-import.test.ts
pnpm check:tests-wired
```

Expected:

```text
canvas GitHub import model: ok
✓ all test files wired into CI
```

- [ ] **Step 6: Commit the model**

```bash
git add \
  src/lib/canvas-github-import.ts \
  src/lib/canvas-github-import.test.ts \
  src/app/api/canvas/github-source/route.ts \
  scripts/run-tests.mjs
git commit -m "refactor(canvas): centralize GitHub import rules"
```

### Task 2: Rebuild the modal around progressive disclosure

**Files:**
- Create: `src/components/canvas-github-import-modal.test.ts`
- Modify: `src/components/canvas-github-import-modal.tsx:1-220`
- Modify: `scripts/run-tests.mjs` in the `app` suite list

- [ ] **Step 1: Write the failing modal source contract**

Create `src/components/canvas-github-import-modal.test.ts`:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const modal = readFileSync(
  "src/components/canvas-github-import-modal.tsx",
  "utf8",
);

assert.match(
  modal,
  /breadcrumb=\{\["Canvas", "Import GitHub file"\]\}/,
  "the dialog truthfully names the single-file operation",
);
assert.match(
  modal,
  /You’ll review it in Canvas before saving\./,
  "the intro explains that loading is not the final Canvas save",
);
assert.match(
  modal,
  /isSupportedCanvasGitHubFile\(parsed\.filePath\)/,
  "unsupported extensions are rejected before submission",
);
assert.match(
  modal,
  /canvasImportProjectGroups\(projects, parsed\)/,
  "the project list is limited to linked or linkable projects",
);
assert.match(
  modal,
  /defaultCanvasImportProjectChoice\(projects, parsed\)/,
  "a repository-linked project is selected automatically",
);
assert.match(
  modal,
  /createProjectOrThrow\(\s*parsed\.repo,\s*projectRoot\.trim\(\),\s*\{ repoUrl: parsed\.repoUrl \},\s*\)/,
  "new projects derive their name from the repository and require only a root",
);
assert.match(
  modal,
  /shell_pick_directory/,
  "the desktop path uses the native folder dialog",
);
assert.match(
  modal,
  /Canvas doesn’t clone repositories\./,
  "the local-checkout requirement is explicit",
);
assert.match(
  modal,
  /\{busy \? "Loading…" : `Load \$\{fileName\}`\}/,
  "the primary action describes the actual next step",
);
assert.match(
  modal,
  /aria-invalid=\{Boolean\(sourceError\) \|\| undefined\}/,
  "URL validation is exposed to assistive technology",
);
assert.match(
  modal,
  /role="alert"/,
  "submission failures remain assertive",
);
assert.doesNotMatch(
  modal,
  /Sketch branch|Pull request/,
  "the modal does not promise workflow steps it does not perform",
);
assert.doesNotMatch(
  modal,
  />Project name</,
  "repository registration does not ask for a redundant project name",
);

console.log("canvas GitHub import modal contract: ok");
```

Register it in `scripts/run-tests.mjs`:

```js
"src/components/canvas-github-import-modal.test.ts",
```

- [ ] **Step 2: Run the contract and verify it fails**

Run:

```bash
node --experimental-strip-types src/components/canvas-github-import-modal.test.ts
```

Expected: FAIL on the old breadcrumb and misleading workflow strip.

- [ ] **Step 3: Replace the modal implementation**

Replace `src/components/canvas-github-import-modal.tsx` with:

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { useAnnouncer } from "@/components/ui/live-region";
import { Modal } from "@/components/ui/modal";
import { StandardSelect } from "@/components/ui/select";
import type { CanvasArtifactSource } from "@/lib/canvas-artifacts";
import {
  CREATE_CANVAS_IMPORT_PROJECT,
  canvasGitHubImportFileName,
  canvasImportProjectGroups,
  defaultCanvasImportProjectChoice,
  isSupportedCanvasGitHubFile,
} from "@/lib/canvas-github-import";
import {
  gitHubRepoSlug,
  parseGitHubFileUrl,
} from "@/lib/github-repo-link";
import { Icon } from "@/lib/icon";
import { isTauri } from "@/lib/tauri-platform";
import { useProjects } from "@/lib/use-projects";

type ImportedGitHubSketch = {
  code: string;
  title: string;
  source: CanvasArtifactSource;
};

export function CanvasGitHubImportModal({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported: (result: ImportedGitHubSketch) => void;
}) {
  const { announce } = useAnnouncer();
  const {
    projects,
    loading: projectsLoading,
    createProjectOrThrow,
    updateRepoUrl,
  } = useProjects({ enabled: open });
  const [fileUrl, setFileUrl] = useState("");
  const [fileUrlBlurred, setFileUrlBlurred] = useState(false);
  const [projectChoice, setProjectChoice] = useState(
    CREATE_CANVAS_IMPORT_PROJECT,
  );
  const [projectChoiceTouched, setProjectChoiceTouched] = useState(false);
  const [projectRoot, setProjectRoot] = useState("");
  const [nativeFolderPickerAvailable, setNativeFolderPickerAvailable] =
    useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(() => parseGitHubFileUrl(fileUrl), [fileUrl]);
  const supported = parsed
    ? isSupportedCanvasGitHubFile(parsed.filePath)
    : false;
  const sourceReady = Boolean(parsed && supported);
  const fileName = parsed ? canvasGitHubImportFileName(parsed) : "file";
  const projectGroups = useMemo(
    () =>
      parsed
        ? canvasImportProjectGroups(projects, parsed)
        : { linked: [], unlinked: [] },
    [parsed, projects],
  );
  const compatibleProjects = [
    ...projectGroups.linked,
    ...projectGroups.unlinked,
  ];
  const selectedProject =
    compatibleProjects.find((project) => project.id === projectChoice) ?? null;
  const creatingProject =
    projectChoice === CREATE_CANVAS_IMPORT_PROJECT;
  const sourceError =
    fileUrlBlurred && fileUrl.trim()
      ? !parsed
        ? "Paste a GitHub blob URL, such as github.com/owner/repo/blob/main/src/App.tsx."
        : !supported
          ? "Canvas can import HTML, HTM, JSX, or TSX files."
          : null
      : null;
  const projectReady = creatingProject
    ? Boolean(projectRoot.trim())
    : Boolean(selectedProject);
  const canSubmit =
    sourceReady && projectReady && !projectsLoading && !busy;

  useEffect(() => {
    if (!open) return;
    setFileUrl("");
    setFileUrlBlurred(false);
    setProjectChoice(CREATE_CANVAS_IMPORT_PROJECT);
    setProjectChoiceTouched(false);
    setProjectRoot("");
    setNativeFolderPickerAvailable(isTauri());
    setBusy(false);
    setError(null);
  }, [open]);

  const repositoryKey = parsed
    ? `${parsed.owner}/${parsed.repo}`.toLowerCase()
    : null;

  useEffect(() => {
    setProjectChoiceTouched(false);
    setProjectRoot("");
    setError(null);
  }, [repositoryKey]);

  useEffect(() => {
    if (
      !parsed ||
      projectsLoading ||
      projectChoiceTouched
    ) {
      return;
    }
    setProjectChoice(defaultCanvasImportProjectChoice(projects, parsed));
  }, [parsed, projectChoiceTouched, projects, projectsLoading]);

  const browseForProjectRoot = async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const picked = await invoke<string | null>("shell_pick_directory");
      if (picked) {
        setProjectRoot(picked);
        setError(null);
      }
    } catch {
      setError(
        "Couldn’t open the folder picker. Enter the local checkout path.",
      );
    }
  };

  const submit = async () => {
    if (!parsed || !supported || busy) return;
    setFileUrlBlurred(true);
    if (!projectReady) {
      setError(
        creatingProject
          ? "Enter the local checkout for this repository."
          : "Choose a Cave project.",
      );
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const sourceResponse = await fetch("/api/canvas/github-source", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: fileUrl }),
      });
      const sourceData = (await sourceResponse.json().catch(() => null)) as {
        error?: string;
        code?: string;
        title?: string;
        source?: Omit<CanvasArtifactSource, "projectId">;
      } | null;
      if (!sourceResponse.ok || !sourceData?.code || !sourceData.source) {
        throw new Error(
          sourceData?.error ??
            `GitHub import failed (${sourceResponse.status}).`,
        );
      }

      let project = selectedProject;
      if (creatingProject) {
        project = await createProjectOrThrow(
          parsed.repo,
          projectRoot.trim(),
          { repoUrl: parsed.repoUrl },
        );
      } else if (project && !project.repoUrl) {
        const linked = await updateRepoUrl(project.id, parsed.repoUrl);
        if (!linked) {
          throw new Error(
            "The file loaded, but the Cave project couldn’t be linked to its repository.",
          );
        }
        project = { ...project, repoUrl: parsed.repoUrl };
      }
      if (!project) throw new Error("Choose or register a Cave project.");

      onImported({
        code: sourceData.code,
        title:
          sourceData.title ||
          parsed.filePath.split("/").at(-1) ||
          "GitHub sketch",
        source: { ...sourceData.source, projectId: project.id },
      });
      announce(`Loaded ${parsed.filePath} from GitHub.`);
      onClose();
    } catch (caught) {
      const message =
        caught instanceof Error
          ? caught.message
          : "Couldn’t load that GitHub file.";
      setError(message);
      announce(message, "assertive");
    } finally {
      setBusy(false);
    }
  };

  const projectOptions = [
    ...(projectGroups.linked.length
      ? [{
          label: "Linked to this repository",
          options: projectGroups.linked.map((project) => ({
            value: project.id,
            label: project.name,
            detail: project.root,
            icon: "ph:check-circle-fill" as const,
          })),
        }]
      : []),
    ...(projectGroups.unlinked.length
      ? [{
          label: "Available to link",
          options: projectGroups.unlinked.map((project) => ({
            value: project.id,
            label: project.name,
            detail: project.root,
            icon: "ph:folder" as const,
          })),
        }]
      : []),
    {
      value: CREATE_CANVAS_IMPORT_PROJECT,
      label: "Register local checkout",
      detail: parsed
        ? `Add ${parsed.owner}/${parsed.repo} from a folder on this Mac.`
        : "Register an existing local checkout.",
      icon: "ph:folder-plus" as const,
    },
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      breadcrumb={["Canvas", "Import GitHub file"]}
      ariaDescribedBy="canvas-github-import-description"
      dismissOnBackdrop={!busy}
      dismissOnEscape={!busy}
      footerActions={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            leadingIcon="ph:download-simple"
            onClick={() => void submit()}
            disabled={!canSubmit}
          >
            {busy ? "Loading…" : `Load ${fileName}`}
          </Button>
        </>
      )}
    >
      <div className="canvas-github-import">
        <p
          id="canvas-github-import-description"
          className="canvas-github-import__intro"
        >
          Paste a link to one HTML or React file. You’ll review it in Canvas
          before saving.
        </p>

        <label className="canvas-github-import__field">
          <span>GitHub file URL</span>
          <input
            className="focus-ring"
            value={fileUrl}
            onChange={(event) => {
              setFileUrl(event.target.value);
              setFileUrlBlurred(false);
              setError(null);
            }}
            onBlur={() => setFileUrlBlurred(true)}
            placeholder="https://github.com/owner/repo/blob/main/src/App.tsx"
            inputMode="url"
            autoComplete="url"
            autoFocus
            aria-invalid={Boolean(sourceError) || undefined}
            aria-describedby={
              sourceError
                ? "canvas-github-import-url-error"
                : "canvas-github-import-url-help"
            }
          />
          {sourceError ? (
            <small
              id="canvas-github-import-url-error"
              className="canvas-github-import__field-error"
            >
              {sourceError}
            </small>
          ) : (
            <small id="canvas-github-import-url-help">
              Use the file’s GitHub <strong>blob</strong> URL.
            </small>
          )}
        </label>

        {parsed && supported ? (
          <>
            <div
              className="canvas-github-import__source"
              role="status"
              aria-label="GitHub file ready"
            >
              <span className="canvas-github-import__source-icon">
                <Icon name="ph:github-logo" aria-hidden />
              </span>
              <span className="canvas-github-import__source-copy">
                <strong>{fileName}</strong>
                <span>
                  {parsed.owner}/{parsed.repo} · {parsed.ref}
                </span>
                <code>{parsed.filePath}</code>
              </span>
              <Icon
                name="ph:check-circle-fill"
                className="canvas-github-import__source-ready"
                aria-hidden
              />
            </div>

            <section
              className="canvas-github-import__section"
              aria-labelledby="canvas-github-import-project-heading"
            >
              <div className="canvas-github-import__section-heading">
                <h3 id="canvas-github-import-project-heading">
                  Connect a Cave project
                </h3>
                <p>
                  Canvas uses the local checkout for later commits and pull
                  requests.
                </p>
              </div>

              <label className="canvas-github-import__field">
                <span>Cave project</span>
                <StandardSelect
                  label="Cave project"
                  value={projectChoice}
                  onChange={(value) => {
                    setProjectChoice(value);
                    setProjectChoiceTouched(true);
                    setError(null);
                  }}
                  options={projectOptions}
                  disabled={projectsLoading}
                  placeholder={
                    projectsLoading
                      ? "Loading projects…"
                      : "Choose a project"
                  }
                />
                {selectedProject?.repoUrl ? (
                  <small>
                    Linked to{" "}
                    {gitHubRepoSlug(selectedProject.repoUrl) ??
                      selectedProject.repoUrl}
                  </small>
                ) : selectedProject ? (
                  <small>
                    This import will link {selectedProject.name} to{" "}
                    {parsed.owner}/{parsed.repo}.
                  </small>
                ) : null}
              </label>

              {creatingProject ? (
                <label className="canvas-github-import__field">
                  <span>Local checkout</span>
                  <span className="canvas-github-import__folder">
                    <input
                      className="focus-ring"
                      value={projectRoot}
                      onChange={(event) => {
                        setProjectRoot(event.target.value);
                        setError(null);
                      }}
                      placeholder="/Users/you/code/project"
                    />
                    {nativeFolderPickerAvailable ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        leadingIcon="ph:folder-open"
                        onClick={() => void browseForProjectRoot()}
                      >
                        Browse…
                      </Button>
                    ) : null}
                  </span>
                  <small>
                    Choose an existing checkout for {parsed.owner}/{parsed.repo}.
                    Canvas doesn’t clone repositories.
                  </small>
                </label>
              ) : null}
            </section>
          </>
        ) : null}

        {error ? (
          <div className="canvas-github-import__error" role="alert">
            {error}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
```

- [ ] **Step 4: Run the modal contract and typecheck**

Run:

```bash
node --experimental-strip-types src/components/canvas-github-import-modal.test.ts
pnpm exec tsc --noEmit --pretty false
```

Expected:

```text
canvas GitHub import modal contract: ok
```

TypeScript must report no errors. `ph:folder-plus`, `ph:folder-open`, and `ph:check-circle-fill` already exist in `src/lib/icon.tsx`, so this work does not regenerate the icon subset.

- [ ] **Step 5: Commit the interaction**

```bash
git add \
  src/components/canvas-github-import-modal.tsx \
  src/components/canvas-github-import-modal.test.ts \
  scripts/run-tests.mjs
git commit -m "feat(canvas): simplify GitHub file import"
```

### Task 3: Replace the dense workflow strip with compact modal styling

**Files:**
- Create: `src/components/canvas-github-import-styles.test.ts`
- Modify: `src/styles/chat-canvas.css:634-708`
- Modify: `scripts/run-tests.mjs` in the `app` suite list

- [ ] **Step 1: Write the failing style contract**

Create `src/components/canvas-github-import-styles.test.ts`:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync("src/styles/chat-canvas.css", "utf8");

assert.match(
  css,
  /\.canvas-github-import__source\s*\{[\s\S]*?border:\s*1px solid var\(--border-hairline\)/,
  "the parsed file renders as a solid content card",
);
assert.match(
  css,
  /\.canvas-github-import__section\s*\{[\s\S]*?background:\s*var\(--bg-sunken\)/,
  "project resolution is grouped in one recessed section",
);
assert.match(
  css,
  /\.canvas-github-import__folder\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) auto/,
  "the local path and Browse action share one compact row",
);
assert.match(
  css,
  /\.canvas-github-import__field-error\s*\{[\s\S]*?color:\s*var\(--danger-text\)/,
  "field errors use the semantic danger token",
);
assert.match(
  css,
  /@media \(max-width: 640px\)[\s\S]*?\.canvas-github-import__folder\s*\{[\s\S]*?grid-template-columns:\s*1fr/,
  "the folder row stacks on narrow screens",
);
assert.doesNotMatch(
  css,
  /\.canvas-github-import__route/,
  "the misleading delivery pipeline styling is removed",
);

console.log("canvas GitHub import styles: ok");
```

Register it in `scripts/run-tests.mjs`:

```js
"src/components/canvas-github-import-styles.test.ts",
```

- [ ] **Step 2: Run the style contract and verify it fails**

Run:

```bash
node --experimental-strip-types src/components/canvas-github-import-styles.test.ts
```

Expected: FAIL because the old `__route` styles still exist.

- [ ] **Step 3: Replace the modal CSS block**

Replace the existing `.canvas-github-import` block through its `@media (max-width: 640px)` block in `src/styles/chat-canvas.css` with:

```css
.canvas-github-import {
  display: grid;
  gap: var(--space-4);
}

.canvas-github-import__intro {
  margin: 0;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  line-height: 1.5;
}

.canvas-github-import__field {
  display: grid;
  gap: var(--space-2);
  color: var(--text-secondary);
  font-size: var(--text-xs);
  font-weight: 600;
}

.canvas-github-import__field input {
  width: 100%;
  min-width: 0;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-control);
  background: var(--bg-sunken);
  color: var(--text-primary);
  font: inherit;
  font-size: var(--text-sm);
  font-weight: 400;
  padding: var(--space-2) var(--space-3);
}

.canvas-github-import__field input::placeholder {
  color: var(--text-muted);
}

.canvas-github-import__field small {
  color: var(--text-muted);
  font-size: var(--text-2xs);
  font-weight: 400;
  line-height: 1.4;
}

.canvas-github-import__field-error {
  color: var(--danger-text);
}

.canvas-github-import__source {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-3);
  border: 1px solid var(--border-hairline);
  border-radius: var(--radius-card);
  background: var(--bg-raised);
  padding: var(--space-3);
}

.canvas-github-import__source-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--space-8);
  height: var(--space-8);
  border-radius: var(--radius-pill);
  background: var(--bg-subtle);
  color: var(--text-primary);
}

.canvas-github-import__source-copy {
  display: grid;
  min-width: 0;
  gap: var(--space-1);
}

.canvas-github-import__source-copy strong {
  overflow: hidden;
  color: var(--text-primary);
  font-size: var(--text-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.canvas-github-import__source-copy span,
.canvas-github-import__source-copy code {
  overflow: hidden;
  color: var(--text-muted);
  font-family: var(--font-mono), ui-monospace, monospace;
  font-size: var(--text-2xs);
  font-weight: 400;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.canvas-github-import__source-ready {
  color: var(--color-success);
}

.canvas-github-import__section {
  display: grid;
  gap: var(--space-4);
  border: 1px solid var(--border-hairline);
  border-radius: var(--radius-card);
  background: var(--bg-sunken);
  padding: var(--space-4);
}

.canvas-github-import__section-heading {
  display: grid;
  gap: var(--space-1);
}

.canvas-github-import__section-heading h3,
.canvas-github-import__section-heading p {
  margin: 0;
}

.canvas-github-import__section-heading h3 {
  color: var(--text-primary);
  font-size: var(--text-sm);
  font-weight: 600;
}

.canvas-github-import__section-heading p {
  color: var(--text-muted);
  font-size: var(--text-xs);
  line-height: 1.4;
}

.canvas-github-import__folder {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-2);
}

.canvas-github-import__error {
  border: 1px solid var(--danger-border);
  border-radius: var(--radius-control);
  background: var(--danger-bg);
  color: var(--danger-text);
  font-size: var(--text-xs);
  padding: var(--space-2) var(--space-3);
}

@media (max-width: 640px) {
  .canvas-github-import__folder {
    grid-template-columns: 1fr;
  }

  .canvas-github-import__folder .ui-btn {
    justify-self: start;
  }
}
```

- [ ] **Step 4: Run design-focused checks**

Run:

```bash
node --experimental-strip-types src/components/canvas-github-import-styles.test.ts
node scripts/design-system/token-reference-scan.mjs
pnpm codemod:design:check
```

Expected:

```text
canvas GitHub import styles: ok
```

The token scan and design codemod check must finish without introducing a new finding.

- [ ] **Step 5: Commit the presentation**

```bash
git add \
  src/styles/chat-canvas.css \
  src/components/canvas-github-import-styles.test.ts \
  scripts/run-tests.mjs
git commit -m "style(canvas): clarify GitHub import modal"
```

### Task 4: Prove the modal end to end

**Files:**
- Create: `tests/canvas-github-import.spec.ts`

- [ ] **Step 1: Write the daemon-less Playwright coverage**

Create `tests/canvas-github-import.spec.ts`:

```ts
import { expect, test, type Page } from "@playwright/test";

const ISO = "2026-08-24T00:00:00.000Z";
const FILE_URL =
  "https://github.com/OpenCoven/coven-cave/blob/main/src/App.tsx";
const SOURCE = {
  kind: "github",
  url: FILE_URL,
  repoUrl: "https://github.com/OpenCoven/coven-cave",
  filePath: "src/App.tsx",
  ref: "main",
  projectFileHash: "fixture-hash",
};

async function openGitHubImport(
  page: Page,
  projects: Array<{
    id: string;
    name: string;
    root: string;
    repoUrl?: string;
    createdAt: string;
    updatedAt: string;
  }>,
) {
  await page.addInitScript(() => {
    window.localStorage.setItem("cave:active-familiar", "nova");
    window.localStorage.setItem(
      "cave:familiar:nova:last-surface",
      "chat",
    );
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
  });
  await page.route("**/api/familiars**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        familiars: [{
          id: "nova",
          display_name: "Nova",
          role: "Orchestrator",
          status: "active",
          icon: "ph:sparkle-fill",
        }],
      },
    }),
  );
  await page.route("**/api/sessions/list**", (route) =>
    route.fulfill({ json: { ok: true, sessions: [] } }),
  );
  await page.route("**/api/projects**", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { ok: true, projects } });
      return;
    }
    await route.fallback();
  });
  await page.route("**/api/canvas", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        json: { ok: true, positions: {}, artifacts: [] },
      });
      return;
    }
    const body = route.request().postDataJSON();
    await route.fulfill({
      json: {
        ok: true,
        artifacts: [body.artifact],
        savedId: body.artifact.id,
      },
    });
  });
  await page.route("**/api/canvas/github-source", (route) =>
    route.fulfill({
      json: {
        ok: true,
        code: "export default function App() { return <main>Ready</main>; }",
        title: "App",
        source: SOURCE,
      },
    }),
  );

  await page.goto("/?mode=chat");
  await page.waitForSelector(".chat-surface", { timeout: 30_000 });
  await page.getByRole("tab", { name: "Canvas" }).click();

  const startFromCode = page.getByRole("button", {
    name: "Start from code",
  });
  if (!(await startFromCode.isVisible())) {
    await page.getByRole("button", { name: "New sketch" }).first().click();
  }
  await startFromCode.click();
  await page.getByRole("menuitem", { name: /GitHub file/ }).click();
  await expect(
    page.getByRole("dialog", { name: "Canvas › Import GitHub file" }),
  ).toBeVisible();
}

test.describe("Canvas GitHub file import", () => {
  test("reveals details after a valid URL and prefers the linked project", async ({
    page,
  }) => {
    const linkedProject = {
      id: "project-linked",
      name: "Coven Cave",
      root: "/work/coven-cave",
      repoUrl: "https://github.com/OpenCoven/coven-cave",
      createdAt: ISO,
      updatedAt: ISO,
    };
    await openGitHubImport(page, [linkedProject]);

    const dialog = page.getByRole("dialog", {
      name: "Canvas › Import GitHub file",
    });
    await expect(
      dialog.getByRole("heading", { name: "Connect a Cave project" }),
    ).toHaveCount(0);

    const url = dialog.getByLabel("GitHub file URL");
    await url.fill("not-a-github-url");
    await url.blur();
    await expect(
      dialog.getByText(/Paste a GitHub blob URL/),
    ).toBeVisible();

    await url.fill(FILE_URL);
    await expect(dialog.getByLabel("GitHub file ready")).toContainText(
      "OpenCoven/coven-cave",
    );
    await expect(
      dialog.getByRole("heading", { name: "Connect a Cave project" }),
    ).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Cave project" }))
      .toContainText("Coven Cave");

    await dialog.getByRole("button", { name: "Load App.tsx" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByLabel("Paste sketch code")).toContainText(
      "return <main>Ready</main>",
    );
    await expect(
      page.getByLabel("Connected sketch source"),
    ).toContainText("src/App.tsx");
  });

  test("registers a local checkout without asking for a project name", async ({
    page,
  }) => {
    let createdProjectBody: Record<string, unknown> | null = null;
    await openGitHubImport(page, []);
    await page.route("**/api/projects", async (route) => {
      if (route.request().method() !== "POST") {
        await route.fallback();
        return;
      }
      createdProjectBody = route.request().postDataJSON();
      await route.fulfill({
        json: {
          ok: true,
          project: {
            id: "project-created",
            name: "coven-cave",
            root: "/work/coven-cave",
            repoUrl: "https://github.com/OpenCoven/coven-cave",
            createdAt: ISO,
            updatedAt: ISO,
          },
        },
      });
    });

    const dialog = page.getByRole("dialog", {
      name: "Canvas › Import GitHub file",
    });
    await dialog.getByLabel("GitHub file URL").fill(FILE_URL);
    await expect(dialog.getByText("Register local checkout")).toBeVisible();
    await expect(dialog.getByLabel("Project name")).toHaveCount(0);
    await dialog.getByLabel("Local checkout").fill("/work/coven-cave");
    await dialog.getByRole("button", { name: "Load App.tsx" }).click();

    await expect.poll(() => createdProjectBody).toEqual({
      name: "coven-cave",
      root: "/work/coven-cave",
      repoUrl: "https://github.com/OpenCoven/coven-cave",
    });
    await expect(page.getByLabel("Paste sketch code")).toBeVisible();
  });
});
```

- [ ] **Step 2: Run the focused browser test**

Run:

```bash
pnpm exec playwright test tests/canvas-github-import.spec.ts --project=desktop
```

Expected:

```text
2 passed
```

If the dialog accessible name is announced without separators by the browser, inspect it once with `getByRole("dialog").evaluate((node) => node.getAttribute("aria-labelledby"))` and use the actual accessible name. Do not switch the test to CSS-only modal selectors.

- [ ] **Step 3: Commit end-to-end coverage**

```bash
git add tests/canvas-github-import.spec.ts
git commit -m "test(canvas): cover GitHub import flow"
```

### Task 5: Complete design-system and regression verification

**Files:**
- Modify only files already listed if a verification command exposes a defect.

- [ ] **Step 1: Run all focused contracts together**

Run:

```bash
node --experimental-strip-types src/lib/canvas-github-import.test.ts
node --experimental-strip-types src/components/canvas-github-import-modal.test.ts
node --experimental-strip-types src/components/canvas-github-import-styles.test.ts
node --experimental-strip-types src/components/chat-canvas-tab.test.ts
pnpm check:tests-wired
```

Expected: all commands exit 0.

- [ ] **Step 2: Run static and design gates**

Run:

```bash
pnpm lint
pnpm exec tsc --noEmit --pretty false
```

Expected: both commands exit 0. Fix only regressions caused by this work.

- [ ] **Step 3: Run the app suite**

Run:

```bash
pnpm test:app
```

Expected: every app test file passes.

- [ ] **Step 4: Run production build validation**

Run:

```bash
pnpm build
```

Expected: the Next.js build, bundle budget, and standalone budget pass.

- [ ] **Step 5: Inspect the real modal in the desktop shell**

Run:

```bash
bash scripts/dev-app.sh
```

In the Tauri window:

1. Open **Canvas**.
2. Choose **New sketch → Start from code → GitHub file**.
3. Confirm only the URL field is initially visible.
4. Paste a valid `blob` URL and confirm the source card and project section appear.
5. Confirm an exact linked project is selected automatically.
6. Choose **Register local checkout** and confirm **Browse…** opens the native macOS folder dialog.
7. Confirm the modal survives all available dark/light theme combinations without unreadable borders or text.
8. Confirm Tab order is URL → project → root/Browse → Cancel → Load.
9. Confirm Escape closes while idle and does not close while loading.
10. Confirm reduced-motion mode removes modal entrance animation through the shared primitive.

Stop the app with `Ctrl-C`.

- [ ] **Step 6: Walk the design-language shipping checklist**

Verify against `docs/coven-design-language.md` §9:

- semantic tokens only;
- one primary CTA;
- visible `.focus-ring` on every interactive element;
- mutation announcements remain present;
- errors use text plus semantic styling;
- no color-only meaning;
- concise sentence-case copy;
- all behavior is truthful to the single-file import backend.

- [ ] **Step 7: Record completion evidence in Beads**

Run:

```bash
bd comments add cave-4pquo "Implementation verification: pure import model, modal/source/style contracts, Canvas GitHub Playwright flow, lint, typecheck, app suite, production build, and native modal inspection all passed. The flow now progressively reveals project setup, auto-selects linked projects, derives new project names from the repository, and truthfully loads one file for review before Add to Canvas."
```

- [ ] **Step 8: Confirm the final diff is scoped**

Run:

```bash
git diff --check
git status --short
git diff --stat origin/main...HEAD
```

Expected: only the files named in this plan are changed, with no whitespace errors.
