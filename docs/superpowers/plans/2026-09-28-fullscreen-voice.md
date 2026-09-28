# Fullscreen voice calls

Issue: https://github.com/OpenCoven/coven-cave/issues/5654. Continues PR #5657.
Val requested fullscreen calls, captions above Glitter Crypt, refined Cave UI,
lower latency, ElevenLabs support, and easy per-familiar voice switching.
The supplied arcade image guides the game's cyan ghosts and magenta crystals;
application chrome follows `docs/coven-design-language.md` and existing tokens.

## 1. Reduce avoidable speech latency

- [x] In `src/app/api/voice/session/route.ts`, avoid hydrating unused realtime
  instructions for providers whose familiar runtime owns the conversation.
- [x] In `src/lib/voice/speech-loop.ts` and `elevenlabs.ts`, prepare at most one
  upcoming utterance while the current one plays. Preserve order, bound buffered
  work, and cancel prepared requests on interruption, failure, and disconnect.
- [x] Keep the chosen expressive v3 Conversational default and explicit saved
  choices. Do not trade identity, tools, privacy, or speech quality for latency.
- [x] Add behavioral regressions for hydration and queued-audio cancellation;
  report measurements as measurements, not provider-wide performance claims.

## 2. Fullscreen conversation and game captions

- [x] Move gated call CSS from `src/styles/cave-chat/activity.css` into a sheet
  imported by `voice-call-overlay.tsx`. Fill the viewport with safe-area padding,
  a restrained header, readable conversation measure, and a compact control dock.
- [x] Make `arcade-panel.tsx` fill the available stage when playing. Layer a
  bounded recent-caption view above the iframe without intercepting game input.
  Keep full transcript, typed reply, mute, interruption, and end-call reachable.
- [x] Preserve sandbox isolation and silent gameplay. Use the reference palette
  inside the game; do not add hardcoded colors to application chrome.
- [x] Verify keyboard/focus return, narrow viewports, long captions, loading and
  error recovery, light/dark/non-default themes, and reduced motion.

## 3. Set a familiar's voice within the call

- [x] Add a focused settings surface using existing provider catalogs and shared
  controls. Expose provider, delivery model, and voice with honest loading/errors.
- [x] Save compatible fields atomically through `PATCH /api/config`, announce
  success, refresh familiar data, and reconnect using the saved selection.
  Preserve transcript and mute preference across a deliberate voice change.
- [x] Test successful switch, failed save, incompatible provider fields, retry,
  cancellation, and cleanup of the prior live session.

## 4. Verify and deliver

- [x] Run focused regressions, typecheck, lint/design/test-wiring gates, production
  build, and Chromium/WebKit acceptance for fullscreen, game captions, and voice
  changes. Retain the live ElevenLabs/native OpenAI evidence already collected.
- [x] Obtain specification review followed by code-quality review and fix findings.
- [ ] Update PR scope and verify every terminal check on the exact final head.
- [ ] Squash merge through protected-main workflow. Record issue completion and
  preserve this worktree with its owner because unrelated Vault state is dirty.

The canonical execution status remains on issue #5654; this document specifies
the requested implementation and acceptance, not a separate work queue.
