# Screenshots

This directory holds the canonical screenshots referenced from the
top-level `README.md`. They are the marketing surface of the Cave
desktop app — capture them carefully.

## Required captures

The README expects these files to exist. Replace any missing entries.

| File              | What to show                                                                                 | Status   |
|-------------------|----------------------------------------------------------------------------------------------|----------|
| `shell.png`       | Three-pane shell with sidebar + chat + agent panel; an active familiar with a live session   | needed   |
| `chat.png`        | Chat view mid-conversation, including a markdown reply with a syntax-highlighted code block  | needed   |
| `terminal.png`    | Dedicated terminal page inside Cave, showing an active xterm session                         | needed   |
| `home.png`        | HomeComposer cold-start with the new suggestion skeletons → resolved suggestions             | needed   |
| `board.png`       | Board view with kanban + filter popover open                                                 | needed   |
| `library.png`     | Library three-pane layout with a doc preview                                                 | needed   |
| `calendar.png`    | Calendar week view with the new view-mode toggle                                             | needed   |
| `floor.png`       | Coven Floor session traceability surface                                                     | needed   |

## Capture settings

- **Resolution**: 2× retina (logical 1440×900 minimum, exported at full pixel density)
- **Format**: PNG, no transparency
- **Window chrome**: native macOS chrome on the `.dmg`-bundled app; the screenshots showcase the desktop product, not the browser dev view
- **Theme**: dark mode (the app is dark-only)
- **State**: real data over demo fixtures where possible; use `NEXT_PUBLIC_DEMO=true pnpm dev` for the curated demo familiars when capturing marketing-clean shots
- **PII**: scrub any session titles, file paths, or message bodies that contain personal info before committing

## How to capture

1. `pnpm tauri dev` (native window — preferred) or `pnpm dev` (browser fallback)
2. Resize the window to the target dimensions
3. Use the OS screenshot tool:
   - macOS: `⌘⇧4` then `space` then click the Cave window
   - Linux/Windows: equivalent native shortcut
4. Save to `screenshots/<file>.png`
5. Run `pngcrush -reduce -brute -ow screenshots/<file>.png` to keep the diff small (optional but appreciated)
6. Open a PR replacing the placeholder

## Context

This directory was bootstrapped as part of the design-system uplift in
commit `e24f879` (`feat(ui): comprehensive design-system token + primitive uplift`).
The prior screenshots in the README were dead links; this directory + the
release-standard checklist make the screenshot refresh trackable as a PR.
