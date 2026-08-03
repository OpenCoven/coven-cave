# Central voice settings design

Status: approved
Bead: `cave-ti4j9`

## Problem

Cave already supports OpenAI Realtime, Familiar brain, Local, and ElevenLabs
voice providers. ElevenLabs has a Vault-backed key, account catalog, streaming
TTS proxy, previews, and per-familiar controls. Settings only exposes the local
Piper/Kokoro model manager under General, so provider readiness, credentials,
models, and voices remain fragmented across Settings, Familiar Studio, and
Research Studio.

## Decision

Add a dedicated **Settings → Voice** destination. It is the app-wide provider
hub and the owner of defaults for newly created familiars. Familiar Studio
continues to own per-familiar overrides.

The alternatives are intentionally rejected:

- Expanding General → Local speech keeps the smallest diff but preserves the
  fragmented information architecture and becomes crowded as providers grow.
- Moving voice configuration into Vault conflates secret custody with
  provider/model selection and would make keyless providers awkward.

## Goals

- Put supported voice providers, readiness, credentials, voices, and models in
  one Settings destination.
- Move the existing local model manager without losing download, removal,
  progress, runtime, refresh, or announcement behavior.
- Make ElevenLabs a first-class TTS option with Vault-backed credential status,
  the user's saved voice library, and TTS-capable models.
- Persist a non-secret provider/model/voice default that seeds newly created
  familiars.
- Reuse shared provider and catalog definitions in Settings and Familiar Studio
  so option labels and availability cannot drift.

## Non-goals

- Do not rewrite or dynamically inherit settings for existing familiars.
- Do not move per-familiar selection out of Familiar Studio.
- Do not store, return, or prefill plaintext provider keys.
- Do not implement Gemini Live while its provider remains unavailable.
- Do not redesign voice-call transport, speech recognition, Research Studio,
  or the existing provider proxies.

## Information architecture

Add `voice` to the canonical Settings section catalog, navigation, overview
metadata, search index, and shell renderer. Use an existing Phosphor icon from
the checked-in subset. Remove Local speech from General and render the same
management component inside Voice.

The Voice page contains these ruled groups:

1. **Default for new familiars** — provider, model, and voice controls with
   provider-specific choices and an explicit None default.
2. **ElevenLabs** — credential status, replace-key action, catalog refresh,
   saved voices, and TTS-capable models.
3. **OpenAI Realtime** — credential status and the existing reviewed voice
   catalog with previews.
4. **Local speech** — the existing Piper/Kokoro runtime and model download
   manager.
5. **Familiar brain** — a concise availability explanation because it is
   keyless and uses the familiar's configured runtime.

Gemini may appear only as unavailable explanatory text; it cannot be selected
as the creation default.

## Shared catalog contract

Create a dependency-light voice-settings catalog that describes selectable
providers, labels, implementation state, Vault key when applicable, and
provider defaults. The runtime registry, Vault recovery mapping, Settings, and
Familiar Studio consume that metadata. The catalog composes existing
authoritative model/voice sources rather than copying their data:

- `OPENAI_REALTIME_VOICES` and `DEFAULT_OPENAI_VOICE_ID`;
- ElevenLabs shared validators/defaults plus `/api/voice/elevenlabs/catalog`;
- `/api/voice/engines` for verified local voice choices.

Familiar Studio and Settings consume this shared catalog for provider ordering
and labels. Provider-specific controls remain focused components rather than a
single conditional mega-form.

## Persistence and creation behavior

Add a top-level `voice` object to canonical Cave preferences:

```ts
voice: {
  defaultProvider: "" | "openai" | "local" | "familiar" | "elevenlabs";
  defaultModel: string;
  defaultVoice: string;
}
```

Normalization and patch validation trim bounded strings, reject unknown
providers, and clear incompatible model/voice values when the provider changes.
The default remains empty for existing installations, preserving current
creation behavior until the user opts in.

`POST /api/familiars` reads the canonical preference at creation time. When a
default provider is selected, it writes `voiceProvider`, `voiceModel`, and
`voiceName` into only the new familiar's Cave binding. It never changes global
harness/model defaults and never modifies existing familiar bindings. The
server validates the provider-specific model/voice shape again so a corrupt or
stale preference fails closed to no voice default rather than creating a broken
binding.

## Credentials and security

Provider credentials remain Vault entries. The Voice page uses `/api/vault` to
read mapping status and to write a replacement encrypted value for the exact
allowlisted keys `OPENAI_API_KEY` and `ELEVENLABS_API_KEY`. It never reads a
secret value back, never serializes credentials into Cave preferences, and
never sends keys through provider catalog responses.

Successful key replacement refreshes provider readiness/catalog state and is
announced. Failures render as errors with Retry or replacement guidance rather
than as an empty voice list.

## Interaction and accessibility

- Persistent labels identify provider, model, voice, and secret inputs.
- Provider-specific help and errors are connected with `aria-describedby`.
- Loading names the provider or collection; known-shape loads use existing
  skeleton/error primitives.
- Key saves, default changes, downloads, removals, and refresh outcomes use the
  existing live-region announcer.
- Interactive controls reuse Button, StandardSelect, SettingsGroup, and focus
  ring primitives. No new animation is required.
- Copy stays utilitarian and sentence case. ElevenLabs uses the vendor's
  canonical spelling.

## Error handling

- Vault unavailable: show a provider-specific error and Retry; do not report
  the provider as unconfigured.
- Missing or invalid ElevenLabs key: keep the default selection visible but
  mark it unavailable and offer key replacement.
- Catalog failure: preserve the stored opaque model/voice IDs and allow retry;
  do not clear user intent.
- Local runtime or model failure: retain the current VoiceEngineSettings
  behavior and actionable runtime hints.
- Invalid stored default: normalize to no creation default while leaving
  per-familiar bindings untouched.

## Testing and verification

Follow red-green TDD for each behavior:

- preference defaults, normalization, patch validation, merge, and sidecar
  smoke round-trip;
- familiar creation with no default, each valid provider default, and corrupt
  preference fallback;
- Settings section navigation/search and removal of Local speech from General;
- shared provider catalog ordering and disabled Gemini behavior;
- ElevenLabs Vault status, catalog success/failure, opaque saved selection, and
  key replacement without secret readback;
- OpenAI/local/familiar provider rendering and creation-default controls;
- accessibility labels, described errors, announcements, and focus behavior.

Before handoff, run focused tests, tests-wired, typecheck, lint/design gates,
the relevant app/API suites, build, and `git diff --check`. Verify the rendered
Settings surface in the native Tauri app or the user's default browser at
desktop and narrow widths, in dark, light, and one non-default theme. Walk the
design-language shipping checklist and report any proof gap explicitly.

## Delivery boundaries

The implementation stays on `feat/cave-ti4j9-voice-settings` in the authorized
fallback worktree. No commit, push, PR, merge, or automatic Bead close occurs
without the required verification and current authority. Because the managed
creator was unavailable, post-merge cleanup requires bounded manual retirement
instead of the automatic lifecycle transaction.
