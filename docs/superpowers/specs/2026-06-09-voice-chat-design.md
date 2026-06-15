# Voice chat (full-duplex realtime) with your familiar

**Date:** 2026-06-09
**Status:** Approved (design); plan pending
**Scope:** Browser-direct realtime voice calls between the user and a familiar. Pluggable provider adapter shipping OpenAI Realtime first; Gemini Live stubbed for v1.1. Per-familiar provider/model. Transcripts append to the familiar's existing chat thread. No daemon protocol changes. No harness pipeline changes.

## Why

Today every conversation with a familiar is mediated by a CLI harness (Codex, Claude Code, Hermes, OpenClaw) over turn-based text. Realtime provider APIs (OpenAI Realtime, Gemini Live) expose full-duplex audio with provider-side VAD, barge-in, and turn-taking — capabilities the harness pipeline can't model. Adding a voice modality means a *new pipeline*, parallel to the harness chat path, that connects the browser directly to a provider's realtime endpoint.

The user wants to hold spoken conversations with a familiar with the same continuity as text chats: identity (display name, role, pronouns, description) intact, recent chat context carried in, and the transcript folded back into the same conversation file so future text turns can reference what was said.

## Goals

- Full-duplex realtime voice between the user and any one familiar, mediated by an OpenAI Realtime session (v1) or future Gemini Live session (v1.1) selected per-familiar. The wire protocol differs per provider (WebRTC for OpenAI; WebSocket for Gemini Live) and is hidden behind the provider's client adapter.
- API keys live in the existing vault (1Password `op://` refs); the long-lived key never leaves the server. The browser receives an ephemeral token and opens WebRTC directly to the provider.
- Voice turns persist into the familiar's existing conversation file with `origin: "voice"` and a shared `voiceCallId`, blending seamlessly with text chat history.
- Hydration: every call opens with the familiar's identity fields + the last 12 turns of conversation history as the realtime session's instructions + conversation seed.
- All new code lives behind a single seam (`VoiceProvider` interface in `src/lib/voice/`). The harness pipeline is not modified.

## Non-goals

See the Non-goals section at the end for the full explicit cutline list. The most consequential ones:

- No Gemini Live implementation in v1 (interface + stub only).
- No audio recording — only the streamed text transcript persists.
- No new "Calls" history view. Voice turns live inside the chat thread.
- No tool/function calling over voice.
- No memory retrieval into hydration — last 12 conversation turns only.
- No daemon protocol changes.

## Architecture

A single seam: `VoiceProvider` in `src/lib/voice/`. Everything else — UI overlay, transcript writer, ephemeral-token route — is provider-agnostic and talks to the seam. The audio path is browser ↔ provider direct (WebRTC for OpenAI; WebSocket for Gemini Live); the Next.js server only mints the ephemeral token and accepts transcript appends.

### Module layout

```
src/lib/voice/
  types.ts                 # VoiceProvider, VoiceSessionRequest, VoiceSessionGrant
  registry.ts              # id → provider; mirrors harness-adapters' shape
  openai-realtime.ts       # server-side mint + client-side WebRTC adapter (one file)
  hydrate-instructions.ts  # identity + last N chat turns → { instructions, conversationSeed }
  append-voice-turn.ts     # the one writer that stamps origin:"voice" + voiceCallId

src/app/api/voice/
  session/route.ts         # POST: mint ephemeral token, return connection grant
  transcript/route.ts      # POST: append a voice-origin turn to conversation file

src/components/
  voice-call-overlay.tsx   # call UI + WebRTC client
  voice-call-button.tsx    # phone icon in chat-header-row
```

**Files touched outside the new tree:**

- `src/components/chat-header-row.tsx` — mounts `<VoiceCallButton />`.
- `src/lib/types.ts` — `Familiar` gains `voiceProvider?`, `voiceModel?`, `voiceName?`.
- `src/components/familiar-studio-brain-tab.tsx` — gains voice provider/model/voice pickers, parallel to the existing harness/model selectors.
- `src/components/chat-view.tsx` — small visual treatment grouping consecutive turns with the same `voiceCallId` under a "Voice call · MM:SS" header.
- `vault.yaml` — documents `OPENAI_API_KEY` and `GOOGLE_API_KEY` (no pre-filled refs).
- `package.json` — test files appended to `test:app` / `test:api` scripts.

**Files explicitly not touched:**

- `harness-adapters.ts` and the entire harness chat pipeline.
- `cave-conversations.ts`'s write primitive — `appendVoiceOriginTurn` calls it; it doesn't change.
- Any daemon code; the daemon never sees a voice call.

## Design decisions (locked)

| Decision | Choice | Alternatives considered |
|---|---|---|
| VC modality | **Full-duplex realtime** (OpenAI Realtime / Gemini Live class) | Push-to-talk → spoken reply; voice-in/text-out dictation; both modes |
| Provider strategy | **Per-familiar provider; pluggable adapter; ship OpenAI first** | Pluggable + ship both; OpenAI-only no abstraction |
| Transport | **Browser-direct realtime via server-minted ephemeral token** (WebRTC for OpenAI; WebSocket for Gemini) | Next.js WS relay; Tauri Rust-side native client |
| Secrets | **Existing vault (`OPENAI_API_KEY` → `op://`), server resolves at mint** | Browser-side API key entry; env-var-only |
| Entry surface | **Phone-icon button in chat header → right-side overlay panel** | Dedicated VC view; familiar avatar rail action; all three |
| Persistence | **Full transcript appended to chat thread; audio not saved** | Transcript + audio recording; lightweight call log only; fully ephemeral |
| Hydration | **Familiar identity fields + last 12 conversation turns** | Memory retrieval; identity only; identity + turns + memory |
| Transcript writer | **Dedicated `/api/voice/transcript` route, never invokes harness** | Reuse `/api/chat/send` with `mode: "voice"` flag |
| Adapter file split | **Server `mintSession` + client adapter in the same provider file** | Separate server/ and client/ subdirs per provider |

## Data model

### `Familiar` type

```ts
// src/lib/types.ts
export type Familiar = {
  // ... existing fields ...
  harness?: string;
  model?: string;
  voiceProvider?: string;  // "openai" | "gemini" — undefined = voice not configured
  voiceModel?: string;     // e.g. "gpt-4o-realtime-preview"
  voiceName?: string;      // provider voice id, e.g. "alloy" / "Puck"
};
```

Stored in `cave-config.json` alongside `harness`/`model`. When `voiceProvider` is unset, the phone-icon button is disabled with a tooltip pointing at Familiar Studio → Brain.

### Vault entries

Documented in `vault.yaml` (entries are not pre-filled; user adds their own `op://` refs):

```yaml
OPENAI_API_KEY:
  ref: "op://Development/OpenAI API Key/credential"
  description: "OpenAI API key, used to mint ephemeral tokens for Realtime voice"
  required: false

GOOGLE_API_KEY:
  ref: "op://Development/Google AI Studio/credential"
  description: "Google AI Studio key, used to mint ephemeral tokens for Gemini Live (v1.1)"
  required: false
```

`required: false` — only resolved when a voice call is initiated. Failure to resolve surfaces via the existing vault-status UI.

### Conversation turn shape

The existing `ChatTurn` type in `src/lib/cave-conversations.ts` gains two optional fields. Conversation files are keyed by `sessionId` (one familiar can have many sessions). Existing files do not need migration.

```ts
// src/lib/cave-conversations.ts (delta)
export type ChatTurn = {
  // existing fields: id, role, text, attachments?, reasoning?, tools?, createdAt, durationMs?, isError?
  origin?: "chat" | "voice";   // NEW — defaults to "chat" when absent
  voiceCallId?: string;         // NEW — groups all turns from the same call
};
```

`chat-view.tsx` renders a "Voice call · MM:SS" group header above any run of consecutive turns sharing a `voiceCallId`. Duration = last-turn timestamp − first-turn timestamp.

## VoiceProvider adapter interface

```ts
// src/lib/voice/types.ts
export type VoiceProviderId = "openai" | "gemini";

export type VoiceSessionRequest = {
  familiarId: string;
  model: string;
  voice: string;
  instructions: string;
  conversationSeed?: Array<{ role: "user" | "assistant"; content: string }>;
};

export type VoiceSessionGrant = {
  provider: VoiceProviderId;
  clientSecret: string;       // ephemeral token, e.g. OpenAI client_secret.value
  expiresAt: string;          // ISO timestamp
  connection: {               // provider-shaped, opaque to the server route
    kind: string;             // "openai-realtime" | "gemini-live"
    [key: string]: unknown;
  };
};

export interface VoiceProvider {
  id: VoiceProviderId;
  label: string;
  mintSession(apiKey: string, req: VoiceSessionRequest): Promise<VoiceSessionGrant>;
  clientAdapter: VoiceClientAdapter;  // imported by VoiceCallOverlay; never runs server-side
}

export interface VoiceClientAdapter {
  connect(
    grant: VoiceSessionGrant,
    mic: MediaStream,
    callbacks: {
      onUserTranscriptFinal: (text: string) => void;
      onAssistantTranscriptFinal: (text: string) => void;
      onPartialTranscript: (role: "user" | "assistant", delta: string) => void;
      onError: (err: Error) => void;
      onDisconnect: () => void;
    },
  ): Promise<LiveSession>;
}

export interface LiveSession {
  inboundAudio: MediaStream;  // overlay binds to a hidden <audio autoplay>
  setMuted(muted: boolean): void;  // local-only mute (mic track enabled/disabled)
  close(): Promise<void>;  // tears down transport; idempotent
}
```

```ts
// src/lib/voice/registry.ts
const PROVIDERS: Record<VoiceProviderId, VoiceProvider> = {
  openai: openaiRealtimeProvider,
  gemini: geminiLiveProvider_stub,  // mintSession rejects with "not_implemented"
};

export function getVoiceProvider(id: string): VoiceProvider | null;
export function listVoiceProviders(): Array<{ id: VoiceProviderId; label: string }>;
```

`connection` is intentionally provider-shaped/opaque to the server route — every realtime API does SDP differently and normalizing it would leak provider semantics into a fake-generic schema.

### OpenAI Realtime adapter (`openai-realtime.ts`)

One file, two exports: server-side `mintSession` and a client-side `clientAdapter`.

**Server `mintSession`:**

1. `POST https://api.openai.com/v1/realtime/sessions` with bearer auth using the resolved `OPENAI_API_KEY`, body containing `{ model, voice, instructions, input_audio_transcription, ... }`.
2. Read `client_secret.value` + `expires_at` from the response.
3. Return a `VoiceSessionGrant` with `connection.kind === "openai-realtime"` carrying the SDP exchange URL.

**Client `clientAdapter.connect(grant, mediaStream, callbacks)`:**

1. Create `RTCPeerConnection`, attach mic track from `mediaStream`.
2. Open a data channel `"oai-events"` for JSON events.
3. SDP offer/answer with the OpenAI Realtime endpoint using `grant.clientSecret` as bearer.
4. Play inbound audio track via a hidden `<audio autoplay>`.
5. Stream transcript deltas through `callbacks.onPartialTranscript` and finalized turns through `callbacks.onUserTranscriptFinal` / `callbacks.onAssistantTranscriptFinal`.

## Server routes

Both under `src/app/api/voice/`, `runtime = "nodejs"`, `dynamic = "force-dynamic"`.

### `POST /api/voice/session`

```ts
// Request
{ familiarId: string; sessionId: string }

// 200
{ ok: true, grant: VoiceSessionGrant, callId: string /* ULID */ }

// 4xx/5xx
{ ok: false, error: string, hint?: string, missingKey?: string }
```

**Steps:**

1. Load familiar from `cave-config.json`. `404` if not found.
2. Validate `sessionId` via `isSafeConversationSessionId`. `400 invalid_session` on failure.
3. Read `familiar.voiceProvider`. `400 voice_not_configured` if unset.
4. `getVoiceProvider(...)`. `400 unknown_provider` if null.
5. Resolve the provider's vault key (`OPENAI_API_KEY` for `openai`, `GOOGLE_API_KEY` for `gemini`) via existing vault helpers. `400 vault_key_unresolved` with `missingKey` and a hint if unresolved.
6. Build `VoiceSessionRequest`: `instructions` and `conversationSeed` from `hydrateForVoiceCall({ familiarId, sessionId }, { seedTurns: 12 })`; `model` and `voice` from familiar fields with provider-specific fallbacks (`gpt-4o-realtime-preview` / `alloy` for OpenAI).
7. `provider.mintSession(key, req)`. `502 provider_mint_failed` on rejection, surfacing the provider's message verbatim.
8. Generate `callId` (ULID). No server state is stored at mint time; the call only "exists" once turns get written.

### `POST /api/voice/transcript`

```ts
// Request
{
  sessionId: string;
  callId: string;
  role: "user" | "assistant";
  text: string;
  endedAt?: string;  // ISO, defaults to server now
}

// 200
{ ok: true }

// 4xx
{ ok: false, error: string }
```

**Steps:**

1. Validate body shape (including `isSafeConversationSessionId(sessionId)`); `400` on missing/invalid fields.
2. Call `appendVoiceOriginTurn(sessionId, { callId, role, text, createdAt })` — the single voice writer in `src/lib/voice/append-voice-turn.ts`.
3. That helper builds a `ChatTurn` with `origin: "voice"` and `voiceCallId: callId` stamped, then delegates to `cave-conversations.ts`'s existing `appendTurn(sessionId, turn)`.
4. **Never invokes the harness.** The voice provider already produced the assistant reply.

**Two writers, one helper rule:** harness chat continues to call `appendTurn` directly; voice goes through `appendVoiceOriginTurn`. Both end up at the same `appendTurn` primitive — the single point where conversation files are mutated.

## Hydration (`hydrate-instructions.ts`)

```ts
export type Hydrated = {
  instructions: string;
  conversationSeed: Array<{ role: "user" | "assistant"; content: string }>;
};

export async function hydrateForVoiceCall(
  ids: { familiarId: string; sessionId: string },
  opts?: { seedTurns?: number },  // default 12
): Promise<Hydrated>;
```

Identity fields come from the familiar config; the conversation seed comes from the session file.

**`instructions` template** (deterministic; empty fields omit their line):

```
You are {display_name}{pronouns ? ` (${pronouns})` : ""}, a familiar in the user's coven.
Your role: {role}.
{description ? `About you: ${description}` : ""}
{note ? `Notes for this conversation: ${note}` : ""}

You are speaking with the user over a live voice call. Respond conversationally and concisely. The transcript of this call will be appended to your ongoing chat history with the user, so future text turns will be able to read what you said here.
```

**`conversationSeed`:**

1. Load the conversation file via `loadConversation(sessionId)`.
2. Take the last `opts.seedTurns ?? 12` turns, chronological order. Filter out turns whose `role === "system"` (provider seed only accepts `user`/`assistant`).
3. Project each to `{ role, content: turn.text }`. `origin: "voice"` turns are included identically to text turns — voice and text history blend.
4. Empty/missing conversation → `[]`. Session opens cold but with full identity.

**Invariant:** `hydrateForVoiceCall` is read-only. It does not mutate the conversation file, does not create one if missing, does not stamp timestamps. The first mutation in a call's lifecycle is the first `POST /api/voice/transcript`.

## Client: `VoiceCallOverlay`

```ts
type VoiceCallOverlayProps = {
  familiar: Familiar;
  sessionId: string;  // the currently active chat session — turns will append here
  onClose: () => void;
};
```

Mounted as a portal from `<VoiceCallButton />` in `chat-header-row.tsx` (which receives both `familiar` and the active `sessionId` from the chat surface). Right-side panel, ~360px, matches the existing right-side-drawer pattern from Familiar Studio.

### State machine

```
idle → requesting-mic → minting-session → connecting → live → ending → closed
                                                      ↘
                                                       error (terminal until retry)
```

Each transition has exactly one trigger. Overlay header shows the current state as plain text ("Connecting…", "Live · 0:42", "Mic blocked").

### Lifecycle

1. **idle → requesting-mic.** `navigator.mediaDevices.getUserMedia({ audio: true })`. Denied → `error("microphone_denied")` with "Try again" button.
2. **requesting-mic → minting-session.** `POST /api/voice/session`. On vault hint → render inline with a deep-link to vault settings. Network error → retry button.
3. **minting-session → connecting.** Look up `getVoiceProvider(familiar.voiceProvider).clientAdapter`. Hand it the grant + `MediaStream` + callbacks. The overlay does not know whether the adapter speaks WebRTC or WebSocket — those details live in the adapter file.
4. **connecting → live.** Adapter resolves with a `LiveSession` handle exposing an inbound audio source the overlay binds to a hidden `<audio autoplay>` (for WebRTC: the remote track; for WebSocket: a MediaStream the adapter assembles from decoded frames). Start the call duration timer.
5. **live.** Adapter pushes events through callbacks:
   - `onUserTranscriptFinal(text)` → `POST /api/voice/transcript { sessionId, callId, role: "user", text }`
   - `onAssistantTranscriptFinal(text)` → same with `role: "assistant"`
   - `onPartialTranscript(role, delta)` → render in the overlay's live caption area only; do **not** persist
   - `onError(err)` → transition to `error`
   - `onDisconnect()` → transition to `closed`
6. **live → ending.** User clicks "End call" or closes the overlay. Adapter tears down its transport (data channel + peer connection, or WebSocket). Overlay stops local mic tracks. Any in-flight partial gets discarded.
7. **closed.** Overlay unmounts. The familiar's chat thread already shows the appended turns.

### UI shape

- Header: familiar avatar + name, call duration, state label.
- Body: live caption area (current partial transcript, auto-scrolls).
- Footer: **Mute** toggle (calls `LiveSession.setMuted(true)` — disables the local mic track; no provider signal), **End call** button (no confirmation; accidental hangup is recoverable since history is preserved).

### Persistence during the call

Transcript appends are fire-and-forget POSTs — no awaiting on the audio path. A failed POST logs to console and renders a small "transcript not saved" badge near the affected turn line. The call continues. No retry queue in v1.

## Error handling

| Failure | Where | Behavior |
|---|---|---|
| `familiar.voiceProvider` unset | session route | `400 voice_not_configured` + hint pointing at Familiar Studio → Brain. Phone button is also disabled with the same tooltip (belt-and-suspenders). |
| Unknown provider id | session route | `400 unknown_provider`. Should be unreachable in practice. |
| Vault key unresolved | session route | `400 vault_key_unresolved` carrying `missingKey`. Overlay renders existing vault-status pattern with a "Open Vault settings" link. |
| Provider rejects mint | session route | `502 provider_mint_failed` with provider message verbatim. |
| Mic permission denied | overlay | `error("microphone_denied")` with OS-specific re-grant hint (Tauri: System Settings → Privacy → Microphone; browser: click lock icon). |
| No mic device | overlay | `error("no_input_device")`. "Plug in a microphone, then click Retry." |
| Ephemeral token expired before connect | client adapter | Auto-retry once (re-mint) before surfacing `error("token_expired")`. |
| Connection negotiation fails | client adapter | SDP exchange for WebRTC, WebSocket handshake for Gemini. `error("connect_failed", details)`. "Retry" re-mints and reconnects from scratch. |
| Network drop mid-call | client adapter | Transport state goes to disconnected/failed → overlay transitions `ending` → `closed`. In-flight partial discarded. Toast: "Call ended unexpectedly." |
| Transcript POST fails | overlay | Console log + "transcript not saved" badge near the affected turn. Call continues. |
| User closes overlay during `connecting` | overlay | Clean cancel: abort SDP, stop mic, no error state. |
| Second call attempt while one is live | button | Phone button disabled while overlay is open. Switching chats does NOT auto-end the call; the overlay floats above. |
| Concurrent calls to different familiars | overlay | v1 limits stacking to one overlay (simpler UI). Two-call concurrency is v1.1. |
| Mid-text-chat-turn when call starts | session route | No special handling. The only shared resource is the conversation file; turn appends serialize through `cave-conversations.ts`. |

### Invariants enforced by tests

- A failed mint never writes anything to the conversation file.
- A failed transcript POST never affects subsequent transcript POSTs.
- Closing the overlay always stops mic tracks (verified via `MediaStreamTrack.readyState`).

## Testing strategy

Follows the existing pattern (`node --experimental-strip-types`-driven `.test.ts` files alongside the unit under test). Run locally with `npx --yes tsx --test`; CI does not execute them. Test files get appended to `package.json` `test:app` / `test:api`.

### Unit / module tests

| File | Pins |
|---|---|
| `src/lib/voice/hydrate-instructions.test.ts` | Identity template renders deterministically across full / missing-pronouns / missing-description / missing-note / empty-conversation cases. Seed projection takes the last N turns in chronological order. `origin: "voice"` turns are included identically to text turns. Function is read-only (file mtime unchanged after call). |
| `src/lib/voice/registry.test.ts` | `getVoiceProvider("openai")` returns the OpenAI adapter; `("gemini")` returns the stub whose `mintSession` rejects with `"not_implemented"`; `("bogus")` returns `null`. `listVoiceProviders` returns a stable order. |
| `src/lib/voice/openai-realtime.test.ts` | `mintSession` POSTs to the correct URL with bearer auth and includes `instructions`, `voice`, `model`, `input_audio_transcription` in body; surfaces provider error messages verbatim on non-2xx. `fetch` is stubbed via a module-level injector — no real network. |
| `src/lib/voice/append-voice-turn.test.ts` | Appends a turn with `origin: "voice"` and `voiceCallId` set; does not alter prior turns; preserves turn order; matches existing `cave-conversations` file-creation behavior. |

### Route tests

| File | Pins |
|---|---|
| `src/app/api/voice/session/route.test.ts` | Full error matrix from the error-handling table. Happy path returns a ULID-shaped `callId` and the grant the adapter produced. Vault resolution + `mintSession` are stubbed. |
| `src/app/api/voice/transcript/route.test.ts` | Missing fields → `400` each; happy path appends one turn with `origin: "voice"` and the supplied `callId`; never invokes the harness (verified via injected `appendVoiceOriginTurn` and a sentinel that fails the test if any chat-send path is reached). |

### Component tests

| File | Pins |
|---|---|
| `src/components/voice-call-button.test.ts` | Renders disabled with the `voice_not_configured` tooltip when `familiar.voiceProvider` is unset; renders enabled otherwise; emits a click event the chat header maps to overlay-open. |
| `src/components/voice-call-overlay-state.test.ts` | State machine transitions are exhaustive: every state has exactly one trigger out; `error` is terminal until retry; closing during `connecting` is a clean cancel (mic stopped, no error toast). Driven by injected callbacks — no real WebRTC. |

### Deliberately not tested in v1

- Real WebRTC SDP exchange. Stubbed at the client-adapter boundary. End-to-end voice is a manual smoke: "call my familiar, hear her respond, hang up, see transcript in chat thread."
- Provider partial-transcript timing. We test that only `*Final` events persist; the actual delta cadence is the provider's concern.
- Tauri mic permission flow. Tested manually on first run.

## Non-goals (full list)

- **No Gemini Live adapter implementation.** Interface includes it; registry stub returns `not_implemented`. v1.1.
- **No audio recording.** Only streamed text transcript persists.
- **No new "Calls" history view.** Voice turns live inside the existing chat thread, grouped by `voiceCallId`.
- **No multi-party voice.** One user ↔ one familiar per call. No familiar-to-familiar voice; the existing `coven-calls` API stays text-only.
- **No tool/function calling over voice.** Cross-referencing the harness pipeline's tool surface is out of scope for v1.
- **No partial-transcript persistence.** Only finalized turns hit the conversation file.
- **No transcript retry queue.** Failed transcript POSTs drop the turn with a visible badge.
- **No call-from-rail or call-from-dedicated-view.** Single entry surface.
- **No two simultaneous overlays.** v1 ships single-call concurrency.
- **No memory retrieval.** Hydration is identity fields + last 12 conversation turns only.
- **No daemon protocol changes.** Voice is entirely cave-local + browser ↔ provider.
- **No provider switch mid-call.** Provider/voice/model are read at call start; changes take effect on the next call.
- **No mobile-specific UI work.** Overlay reuses the right-side-drawer pattern; mobile responsiveness inherits whatever that pattern already does.
