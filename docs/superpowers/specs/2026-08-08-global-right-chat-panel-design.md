# Global right chat panel

**Bead:** `cave-xxc55`  
**Status:** Approved design  
**Scope:** A shell-owned auxiliary chat available from every Cave surface

## Problem

Chat is currently a destination. A person working on Board, Code, Calendar,
Library, or another Cave surface must leave that context to continue a
conversation with a familiar.

The Cave already has a persistent, resizable left navigation panel with a
top-bar toggle. The requested interaction is its right-side counterpart: open
Chat beside the current surface, resize it, and close it without navigating
away. On the full Chat surface, the auxiliary panel must remain available so
two conversations can be viewed side by side.

A previous generic right companion panel was removed because it mixed several
unrelated tools into a second navigation system. This design does not restore
that abstraction. The new panel has one purpose: Chat.

## Decision

Add one dedicated `rightChat` slot to the shared `Shell`.

- On desktop, `rightChat` is a collapsible, resizable panel after the detail
  panel.
- On tablet and mobile, the same content renders in a modal drawer from the
  right edge.
- A top-right button mirrors the existing top-left navigation toggle.
- The panel is available on every workspace surface, including Chat.
- Opening it resumes the active familiar's most recent eligible chat.
- The panel keeps an independent chat router, so the main Chat surface and the
  auxiliary panel can show and operate different conversations.

The auxiliary panel is independent of `DetailSplitHost`. Page split tiles stay
temporary page layouts; right Chat is persistent shell utility chrome.

## Architecture

### Shell

`Shell` gains:

- an optional `rightChat` React node;
- imperative `openRightChat`, `closeRightChat`, and `toggleRightChat` methods;
- desktop open-state and width persistence;
- a right-side mobile drawer slot;
- a top-right toggle rendered in hydration-stable top-bar markup.

When `rightChat` is present, the horizontal panel group is:

`nav · optional list · detail · right chat`

The detail remains the primary flexible panel. Right Chat defaults to `360px`,
has a `320px` minimum and `640px` maximum, and collapses fully to `0`. Its
separator uses the existing shell separator treatment and accessible resize
semantics from `react-resizable-panels`.

The right panel's open state and last expanded width are global preferences,
not route-specific layout state. They survive surface navigation and app
relaunch. The panel starts closed only when no preference has been recorded.
Corrupt or unavailable storage falls back to closed at the default width
without preventing Chat from opening.

Opening Right Chat at a constrained desktop width may collapse the left
navigation to its existing icon rail. It must not hide the left navigation,
shrink Right Chat below its minimum, or shrink the detail below the shell's
existing usable minimum. Closing Right Chat restores a left panel that the
shell auto-collapsed unless the user changed the left panel while Right Chat
was open. This follows the existing code-rail/nav coupling rule.

### Workspace ownership

`Workspace` owns one auxiliary chat controller and passes its rendered node to
`Shell`. The controller stays mounted while the workspace mode changes so:

- transcript and composer state survive navigation;
- streaming work remains visible and is not restarted;
- closing the panel hides it but does not terminate or reset its chat;
- reopening returns to the same panel conversation unless the active familiar
  changed.

The controller uses the existing `ChatRouter` and `ChatView` behavior through a
focused `RightChatPanel` wrapper. It must not fork message rendering, streaming,
composer, attachment, tool-card, citation, or send logic.

The primary Chat surface keeps its own router. The two routers share canonical
session data and refresh signals, but they own independent selected-session,
scroll, composer, and view state. They may display the same canonical session;
switching the panel thread allows two different chats side by side. A mutation
to a shared session must propagate through the existing session refresh/cache
paths rather than a new panel-only synchronization channel.

## Session resolution

The first time the panel opens, and whenever the singular active familiar
changes, resolve that familiar's newest eligible session using the existing
chat recency helper:

1. Match the active familiar ID exactly.
2. Exclude archived or sacrificed sessions and sessions hidden by existing
   chat-list policy.
3. Order by the existing effective recency (`updated_at`, then `created_at`).
4. Open the newest result.
5. If none exists, show the normal new-chat state for that familiar.

The panel never substitutes another familiar. When the current scope has no
singular active familiar, such as All or a multi-familiar selection without an
active owner, it shows an explicit familiar chooser instead of selecting the
first roster entry.

Manual thread selection in the panel remains stable while the same familiar is
active. Closing and reopening does not re-resolve recency. Changing the active
familiar replaces the panel selection with the new familiar's latest eligible
session or new-chat state.

## Interaction design

### Top-bar toggle

The button sits at the far right of `.shell-top`, after the rendered surface
top bar. It uses the same dimensions, border, focus ring, active tint, and icon
state language as the left toggle.

Required semantics:

- label: `Open Chat panel` or `Close Chat panel`;
- `aria-expanded` reflects visibility;
- `aria-controls` points to the desktop panel or active mobile drawer;
- tooltip includes the keyboard shortcut;
- active tint is not the only indication of state.

Reuse the shared `toggleRightPanel` binding, which already defaults to `⌘⇧B` on
macOS and `Ctrl+Shift+B` elsewhere. The shortcut is documented in the Shortcuts
sheet and does not fire from editable controls. Keeping the existing binding
name preserves user overrides stored under `cave:keyboard-shortcuts:panels`.

### Panel header

The compact header shows:

- active familiar avatar and name;
- current thread title or `New chat`;
- a thread switcher scoped to that familiar;
- `New chat`;
- `Close Chat panel`.

The header stays single-row where possible and uses the existing overflow
pattern when the panel approaches its minimum width. It does not reproduce the
full Chat project/sidebar navigator.

### Desktop resizing

Dragging the separator changes the width continuously and persists the final
user-authored width. Programmatic layout changes, viewport changes, and panel
open/close transitions do not overwrite the preferred width.

The panel remains part of the inset shell: it sits on the shell floor while the
main detail keeps its existing elevated card treatment. Right Chat uses
tokenized surfaces, borders, spacing, and motion and must work across all
palette and mode combinations.

### Tablet and mobile

At the shell's existing `1023px` breakpoint and below, the desktop panel is not
mounted in the horizontal group. The top-right toggle opens a right-edge modal
drawer containing the same `RightChatPanel` instance.

The drawer:

- traps focus with the shared `useFocusTrap`;
- returns focus to the toggle when closed;
- closes on Escape, backdrop activation, or its explicit Close button;
- locks background interaction while open;
- announces open and close state;
- respects reduced motion;
- uses a viewport-safe width on tablet and full available width on narrow
  phones.

Closing the drawer does not reset the chat. Native iOS is not changed by this
design; this responsive behavior applies to the Cave web/Tauri shell.

## Data flow

1. The user activates the right Chat toggle.
2. `Shell` opens the desktop panel or mobile drawer and persists the explicit
   open preference.
3. `RightChatPanel` receives the current active familiar and session roster
   from `Workspace`.
4. If the familiar has no retained panel selection, the panel resolves the
   latest eligible session.
5. The independent `ChatRouter` opens that session or its familiar-bound
   new-chat state.
6. Existing chat APIs, stream handling, caches, and session refresh events
   handle reads and mutations.
7. Closing changes only panel visibility.

No new server endpoint, session schema, or panel-specific chat persistence is
introduced.

## Loading, empty, and error states

Use existing shared state components:

- roster or session loading: existing chat skeleton treatment;
- active familiar with no eligible sessions: normal familiar-bound new chat;
- no singular active familiar: explicit familiar chooser;
- daemon unavailable: existing Chat unavailable state and recovery action;
- session-list or conversation failure: explicit `ErrorState` with Retry;
- archived/deleted selected session: re-resolve the same familiar's latest
  eligible session, or show new chat when none remains.

Failures must not silently choose another familiar, discard a draft, start a
new session, or report success. If changing familiar scope would replace a
non-empty unsent draft, preserve the draft per familiar for the panel's mounted
lifetime rather than dropping it.

## Accessibility

- The desktop panel is an `aside` named `Chat panel`; the main Chat surface
  remains the primary chat landmark.
- Toggle, thread switcher, New chat, Close, and composer controls use visible
  focus rings and truthful accessible names.
- The resize separator remains keyboard operable through the panel library.
- The mobile drawer is modal, focus-trapped, labelled, and returns focus.
- Open, close, familiar change, and new-session mutations use the shared
  announcer where appropriate.
- Familiar identity, streaming state, and errors use text or icon-plus-text;
  color is never the only channel.
- Motion follows shell duration/easing tokens and the global reduced-motion
  contract.

## Testing

Targeted tests must cover:

### Shell

- the right toggle is present on every workspace mode when `rightChat` exists;
- toggle labels, `aria-expanded`, `aria-controls`, icon state, and shortcut;
- open state and user-authored width persist globally;
- corrupt storage falls back safely;
- resize limits preserve usable detail width;
- constrained-width auto-collapse and conditional restore of the left nav;
- Right Chat remains independent from `DetailSplitHost` page tiles;
- the retired generic companion rail and companion tabs do not return.

### Chat behavior

- first open selects the active familiar's latest eligible session;
- archived, sacrificed, and policy-hidden sessions are excluded;
- no eligible session opens familiar-bound new chat;
- no singular familiar shows the chooser without a silent default;
- familiar changes resolve that familiar's latest session;
- same-familiar close/reopen preserves the chosen thread and draft;
- primary and auxiliary routers can hold different sessions on Chat;
- updates to a session visible in both routers reconcile through existing
  cache/refresh behavior;
- closing the panel does not stop a running response.

### Responsive and accessibility

- desktop renders a resizable panel and mobile renders only the overlay drawer;
- Escape, backdrop, and Close dismiss the drawer;
- focus is trapped and returned to the toggle;
- reduced motion suppresses drawer animation;
- unique landmark names and keyboard resize behavior pass accessibility checks.

Add a self-contained Playwright path that opens the panel from a non-Chat
surface, resizes it, navigates without closing it, then verifies two
independent chats on the Chat surface. The test must use mocked Cave APIs and
must not require a live daemon.

## Out of scope

- Restoring a generic companion panel, companion tabs, or a right navigation
  rail.
- Moving Salem, Memory, Browser, inspector content, or page split tiles into
  Right Chat.
- More than one auxiliary Chat panel.
- Detaching Chat into another native window.
- New chat APIs, session storage, or streaming protocols.
- Redesigning the full Chat surface or project/session sidebar.
- Changing the native iOS layout.

## Acceptance criteria

1. Every Cave surface exposes a mirrored top-right Chat toggle.
2. Desktop opens a shell-owned right panel that can be resized between `320px`
   and `640px` and remembers its open state and width.
3. Tablet and mobile open the same chat as a focus-trapped right overlay
   drawer.
4. First open resumes the active familiar's newest eligible chat; no chat opens
   the familiar-bound new-chat state.
5. The panel never silently selects another familiar.
6. Closing and reopening preserves the current panel chat and draft.
7. The full Chat surface can show a primary conversation and an independently
   selected auxiliary conversation side by side.
8. Surface navigation and page split tiles remain functional while Right Chat
   is open.
9. Existing chat rendering, sending, streaming, session refresh, empty states,
   and errors are reused rather than reimplemented.
10. The retired multi-purpose right companion architecture does not return.
