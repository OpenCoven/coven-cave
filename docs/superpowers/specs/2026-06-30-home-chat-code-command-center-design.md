# Home, Chat, and Code Command Center — Design

**Date:** 2026-06-30
**Status:** Approved design; pending spec review
**Surfaces:** `HomeComposer`, `ChatSurface` / `ChatView`, `CodeView`, Quick Chat

## Goal

Make Coven Cave feel like a single coherent command environment instead of a
set of adjacent launchers. The home page becomes the primary command center:
clear enough for first use, dense enough for daily maintainer work, and explicit
about what will run before the user sends.

The same execution controls must behave consistently across Home, Chat, Code,
and Quick Chat:

- familiar
- project / runtime root
- destination or workspace mode
- runtime / harness
- model
- thinking effort
- response speed

The work should improve the visible Home experience and reduce switching drift
at the same time. A polished Home without shared behavior is not sufficient;
shared behavior with no visible UX lift is also not sufficient.

## Current State

- `src/components/home-composer.tsx` is the cold-start intent surface. It can
  start chat or create a board task. It already renders familiar, project,
  destination, runtime, and model selectors.
- Home runtime changes write familiar config through `/api/config` and select
  `defaultModelForRuntime(runtime)`. Home model changes write
  `/api/chat/model-state` with `scope: "familiar-default"`.
- `src/components/chat-view.tsx` owns the richer live send path. It persists
  composer preferences for `thinkingEffort` and `responseSpeed`, sends them to
  `/api/chat/send`, and supports session-scoped model intent.
- `src/app/api/chat/send/route.ts` accepts `reasoningEffort`,
  `responseSpeed`, `modelOverride`, and `modelOverrideScope`. It normalizes
  speed server-side and gates model forwarding through the existing harness
  capability checks.
- `src/components/workspace.tsx` mounts `ChatSurface` directly for Chat mode
  and embeds the same `ChatSurface` inside `CodeView` for Code mode. Code should
  not grow a separate chat implementation.
- Quick Chat now exists as a compact tray surface (`src/app/quick-chat`,
  `src/components/tray-quick-chat.tsx`, `src/lib/quick-chat.ts`). It resolves
  `@familiar` targets, streams text, and can open the saved full session.

## Chosen Approach

Use a **Home-first command center with a shared switching contract**.

Home gets the strongest visual and interaction polish because it is the first
screen and the place where users choose intent. Shared control state and helper
logic are introduced where they prevent drift across Home, Chat, Code, and
Quick Chat. This is intentionally not a new global store; the contract should
wrap the existing persistence scopes and API routes.

Rejected alternatives:

- **Switching infrastructure first:** lower user-facing payoff and easy to
  overbuild before validating the interface shape.
- **Quick Chat first:** useful, but it would let the tray surface lead the main
  product. Quick Chat should become the compact version of the same command
  contract after Home defines it.

## Product Design

### Home command center

Home should read as an operational command deck, not a marketing landing page.
The first viewport should contain:

- a concise project-aware heading
- a large direct intent composer
- an execution strip grouped by purpose
- recent resumable sessions below the composer
- digest / ambient context below the primary command area

The execution strip is grouped as:

1. **Who and where:** familiar, project
2. **What kind of action:** chat / task destination
3. **How it runs:** runtime, model, thinking effort, response speed
4. **Commit action:** send

The controls stay visible before send. Slash commands remain useful shortcuts,
but they should not be the only way to discover model or execution controls.

Responsive behavior:

- Desktop: controls can span one or two compact rows without layout jump.
- Narrow windows / mobile: controls wrap into stable groups with no overlapping
  labels, clipped select text, or expanding hover states.
- Code-mode width: labels may collapse to short values where needed, but the
  selected value must remain visible.

### Chat

Chat keeps its transcript-first flow, but the same execution contract should be
visible near the composer. Session-scoped model intent remains the default for
active conversations. Thinking effort and response speed continue to persist as
composer preferences and must still be sent on every chat request.

The user should be able to switch model, thinking effort, and speed without
losing draft text, selected project, attachments, or active session state.

### Code

Code continues to embed `ChatSurface`. It should use the compact form of the
same control contract and not fork the switching logic. Code-specific project
navigation still belongs to `CodeSidebar` / `ComuxView`; the chat execution
controls should describe the chat run, not replace file or diff controls.

### Quick Chat

Quick Chat becomes the tray-sized version of the command center. It should:

- resolve `@familiar` the same way it does now
- show the resolved familiar before send
- expose compact model / thinking / speed controls where space allows
- stream through the same familiar send helper
- open the authoritative saved session in the main window

Quick Chat must remain lightweight. It should not introduce a separate
conversation persistence path.

## Architecture

### Shared control model

Add a small client-safe helper layer for command-control behavior. The exact
file names can change during implementation, but the boundaries should be:

- a pure module for option catalogs and state derivation
- a hook or adapter for API-backed model/runtime persistence
- small presentational controls that can render full or compact density

The shared model should represent:

- `familiarId`
- `projectRoot`
- `runtime`
- `model`
- `modelScope`: `familiar-default`, `session`, or `next-message`
- `thinkingEffort`
- `responseSpeed`
- `surface`: `home`, `chat`, `code`, or `quick-chat`

It should not replace server authority. `/api/chat/model-state`, `/api/config`,
and `/api/chat/send` remain the persistence and execution boundaries.

### Runtime and model rules

- Home runtime switch writes familiar config and resets the familiar model to
  `defaultModelForRuntime(runtime)`.
- Home model switch writes `scope: "familiar-default"`.
- Chat model switch writes `scope: "session"` when a session exists; otherwise
  it falls back to `scope: "familiar-default"`.
- Next-message model overrides stay one-shot and must not be saved into config.
- OpenClaw / runtime-managed model menus continue to show as runtime-managed
  when no local model catalog exists.
- Every send path must tolerate stale or synthetic model ids using the existing
  model-state cleanup helpers.

### Thinking and speed rules

- Chat remains the source of truth for valid thinking and speed values.
- Home should expose the same thinking effort and response speed choices before
  starting a chat.
- A Home-started chat passes the selected thinking and speed values into the
  first send through the existing ChatSurface handoff path.
- Quick Chat should pass thinking and speed through its streaming helper once
  the compact controls are present.
- Server-side normalization in `/api/chat/send` remains the final guard.

### Mode and destination rules

Use language consistently:

- **Workspace mode** means Home, Chat, Code, Board, etc.
- **Destination** means what the Home composer will create: chat or task.
- **Runtime** means the harness or execution backend.
- **Model** means the model id or runtime-managed model state.

The UI should not use "mode" ambiguously for all four ideas in the same
surface.

## Error Handling

- Failed model-state fetch: keep the current visible value if present and mark
  the control as stale instead of clearing the user's selection.
- Failed runtime write: refetch familiar config and model state; surface a toast.
- Runtime with no model catalog: disable the model select and show
  "Runtime managed".
- Unknown `@familiar` in Quick Chat: keep the existing inline error and do not
  send.
- Quick Chat streamed session without a returned session id: keep the answer
  visible and disable the "open full session" action rather than navigating to a
  guessed URL.
- Chat / Code control switch while a send is active: disable destructive scope
  changes during the active send, but allow draft text to remain editable where
  the existing composer already permits it.

## Testing

Add source and pure tests before relying on rendered verification:

- Home imports and renders the shared command controls.
- Home runtime switch writes `/api/config` and resets model to
  `defaultModelForRuntime(runtime)`.
- Home model switch writes `/api/chat/model-state` with
  `scope: "familiar-default"`.
- Home-started chat carries familiar, project root, model intent, thinking
  effort, and response speed into the ChatSurface handoff.
- Chat sends `reasoningEffort`, `responseSpeed`, session model overrides, and
  does not persist next-message overrides into config.
- Code embeds `ChatSurface` and uses the compact control density without a
  separate chat send path.
- Quick Chat target resolution, streaming, session id capture, and
  `quick-chat:open-session` handoff remain covered.
- CSS/source assertions prevent nested cards, clipped control text, and missing
  compact-density behavior in narrow composer containers.

Rendered verification should include:

- desktop Home
- narrow Home
- open Chat session
- Code mode with embedded ChatSurface
- Quick Chat route

## Implementation Phasing

### PR 1: shared contract and Home polish

- Introduce the shared command-control model and tests.
- Refactor Home to use it for runtime/model/thinking/speed.
- Polish Home layout and responsive grouping.
- Preserve existing Home slash-command behavior.

### PR 2: Chat and Code parity

- Move Chat composer controls onto the shared contract.
- Ensure Code uses compact density through the embedded ChatSurface.
- Add regression tests for send payloads and scope persistence.

### PR 3: Quick Chat compact parity

- Add compact execution controls to Quick Chat.
- Pass thinking/speed/model intent through its stream path.
- Keep main-window session handoff authoritative.

## Out of Scope

- Replacing `/api/chat/model-state` or `/api/config`.
- Introducing a global client store for all chat state.
- Changing the server harness model-forwarding contract.
- Reworking CodeSidebar, Comux file navigation, or terminal layout.
- Building a marketing-style landing page.

## Completion Evidence

The work is complete only when all of the following are true:

- Home visibly functions as the primary command center.
- Runtime, model, thinking effort, speed, and destination are switchable before
  sending from Home.
- Chat and Code use the same switching behavior without duplicate send logic.
- Quick Chat remains compact and opens the authoritative full session.
- Tests cover the control contract, send payloads, scope persistence, Code
  embedding, Quick Chat handoff, and responsive control constraints.
- Rendered checks prove Home, Chat, Code, and Quick Chat are non-overlapping and
  usable at desktop and narrow widths.
