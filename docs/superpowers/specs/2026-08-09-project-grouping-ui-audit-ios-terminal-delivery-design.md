# Project grouping, UX audit closeout, and iOS terminal composer

**Date:** 2026-08-09  
**Beads:** `cave-1vpy`, `cave-ui5z`, `cave-nv1dk.2`  
**Status:** Approved for implementation

## Delivery model

The three Beads remain independent delivery streams.

- `cave-1vpy` receives one web pull request.
- `cave-ui5z` is an evidence-based audit closeout. It receives a pull request
  only if the live conformance measurements require a repository change.
- `cave-nv1dk.2` receives one iOS pull request.

Each code change uses its own managed worktree and branch. Every applicable
pull request must pass the repository's required checks, receive a final diff
review, preserve exact-head merge safety, and land by squash merge before its
Bead closes.

## `cave-1vpy`: derived organization grouping

### Scope

Ship the first project-level grouping primitive without adding persisted tags
or changing the project API. Organization identity is derived:

1. Use the owner from a valid canonical GitHub repository link.
2. Otherwise use the normalized parent-directory leaf.
3. If neither exists, place the project in `No organization`.

Organization labels compare case-insensitively. A project linking or unlinking
a GitHub repository may move groups because the GitHub owner intentionally
outranks the filesystem fallback.

### Architecture

Add a pure client-safe derivation module that produces stable organization
keys and display labels from `CaveProject`. Compose existing
`ChatProjectGroup` values into organization groups rather than changing
session grouping or canonical project identity.

The Chat rail renders the approved hierarchy:

```text
Organization
  Project
    Chat
```

Organization sections and project sections are independently collapsible.
Organization expansion keys use an `org:` prefix in the existing persisted
expanded-key list, avoiding a second preference store and avoiding collisions
with project selection keys.

The Projects hub reuses the same derivation. Its project cards remain the
existing interactive access controls; organization sections replace the
current top-level workspace/repository split, while each card keeps its
workspace/repository icon and semantics.

### Ordering and search

- Chat organizations sort by their most recently active child project.
- Projects inside each Chat organization retain today's recency order.
- The Projects hub sorts organizations and projects alphabetically.
- Unregistered session roots and `No project` appear under the final
  `No organization` section.
- `No project` remains the final project bucket.
- Search reveals matching descendants regardless of stored collapse state.

Existing project selection, project drag/drop, chat ordering, and the
`__noproject__` behavior remain intact.

### Accessibility and failure behavior

Organization headers are real buttons with `aria-expanded`, a descriptive
accessible name, visible focus treatment, and text/count indicators. Empty or
unavailable metadata falls back to `No organization`; it never drops a
project or blocks rendering.

## `cave-ui5z`: conformance recount closeout

The Bead's referenced 70% to 90% heuristic scorecard is not present in the
repository history, so that percentage cannot be reproduced honestly. Current
conformance is enforced by the design-token drift test, design ESLint rules,
and codemod no-op checks.

Run the live authoritative measurements and record their exact output on the
Bead. If all gates pass, mark `cave-ui5z` superseded by the enforceable drift
gates and close it without a code pull request. If a gate fails, create only
the smallest repository fix needed, verify it, and use a normal pull request
before closure.

No missing scorecard is recreated from estimates.

## `cave-nv1dk.2`: accessible native terminal composer

### Components

- `TerminalCommand`: a pure parser for terminal-only slash commands.
- `TerminalComposer`: a focused SwiftUI view docked below xterm output and
  above the existing special-key row.
- A one-shot native chat handoff model carried through `AppModel`.

`PtyTerminal` remains the sole transport. `XtermWebView` keeps direct
character-mode input, resize, reconnect, scrollback replay, and rendering
ownership.

### Draft and send behavior

The composer is a native multi-line text field with a visible Send button and
an Ask Familiar action.

- Multi-line paste remains editable.
- Hardware Return sends.
- Hardware Shift+Return inserts a newline.
- Software-keyboard Return inserts a newline; the visible Send button submits.
- Send trims outer whitespace, appends exactly one newline, and keeps internal
  newlines.
- Empty drafts do not send.
- Send is disabled while disconnected or exited.
- A disconnected or immediately failed send preserves the draft and relies on
  the existing Reconnect or Restart banner for the next action.
- The draft clears only after the active transport accepts the frame.

### Terminal slash commands

The terminal command palette is distinct from chat slash commands.

- `/help` opens the terminal palette.
- `/clear` sends the existing `clear\n` behavior.
- `/cwd` opens the existing project picker.
- Unknown leading-slash input passes through to the shell unchanged.

Typing a recognized slash prefix shows discoverable matches. Selecting a
command may prefill or dispatch it according to the behavior above.

### Ask Familiar

Ask Familiar creates a safely quoted review prompt containing the draft and
the current cwd, switches to the existing native New Chat flow, and preselects
the matching project where available. After the user chooses a familiar, the
new thread opens with that review prompt persisted as its unsent chat draft.

The original terminal draft remains unchanged. The handoff never sends the
chat message automatically and never executes familiar-produced shell text.

### Accessibility

The composer stays outside `WKWebView`, follows Dynamic Type, exposes explicit
labels and hints for the field and actions, maintains at least 44-point touch
targets, and follows a stable VoiceOver order:

1. terminal output,
2. composer field,
3. Ask Familiar,
4. Send,
5. special-key row.

The command palette uses native focus and dismissal behavior. Reduced Motion
removes nonessential transitions.

## Verification

### Project grouping

- Pure tests for GitHub-owner derivation, parent fallback, case folding,
  Windows paths, malformed links, and no-organization cases.
- Grouping tests for organization recency, project recency, alphabetical hub
  order, unregistered roots, and final `No project`.
- Component tests for disclosure semantics, keyboard focus, persisted
  expansion, search reveal, and preserved drag behavior.
- Targeted app tests, lint, typecheck, build, and dark/light browser evidence
  for Chat and Projects.

### UX audit closeout

- Run the design-token drift test.
- Run lint, including design ESLint and codemod checks.
- Record exact current baselines and command results on `cave-ui5z`.

### iOS terminal composer

- Parser tests for recognized commands, unknown slash input, whitespace, and
  newline behavior.
- Policy tests for disconnected/exited submission, immediate send failure,
  cwd context, handoff quoting, and terminal-draft preservation.
- UI tests for field/actions, disabled states, Dynamic Type, keyboard behavior,
  and accessibility labels.
- Mobile tests and an iOS simulator build.

## Completion

For each code pull request:

1. Review the final scoped diff.
2. Push the branch and open a pull request.
3. Wait for all required checks on the exact head.
4. Read review threads and fix real findings.
5. Squash merge with exact-head protection.
6. Record verification and merge evidence on the Bead.
7. Close the Bead only after its completion criteria are satisfied.
8. Run the worktree lifecycle report and preserve or retire the unit according
   to the repository's retention rules.
