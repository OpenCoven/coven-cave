# Familiar avatar rail upgrade + comprehensive customization (Familiar Studio)

**Date:** 2026-06-08
**Status:** Approved (design); plan pending
**Scope:** Cave-local familiar customization. Avatar-rail visual upgrade, per-familiar editable identity/look/brain attributes, archive + reorder + reset lifecycle. No daemon protocol changes.

## Why

Today the rail (`src/components/familiar-avatar-rail.tsx`) renders Phosphor glyphs, presence dots, and reply-needed badges, but only the **glyph** is user-editable (via `familiar-glyph-picker.tsx` and the `cave:glyph-overrides:v1` localStorage store). Every other field on `Familiar` — `display_name`, `role`, `pronouns`, `description`, `harness`, `model`, `note`, and any notion of per-familiar color or avatar image — is read-only in the UI. The settings panel (`src/components/settings-familiars-panel.tsx`) is a `<dl>` of facts with no edit affordances.

The user wants:

1. The rail itself to feel more crafted (better defaults, hover affordances, per-familiar accent, image avatars).
2. One discoverable surface to edit the *whole* familiar from inside the app, not just its icon.

Cave already owns the right primitive — a Cave-local override store layered on top of the daemon's canonical record — but only ships it for glyphs and rail order. This spec extends that pattern to every customizable attribute and adds the editing surface to drive it.

## Goals

- Rail avatars surface per-familiar identity at a glance (color, image or glyph, smarter defaults).
- One drawer ("Familiar Studio") edits every Cave-local-customizable attribute of a familiar.
- Every override is reversible to the daemon's value with a single click.
- Zero daemon protocol changes. This PR ships entirely in `coven-cave`.
- Existing rail behavior preserved: select-on-click, presence dot, unread badge, scroll-into-view, add/toggle buttons.

## Non-goals

- **No daemon endpoints.** Brain-tab edits write to `cave-config.json` via existing `saveConfig`. Identity edits live in localStorage only. The existing `PUT /api/familiars/{id}/icon` fire-and-forget pattern stays for glyphs; no new daemon writes are required to ship.
- **No "create new familiar" inside the Studio.** Creating a Cave-local stub that the daemon doesn't know about produces a non-functional familiar (can't run sessions). The rail's `+` button keeps its existing onboarding flow unchanged.
- **No "delete" beyond archive.** Without a daemon DELETE endpoint, delete is functionally identical to archive. Archive is the right primitive for Cave-local.
- **No design-token refresh.** Existing CSS custom properties (`--accent-presence`, `--text-primary`, `--bg-raised`, etc.) are reused.
- **No migration.** New stores start empty. Existing `cave:glyph-overrides:v1` and `cave:familiar-order:v1` are untouched.

## Design decisions (locked)

| Decision | Choice | Alternatives considered |
|---|---|---|
| Storage of canonical edit | **Cave-local first** — localStorage overrides + `cave-config.json`, layered on daemon values | Daemon-canonical (new PUT endpoints); per-field routing by ownership |
| Editing surface | **Right-side slide-out drawer (Familiar Studio)** triggered from rail and settings | Inline accordion in settings panel; persistent right-side inspector |
| Tab structure | **Identity / Look / Brain / Lifecycle** — vertical strip inside the drawer | Single long form; horizontal top tabs |
| Lifecycle scope | **Archive + reorder + reset overrides** only | Include create-local-stub; include destructive delete |
| Image avatar storage | **Base64 data URL in localStorage**, per-familiar, capped 2MB each / ~20MB total | Tauri filesystem write; daemon-side blob store |
| Drawer dismissal | **Non-modal** — Esc, click-outside, `×` button. Rail and conversation stay interactive behind it. | Modal with backdrop (current glyph picker pattern) |

## Detailed design

### A. Rail upgrades

All changes land in three existing files; no new files in this section.

**`src/lib/familiar-glyph.ts`** gains:

- `inferGlyphFromRole(role: string): FamiliarGlyph | null` — deterministic keyword-to-Phosphor mapping table. Looks for substrings like `code`, `chat`, `music`, `research`, `art`, `data`, `ops`, `writer`, `design`, etc., each mapped to a curated Phosphor name. Returns `null` on no-match. The mapping table lives at the top of the file as a `const` `Record<string, string>` for easy extension.
- `resolveFamiliarGlyph` adds the inferred step between daemon emoji and `DEFAULT_FAMILIAR_GLYPH`. Final precedence:
  1. Cave-local glyph override
  2. Daemon `icon` (if `ph:*`)
  3. Daemon `emoji` (if `ph:*`)
  4. `inferGlyphFromRole(familiar.role)`
  5. `DEFAULT_FAMILIAR_GLYPH` (`ph:sparkle-fill`)

**`src/components/familiar-glyph.tsx`** stays icon-only. A sibling component, **`src/components/familiar-avatar.tsx`** (new), picks between `<img>` (when a `ResolvedFamiliar` has `avatarImage`) and `<FamiliarGlyph>` (otherwise). All current call sites of the explicit `<FamiliarGlyph glyph={resolveFamiliarGlyph(...)} />` pattern migrate to `<FamiliarAvatar familiar={resolvedF} size="sm|md|lg" />`.

**`src/components/familiar-avatar-rail.tsx`** gains:

- A CSS custom property on each `button.familiar-avatar-rail__avatar`: `style={{ "--familiar-accent": resolved.color }}`. The active-state ring and a new hover glow read from this var, falling back to `--accent-presence`. **The presence dot does not consume `--familiar-accent`** — presence colors continue to encode status (idle / live / needs-reply) and must stay distinguishable across familiars.
- A hover-revealed `…` affordance (small icon button positioned absolutely top-right of the avatar cell, `opacity-0` by default, `opacity-100` on `:hover`/`:focus-within`). Click opens Familiar Studio for that familiar on the **Identity** tab. `aria-label="Customize {display_name}"`.
- A right-click context menu on each avatar (preventDefault on `oncontextmenu`) → opens Studio on **Identity**. The `…` button is the discoverable equivalent for users who don't right-click.
- Drag-and-drop reorder using HTML5 DnD on each `<li>`. On `dragend` with a different position, computes the new id list and calls `setFamiliarOrder(ids)` from `cave-familiar-order.ts`. Visual: dragged item gets `opacity: 0.4`, drop target gets a 2px accent-tinted top/bottom border.
- The `+` button keeps its current `onAddFamiliar` behavior. Right-clicking it opens a small menu with "New familiar (onboarding)" and "Manage familiars…" (the latter opens Studio in list view — see Lifecycle tab below).

The rail consumes resolved familiars via the new `useResolvedFamiliars` hook (Section C). The `familiars` prop type changes from `Familiar[]` to `ResolvedFamiliar[]`; callers do the resolve once at the page/shell layer and pass down.

### B. Familiar Studio drawer

**New files:**

- `src/components/familiar-studio.tsx` — drawer shell, tab routing, header
- `src/components/familiar-studio-identity-tab.tsx`
- `src/components/familiar-studio-look-tab.tsx`
- `src/components/familiar-studio-brain-tab.tsx`
- `src/components/familiar-studio-lifecycle-tab.tsx`
- `src/components/familiar-glyph-picker-panel.tsx` — extracted inner panel of the existing picker, reusable inside the Look tab

**Refactor:**

- `src/components/familiar-glyph-picker.tsx` keeps its modal wrapper for backward compat but delegates its body to `familiar-glyph-picker-panel.tsx`. No external API change.

**Trigger points** (all open the same drawer, opening to the tab named):

| From | Triggers | Tab |
|---|---|---|
| Rail avatar — hover `…` button click | Open Studio for `f.id` | Identity |
| Rail avatar — right-click | Open Studio for `f.id` | Identity |
| Settings panel — new "Edit" button on each card | Open Studio for `f.id` | Identity |
| Rail `+` button — right-click → "Manage familiars…" | Open Studio in list view | Lifecycle |

The drawer's open/active state lives in a small React context provider rendered at the shell layer (the codebase has no zustand/jotai; existing shell state in `src/components/shell.tsx` is `useState` + ad-hoc context, mirrored here). The context exposes `{ openFamiliarStudio(id, tab?), closeFamiliarStudio() }`. Triggers (rail avatars, settings panel "Edit", `+` button right-click) consume it via a `useFamiliarStudio()` hook. New file: `src/lib/familiar-studio-context.tsx`.

**Layout:**

- Right-side slide-out, 480px wide. Slides in from the right edge, transform-translate animation, ~180ms ease-out.
- Non-modal: no backdrop, no pointer-events blocker. Rail and conversation stay interactive.
- Dismissal: Esc key, `×` button in header, clicking the rail's `…` for the same familiar again (toggle).
- Last-used tab persisted in localStorage (`cave:familiar-studio-tab:v1`) so reopening lands on the same tab.

**Header:**

- Large `FamiliarAvatar` preview (96px) on the left.
- Inline-editable `display_name` to the right (click on text → becomes `<input>`; Enter or blur to commit; Esc to cancel). Committing an empty / whitespace-only value clears the override (reverts to the daemon name), so the field cannot be set to a blank string.
- Small role pill underneath the name. Click pill → focuses the role field in the Identity tab.
- `×` close button top-right.

**Tabs:** vertical strip on the left of the drawer (60px wide), each tab is a button with a Phosphor icon + label below. Active tab gets a 2px accent-color left border.

1. **Identity** (`ph:user-circle`)
   - Display name (text input, autosave on blur or 400ms debounce)
   - Role (text input)
   - Pronouns (text input)
   - Description (textarea, ~3 rows)
   - Each field shows the daemon's value as ghosted placeholder when no override exists. A small "↺ reset" icon button next to each field clears that field's override (calls `clearFamiliarOverrideField(id, field)`).

2. **Look** (`ph:palette`)
   - Inline `<FamiliarGlyphPickerPanel familiar={f} />`
   - Color picker row: 8 preset swatches (drawn from existing accent palette tokens) + custom hex `<input type="color">` + a "reset to default" button
   - Image upload zone: drag-drop area + file picker button. Validates size ≤ 2MB and mime in `{image/png, image/jpeg, image/webp, image/svg+xml}`. Reads as data URL, writes via `setFamiliarImage(id, { dataUrl, mime })`. Shows current image preview + "Remove image" button when one is set.

3. **Brain** (`ph:brain`)
   - Harness dropdown (`<select>`), populated from `/api/harnesses` like `settings-familiars-panel.tsx` already does. Selecting writes via the new `POST /api/cave-config/familiar/:id` route (see below).
   - Model text input with a small `<datalist>` of common model strings (`openai/gpt-5.5`, `anthropic/claude-opus-4-7`, `anthropic/claude-sonnet-4-6`, etc. — short curated list).
   - System prompt / note textarea (writes to `cave-config.json.familiars[id].note`).
   - Each row has the same `↺ reset` affordance to revert to the cave-config default (which falls back to `cave-config.json.defaults`).

4. **Lifecycle** (`ph:flow-arrow`)
   - **Archive** / Unarchive button (toggles based on current state)
   - **Reset all overrides** — destructive-styled button, second-click confirm. Calls `clearAllFamiliarOverrides(id)` + `clearGlyphOverride(id)` + `clearFamiliarImage(id)`, and for `cave-config.json` resets the familiar's entry to `{}` so it inherits defaults.
   - **List view** (when opened via "Manage familiars…"): the drawer is in *no-familiar-selected* mode — the Lifecycle tab body becomes a scrollable list of all familiars (active group + collapsed "Archived" group) with quick archive/unarchive toggles. The header is empty, Identity/Look/Brain tabs are disabled. Clicking a row in the list selects that familiar, populates the header, and re-enables the other tabs (default jump: Identity).

**Footer:** muted "Changes save automatically" label on the left; daemon sync status on the right (e.g., "Synced" / "Saved locally, daemon offline").

### C. Data model and storage

**Three new localStorage stores**, each in its own file following the existing `cave-glyph-overrides.ts` / `cave-familiar-order.ts` pattern (`useSyncExternalStore`, cross-tab `storage` event listener, snapshot accessors, corrupt-JSON fallback to empty):

**1. `src/lib/cave-familiar-overrides.ts`** — key `cave:familiar-overrides:v1`

```ts
type FamiliarOverride = {
  display_name?: string;
  role?: string;
  pronouns?: string;
  description?: string;
  color?: string;  // CSS color string (hex, oklch, or named)
};

type OverrideMap = Record<string, FamiliarOverride>;

export function useFamiliarOverrides(): OverrideMap
export function setFamiliarOverride(id: string, patch: Partial<FamiliarOverride>): void
export function clearFamiliarOverrideField(id: string, field: keyof FamiliarOverride): void
export function clearAllFamiliarOverrides(id: string): void
export function readFamiliarOverridesSnapshot(): OverrideMap
```

**2. `src/lib/cave-familiar-images.ts`** — key `cave:familiar-images:v1`

```ts
type FamiliarImage = {
  dataUrl: string;
  mime: string;
  updatedAt: string;
};

type ImageMap = Record<string, FamiliarImage>;

export function useFamiliarImages(): ImageMap
export function setFamiliarImage(id: string, image: FamiliarImage): { ok: true } | { ok: false; reason: string }
export function clearFamiliarImage(id: string): void
```

`setFamiliarImage` enforces a per-image cap (2MB pre-encode) and a total-store cap (~20MB). On overage, returns `{ ok: false, reason }` so the Look tab can surface a toast.

**3. `src/lib/cave-familiar-archive.ts`** — key `cave:familiar-archive:v1`

```ts
type ArchiveMap = Record<string, string>;  // id → ISO timestamp

export function useArchivedFamiliars(): ArchiveMap
export function archiveFamiliar(id: string): void
export function unarchiveFamiliar(id: string): void
export function isFamiliarArchived(id: string, map: ArchiveMap): boolean
```

**Existing `cave-config.json` stays the home for brain-tab fields** (`harness`, `model`, `note`). The existing `PATCH /api/config` route (in `src/app/api/config/route.ts`) already accepts `{ familiars: { [id]: { harness?, model?, note? } } }` and shallow-merges it into `familiars` via `saveConfig`. **No new route is required.** The Brain tab calls `PATCH /api/config` on each field's debounced/blur save, with a body shaped as `{ familiars: { [id]: { ...patch } } }`. To reset a familiar to defaults, send `{ familiars: { [id]: {} } }` — `bindingFor` then falls through to `cave-config.json.defaults`.

**Resolution layer.** New file `src/lib/familiar-resolve.ts`:

```ts
export type ResolvedFamiliar = Familiar & {
  /** Always non-empty after resolve — falls back to var(--accent-presence). */
  color: string;
  /** Data URL if the user uploaded an image. */
  avatarImage?: string;
  /** Resolved glyph (image takes precedence when present, but we still resolve a glyph for fallback). */
  glyph: FamiliarGlyph;
  /** True if archived (callers can filter or display archived state). */
  archived: boolean;
};

export function resolveFamiliar(
  base: Familiar,
  ctx: {
    override?: FamiliarOverride;
    image?: FamiliarImage;
    glyphOverride?: string;
    archived: boolean;
  },
): ResolvedFamiliar

export function useResolvedFamiliars(
  familiars: Familiar[],
  options?: { includeArchived?: boolean },
): ResolvedFamiliar[]
```

`useResolvedFamiliars` composes the four hooks (`useFamiliarOverrides`, `useFamiliarImages`, `useGlyphOverrides`, `useArchivedFamiliars`), applies `applyFamiliarOrder` from the existing order store, and returns the ordered + resolved list. Archived familiars are filtered out by default; Lifecycle list view passes `includeArchived: true`.

**Field-level precedence on resolve:**

| Field | Precedence (highest first) |
|---|---|
| `display_name` | override → daemon `display_name` |
| `role` | override → daemon `role` |
| `pronouns` | override → daemon `pronouns` |
| `description` | override → daemon `description` |
| `color` | override → `var(--accent-presence)` |
| `avatarImage` | image store entry → `undefined` |
| `glyph` (for fallback) | glyph override → daemon `icon` → daemon `emoji` (if `ph:*`) → `inferGlyphFromRole(role)` → `DEFAULT_FAMILIAR_GLYPH` |
| `archived` | archive-store entry presence |

The Brain-tab fields (`harness`, `model`, `note`) are *not* in the override layer because `cave-config.json` is already their canonical Cave-local home. They flow into `Familiar` via the existing server-side enrichment (see `Familiar` type comments in `src/lib/types.ts`).

**Consumer migration:**

Every place that currently renders a `Familiar` with `<FamiliarGlyph glyph={resolveFamiliarGlyph(f, overrides)} />` switches to `<FamiliarAvatar familiar={resolved} />`. Call sites identified at design time:

- `src/components/familiar-avatar-rail.tsx`
- `src/components/familiar-switcher.tsx`
- `src/components/settings-familiars-panel.tsx`
- `src/components/familiar-status-card.tsx`
- `src/components/sidebar-familiars.tsx`
- Any board / task / inbox row that renders a familiar avatar (audit at implementation time — search for `<FamiliarGlyph` and `resolveFamiliarGlyph`).

The top-level page/shell layer calls `useResolvedFamiliars(rawFamiliars)` once and passes the resolved array down. Downstream components stop calling `resolveFamiliarGlyph` directly.

### D. Lifecycle scope, error handling, testing

**Lifecycle decisions:**

- **Create** — out of scope. Existing `onAddFamiliar` (onboarding flow) keeps its current behavior. Documented in non-goals.
- **Archive / unarchive** — Cave-local, full UI support via Lifecycle tab and list view.
- **Reorder** — direct drag-and-drop on the rail; the existing `cave-familiar-order.ts` already supports this. Lifecycle tab also offers up/down arrow buttons for touch / a11y users.
- **Reset all overrides** — Lifecycle tab button; clears the four override stores for that id and resets `cave-config.json.familiars[id]` to `{}`.
- **Delete** — out of scope. Archive replaces it for Cave-local use.

**Error handling** (mirroring `cave-glyph-overrides.ts`'s posture):

| Failure | Handling |
|---|---|
| Corrupt localStorage JSON | Silent fallback to empty map (try/catch on read). |
| Image upload over size cap | Look tab surfaces a toast `Image too large (max 2MB)`. No write. |
| Image upload of disallowed mime | Look tab toast `Unsupported format. Use PNG, JPEG, WebP, or SVG.` No write. |
| Total image-store quota exceeded | Look tab toast `Cave avatar storage full. Remove an image to free space.` No write. |
| `cave-config.json` write failure (Brain tab `PATCH /api/config` non-2xx) | Brain tab toast `Couldn't save to cave-config.json: {error}`. Field reverts to last-known value on blur. |
| Daemon offline during glyph PUT | Existing fire-and-forget posture preserved. Studio footer shows `Saved locally, daemon offline` when a recent PUT failed within the last 60s. |
| Cross-tab edits | Existing `storage` event listener pattern; `useSyncExternalStore` re-renders consumers automatically. |
| Drawer opened for a familiar id that no longer exists in the daemon list | Drawer renders a "This familiar is no longer available" empty state with a button to close. Prevents stale ids from breaking the UI. |

**Testing (Vitest, mirroring existing test style):**

New test files:

- `src/lib/cave-familiar-overrides.test.ts` — set/clear/clearAll, partial patches, cross-tab notify, corrupt-JSON fallback, snapshot accessor.
- `src/lib/cave-familiar-images.test.ts` — size cap, mime validation, total-quota cap (mock storage size), clear.
- `src/lib/cave-familiar-archive.test.ts` — archive/unarchive idempotency, persistence, isArchived helper.
- `src/lib/familiar-resolve.test.ts` — full precedence matrix for every field; archive filtering; combined with `applyFamiliarOrder`.
- `src/lib/familiar-glyph.test.ts` — `inferGlyphFromRole` mapping table; `resolveFamiliarGlyph` new precedence step.
- `src/components/familiar-studio.test.tsx` — drawer open/close, Esc dismiss, tab switching, last-tab persistence, header inline-edit save path, each tab's primary mutation calls the right store, lifecycle archive/unarchive/reset paths, list-view rendering of archived familiars.

Extended test files:

- `src/components/familiar-avatar-rail.test.ts` — hover `…` reveal, right-click opens Studio, image-vs-glyph render branch, accent-color custom property application, drag-to-reorder writes to order store.

No manual QA scripted in the spec. UI smoke testing is the user's responsibility (Tauri can't be driven headlessly here).

## Open questions

None. All scope decisions locked above.

## Implementation order (high-level — full plan in writing-plans pass)

1. **Foundations**: `inferGlyphFromRole` + `resolveFamiliarGlyph` precedence update; `FamiliarAvatar` component; new override / image / archive stores; `familiar-resolve.ts`. Tests for each lib file. No UI behavior change yet.
2. **Consumer migration**: switch every familiar-rendering site to `<FamiliarAvatar familiar={resolved} />`. Verify nothing regresses visually.
3. **Rail polish**: per-familiar accent CSS var, hover `…` button, right-click trigger, drag-to-reorder, default-glyph inference visible at this point.
4. **Studio drawer shell**: drawer container, tab strip, header inline-edit, dismissal, last-tab persistence. Stub each tab as "coming next."
5. **Identity tab**: text inputs + reset buttons wired to `setFamiliarOverride` / `clearFamiliarOverrideField`. Tests.
6. **Look tab**: glyph picker panel extraction + embed; color picker; image upload pipeline. Tests.
7. **Brain tab**: harness/model/note inputs wired through existing `PATCH /api/config`. Tests.
8. **Lifecycle tab**: archive/unarchive, reset-all, list view. Tests.
9. **Settings panel "Edit" button** wiring + final polish pass.
