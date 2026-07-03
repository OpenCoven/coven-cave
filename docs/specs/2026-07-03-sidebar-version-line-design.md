# Sidebar version line — design

- **Date:** 2026-07-03
- **Status:** Approved (user approved design in-session)
- **Surface:** Default nav sidebar (`src/components/sidebar-minimal.tsx`)

## Problem

The app version is not visible anywhere in the main chrome. The user wants it
shown at the bottommost position of the left sidebar with minimal height.

## Design

Render a single muted text line `v{APP_VERSION}` as the last child of the
sidebar nav, directly below the `.sidebar-foot` icon row (Dashboard /
Notifications / Settings), so it is the bottommost element.

- **Version source:** `APP_VERSION` from `src/lib/app-version.ts` (package.json
  version; `app-version.test.ts` already pins it in sync with
  `tauri.conf.json`, `Cargo.toml`, and the iOS plists — it is the real app
  version on web and desktop).
- **Markup:** `<div className="sidebar-version" title={`CovenCave v${APP_VERSION}`}>v{APP_VERSION}</div>`
  — plain text, no interactivity (YAGNI; a Settings/About link can come later).
- **Minimal height:** ~16px total — `font-size: 10.5px`, `line-height: 1`,
  `padding: 3px 6px 4px`, centered, `color: var(--text-muted)`,
  `user-select: none`. The footer above already has no bottom padding.
- **Rail mode:** hidden (`.shell-nav--rail .sidebar-version { display: none }`)
  — the 56px rail has no room for text, consistent with all other labels.
- **Scope:** `sidebar-minimal` only; the chat/code sidebars are separate
  components and unchanged. Mobile drawer shows it (it renders the same
  component expanded).

## Alternatives rejected

- Fourth item inside the `.sidebar-foot` icon row — zero added height but
  clutters an evenly-spaced icon row.
- Version as a button/link — plumbing without a request behind it.

## Testing

Append source-text assertions to the existing `sidebar-minimal.test.ts`
(already wired in `SUITES.app`): the `APP_VERSION` import, the
`.sidebar-version` element rendered immediately before `</nav>` (pins
"bottommost"), the CSS block, and the rail hide rule.
