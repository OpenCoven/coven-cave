# Set up a project from a chat's unregistered folder — design

Date: 2026-07-24
Status: approved (brainstorm with @BunsDev)

## Problem

A chat can open in a folder that is not a registered Cave project — an
opener-provided ad-hoc cwd (Code surface hand-offs, launch flows, GitHub
kick-offs). Today that chat just shows "No project": the folder never groups
in rails or the Board, and the only path to register it is the generic
"Add project…" flow, which makes the user re-browse to a directory the chat
already knows. There is also no in-context way to decide, at registration
time, which familiar — or which of the familiar's access groups — gets
access to the new project.

## Goal

When a conversation is opened in a non-registered project location:

1. Offer to create/register that folder as a project, in place.
2. Explain what registering entails before the user commits.
3. Let the user pick access preferences for the chat's familiar and for the
   access groups that familiar belongs to.

## Non-goals

- Registering a familiar's own workspace as a project (bare "No project"
  chats). Policy: those cwds are never surfaced or re-asserted.
- Promoting `.worktrees/<branch>` checkouts to standalone projects — they
  deliberately authorize against their parent project.
- Any change to grant-mutation security (`requireTrustedHumanGrantMutation`,
  relayed-approval rejection stays as is).
- Group membership editing; only project grants on existing groups.

## Eligibility

New pure helper `src/lib/project-setup-offer.ts`:

```ts
projectSetupCandidateRoot(args: {
  selection: ChatProjectSelection;   // from resolveChatProjectSelection
  projects: CaveProject[];
}): string | null
```

Returns the normalized root only when ALL hold:

- `selection.projectId === NO_PROJECT_ID` and `selection.unregisteredRoot`
  is present (the chat actively runs in a known unregistered folder);
- the root does not map to a registered project (`projectForRoot` misses);
- the root is not at or below any registered project's `.worktrees/`
  directory (separator-exact, normalized comparison — same containment
  discipline as `chat-project-access.ts`).

Consequences: registered-project chats, bare No-project chats (familiar
workspaces carry no `unregisteredRoot`), and worktree checkouts are all
excluded. Pure and unit-testable, in the style of `chat-projects.ts`.

## Entry points (chat view)

Both entry points call one `beginProjectSetup(root)`.

1. **Picker row.** `ProjectPickerPopover` gains optional props
   `registerCurrentRoot?: string` and `onRegisterCurrentRoot?: () => void`.
   When provided, a row "Register this folder as a project…" (leading
   `ph:folder-plus`, root as secondary text) renders above the existing
   "Add project…" row. Wired from the chat composer's project chip and the
   session-header kebab picker whenever the candidate root is non-null.

2. **Dismissible banner.** An inline notice above the composer when the
   candidate root is non-null and not dismissed: "This chat runs in
   `<leaf>`, which isn't a registered project." with a **Set up as
   project…** button and a dismiss ✕. Dismissal persists in
   `localStorage` under `cave:project-setup-dismissed:<normalized-root>` —
   per folder, so the same folder never re-nags across chats; the picker
   row remains the persistent affordance. Banner uses design-language
   tokens only, `.focus-ring` on both controls, color never the only
   channel.

## Setup modal

New `ProjectSetupModal`, built on `components/ui` `Modal` (focus trap +
focus return come with it), `useAnnouncer()` for completion.

- **Header:** "Set up project"; folder path as subtitle.
- **Explainer:** "Registering makes this folder a project across the
  Cave — it shows up in project pickers, the Board, and chat rails.
  Familiars can only work in a project after you grant access; choose who
  starts with access below. Everything here can be changed later in
  Projects and Permissions."
- **Fields:**
  1. **Name** — text, prefilled `projectNameForRoot(root)`.
  2. **Color** — the swatch row from `project-settings-modal`, extracted
     into a shared piece (not duplicated).
  3. **GitHub repository** — optional; prefilled when the folder's git
     `origin` remote normalizes to a GitHub URL (see server addition);
     server-side validation stays `normalizeGitHubRepoUrl`.
  4. **Familiar access** — "`<Familiar name>`'s access": No access / Read /
     Write; default **Write** (the chat needs to keep running here). If the
     familiar is Supreme: static "has access to every project", no grant
     call.
  5. **Group access** — one row per access group whose
     `memberFamiliarIds` contains the chat's familiar: group name, member
     count, No access / Read / Write (default **No access**), helper
     "Applies to every member." Section hidden when the familiar belongs
     to no groups. Groups come from the existing `GET /api/project-grants`
     payload (`accessGroups`).
- **Footer:** Cancel / **Create project** (busy label "Creating…").

## Submit sequence

All requests fire from the direct human click (satisfies
`requireTrustedHumanGrantMutation` / relayed-approval rejection):

1. `createProject(name, root, { emitMutation: false, color, repoUrl })` —
   `CreateProjectOptions` in `chat-add-project.ts` extends with optional
   `color` and `repoUrl`; `use-projects` threads them into the
   `POST /api/projects` body (the API already accepts both).
2. If familiar access ≠ none and familiar is not Supreme:
   `POST /api/project-grants { targetFamiliarId, projectId, access }`.
3. For each group with level ≠ none:
   `PATCH /api/access-groups/<id>` with `projectGrants` = the group's
   existing grants ∪ `{ projectId, access }` (replace an existing entry for
   the same projectId rather than duplicating).
4. `emitProjectRegistryMutation()` exactly once, then `onAdded(projectId)`
   → the chat's `projectIdDraft` rescopes to the new project,
   `reloadProjects()`, announce "Project created."

**Partial failure:** if creation succeeded but a later step failed, the
modal stays open with an inline error naming the failed step; retry passes
`existingProjectId` so no duplicate project is created (mirrors
`addChatProject`'s two-step semantics and its partial-mutation emit).

## Server addition: git-remote probe

`GET /api/changes?projectRoot=<abs>&remote=1` →
`{ ok: true, remoteUrl: string | null }`, implemented with the route's
existing `execFile` discipline (`git config --get remote.origin.url`, no
shell). Containment is unchanged: an eligible ad-hoc root is by definition
a daemon session root (the chat runs there), so the route's existing
`resolveWithinSessionRoots` fallback already admits it. Missing remote or
non-repo → `remoteUrl: null`. The modal probes once on open; a failed
probe leaves the field blank and never blocks.

## Testing

1. `src/lib/project-setup-offer.test.ts` — eligibility matrix: ad-hoc root
   ✓; registered root ✗; `.worktrees/` child ✗; bare No-project ✗;
   normalization (trailing slash, backslashes).
2. `src/components/project-setup-modal.test.ts` — source-shape: explainer
   copy, defaults (familiar write, groups none), Supreme skip, submit
   ordering (create → grant → group patches → single emit),
   `existingProjectId` retry, focus/announcer wiring.
3. `chat-view.test.ts` / `project-picker.test.ts` additions — banner gated
   on candidate root + localStorage dismissal; picker row only when
   `registerCurrentRoot` is provided.
4. `chat-add-project.test.ts` / `use-projects` coverage — `color`/`repoUrl`
   ride the create POST body.
5. `src/app/api/changes` route test — `remote=1` returns the origin URL,
   absent remote → null, containment intact.

Gates: `pnpm lint` (design ESLint suite) plus targeted `node --test` on the
touched suites. `ph:folder-plus` is not yet in `ICON_NAMES` (verified): add
it and regenerate the icon subset (`node scripts/generate-icon-subset.mjs`),
committing the regenerated subset in the same PR.
