# Screenshots

This directory holds the canonical screenshots referenced from the
top-level `README.md`. They are the marketing surface of the Cave
desktop app — capture them carefully.

## Required captures

The README expects these files to exist. Replace any missing entries.

| File              | What to show                                                                                 | Status      |
|-------------------|----------------------------------------------------------------------------------------------|-------------|
| `home.png`        | HomeComposer cold-start: hero, composer with Nova selected, three resolved suggestions       | **landed**  |
| `shell.png`       | Familiars shell — sidebar, Chats/Floor/Memory tabs, daemon-offline warning, empty-state CTA  | **landed**  |
| `board.png`       | Board view — 4-column kanban (Backlog/Inbox/Running/Review) with real cards                  | **landed**  |
| `library.png`     | Library three-pane layout — research rail, document list, preview slot                       | **landed**  |
| `calendar.png`    | Calendar week view — today highlighted, view-mode toggle, real demo event                    | **landed**  |
| `floor.png`       | Coven Floor surface, Floor tab active                                                        | **landed**  |
| `terminal.png`    | Terminal mode — empty state with "+ New terminal" CTA                                        | **landed**  |
| `chat.png`        | Chat view mid-conversation between user and Cody, with a TypeScript code block               | **landed** (\*) |

(\*) `chat.png` is captured against mocked endpoints
(`/api/sessions/list`, `/api/familiars`, `/api/chat/conversation/[id]`)
because the local `coven` daemon's session ledger was empty at
capture time. The conversation is the "Phase 2A: relay PR" demo
scripted in `scripts/capture-chat-screenshot.mjs`. The async
markdown renderer (`mdToHtml` in `MessageBubble`) hasn't fully
resolved by screenshot time — bullets render as raw `**…**` and
the code block is unhighlighted. For the next refresh, either bump
the post-click wait further, or capture manually against a real
populated session.

## Capture settings

- **Resolution**: 2× retina (logical 1440×900 minimum, exported at full pixel density)
- **Format**: PNG, no transparency
- **Window chrome**: native macOS chrome on the `.dmg`-bundled app; the screenshots showcase the desktop product, not the browser dev view
- **Theme**: dark mode (the app is dark-only)
- **State**: use real data (a running daemon with familiars/sessions) when capturing shots
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
