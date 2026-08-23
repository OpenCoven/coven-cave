# Waste-Free Half Splits — Design

**Date:** 2026-07-09
**Status:** Approved
**Bead:** `cave-x6rw`
**Scope:** Every operator page registered in the CovenCave workspace can render as either half of an exact two-pane split without dead space, shell overflow, clipped controls, or viewport-dependent layout mistakes.

## Problem

CovenCave already has a shared `DetailSplitHost`, a magnetic 50% detent, and drag-to-split navigation. The implementation is not exhaustive:

- `WorkspaceMode` has 17 built-in values, while the sidebar exposes only a subset and keeps a second hand-written mode type.
- primary navigation canonicalizes `groupchat` to Chat and `journal` to Grimoire, but secondary rendering bypasses that path; the same request can therefore render a different page in a split.
- `flow` and any unhandled mode silently fall through to `HomeComposer`, so a missing page looks valid.
- `page-drag.ts` excludes `journal`, `terminal`, and every dynamic `surface:*` role room.
- Settings and Dashboard are footer destinations outside the workspace registry, and Terminal is a context-bound rail panel rather than a page definition.
- the pane body applies a global 300px content floor and horizontal scrolling. That prevents catastrophic crushing, but it can conceal viewport-keyed layouts instead of making each page genuinely half-width responsive.
- source tests prove that split machinery exists, but no rendered matrix proves that every registered page fills either half without overlap or wasted strips.

The result is a split system that is plausible for selected pages rather than a contract the whole application must satisfy.

## Definition of “all pages”

The split contract covers every operator surface the native Cave shell can present as a workspace page:

1. all built-in `WorkspaceMode` values;
2. every visible dynamic `surface:<id>` role room;
3. split companions that behave as pages: Salem, Memory, Browser, and Terminal;
4. the Settings and Dashboard footer destinations, exposed through embeddable workspace adapters while retaining their standalone routes.

Aliases remain independently addressable requests but resolve to a live canonical surface and variant:

| Request | Canonical surface | Variant |
| --- | --- | --- |
| `groupchat` | Chat | Group |
| `familiar-work-queue` | Tasks | Queue |
| `calendar` | Schedules | Calendar |
| `roles` | Marketplace | Roles |
| `capabilities` | Marketplace | Capabilities |
| `journal` | Grimoire | Journal |

`flow` is not an alias. It must render the existing lazy `FlowView`; it may not fall through to Home.

Standalone drill-down documents reached from a registered page—individual analytics reports, daily-report documents, retro detail routes, and development mockups—remain standalone documents. Their owning workspace page must fit in a half; they are not additional workspace page identities.

## Approaches considered

### 1. Exhaustive registry plus shared pane contract — chosen

Create one compile-time-exhaustive page registry and make navigation, drag eligibility, primary rendering, secondary rendering, titles, availability, and verification consume it. Patch individual surfaces only where rendered evidence shows a pane-width failure.

This has the highest initial rigor but prevents future pages from shipping without declaring and testing split behavior.

### 2. Blanket containment CSS

Apply `min-width: 0`, `overflow: auto`, and `width: 100%` to all descendants. This is quick, but it converts many failures into hidden horizontal scrollbars and cannot catch dead aliases or inconsistent render paths.

### 3. Independent per-page split implementations

Give every surface its own two-column logic. This can look precise in isolation, but duplicates page identity, resize behavior, mobile fallback, accessibility, and tests. It would drift immediately.

## 1. Authoritative page registry

Add a pure, JSX-free `src/lib/workspace-page-registry.ts`. It owns page identity and resolution but not React components.

```ts
export const WORKSPACE_MODE_IDS = [/* all WorkspaceMode literals */] as const;

export type BuiltInWorkspacePageId = WorkspaceMode | "settings" | "dashboard";
export type CompanionPageId = "salem" | "memory" | "terminal";
export type WorkspacePageId = BuiltInWorkspacePageId | CompanionPageId | RoleSurfaceMode;

export type WorkspacePageVariant =
  | "default"
  | "group"
  | "queue"
  | "calendar"
  | "roles"
  | "capabilities"
  | "journal";

export type WorkspacePageDefinition = {
  id: BuiltInWorkspacePageId | CompanionPageId;
  title: string;
  canonicalId: BuiltInWorkspacePageId | CompanionPageId;
  variant: WorkspacePageVariant;
  nav: "daily" | "quiet" | "hidden" | "footer" | "companion";
  split: "always" | "contextual";
  landmark: string;
};
```

The built-in map must use `satisfies Record<WorkspaceMode, WorkspacePageDefinition>` so adding a mode is a compile error until the page declares its canonical surface and split behavior. Settings, Dashboard, and companions live in equally typed supplemental maps. Dynamic role surfaces resolve generically through the existing `surface:` prefix and role registry.

`resolveWorkspacePage(request)` returns a normalized page request containing the canonical page, variant, title, and availability policy. It never returns Home for an unknown id.

The sidebar, command palette, footer, keyboard shortcuts, and drag protocol use registry definitions instead of maintaining divergent unions and labels. Hidden pages remain reachable through the palette or their owning actions.

## 2. One rendering path for every pane

Replace `renderSurface(mode)` and the split-specific branches with one pane renderer:

```ts
type WorkspacePaneRequest = {
  instanceId: string;
  pageId: WorkspacePageId;
  variant: WorkspacePageVariant;
};

renderWorkspacePane(request, context)
```

Primary navigation and split opening both resolve raw ids through the registry before creating a `WorkspacePaneRequest`. This removes the current difference between `setMode(...)` and direct split rendering.

The request keeps a stable `instanceId`, so context-bound pages can own refs and local state without colliding with the primary instance. Exact duplicate page+variant requests remain deduplicated; different variants of one canonical surface, such as Chat Sessions and Chat Group, may coexist.

Promotion from secondary to primary carries the complete normalized request, including its variant. Alias activation no longer depends on timeout events racing a newly mounted surface.

### Embeddable adapters

- **Settings:** give `SettingsShell` an `embedded` mode. It fills its pane, suppresses route-level back/Escape behavior, and keeps section state local to that pane. `/settings` continues to render the same shell in standalone mode.
- **Dashboard:** extract the cockpit-loading boundary into an embeddable Dashboard surface. The standalone `/dashboard` route supplies the same model; the workspace adapter loads it through a dedicated API boundary rather than nesting a route or iframe.
- **Terminal:** register a contextual page adapter around `RailTerminalPanel`. It receives the active session/project context and shows the existing explicit empty state when no session is available. Each pane gets a stable PTY thread id derived from its `instanceId` so opening a split does not steal or remount another terminal.
- **Flow:** mount the existing lazy `FlowView` for `flow`; loading remains code-split.
- **Role rooms:** allow `RoleSurfaceMode` in `WorkspacePaneRequest` and render through the existing generic `RoleSurfaceHost`.

## 3. Exact pane geometry

The two-pane path remains resizable, but opening or resetting a pair produces mathematically equal **usable** pane widths after the separator is accounted for.

Rendered invariants, with a 1px rounding tolerance:

1. `abs(left.width - right.width) <= 1` at the default/reset detent;
2. `left.left == host.left`;
3. `right.right == host.right`;
4. `left.width + separator.width + right.width == host.width`;
5. exactly one separator occupies the gap; there is no margin, padding gutter, or trailing strip;
6. both pane frames and pane bodies have equal heights;
7. every page root fills its pane body in both axes.

When split, both primary and secondary panes use the same compact pane frame and title bar so their usable content starts at the same vertical coordinate. Solo mode renders no pane title bar.

The divider keeps free resize, the magnetic 50% detent, double-click reset, close-at-near-edge, and promote-at-far-edge behavior. The existing three/four-pane feature remains, but this work does not redesign its ratios; it must still cover the full host with no dead area.

The manual ResizeObserver refit remains as protection for Tauri webviews. The refit is tested against host-only width changes and must preserve the current ratio rather than forcing 50% after the user resizes.

## 4. Pane-width surface contract

Every registered page renders under a standard `.workspace-pane-page` root:

```css
.workspace-pane-page {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  container: workspace-pane / inline-size;
  overflow: hidden;
}
```

Page toolbars, grids, master-detail layouts, and side panels must respond to their owning container width rather than the browser viewport. The global `.split-host__pane-body > * { min-width: 300px }` fallback is removed once the page matrix is green.

Intentional scrolling is allowed only on the component that owns overflow:

- terminals and code viewers may scroll their content;
- tables may expose an explicitly labelled horizontal scroller when columns cannot compact further;
- lists and documents may scroll vertically;
- the shell, split group, pane frame, and generic page root may not leak overflow.

At narrow pane widths, controls wrap, collapse to icon/menu affordances, or switch from master-detail to one-pane detail navigation. They may not overlap, clip, shrink below existing touch-target contracts, or reserve blank columns.

## 5. Responsive and native behavior

Simultaneous halves are a desktop/native-window behavior when the split host has enough inline space. The fallback is driven by the split host's **container width**, not viewport width:

- at or above the simultaneous-fit threshold, render the real two-pane group;
- below it, keep both logical pages mounted according to their lifecycle needs but display one full-size pane at a time through the existing accessible tab switcher;
- the active tab fills the entire host, inactive panes do not reserve geometry, and switching does not lose state;
- phone controls retain 44px targets and safe-area handling.

The native Tauri shell uses the same DOM and registry. Validation must include a real Tauri launch and macOS traffic-light/titlebar geometry; browser-only simulation is supporting evidence, not the sole native proof.

## 6. Availability and failure isolation

Unknown page ids, missing dynamic role rooms, and contextual pages without required state render an explicit full-pane unavailable state. The state identifies the requested page, explains the missing context, and offers an appropriate recovery action. No request silently renders Home.

Each pane gets an error boundary. A failed lazy import or surface render replaces only that pane with a retryable error state; the sibling page, divider, and close/promote actions remain usable.

Async surfaces use full-pane skeletons with stable geometry. Loading and failure states must satisfy the same fill and overflow contracts as successful content.

## 7. Verification

### Registry and unit contracts

- `workspace-page-registry.test.ts` proves exact coverage of every `WorkspaceMode`, canonical alias/variant resolution, Settings/Dashboard/companion metadata, unknown-id rejection, and generic `surface:*` handling.
- existing sidebar, command-palette, page-drag, and split tests consume the registry and forbid local duplicate mode lists.
- page drag becomes positive-by-registry; no hard-coded `NON_SPLITTABLE` exceptions remain. Contextual availability is checked when the page opens, not by hiding the drag affordance.
- split geometry helpers prove deterministic 50% rounding and ratio preservation.

### Rendered exhaustive matrix

A Playwright spec obtains the registry's test manifest and exercises every page definition:

1. render the page as primary with a stable reference page as secondary;
2. render it as secondary on the left and right;
3. verify its success, loading, or honest-unavailable landmark;
4. assert equal default pane widths, full host coverage, one seam, equal body heights, root fill, no pane/shell/document overflow, and no overlapping visible controls;
5. repeat at representative 1440px, 1280px, and 1024px desktop/native widths;
6. exercise dynamic role rooms with deterministic mocked role data;
7. exercise the below-threshold switcher at tablet and phone widths and prove inactive panes reserve zero space.

The matrix must fail if a registry entry has no test landmark. This makes “all pages” self-updating when future pages are registered.

### Project gates

- targeted registry, split, and surface tests;
- `pnpm check:tests-wired`;
- `pnpm typecheck`;
- `pnpm test:app` and `pnpm test:mobile`;
- the exhaustive Playwright matrix plus the existing E2E suite;
- `pnpm build` and bundle budgets;
- real Tauri startup and a captured/inspected native split at a representative window size;
- independent code review with no unresolved Critical or Important findings.

## 8. Delivery sequence

1. land the exhaustive registry and normalized page requests behind source/unit tests;
2. route primary navigation and split opening through the same resolver;
3. make dynamic role rooms and existing built-ins split-addressable;
4. add Settings, Dashboard, Terminal, and Flow adapters;
5. enforce the standard pane root and exact two-pane geometry;
6. run the exhaustive rendered matrix, patching each surface's container behavior until all entries pass;
7. validate mobile/native behavior, complete review, and ship through the protected PR path.

The work stays in one integration bead because the registry and matrix are the acceptance authority. If an individual surface requires a substantial independent redesign, create a child bead linked to `cave-x6rw`; the parent remains open until every registry entry passes.

## Out of scope

- redesigning the visual content or information architecture of otherwise fitting pages;
- changing the maximum four visible workspace pages;
- persisting split layouts across app restarts;
- allowing two exact duplicates of the same page+variant;
- converting standalone drill-down documents into new workspace identities.
