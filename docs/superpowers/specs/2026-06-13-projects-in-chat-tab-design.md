# Projects-in-Chat Tab + Minimal Redesign — Design

## Goal

Move the standalone **Projects** surface into a third tab inside the chat surface (`Chats · Memory · Projects`), and give it a uniform, sleek, minimal, modern UI/UX that matches the rest of the cave shell. No loss of capability.

## Context (existing system)

- **Projects page**: `src/components/projects-view.tsx` (~352 lines). Data via `src/lib/use-projects.ts` → `/api/projects` (GET/POST) and `/api/projects/[id]` (PUT/DELETE). Type `CaveProject { id, name, root, color?, createdAt, updatedAt }` (`src/lib/cave-projects-types.ts`). Actions: create (inline form), rename (inline), edit root (inline), delete (2-step confirm), new-chat-per-project (`onNewChat(root)`). States: loading / error / empty / list of `ProjectRow`.
- **Reached today via** a top-level workspace `mode === "projects"`:
  - `src/components/workspace.tsx`: `mode` state; full-screen render branch (~line 1327); `SURFACE_ORDER` includes `"projects"` (⌘9, ~line 722); `/projects` slash handler (~line 972).
  - `src/components/sidebar-minimal.tsx`: `FolderMode` union + `FOLDER_MODES` entry `{ id:"projects", label:"Projects", iconName:"ph:folders-bold", group:"tools", kbd:"⌘9" }`.
  - `src/lib/workspace-mode.ts`: `WorkspaceMode` union includes `"projects"`.
  - `src/lib/slash-commands.ts`: `/projects`.
- **Chat tabs**: `src/components/chat-surface.tsx` (~lines 272–382). `scope: "conversation" | "memory"`. Native `role="tablist"` with `role="tab"` buttons; active tab = 2px `after:` underline; panel mounted via a ternary on `scope`. Memory is the exact precedent for a non-conversation tab.
- **Design tokens** (`src/app/globals.css`): `--bg-base`, `--bg-raised`, `--bg-elevated`, `--bg-hover`, `--border-hairline`, `--border-strong`, `--text-primary/secondary/muted`, `--accent-presence` (lavender), `--color-danger`, `--radius-control` (8), `--radius-card` (12), `--ring-focus`. Primitives in `src/components/ui/`: `empty-state`, `error-state`, `icon-button`, `button`, `modal`, `live-region`.
- **Established cross-surface signal pattern**: window `CustomEvent`s like `cave:changes-open` (Codex rail → chat-surface). Hash deep-links (`#card-`, `#memory:`) exist but carry a popstate-gate hazard (see prior fix #557), so we avoid hash for this.

## Decisions (locked with user)

1. **Fully move** — remove the standalone `mode === "projects"` surface; existing entry points reroute into chat → Projects tab.
2. **Restyle + tighten, keep all actions** — no capability loss; uniform minimal/modern treatment.
3. **Refined single-column rows** — calm-at-rest rows, actions on hover/focus.
4. **Primary row activation = start/open a chat in that project** (`onNewChat(root)`); edit/rename/delete are explicit hover/focus actions.

## Architecture

### 1. Tab integration — `chat-surface.tsx`

- Extend scope type: `AgentsScope = "conversation" | "memory" | "projects"`.
- Add `"projects"` to the tablist map (label `Projects`); reuse the existing underline/ARIA button styling verbatim.
- Add panel clause: `scope === "projects" ? <ProjectsView ... /> : …` (sits alongside the Memory ternary; mutually exclusive with the conversation `Group`).
- **Open-from-outside**: add a `window` listener for `cave:chat-open-projects` that calls `setScope("projects")`. Mirrors how chat-surface already reacts to `cave:*` events. Remove the listener on unmount.
- Wire `ProjectsView`'s `onNewChat(root)` to the chat-surface's existing "new chat in project root" path (the same handler the chat router/project sidebar already uses) and switch `scope` back to `"conversation"` after creating, so the user lands in the new chat.

### 2. Entry-point rerouting (remove the standalone mode)

- `workspace.tsx`: delete the `mode === "projects"` full-screen render branch and the `ProjectsView` import there.
- The sidebar "Projects" entry / ⌘9, `/projects` slash, and command-palette intent now: `setMode("chat")` then `window.dispatchEvent(new CustomEvent("cave:chat-open-projects"))`. Centralize this in `handleSlashIntent` (`/projects`) and the sidebar `onModeChange` interception so all four paths share one routine.
- `workspace-mode.ts`: remove `"projects"` from `WorkspaceMode`. `SURFACE_ORDER` keeps the ⌘9 slot but maps it to the reroute routine, not a mode.
- `sidebar-minimal.tsx`: keep the `FOLDER_MODES` "Projects" entry (label/icon/⌘9 unchanged) but its activation triggers the reroute rather than `setMode("projects")`. Update `FolderMode` typing accordingly.

### 3. Redesigned `ProjectsView` (calm single-column rows)

Component stays `src/components/projects-view.tsx`, restructured:

- **Toolbar (slim, sticky to panel top):** no redundant "Projects" title (the tab labels it). Left: honest count (`{n} projects`). Right: Refresh (icon-button) + **New project** (primary button). Reuses `icon-button` / `button` primitives.
- **Create composer:** "New project" toggles an inline composer at the top (name input + root input + Create/Cancel). Same submit semantics as today, restyled to `bg-raised`/`radius-card`/hairline border. Esc cancels.
- **Row (`ProjectRow`):** at rest = folder glyph (`--accent-presence`) · name (13px semibold) · home-relativized root (mono 11px, single-line truncate) · chat-count chip (muted). On hover **or keyboard focus within the row**, reveal trailing icon actions: **Rename · Edit root · New chat · Delete** (`icon-button`s with `aria-label`s). Primary row activation (click / Enter / Space on the row) = `onNewChat(root)`.
  - **Rename / edit root:** reuse the existing inline-edit mechanics (Enter commits, Esc cancels, opacity-disabled during mutation), restyled.
  - **Delete:** keep the 2-step inline confirm (Cancel / Delete), restyled to a quiet danger treatment (`--color-danger` text + low-alpha fill, not a loud block).
- **States:**
  - First load (`loading && projects.length === 0`): **skeleton rows** (3–4 shimmer placeholders), not a bare spinner.
  - Empty (`!loading && projects.length === 0`): `ui/empty-state` — folder icon, "No projects yet", one-line subtitle, **New project** CTA.
  - Error: `ui/error-state` with the message + **Retry** (`reload()`).
- **Uniform tokens / rhythm:** rows `bg-raised` on `bg-base`; `border-hairline → border-strong` on hover/focus; `radius-card`; 8/12 spacing rhythm; type scale 13/12/11; `--ring-focus` focus rings; `--accent-presence` for folder + active affordances. Visually identical language to the Memory tab and shell.

### 4. A11y / keyboard / motion

- Tablist keeps `role="tab"` + `aria-selected` (existing pattern). New Projects tab participates identically.
- Each row is a single focusable control (`role="button"` or a `<button>` wrapper) with an `aria-label` describing the project + primary action; Enter/Space activates `onNewChat`.
- Hover-revealed actions are **kept in the tab order** (visually de-emphasized via opacity/translate, NOT `display:none`) so keyboard/AT users reach them; each has an `aria-label`.
- Create / rename / delete results announced through the existing `live-region` provider.
- All reveal/transition motion gated by `prefers-reduced-motion` (reuse `use-prefers-reduced-motion`).

### 5. Data flow

- Unchanged: `use-projects.ts` + `/api/projects` + `/api/projects/[id]`. No API or contract changes (`api-contracts.test.ts` projects entries stay as-is).
- `color?` field: out of scope for behavior, but if a project has a color we may tint the folder glyph (cheap, optional, no new control).

### 6. Testing

- **Update** `src/components/projects-view.test.ts` for the new structure (toolbar, skeleton/empty/error states, hover actions present + labeled, primary row action wiring).
- **Add** `src/components/chat-surface-projects-tab.test.ts`: Projects tab present in the tablist; selecting it renders `ProjectsView`; `cave:chat-open-projects` selects the scope; ARIA `role=tab`/`aria-selected`. **Wire it into `package.json` `test:app`** (the `check:tests-wired` guard is build-gating).
- **Fix** any nav tests asserting `mode === "projects"` (e.g. `sidebar-minimal.test.ts`, workspace navigation tests) to assert the reroute instead.
- Run with `node --experimental-strip-types` per repo convention.
- **Live verify** in a worktree on a unique port (not :3100): open chat → Projects tab; create / rename / edit-root / delete / new-chat; exercise empty / loading / error; full keyboard pass + focus-visible; reduced-motion.

## Out of scope (YAGNI)

- Card grid and list+detail layouts (explicitly not chosen).
- Project color picker / per-project theming controls.
- Drag-reorder of projects, project archiving, multi-select.
- Any change to `/api/projects` shape or the daemon.
- Migrating `SidecarAuthBridge`/other inline-script warnings (separate, declined).

## Open items to confirm during implementation

- Exact "new chat in project root" handler name in chat-surface to bind `onNewChat` to (chat-router already derives project groups via `useProjects`; reuse its creation path).
- Whether ⌘9 should land on the Projects tab with the **conversation** list still visible underneath, or replace the panel (design assumes replace, like Memory).
- Skeleton-row count and shimmer treatment to match any existing skeleton primitive (check `surface-loading-states`).
