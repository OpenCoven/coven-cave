# Chat UX And Model Routing Design

**Date:** 2026-06-15
**Status:** Draft for review

## Purpose

Improve Coven Cave's chat interface so a user can understand who they are talking to, what runtime is answering, what model is intended, and whether a model change has actually reached the harness. The work should make everyday familiar chat calmer and easier to scan while adding model controls that are honest about propagation limits.

The key product rule is:

> Cave may store model intent locally, but it must not claim a model changed downstream until the harness or runtime confirms that change.

## Current Audit

The current implementation already has strong foundations:

- `src/components/chat-view.tsx` owns the primary chat experience: transcript, composer, retry/cancel, file attachments, slash commands, project selection, mobile context, find-in-chat, streaming state, tool events, progress events, and per-turn metadata.
- `src/components/chat-router.tsx` chooses the active familiar/session and routes list, new chat, and open-session flows into `ChatView`.
- `src/components/chat-surface.tsx` frames chat with memory/projects tabs and the right-side Inspector, Debug, and Changes panels.
- `src/lib/chat-response-metadata.ts` defines `ChatResponseMetadata` with `familiarId`, `harness`, `model`, and `runtime`; it also formats runtime values as working directories for the UI.
- `src/app/api/chat/send/route.ts` records `binding.model` into response metadata and saved conversation records for both OpenClaw bridge and native `coven run` paths.
- `src/components/familiar-studio-brain-tab.tsx` already lets users edit a familiar's harness and model through `/api/config`.
- `src/lib/cave-config.ts` stores defaults and familiar overrides in `~/.coven/cave-config.json`; `bindingFor(config, familiarId)` resolves the effective harness, model, note, voice settings, and runtime.
- `src/app/api/harnesses/route.ts` reports installed harnesses and whether each bundled adapter supports native chat.
- `src/app/api/capabilities/route.ts` exposes daemon harness capability manifests, but those manifests are currently skill/plugin/global-instruction oriented rather than model-routing oriented.
- `coven run --help` currently exposes `--familiar`, `--continue`, `--stream-json`, and related run controls, but no `--model` option. Native Cave chat therefore cannot honestly force a per-send model at the `coven run` layer today.
- `src/app/api/chat/send/harness-routing.test.ts` already pins important routing contracts around trusted harnesses, OpenClaw bridge behavior, SSH runtime handling, resume identity, progress events, image support, and transcript persistence.

This means v0 model controls can safely improve visibility and Cave-local configuration. Runtime propagation needs a small contract expansion before Cave can say "this model is active inside the harness."

## Goals

- Make the chat header and composer easier to scan without replacing the current chat architecture.
- Surface the effective familiar, harness, model, runtime, project, and session state in one coherent control.
- Let users change the model from chat where the scope is clear.
- Preserve Familiar Studio as the place for durable familiar defaults.
- Add session and one-off model intent only where the send path can persist and display it honestly.
- Represent model application state as `applied`, `saved`, `unsupported`, `pending`, or `failed`.
- Propagate model choices into Coven harness/runtime only when an explicit downstream contract supports it.
- Add tests that prevent Cave from silently accepting a UI model choice while sending a different model downstream.

## Non-Goals For The First Implementation

- No full chat rewrite.
- No fine-tuning or model recommendation engine.
- No provider billing or account management UI.
- No unverified hard-coded model list as the source of truth.
- No SSH OpenClaw model switching until a remote OpenClaw bridge exists.
- No claim that `coven run` supports per-send model overrides until Coven exposes that contract.
- No automatic global default changes from a normal chat send.

## UX Shape

### Chat Identity Header

The existing `MetaLine` should stay as the primary desktop status line. It should grow into an explicit chat identity control instead of a bare metadata string.

Recommended desktop layout:

- Left: back button, editable chat title.
- Middle/right: a compact identity control showing harness, model, runtime directory, and current lifecycle.
- Right action cluster: find, project picker, voice, debug, delete.

The identity control should be a button or split button with a clear tooltip:

- Label examples:
  - `claude / anthropic/claude-opus-4-7`
  - `codex / openai/gpt-5.5`
  - `openclaw / Salem default`
- Subtext or tooltip:
  - `Familiar default`
  - `Session override`
  - `One-off for next send`
  - `Saved in Cave, runtime support unavailable`

Mobile should reuse the existing `MobileChatContextMenu` pattern and place model/runtime details in the context panel instead of crowding the header row.

### Model Popover

Opening the identity control should show a compact model popover:

- Current effective model.
- Source: global default, familiar default, session override, or one-off draft.
- Harness and runtime.
- Last confirmed application state.
- Scope choices:
  - `This familiar` - durable default through `/api/config`.
  - `This chat` - session-scoped override stored with the conversation.
  - `Next message` - one-off override sent with the next request only.
- Suggested models, when known from capabilities or local defaults.
- Manual model entry with validation warnings.

The primary action text must match the selected scope:

- `Save familiar default`
- `Use for this chat`
- `Use for next message`

When runtime propagation is unsupported, the popover should still allow a Cave-local save for durable scopes, but it must show a warning such as:

> Cave will remember this model, but the current harness cannot confirm model switching yet.

### Composer

The composer should stay focused on input. Add only lightweight model context:

- A tiny context chip above or inside the composer controls when a non-default session or one-off model is active.
- A clear remove action for session or one-off overrides.
- Existing attach, send, cancel, slash, and file-mention controls remain unchanged.

The placeholder should not carry model details. Long model names belong in the identity popover and metadata, not the input placeholder.

### Transcript

Per-turn metadata should continue to render through `ResponseMetadataText`, but it should distinguish intended versus confirmed model state when that data exists.

Examples:

- `anthropic/claude-opus-4-7 confirmed`
- `openai/gpt-5.5 saved`
- `openai/gpt-5.5 unsupported by coven run`

For old transcripts that only have the current `ChatResponseMetadata` shape, render exactly as today.

## Model State Contract

Add a small typed model-state layer instead of scattering model strings across UI files.

Recommended file:

- `src/lib/chat-model-state.ts`

Core types:

```ts
export type ModelScope = "global-default" | "familiar-default" | "session" | "next-message";

export type ModelApplicationState =
  | "unknown"
  | "saved"
  | "pending"
  | "applied"
  | "unsupported"
  | "failed";

export type ChatModelState = {
  familiarId: string;
  harness: string;
  runtime: string | null;
  effectiveModel: string;
  source: ModelScope;
  applicationState: ModelApplicationState;
  reason?: string;
};

export type ChatModelUpdateRequest = {
  familiarId: string;
  sessionId?: string | null;
  harness: string;
  model: string;
  scope: Exclude<ModelScope, "global-default">;
};

export type ChatModelUpdateResult = {
  ok: boolean;
  state: ChatModelState;
  error?: string;
};
```

The first implementation can compute `applicationState: "saved"` for Cave-local default changes and `applicationState: "unsupported"` when the user asks for runtime application on a path without support.

## Read Path

The UI should compute effective model state from these sources, in order:

1. One-off composer override, if present.
2. Session override stored on the Cave conversation, if present.
3. Familiar binding from `bindingFor(config, familiarId)`.
4. Global default from `config.defaults.model`.
5. Last turn `responseMetadata.model`, only as historical evidence, not as the current desired model.

This read path lets the chat header say:

- "Current desired model" before a send.
- "Last response used/recorded model" for settled transcript metadata.

Those are different concepts and should not be collapsed into one field.

## Write Path

### Familiar Default

Familiar default updates should reuse the existing config path:

- UI calls `/api/config` with `{ familiars: { [familiarId]: { model } } }`.
- Cave recomputes the effective familiar binding.
- Chat header updates immediately after refresh.
- Application state is `saved` unless a downstream confirmation path also applies it.

This mirrors Familiar Studio and avoids creating a second durable config store.

### Session Override

Session overrides need a new Cave-owned conversation field.

Recommended additions:

- Add `modelOverride?: string` or `modelIntent?: { model: string; source: "session" }` to the conversation schema in `src/lib/cave-conversations.ts`.
- Add an API path for updating conversation model intent, likely under `src/app/api/chat/conversation/[id]/route.ts`.
- Use the override when building `responseMetadata` and the send body.
- Persist the selected model with every new assistant turn so history remains explainable.

The first supported behavior can be "Cave uses this as desired model state and records it." Runtime application should remain capability-gated.

### Next Message Override

One-off overrides should live only in `ChatView` state and ride with the next `/api/chat/send` request.

Recommended send body addition:

```ts
type SendBody = {
  modelOverride?: string;
  modelOverrideScope?: "next-message" | "session";
};
```

The server should validate that one-off overrides do not mutate `~/.coven/cave-config.json`.

## Harness And Runtime Propagation

Model changes should travel through a capability-aware path:

```text
Cave UI
  -> Cave API model intent
  -> Cave send/session config
  -> Coven daemon or `coven run`
  -> harness adapter
  -> provider/runtime
  -> confirmed response metadata
```

The current `coven run` CLI does not expose a `--model` flag, so native `coven run` chat cannot yet apply a model override directly. The spec should drive a future Coven-side contract rather than guessing flags.

Recommended downstream contract:

- Coven exposes model override support in a machine-readable adapter capability.
- Coven accepts an explicit model on session creation/run when supported.
- Coven stream-json result includes the model actually used.
- OpenClaw bridge exposes model override support and returns confirmation in JSON.
- SSH runtimes report whether the remote `coven` supports the same contract before Cave enables runtime application.

Until that exists, Cave behavior should be explicit:

- `saved` - persisted in Cave config or conversation state.
- `unsupported` - current harness path cannot apply or confirm the model.
- `applied` - downstream runtime accepted the model and response metadata confirms it.
- `failed` - downstream runtime rejected the model.

## API Design

### New Model State Route

Recommended route:

- `src/app/api/chat/model-state/route.ts`

Responsibilities:

- Return effective `ChatModelState` for a familiar/session pair.
- Include harness/runtime/capability notes.
- Avoid provider network calls.
- Treat unknown model capability as unsupported for application, not as failure.

Example request:

```text
GET /api/chat/model-state?familiarId=salem&sessionId=<id>
```

Example response:

```json
{
  "ok": true,
  "state": {
    "familiarId": "salem",
    "harness": "claude",
    "runtime": "local:/Users/buns/Documents/GitHub/OpenCoven/coven-cave",
    "effectiveModel": "anthropic/claude-opus-4-7",
    "source": "familiar-default",
    "applicationState": "saved",
    "reason": "Saved in Cave config. Runtime model application is not confirmed by coven run yet."
  }
}
```

### Model Update Route

Recommended route:

- `src/app/api/chat/model-state/route.ts` with `PATCH`

Responsibilities:

- Validate scope and model string.
- For `familiar-default`, patch `/api/config` equivalent server-side through `saveConfig`.
- For `session`, patch the conversation model intent.
- For `next-message`, reject because it should not be persisted through a route.
- Return the new `ChatModelState`.

## UI Components

Recommended new components:

- `src/components/chat-model-control.tsx`
  - Header control and popover.
  - Receives `ChatModelState`.
  - Emits scoped update requests.

- `src/components/chat-model-chip.tsx`
  - Compact current-model chip for composer or mobile context.
  - Handles long model names with truncation and tooltip.

Recommended changes:

- `src/components/chat-view.tsx`
  - Fetch model state for current familiar/session.
  - Include model override fields in `/api/chat/send` only when present.
  - Render `ChatModelControl` inside `MetaLine` actions or metadata area.
  - Render composer chip for active session/one-off overrides.

- `src/lib/chat-response-metadata.ts`
  - Extend metadata formatting to support application state when present.
  - Preserve old metadata rendering.

## Error Handling

The UI must use plain, actionable states:

- Missing `coven`: keep today's setup/onboarding route.
- Unsupported model application: allow Cave-local save, disable runtime apply, explain why.
- Invalid model string: reject before save with a short validation message.
- Runtime rejected model: keep previous effective model, show failed state, and preserve the user's typed model in the popover for editing.
- Stream failed after a model choice: record the intended model on the failed turn and mark the response as failed.

Do not fall back silently to another model. If a harness falls back internally and reports that fallback, Cave should show the reported model as the response model and keep the desired model visible as unconfirmed or failed.

## Implementation Slices

1. **Model routing audit and spec**
   - Land this document.
   - No app behavior changes.

2. **Model state helper and tests**
   - Add `src/lib/chat-model-state.ts`.
   - Add unit tests for effective source resolution and application-state labeling.

3. **Chat header UX**
   - Add `ChatModelControl` using existing header/action styling.
   - Show current effective model and source without write actions first.
   - Add mobile context rendering.

4. **Familiar-default update from chat**
   - Wire `familiar-default` saves through the same config path Familiar Studio uses.
   - Show `saved` state and refresh familiar data.

5. **Session and one-off model intent**
   - Add conversation-level session intent.
   - Add one-off composer intent.
   - Persist per-turn intended model metadata.

6. **Downstream propagation contract**
   - Add runtime application only after Coven/OpenClaw expose confirmed support.
   - Extend tests so unsupported paths cannot claim `applied`.

7. **Chat polish pass**
   - Tighten header density, composer chip behavior, and transcript metadata.
   - Verify desktop and mobile layouts.

## Testing Strategy

- Unit test `chat-model-state` source precedence:
  - next-message beats session.
  - session beats familiar.
  - familiar beats global default.
  - last response metadata never overrides desired current state.

- Unit test unsupported propagation:
  - native `coven run` path reports `saved` or `unsupported`, not `applied`, while no model flag exists.
  - OpenClaw local bridge does not claim model application until the bridge returns confirmation.
  - SSH runtime does not enable runtime application without remote capability support.

- API route tests:
  - `GET /api/chat/model-state` returns a stable state shape.
  - `PATCH` familiar default updates config and returns `saved`.
  - `PATCH` session override updates only the conversation.
  - `PATCH` rejects one-off persistence.

- Chat route tests:
  - send body accepts model intent without mutating global config.
  - response metadata records intended and confirmed model separately once the metadata shape expands.
  - old conversations with simple `model` fields still render.

- UI tests:
  - model control renders long model names without overflow.
  - scope switch changes primary action copy.
  - unsupported state is visible before save/apply.
  - mobile context menu shows model and runtime details.

- Manual verification:
  - desktop chat header at narrow and wide widths.
  - mobile chat header/context panel.
  - streaming/cancel flow with model control present.
  - failed send and retry with model intent preserved.

## Definition Of Done

- Users can see the familiar, harness, model, runtime, and project context before sending.
- Users can change a familiar default model from chat without leaving the conversation.
- Users can choose a session or next-message model intent once those scopes are implemented.
- Cave distinguishes desired, saved, unsupported, failed, and applied model states.
- Cave never claims downstream model application without a harness/runtime confirmation path.
- Existing chat streaming, retry, cancel, attachments, slash commands, voice, debug, and project selection keep working.
- Tests cover source precedence, unsupported propagation, and UI overflow behavior.
