# Roles page absorbs Plugins & Skills tabs (out of Settings)

**Date:** 2026-06-11
**Status:** Approved (Val, in-session)

## Problem

Plugins and Skills live in Settings (`/settings#plugins`), rendered by `PluginsSection` in `settings-shell.tsx`. Settings lacks workspace context, so that surface runs degraded by design: `familiars={[]}` and `window.location.href = "/"` stand-ins for the create-skill / create-plugin / open-chat CTAs. The code comments there explicitly defer to "a follow-up spec [that] threads real familiars through SettingsShell." Meanwhile the Roles page (workspace mode `"roles"`) renders the same `PluginsView` component with real familiars and real navigation — but only the `roles` and `workflows` tabs.

## Decision

Move the Plugins and Skills tabs to the Roles page; remove the Plugins section from Settings entirely. "Capabilities" in the original request refers to the Plugins tab — the separate sidebar Capabilities page is untouched. No duplicate surface remains in Settings (no pointer/redirect entry).

## Changes

### 1. `src/components/workspace.tsx` — Roles mode

```tsx
<PluginsView
  tabs={["roles", "workflows", "plugins", "skills"]}
  initialTab="roles"
  familiars={resolvedFamiliars}
  onOpenChat={() => setMode("chat")}
  onCreateSkill={() => setMode("capabilities")}
  onCreatePlugin={() => setMode("capabilities")}
/>
```

Only the `tabs` prop changes (explicit four-tab list, matching the component's default order). CTA wiring is already correct and now serves the plugins/skills tabs too, with real familiar context.

### 2. `src/components/settings-shell.tsx` — remove the Plugins section

- Drop `"plugins"` from the `Section` union type.
- Drop the `{ id: "plugins", label: "Plugins", icon: "ph:sparkle" }` entry from `SECTIONS`.
- Drop the `{section === "plugins" && <PluginsSection />}` render branch.
- Delete the `PluginsSection` component.
- Remove the now-unused `PluginsView` import.
- Update the two comments that cite `/settings#plugins` as the deep-link example (use a surviving section, e.g. `/settings#familiars`).

Deep-link compatibility: `initialSection()` already falls back to `"general"` for unrecognized hashes, so stale `/settings#plugins` links degrade gracefully. A repo-wide grep found no other references to `settings#plugins`.

### 3. Tests

- Update `roles-tools-navigation.test.ts` and `plugins-roles-detail.test.ts` if they assert the current two-tab `tabs` prop on the workspace call site.
- New/extended assertions: the workspace roles mode passes all four tabs to `PluginsView`; `settings-shell.tsx` no longer imports `PluginsView` nor declares a `plugins` section.

### 4. Explicitly out of scope

- `PluginsView` internals (tab rendering, data fetching) — unchanged.
- The sidebar Capabilities page (`capabilities-view.tsx`, workspace mode `"capabilities"`) — unchanged.
- API routes (`/api/roles`, `/api/skills`, `/api/capabilities`, `/api/marketplace`) — unchanged.

## Error handling

No new failure modes: the change is tab composition plus dead-code removal. The degraded-context hacks being deleted were the error-prone part.

## Testing

Repo convention: source-assertion tests run via `node --experimental-strip-types`, plus `tsc --noEmit`. Runtime verification: drive the app — Roles page shows four tabs with working content; Settings nav has no Plugins entry; `/settings#plugins` lands on General.

## Implementation note

Concurrent Claude sessions actively rewrite the primary checkout's working tree. All implementation happens in a `.worktrees/<branch>` worktree per repo convention; commits signed (`-S`).
