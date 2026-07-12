# OpenTrust Sidepanel Parity Design

**Bead:** `cave-9q0v`

**Reference:** `OpenKnots/OpenTrust` at `11a4ac9`

**Target:** Coven Cave branch based on `origin/main` at `0c00c069`

## Goal

Make Coven Cave's left sidepanel read and behave like the sidepanel in
OpenTrust while preserving Coven Cave's product language and existing
capabilities. Parity includes composition, proportions, collapsed and mobile
states, navigation hierarchy, active and badge states, utility placement,
identity selection, keyboard behavior, and accessibility. It is not a
cosmetic-only recolor.

The result must cover both left-panel hosts:

1. `SidebarMinimal`, shown on non-Chat workspace surfaces.
2. `WorkspaceSidebar`, shown on Chat and responsible for project/thread
   navigation.

## Reference Contract

The OpenTrust source is the authoritative visual and interaction reference.
The following behaviors are load-bearing.

| OpenTrust source | Reference behavior | Coven Cave mapping |
| --- | --- | --- |
| `components/ui/sidebar.tsx` | 16rem expanded, 3rem icon rail, 18rem mobile sheet; 200ms linear width transitions; icon-only collapsed state; tooltips on collapsed rows | Keep Cave's `react-resizable-panels` shell, but use 256px expanded and 48px rail constants, 288px mobile drawer presentation, matching transitions, and existing titles/tooltips |
| `components/app-sidebar.tsx` | Header, content, primary navigation, labeled tool group, lower secondary actions, separator/attribution, identity footer | Give both Cave panel hosts the same region ordering and shared chrome components |
| `components/sidebar-01/nav-header.tsx` | 48px large brand row with a 32px product mark and two-line identity | Render a `Coven Cave` / `OpenCoven` brand row using the local app icon; keep it meaningful in expanded mode and icon-only in the rail |
| `components/sidebar-01/nav-main.tsx` | Prominent primary action beside a compact search button, followed by compact primary destinations | Map to `New chat` + command search, then Home, Chat, Tasks, and Schedules |
| `components/sidebar-01/nav-documents.tsx` | Labeled content/tool group; compact rows; trailing badges/actions; group hidden in the icon rail | Map to Journal, Grimoire, Marketplace, GitHub, and registry-provided role rooms; preserve badges and page drag-to-split; hide labels/group heading in the rail but keep destination icons reachable |
| `components/sidebar-01/nav-secondary.tsx` | Small utility rows pinned to the bottom of scrollable content | Map to Dashboard, Settings, and Search with existing callbacks/links |
| `components/sidebar-01/nav-user.tsx` | Large identity/status trigger in the footer; menu opens away from the panel; label disappears in collapsed mode | Present the familiar scope switcher as the footer identity control, preserving single/multi/all scopes, response-needed state, avatars, and menu behavior |
| `app/globals.css` | Active row has a 3px leading accent, tinted wash, and inset glow; compact typography and 8px/7px row sizing | Reproduce the geometry and state hierarchy with Cave theme tokens (`--accent-presence`, sidebar surface/text tokens) rather than copying OpenTrust red |

## Chosen Approach

Use semantic parity, not a literal framework transplant.

OpenTrust's sidebar primitive depends on Base UI, Tailwind utility composition,
cookie-backed provider state, and fixed positioning. Coven Cave already has a
feature-rich resizable shell with persisted pixel layouts, hover peek, native
titlebar behavior, mobile drawers, split panes, and several shell-level tests.
Replacing that shell would add risk without improving user-visible parity.

Instead:

- Keep Cave's shell state, resize persistence, mobile drawer, hover peek, and
  shortcut plumbing.
- Add a small set of shared sidepanel chrome components and class contracts
  shaped after OpenTrust's regions.
- Adapt the two Cave panel hosts to those shared regions.
- Retune shell constants and CSS to the reference dimensions and state
  language.
- Preserve Cave-specific navigation and data flow inside the new composition.

## Information Architecture

### Shared product header

The top region is a static product identity, matching OpenTrust's large header
row:

- Local Coven Cave icon in a 32px rounded tile.
- `Coven Cave` as the primary label.
- `OpenCoven` as the quiet secondary label.
- In the 48px rail, only the centered product mark remains.

The shell's existing floating panel toggle and Command-B shortcut continue to
own expansion. The brand row is not a second collapse button.

### Primary action and search

Immediately below the header:

- `New chat` is the emphasized full-width action.
- Search is a 32px outlined icon action beside it.
- Search dispatches the existing Command-K path, so the sidebar and keyboard
  shortcut open the same command palette.
- In the rail, the search action is hidden and `New chat` becomes the centered
  32px primary icon, matching OpenTrust.

`WorkspaceSidebar` uses the same row. Its existing New Chat behavior remains
the action callback; its existing search field moves into the thread-content
region rather than competing with the global command-search action.

### Primary navigation

The standard sidebar's primary group contains the daily destinations in this
order:

1. Home
2. Chat
3. Tasks
4. Schedules

Rows remain buttons because Cave navigation is callback-driven. Existing
keyboard shortcuts, `aria-current`, badges, descriptions, and page mode
derivation stay intact.

The Chat sidebar does not duplicate these destinations. Its primary content is
the project/thread navigator, because replacing that with app navigation would
remove the core Chat workflow. It receives the same row geometry, states,
header, action row, lower utilities, and footer so the host still belongs to
the same sidepanel system.

### Tools and contextual content

The standard sidebar renders a labeled `Cave tools` group containing:

- Journal
- Grimoire
- Marketplace
- GitHub
- Role rooms supplied by the role-surface registry

The group preserves:

- count badges;
- active versus split-open state;
- native descriptions/tooltips;
- drag-to-split payloads and events;
- roving vertical keyboard navigation.

Role rooms appear under a nested quiet `Rooms` label inside the same tool
region, rather than as an unrelated cluster below the entire navigation.

The Chat sidebar uses its project/thread list as the contextual region. Its
organize menu, project avatars, running counts, pinned/active states, recent
grouping, and thread navigation remain functional. The recent activity rollup
is retained only on the standard sidebar and styled as contextual content
below the tools group.

### Lower utilities

A compact utility group sits at the bottom of the scrollable content, matching
OpenTrust's `NavSecondary` placement:

- Dashboard
- Settings
- Search

Dashboard remains a real `/dashboard` link. Settings uses the existing
callback. Search uses the same command-palette event as the primary search
button. The duplicate search entry intentionally mirrors OpenTrust: the icon
button is optimized for quick access, while the labeled lower row is
discoverable.

### Footer identity

The footer contains:

1. a separator;
2. a quiet `Coven Cave v{version}` attribution line;
3. the familiar scope selector presented as a 48px identity row.

The identity row reuses `FamiliarSwitcher` behavior rather than creating a
second familiar menu implementation. Expanded mode shows avatar/glyph,
resolved familiar or multi-scope label, quiet scope/status text, and a trailing
caret. Rail mode shows only the centered avatar/glyph and exposes the full label
through its accessible name/title. The popover opens to the right/up as needed
so it does not clip inside the panel.

Both standard and Chat hosts use the same footer component. This removes the
current mismatch where familiar identity is at the top of one host and in the
header of the other.

## Shared Component Boundaries

Create `src/components/sidebar-chrome.tsx` with focused components:

- `SidebarBrand`: static product identity row.
- `SidebarPrimaryActions`: New Chat plus global Search.
- `SidebarSectionLabel`: compact group heading with rail hiding behavior.
- `SidebarUtilityNav`: Dashboard, Settings, and Search rows.
- `SidebarIdentityFooter`: version attribution plus familiar switcher.
- `openSidebarSearch()`: one event helper used by both search affordances.

These components own composition and accessible labeling, not application
state. They receive callbacks and the familiar data already held by Workspace.
They do not fetch, persist, or interpret sessions.

`SidebarMinimal` continues to own its destination model and split-page events.
`WorkspaceSidebar` continues to own projects, thread grouping, and organizer
state. `Shell` continues to own width, collapsed state, hover peek, drawer
state, and keyboard shortcuts.

## Shell and Responsive Behavior

- Change `NAV_OPEN_PX` from 240 to 256.
- Change `NAV_RAIL_PX` from 56 to 48.
- Bump the persisted shell layout key so stale 240/56 layouts cannot override
  the new contract.
- Keep Cave's 1023px mobile/tablet boundary because it coordinates the whole
  multi-pane app, not only the sidebar.
- Set the nav drawer's visual width to 288px, matching OpenTrust's 18rem mobile
  sheet while retaining `MobileDrawer` behavior and focus management.
- Keep drag resize, Command-B toggle, floating titlebar toggle, and hover peek.
- Ensure both expanded and rail content stay centered and clipped without
  horizontal scrollbars.
- Respect reduced motion by disabling nonessential width/opacity animation
  through the repo's existing reduced-motion rules.

## Visual Language

Parity uses OpenTrust's geometry with Cave's theme system:

- 8px outer padding per region.
- 32px default menu rows and actions.
- 48px brand and identity rows.
- 16px navigation icons.
- 8px row gaps only between major regions; zero/near-zero gaps inside menus.
- Medium active label weight; regular inactive rows.
- 3px leading active indicator plus a subtle accent wash and inset glow.
- Quiet 12px section labels and utility rows.
- Hairline separator before attribution/footer.
- No new hard-coded OpenTrust red, product name, remote image, or font.

Collapsed state is a designed rail, not a squeezed expanded panel:

- centered 32px targets;
- labels, section headings, attribution, badges, and trailing controls hidden;
- active indicator remains visible;
- native title/tooltip names every target;
- the familiar avatar remains the final identity target.

## Data Flow and Preservation Rules

Workspace already supplies every required input. The changes only rearrange
presentation:

```text
Workspace
  ├─ mode / splitPageModes / roleSurfaces / counts
  │    └─ SidebarMinimal → shared chrome + Cave destination groups
  ├─ sessions / projects / organizer state
  │    └─ WorkspaceSidebar → shared chrome + thread content
  ├─ familiar scope / response-needed state
  │    └─ SidebarIdentityFooter → existing FamiliarSwitcher
  └─ shell callbacks
       └─ Shell → 256px expanded / 48px rail / 288px drawer
```

The implementation must not remove or silently change:

- familiar single, multi, or all scopes;
- response-needed signals;
- live destination counts;
- active and split-open distinction;
- role-surface registry rendering;
- page drag-to-split;
- project/thread organizer modes;
- Recent Activity session opening;
- Dashboard and Settings access;
- Command-K and Command-B behavior;
- mobile drawer dismissal after navigation.

## Error Handling

The sidepanel introduces no new network calls. Existing empty and failure states
remain owned by their current components. Shared chrome must fail soft when:

- no familiar is active (`All familiars` identity);
- the familiar roster is empty (existing switcher empty action remains
  available);
- counts are missing or zero (badge omitted);
- role rooms are absent (nested label omitted);
- browser storage is unavailable (Shell's existing persistence fallback
  remains authoritative).

No sidepanel control may render a convincing disabled state for a failed load;
existing error UI in the nested feature remains visible.

## Accessibility and Input

- Keep the sidepanel a named navigation landmark.
- Preserve one vertical roving tab stop for standard destination rows.
- Keep project/thread keyboard behavior in `WorkspaceSidebar`.
- Use native links for Dashboard and buttons for callback navigation.
- Continue to expose `aria-current="page"` only for the primary active surface;
  split-open rows use a separate visible state without claiming current page.
- Every icon-only rail control has an accessible name and title/tooltip.
- Search icon action has `aria-label="Search"`.
- Group labels are hidden from the accessibility tree only where they are
  purely visual; meaningful group structure remains discoverable from row
  order and labels.
- Mobile targets retain the shared 44px minimum touch target override.
- Active state uses indicator, background, and text weight rather than color
  alone.
- Focus rings must remain visible in expanded, rail, and drawer states.

## Testing Strategy

### Source and unit tests

Add a dedicated parity test wired into `scripts/run-tests.mjs` that pins the
reference contract without snapshotting incidental markup:

- shared brand/action/utility/identity regions exist;
- both sidebar hosts use shared chrome;
- standard destinations are split into primary and tools groups;
- role rooms, badges, activity, split state, and page dragging remain wired;
- search actions use one helper;
- shell dimensions and persisted layout key match 256/48;
- rail hides labels but retains icon targets and identity;
- active row uses a 3px leading indicator plus tokenized wash;
- no OpenTrust red/name/remote favicon is copied.

Update existing sidebar, footer, shell sizing, mobile smoke, rail, and Chat
wiring assertions to the new intentional structure. Run each changed test first
and observe the expected failure before production edits.

### Browser verification

Use the real Coven Cave app in demo mode and capture:

1. Standard sidebar, expanded, on Home.
2. Standard sidebar, 48px rail, with an active destination and badge.
3. Chat sidebar, expanded, with projects/threads.
4. Chat sidebar rail.
5. Mobile drawer at a phone viewport.
6. Familiar identity menu opening from expanded and rail states.
7. Keyboard smoke: Arrow navigation, Command-K Search, Command-B toggle.

Compare those states against a running or source-faithful OpenTrust reference,
checking region order, dimensions, row density, active state, rail centering,
footer placement, and drawer width. The comparison is visual evidence in
addition to tests, not a replacement for them.

### Final gates

- Targeted changed tests.
- `pnpm test:app`.
- `pnpm exec tsc --noEmit`.
- `pnpm build` when the sidebar and shell tests are green.
- Real-app browser verification through the repo's supported launch workflow.

## Non-goals

- Copying OpenTrust product names, red branding, remote OpenClaw favicon, or
  operator/demo/auth menu items.
- Replacing `react-resizable-panels` with OpenTrust's fixed Base UI provider.
- Changing workspace routes, command bindings, or shell breakpoint policy.
- Redesigning the command palette, familiar switcher menu contents, project
  organizer, recent activity data, or role-surface registry.
- Adding row overflow actions that have no valid Cave semantics.

## Completion Evidence

The bead is complete only when all four acceptance groups are proven:

1. **Geometry and composition:** source plus rendered measurements prove
   256/48/288 widths and OpenTrust region ordering in both hosts.
2. **Behavior preservation:** tests and runtime interaction prove routing,
   familiar scope, badges, split state, role rooms, activity, project/thread
   navigation, keyboard commands, and mobile dismissal.
3. **Visual parity:** side-by-side evidence covers expanded, rail, Chat, and
   mobile states.
4. **Quality gates:** targeted tests, app suite, typecheck, and build are
   green from the implementation worktree.
