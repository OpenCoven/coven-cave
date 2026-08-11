# Mobile live voice calls

## Goal

Add a live voice-call action to a direct iOS chat without changing the existing
composer dictation action. A call opens in a compact bottom sheet and can expand
into a transcript-first full-screen view.

## Scope

- Direct chats only in this increment.
- OpenAI Realtime is the full-duplex path for familiars configured with the
  `openai` voice provider.
- Apple-native voice is a separate, clearly labeled, turn-based call mode using
  `Speech` recognition, `AVAudioSession`, and `AVSpeechSynthesizer`.
- The sheet displays final and partial user/assistant transcript rows. It
  expands when the user asks for focused reading; it returns to the existing
  chat when dismissed.
- Dictation remains the composer microphone and only edits the unsent draft.

## Non-goals

- Do not describe Apple-native voice as full-duplex or Realtime.
- Do not add group-call fan-out, background calling, CallKit integration, call
  recording, or voice settings editing.
- Do not send provider API keys or long-lived credentials to iOS.
- Do not make local, familiar, Gemini, or ElevenLabs voice loops part of this
  first implementation.

## Architecture

`VoiceCallCoordinator` owns one call lifecycle and exposes a small observable
state model: `idle`, `requestingPermission`, `connecting`, `listening`,
`speaking`, `muted`, `ended`, and `failed`. It owns the audio session and is
the only code allowed to start or stop a call microphone.

`VoiceCallSheet` renders the compact call controls and transcript. Its expand
control presents `VoiceCallTranscriptView` full-screen using the same
coordinator, so a call never reconnects merely because the operator changes
presentation.

The chat toolbar gets a phone action only for direct chats. Tapping it presents
the call sheet in a pre-connect state with explicit modes: `Realtime` is
enabled only when the familiar reports the `openai` voice provider, while
`Native voice` is available for every connected direct chat. The selected mode
starts only after the operator taps its explicit call action; a Realtime error
never silently falls back to Native voice. The composer keeps its existing
dictation action and continues to operate independently when no call is active.

The iOS `Familiar` model decodes the already-published `voiceProvider`,
`voiceModel`, and `voiceName` roster fields solely to determine mode
availability and accessible labels. It does not receive provider credentials.

### OpenAI Realtime path

1. iOS creates or resolves the direct-chat server session using existing chat
   ownership rules.
2. iOS posts only `familiarId` and `sessionId` to `/api/voice/session` using
   the paired mobile credential.
3. The desktop resolves the vault key, hydrates familiar instructions and
   conversation seed, and returns a short-lived OpenAI Realtime grant.
4. An iOS WebRTC adapter exchanges SDP with the grant URL, sends microphone
   audio, plays inbound audio, and maps provider events into transcript rows.
5. Ending the call closes the peer connection, stops audio, and leaves the
   ordinary chat thread intact. Final transcript persistence must use one
   explicit path so it never duplicates a provider-persisted turn.

SwiftUI does not provide `RTCPeerConnection`; the implementation therefore
adds a vetted iOS WebRTC package rather than attempting to emulate Realtime
over the deprecated WebSocket protocol.

### Apple-native path

Apple-native voice uses the app's existing `Speech` permission pattern, an
exclusive call audio session, and `AVSpeechSynthesizer` output. It is a
turn-taking loop:

1. Listen for a final spoken user turn.
2. Append that turn through `ChatThread.send` so ordinary chat persistence and
   streaming remain authoritative.
3. Render the assistant stream in the call transcript.
4. Speak only completed assistant text, then return to listening.

The sheet labels this mode `Native voice` and describes its turn-based behavior
in accessible status text. It never claims to be a live Realtime conversation.

## Safety and failure handling

- Request microphone and speech permissions before starting either path; deny
  cleanly with a retryable explanation.
- Use an audio session appropriate for two-way audio, deactivate it on every
  terminal state, and stop promptly for interruptions, route changes, and
  app-background transition.
- Map `/api/voice/session` errors to the route's existing actionable hints;
  do not surface vault values or ephemeral secrets in UI, logs, or tests.
- Disable Realtime, with an explanatory label, when the familiar's provider is
  not OpenAI; Native voice remains an explicit available mode.
- Finalize or discard partial transcript rows explicitly on disconnect so a
  partial string is never persisted as a user or assistant chat message.

## Verification

- Pure Swift tests cover state transitions, permission denial, mute/end,
  transcript ordering, partial-final replacement, audio interruption cleanup,
  and native turn handoff.
- API tests prove the mobile call request carries only familiar/session IDs and
  the returned grant never contains the provider key.
- UI tests prove dictation and phone-call controls remain distinct, the sheet
  expands without reconnecting, and unsupported/group chats cannot start a
  call.
- Generate the Xcode project from `project.yml`, run focused iOS tests, then
  run the relevant JavaScript API/app gates and a diff check.
