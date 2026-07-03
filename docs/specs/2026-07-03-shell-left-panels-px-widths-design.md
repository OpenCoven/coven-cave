# Shell left panels: pixel-based widths for full-width content usage

- **Date:** 2026-07-03
- **Status:** Approved design, pending implementation
- **Surface:** App shell (`src/components/shell.tsx`) — left nav panel and list panel

## Problem

The shell's left nav panel sizes by **percentage of the window** (`defaultSize="24%"`,
`minSize="14%"`, `maxSize="28%"`), and the list pane likewise (`18%` / `15%` / `33%`).
Percentages scale with monitor width, so the wider the screen the more space the
left side wastes:

| Window width | Nav default (24%) | Nav minimum (14%) |
|---|---|---|
| 1280px laptop | 307px | 179px |
| 1920px desktop | 461px | 269px |
| 3440px ultrawide | 826px | 482px |

A nav rail listing ~10 labels needs roughly 240px; on wide monitors the default
hands it 2–3× that, squeezing the main content. Even the *minimum* on an
ultrawide (482px) is wider than the intended full size. `globals.css` already
declares the intended widths — `--shell-nav-width: 240px`,
`--shell-list-width: 260px` (globals.css:110–111) — but the panels never honor
them; the vars are declarative only.

The main `.shell-detail` content area has no max-width cap of its own and
already absorbs any width the left panels release (verified: nav rail collapse
frees the space today), so fixing the left panels is sufficient for full-width
content usage. Chat prose width is separately governed by the user-facing
reading-width setting (`--cave-reading-width`, default `full` = uncapped) and
is out of scope.

## Goals

- The left nav and list panels default to content-appropriate **pixel** widths
  that do not scale with monitor size.
- The main content area receives all reclaimed width automatically (no new
  layout code — the detail panel already fills remaining space).
- Users keep full manual control: drag-resize, collapse-to-rail (nav, 56px),
  collapse-to-zero (list), hover-peek, and ⌘B / ⌘\ shortcuts all behave as today.

## Non-goals

- Changing the Home composer's centered `min(1200px, 100%)` composition — a
  deliberate design (see 2026-06 home composer work).
- Changing chat prose measure — already user-controlled via the reading-width
  setting.
- Any change to mobile, where the nav/list render as slide-in drawers with
  CSS-overridden positioning and are unaffected by panel percentages.

## Approaches considered

1. **Pixel-clamp the panels (chosen).** `react-resizable-panels` v4.12 supports
   px units natively; the codebase already uses them for the chat surface's
   `right-sidebar` panel (`defaultSize="230px" minSize="200px" maxSize="480px"`,
   chat-surface.tsx:474, pinned by `right-sidebar-fit.test.ts`). Realizes the
   intent the CSS vars already declare.
2. **Retune the percentages** (e.g. 24% → 16%). Cheap, but still monitor-scaled:
   an ultrawide nav would still balloon past 500px. Rejected.
3. **Default-collapse the nav to the 56px rail.** Maximal content width but
   hides labels for everyone and changes default behavior; already available
   manually via ⌘B. Rejected as a default.

## Design

### Panel size changes (`src/components/shell.tsx`)

Nav panel (currently lines 447–449):

```
defaultSize="240px"   // was "24%" — matches --shell-nav-width
minSize="200px"       // was "14%" — labels stay readable; below this, collapse to rail
maxSize="420px"       // was "28%" — generous manual stretch for file trees / long titles
```

List panel (currently lines 476–478):

```
defaultSize="260px"   // was "18%" — matches --shell-list-width
minSize="220px"       // was "15%"
maxSize="420px"       // was "33%"
```

Unchanged: `collapsible`, `collapsedSize` (56px nav rail via `NAV_RAIL_PX` /
0 for list and mobile), `NAV_OPEN_THRESHOLD_PX` open-detection (already
pixel-based via `size.inPixels`), the hover-peek overlay (232px, consistent
with the 240px default), separators, and the detail panel (no size props —
fills the remainder).

The nav slot hosts surface-specific sidebars (`sidebar-minimal`,
`chat-sidebar`, `code-sidebar`) which all inherit the panel width; no
per-sidebar changes needed.

### Saved-layout migration

Layouts persist as a percent map (e.g. `{"nav":26.5,"detail":73.5}`) under
`SHELL_GROUP_ID = "cave.shell.widths.v1"` (shell.tsx:35) in localStorage.
Existing users carry saved percentages produced under the old constraints;
whether RRP v4 re-clamps a restored layout against new px constraints is not
guaranteed. Rather than rely on it, **bump the group id to
`cave.shell.widths.v2`**: every user gets the new compact defaults once, and
subsequent drags persist under the new key. The existing corrupt-layout guard
in `shellStorage.getItem` still applies (v4 persistence format is unchanged).
One-time cost: users who deliberately widened the nav re-drag once.

### CSS var alignment

`--shell-nav-width` / `--shell-list-width` (globals.css:110–111) become
accurate descriptions of the defaults. Update the adjacent comment to note
that the authoritative values live in `shell.tsx` panel props (React props
cannot read CSS vars), so future edits change both together.

### Edge cases

- **Narrow desktop windows** (~900–1100px): nav 240px + list 260px consumes
  more relative width than today's percentages. Mitigations already exist —
  nav collapses to the 56px rail, list to 0, and the 2-pane surfaces don't
  render the list panel at all. Verify during implementation that RRP v4
  degrades sanely (proportional clamp) when the group is narrower than the
  summed px minimums; if it doesn't, lower `minSize` values are the fallback
  lever. Mobile is unaffected (drawer overlay).
- **Stale layouts:** handled by the key bump above.
- **Desktop (Tauri) app:** panel sizing is identical in the webview; the
  ResizeObserver re-fit fix from #2284 already covers detail-split re-measure
  on nav collapse. No app-side change.

## Testing

- **Source-text test** `src/components/shell-left-panels-fit.test.ts` modeled
  on `right-sidebar-fit.test.ts`: pin the nav panel's
  `defaultSize="240px" / minSize="200px" / maxSize="420px"`, the list panel's
  `260px / 220px / 420px`, and the `cave.shell.widths.v2` group id. Wire it
  into `run-tests.mjs` under the app suite (watch the ALIAS_LOADER 2-space
  anchor gotcha — a mis-indented entry lands the test in the wrong list and it
  runs loaderless in CI).
- **Manual/visual:** run the app at a wide viewport (≥2560px) and confirm the
  nav renders ≈240px with the detail area filling the remainder; drag-resize,
  ⌘B rail collapse, hover-peek, and list collapse still work; repeat at
  ~1000px width to confirm narrow-window behavior.
- Existing shell tests (`shell-drawer-smoke`, `mobile-shell-smoke`,
  `sidepanel-nav-peek`) pin CSS/drawer behavior only — no size pins — and
  should pass unchanged.

## Rollout

Single PR from `shell-left-panels-px-widths` (worktree
`.worktrees/shell-left-panels-px-widths`), squash-merged once the six
required checks are green.
