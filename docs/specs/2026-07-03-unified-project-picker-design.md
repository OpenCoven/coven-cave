# Unified project picker — design

Date: 2026-07-03
Status: approved (autonomous session — decisions recorded here for async review)
Related: goal "update the method of project selection for a seamless UI/UX"

## Problem

Project selection is fragmented across the app, with four-plus independent
picker implementations and two dead ends:

1. **Four picker styles, no shared component.** Chat overflow kebab (Popover
   list), chat empty-state (native `<select>`, hidden entirely for no-project
   chats), home composer (native `<select>`), comux PROJECTS rail (DnD list),
   code sidebar (event-dispatch list). Each styles and behaves differently.
2. **Register ≠ grant.** `ProjectsView`'s "New project" form registers a root
   (`POST /api/projects`) but never grants it to the active familiar — a
   freshly created project can still 403 in chat. Only the 403-recovery path
   (`addChatProject`) does both steps.
3. **Add-project is reactive.** The main way an unregistered cwd becomes a
   project is by *failing a send* and clicking the error-strip recovery
   button. There is no proactive "add a project" affordance in any picker.
4. **Code surface forgets its project.** `selectedProjectRoot` in comux-view
   is plain React state; pins and drag order persist to localStorage but the
   selection itself resets to `projects[0]` on every reload.
5. **No-project empty chat has no picker.** `ChatEmptyState` hides its select
   when the resolved project is `NO_PROJECT_ID` (`project &&` guard), so the
   only way out is the overflow kebab.

## Approaches considered

- **A. Full model unification** — replace the derived-project model
  (session-bucketed roots in code sidebar/comux/chat sidebar) with registered
  projects everywhere. Correct long-term, but a multi-PR structural arc with
  migration questions (unregistered roots with live sessions). Too big for
  one coherent change; deferred as follow-up.
- **B. Shared picker + one-step add + persistence (chosen).** Introduce one
  shared `ProjectPicker` UI and one shared add-project flow (register +
  grant), wire them into the chat empty state, chat overflow menu, and home
  composer; persist the code surface's selection. Fixes every pain point
  above that a user hits day-to-day, in one reviewable PR, without touching
  the derived-model surfaces' data flow.
- **C. Minimal patch** — grant-on-create + unhide the empty-state select.
  Fixes the dead ends but leaves the fragmented UX in place; doesn't meet
  the "seamless" bar.

## Design (approach B)

### New: `src/components/project-picker.tsx`

Two exports, both reusing existing primitives (`Popover*`,
`DirectoryPickerModal`, `addChatProject`, `projectNameForRoot`):

- **`useAddProjectFlow({ familiarId, createProject, onAdded })`** — the one
  shared add-project flow. `beginAddProject()` opens the native folder dialog
  on Tauri (`shell_pick_directory`) or the web `DirectoryPickerModal`; the
  picked directory is registered **and granted** via `addChatProject` (name
  auto-derived from the leaf folder), then `onAdded(project)` fires so the
  caller can select it. Returns `{ beginAddProject, addProjectModal, adding,
  addError }`; the caller renders `addProjectModal` once.
- **`ProjectPicker`** — a popover picker: trigger chip (folder icon + current
  project name or "No project") opening a Popover with a filter input (shown
  above 6 projects, mirroring `familiar-switcher`), an optional "No project"
  row (`allowNoProject`), the project rows (name + root), and an
  "Add project…" row wired to `useAddProjectFlow`. Props: `projects`,
  `value` (project id / `NO_PROJECT_ID` / null), `onChange(id)`,
  `allowNoProject?`, `familiarId?`, `createProject?`, `disabled?`,
  `ariaLabel`, `className?`. With zero projects the trigger still renders and
  the popover leads with "Add project…" — the empty state becomes an
  onboarding affordance instead of a dead end.

CSS: `.cave-project-picker*` block in `src/app/globals.css` (repo convention
for shell/chat surface styles).

### Chat empty state (`chat-view.tsx` `ChatEmptyState`)

Replace the native `<select>` with `ProjectPicker`. Keep the
`cave-chat-empty-project` wrapper class and `aria-label="Project for this
chat"` (both pinned by tests; the aria-label moves to the picker trigger).
Drop the `project &&` guard — the picker now renders for no-project chats
("No project" shown as the value) and for zero-project installs (add flow).
Prop names `projectId`/`onProjectChange` stay (pinned).

### Chat overflow menu (`SessionOverflowMenu`)

The existing Project section (PopoverLabel + "No project" row + project rows)
stays textually intact — it already matches the picker's semantics and two
source-text tests pin its structure. Add one "Add project…" `PopoverItem`
after the project rows, driven by a new optional `onAddProject` prop; the
mount site passes the shared flow's `beginAddProject`. ChatView renders the
flow's modal once, next to the existing DirectoryPickerModal-free tree.

### Home composer (`home-composer.tsx`)

Keep the native select (the composer's control bar is a row of native
selects — local idiom, and its markup is pinned), but make it complete:

- A "No project" option (sentinel `NO_PROJECT_ID` value) so home chats can
  deliberately start without a project, matching chat semantics.
  `selectedProject` resolves to null for it; the existing null-safe handoff
  (`selectedProject?.root ?? null`) already does the right thing.
- An "Add project…" option (sentinel `__add-project__`). Selecting it does
  not change the selection; it opens the shared add flow, and on success the
  new project becomes selected. The select is no longer disabled at zero
  projects so the flow stays reachable.
- `aria-label="Choose project"` and `value={selectedProjectId}` unchanged
  (pinned).

### Projects view (`projects-view.tsx`)

`handleCreate` routes through `addChatProject({ root, familiarId:
activeFamiliarId, createProject, name })` instead of bare `createProject`,
so creating a project from the management surface also grants it to the
familiar whose scope you're looking at. No familiar in scope (operator view)
→ behaves exactly as before. `handleCreate` stays the form's `onSubmit`
(pinned).

### Code surface persistence (`comux-view.tsx`, `comux-project-order.ts`)

New `readSelectedProject()` / `writeSelectedProject(root)` pair in
`comux-project-order.ts` (key `cave:comux:selectedProject`, same
SSR-safe read/write helpers as order/pins). Comux seeds it in the existing
after-mount effect (only when nothing is selected yet) and writes it whenever
`selectedProjectRoot` changes. The existing `?? projects[0]` fallback already
handles a persisted root that no longer exists.

### Grant semantics

`POST /api/project-grants` rejects agent-relayed approvals and accepts direct
human clicks; every new grant call here happens in a click handler (add
flow, create form), same as the existing 403-recovery path — no server
changes needed.

## Error handling

- Add flow failures (register or grant) surface inline where the flow was
  started (picker popover / composer row / error strip), never silently.
- Grant failure after successful registration reports the grant error but
  keeps the registered project (same behavior as `addChatProject` today).

## Testing

- New `src/components/project-picker.test.ts` — source-text pins for the
  shared component: trigger aria pattern, "No project" row, "Add project…"
  flow registering **and** granting via `addChatProject`, filter input.
- Update `task-chat-cwd.test.ts` empty-state pins (select → picker markup);
  its overflow-menu pins remain valid by construction.
- `chat-surface-polish.test.ts`, `home-composer.test.ts`,
  `projects-view.test.ts`, `chat-view.test.ts` pins are preserved by keeping
  the pinned classes/aria/props/function names in place.
- New pins: home composer sentinel options; comux persistence
  (`cave:comux:selectedProject` read/write wiring); projects-view
  grant-on-create.
- All new test files wired into `scripts/run-tests.mjs` (app suite);
  ALIAS_LOADER only if a test imports `@/` runtime modules.

## Out of scope (follow-ups)

- Merging the derived-project model (code sidebar / chat sidebar buckets)
  into the registered-project registry (approach A).
- Quick-chat project selection (deliberately lightweight surface).
- Connecting the chat sidebar's folder *filter* selection to the active
  chat's project draft.
