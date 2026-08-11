// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const component = readFileSync(new URL("./voice-call-overlay.tsx", import.meta.url), "utf8");
// cave-chat.css is an @import aggregator: the overlay's own rules live in the
// partials it pulls in, so reading only the aggregator asserts against a file
// that contains none of them.
const styles = [
  "cave-md",
  "cave-composer",
  "chat-list",
  "calendar",
  "cave-chat",
  "cave-chat/activity",
  "cave-chat/auxiliary-surfaces",
]
  .map((sheet) => readFileSync(new URL(`../styles/${sheet}.css`, import.meta.url), "utf8"))
  .join("\n");

assert.match(
  component,
  /import\s+\{[^}]*useFocusTrap[^}]*\}\s+from\s+["']@\/lib\/use-focus-trap["']/,
  "VoiceCallOverlay imports the shared focus trap",
);

assert.match(
  component,
  /useFocusTrap\(true,\s*dialogRef,\s*\{\s*onEscape:/,
  "VoiceCallOverlay traps focus and handles Escape",
);
assert.match(
  component,
  /onEscape:[\s\S]{0,220}dispatch\(\{\s*type:\s*"CLOSE_REQUEST"\s*\}\);?\s*\},/,
  "Escape ends the call cleanly once nothing else is staged",
);

assert.match(
  component,
  /role="dialog"[\s\S]{0,160}aria-modal="true"[\s\S]{0,160}aria-labelledby="voice-call-overlay-title"/,
  "VoiceCallOverlay exposes named modal dialog semantics",
);

assert.match(
  component,
  /id="voice-call-overlay-title"/,
  "VoiceCallOverlay provides a heading id for aria-labelledby",
);

assert.match(
  component,
  /tabIndex=\{-1\}/,
  "VoiceCallOverlay dialog can receive fallback focus",
);

assert.match(
  component,
  /className="voice-call-overlay__retry focus-ring"/,
  "error retry action uses the styled overlay button class",
);

assert.match(
  component,
  /className="voice-call-overlay__control focus-ring"/,
  "mute action uses the styled overlay control class",
);

assert.match(
  styles,
  /\.voice-call-overlay\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?z-index:\s*1200;[\s\S]*?place-items:\s*center;/,
  "voice overlay is fixed, centered, and above mobile chrome",
);

assert.match(
  styles,
  /\.voice-call-overlay__dialog\s*\{[\s\S]*?background:\s*var\(--glass-raised\);[\s\S]*?backdrop-filter:\s*blur\(var\(--glass-blur\)\)[\s\S]*?box-shadow:/,
  "voice overlay dialog is a frosted raised surface",
);

assert.match(
  styles,
  /\.voice-call-overlay__end\s*\{[\s\S]*?background:\s*var\(--color-danger\);/,
  "end-call button reads as the destructive primary action",
);

// ── Call status + errors are announced to assistive tech ─────────────────────
// Was: a plain <span> whose text cycled through requesting-mic → connecting →
// live → error with no live region, so screen readers heard nothing.
assert.match(
  component,
  /className="voice-call-overlay__state" role="status" aria-live="polite"/,
  "the call-status label is a polite live region so transitions are announced",
);
assert.match(
  component,
  /className="voice-call-overlay__error" role="alert"/,
  "the error block is an alert so failures interrupt the screen reader",
);
assert.match(
  component,
  /aria-describedby=\{state\.state === "error" \? "voice-call-overlay-error" : undefined\}/,
  "the dialog is described by the error message while in the error state",
);
assert.match(
  component,
  /<div id="voice-call-overlay-error">\{errorMessage\(state\.errorCode\)\}<\/div>/,
  "the error headline is a human message, not the raw error code",
);

// ── Raw error codes map to actionable messages ───────────────────────────────
assert.match(component, /function errorMessage\(code: string \| undefined\): string/, "errorMessage maps codes to readable text");
assert.match(component, /case "microphone_denied":[\s\S]*?Microphone access is blocked/, "microphone_denied becomes a native-safe headline");
assert.match(component, /case "microphone_not_found":[\s\S]*?No microphone was found/, "missing hardware is not mislabeled as denied");
assert.match(component, /case "microphone_unavailable":[\s\S]*?microphone isn't available/, "busy or unreadable hardware is not mislabeled as denied");
assert.doesNotMatch(
  component,
  /<div>\{state\.errorCode\}<\/div>/,
  "the raw error code is no longer rendered as the headline",
);

// ── Desktop microphone permission is requested natively before capture ──────
assert.match(
  component,
  /import\s+\{[^}]*requestMicrophoneStream[^}]*\}\s+from\s+["']@\/lib\/voice\/microphone-access["']/,
  "voice calls use the shared native-aware microphone request",
);
assert.match(
  component,
  /await requestMicrophoneStream\(\)/,
  "the overlay asks the native-aware flow for its stream",
);
assert.doesNotMatch(
  component,
  /navigator\.mediaDevices\.getUserMedia/,
  "the overlay must not bypass the native permission preflight",
);
assert.match(
  component,
  /type:\s*"MIC_FAILED",[\s\S]{0,180}errorCode:\s*failure\.code,[\s\S]{0,180}hint:\s*failure\.hint,[\s\S]{0,180}canOpenSettings:\s*failure\.canOpenSettings/,
  "capture failures preserve their real reason and recovery capability",
);
assert.match(
  component,
  /catch \(error\) \{[\s\S]*?if \(cancelled\) return;[\s\S]*?const failure = classifyMicrophoneCaptureError\(error\)/,
  "cancelled microphone requests do not dispatch failure after cleanup",
);
assert.match(
  component,
  /\{state\.canOpenSettings && \([\s\S]{0,600}>\s*Open settings\s*<\/button>/,
  "denied desktop access offers a direct System Settings recovery action",
);

// ── True-voice providers own persistence — no transcript double-append ───────
// The familiar-brain provider's turns run through /api/chat/send, which
// persists both sides as real conversation history; posting voice transcripts
// on top would duplicate every exchange.
assert.match(
  component,
  /const persistTranscript = !provider\.persistsTranscripts;/,
  "the overlay derives transcript posting from the provider's persistence capability",
);
assert.match(
  component,
  /onUserTranscriptFinal:\s*\(text\)\s*=>\s*\{[\s\S]{0,160}if \(persistTranscript\) postTranscript\(sessionId, callId, "user", text\);/,
  "user transcript finals persist only when the provider does not",
);
assert.match(
  component,
  /onAssistantTranscriptFinal:\s*\(text\)\s*=>\s*\{[\s\S]{0,160}if \(persistTranscript\) postTranscript\(sessionId, callId, "assistant", text\);/,
  "assistant transcript finals persist only when the provider does not",
);

// ── Provider error detail is threaded to the error UI, not swallowed ─────────
// Was: clientAdapter.connect threw bare `sdp_exchange_failed_<status>` and the
// PROVIDER_ERROR dispatches dropped everything but the code, so a stale
// voiceModel surfaced only as "The call ran into a problem." (cave-8c9c)
assert.match(
  component,
  /import\s+\{[^}]*voiceErrorHint[^}]*\}\s+from\s+["']@\/lib\/voice\/types["']/,
  "overlay imports the shared voiceErrorHint extractor",
);
assert.match(
  component,
  /onError:\s*\(err\)\s*=>\s*dispatch\(\{\s*type:\s*"PROVIDER_ERROR",\s*errorCode:\s*err\.message,\s*hint:\s*voiceErrorHint\(err\)\s*\}\)/,
  "live provider errors thread their hint into PROVIDER_ERROR",
);
assert.match(
  component,
  /type:\s*"PROVIDER_ERROR",[\s\S]{0,120}errorCode:\s*err instanceof Error \? err\.message : "connect_failed",[\s\S]{0,120}hint:\s*voiceErrorHint\(err\)/,
  "connect failures thread their hint into PROVIDER_ERROR",
);

// ── The live call says how it hears (cave-vpe1, hybrid on-device policy) ─────
// The engine label is honesty UI: "on-device" is the no-cloud promise kept;
// dictation/browser modes tell the user their audio rides a service.
assert.match(
  component,
  /dispatch\(\{\s*type:\s*"CONNECTED",\s*startedAt:\s*Date\.now\(\),\s*earsEngine:\s*live\.earsEngine,\s*mouthEngine:\s*live\.mouthEngine,/,
  "CONNECTED carries the LiveSession's ears and mouth engines into call state",
);
assert.match(
  component,
  /\{state\.earsEngine && \([\s\S]{0,120}className="voice-call-overlay__ears"/,
  "live calls render the ears-engine badge when a loop provider reports one",
);
assert.match(
  component,
  /\{state\.mouthEngine && \([\s\S]{0,120}className="voice-call-overlay__mouth"/,
  "live calls render the mouth-engine badge when a loop provider reports one (cave-vony)",
);
assert.match(
  component,
  /case "native-on-device": return "Hearing on-device";[\s\S]{0,120}case "native-dictation": return "Hearing via Apple dictation";[\s\S]{0,120}case "web-speech": return "Hearing via browser speech";/,
  "every ears engine mode has an honest human label",
);
assert.match(
  component,
  /case "sidecar-piper": return "Speaking via local Piper";[\s\S]{0,120}case "elevenlabs": return "Speaking via ElevenLabs";[\s\S]{0,120}case "system-synth": return "Speaking via system voice";/,
  "every mouth engine mode has an honest human label (cave-vony)",
);
assert.match(
  component,
  /startsWith\("sdp_exchange_failed_"\)/,
  "SDP-exchange failures get their own human headline",
);
assert.match(
  component,
  /\{state\.hint && <div className="voice-call-overlay__hint">\{state\.hint\}<\/div>\}/,
  "the provider hint renders under the headline when present",
);

// ── In-place recovery: key-shaped failures are fixable without leaving the
// call (cave-xz57). Was: every connect failure dead-ended at "Try again" —
// a missing/rejected ElevenLabs (or any provider) key sent the user hunting
// through Vault settings while the call overlay sat useless.
assert.match(
  component,
  /import\s+\{[^}]*voiceRecoveryVaultKey[^}]*\}\s+from\s+["']@\/lib\/voice\/vault-key-recovery["']/,
  "overlay derives key-fixability from the shared recovery module",
);
assert.match(
  component,
  /voiceRecoveryVaultKey\(\{\s*errorCode:\s*state\.errorCode,\s*missingKey:\s*state\.missingKey,\s*providerId:\s*familiar\.voiceProvider,\s*\}\)/,
  "fixable key resolution threads the server's missingKey and the familiar's provider",
);
assert.match(
  component,
  /\{fixableKey && \([\s\S]{0,80}<form[\s\S]{0,80}className="voice-call-overlay__fix"/,
  "a key-shaped failure renders the in-place vault editor form",
);
assert.match(
  component,
  /type="password"[\s\S]{0,120}autoComplete="off"/,
  "the key input is a password field that never autocompletes",
);
assert.match(
  component,
  /fetch\("\/api\/vault",\s*\{\s*method:\s*"POST",[\s\S]{0,200}storage:\s*"encrypted"/,
  "saving writes the key to the vault as a local encrypted secret",
);
assert.match(
  component,
  /setKeyDraft\(""\);\s*dispatch\(\{\s*type:\s*"RETRY"\s*\}\)/,
  "a successful save clears the draft and retries the call in place",
);
assert.match(
  component,
  /setKeySaveError\("Couldn't save the key — is the daemon running\?"\)/,
  "a failed vault write degrades to an inline message, never a crash",
);
assert.match(
  component,
  /\{keySaveError && \([\s\S]{0,120}role="alert"/,
  "vault save failures are announced to assistive tech",
);
assert.match(
  component,
  /getVoiceProvider\(grant\?\.provider \?\? familiar\.voiceProvider \?\? ""\)/,
  "the connect phase trusts the minted grant's provider over the possibly-stale familiar prop",
);
assert.match(
  component,
  /case "not_implemented":[\s\S]{0,80}isn't available yet/,
  "unshipped providers fail with honest copy instead of a generic error",
);
assert.match(
  styles,
  /\.voice-call-overlay__fix\s*\{[\s\S]*?display:\s*grid;/,
  "the in-place fix form has overlay styling",
);
assert.match(
  styles,
  /\.voice-call-overlay__retry:disabled\s*\{[\s\S]*?opacity:/,
  "the save button reads as disabled while the draft is empty or saving",
);

// ── Live transcript, speaking highlight, in-call reply (cave-zr9dx) ────────

assert.match(
  component,
  /className="voice-call-overlay__transcript"[\s\S]{0,200}role="log"[\s\S]{0,200}aria-live="polite"/,
  "the live transcript is an announced log region",
);
assert.match(
  component,
  /aria-relevant="additions"/,
  "only added turns are announced — a partial rewrites its own text constantly",
);
assert.match(
  component,
  /onSpeaking:\s*\(utterance\)\s*=>\s*\{\s*setTranscript\(\(t\)\s*=>\s*applySpeaking\(t,\s*utterance\)\)/,
  "the overlay tracks the utterance the mouth is voicing",
);
assert.match(
  component,
  /splitSpokenText\(turn\.text,\s*isSpeaking \? transcript\.speaking : null\)/,
  "only the turn being voiced is split for highlighting",
);
assert.match(
  component,
  /<mark className="voice-call-overlay__spoken">\{split\.match\}<\/mark>/,
  "the spoken run renders as a semantic mark, not a styled span",
);
assert.match(
  component,
  /onPartialTranscript:\s*\(role,\s*text\)\s*=>\s*\{\s*setTranscript\(\(t\)\s*=>\s*applyPartial\(t,\s*role,\s*text\)\)/,
  "in-flight text renders live without being persisted",
);
assert.match(
  component,
  /canSendText:\s*typeof live\.sendText === "function"/,
  "the reply box only appears when the provider actually accepts typed turns",
);
assert.match(
  component,
  /live\.sendText\(buildQuotedPrompt\(replyTarget,\s*body\)\)/,
  "a quoted reply uses the same prompt shape as the chat composer",
);
assert.match(
  component,
  /if \(replyTargetRef\.current\) \{\s*setReplyTarget\(null\);\s*return;\s*\}/,
  "Escape cancels a staged reply before it ends the call",
);
assert.match(
  component,
  /aria-label="Stop speaking"[\s\S]{0,160}liveRef\.current\?\.interrupt\?\.\(\)/,
  "barge-in is reachable without typing while the familiar is speaking",
);
assert.match(
  component,
  /className="voice-call-overlay__reply-input focus-ring"[\s\S]{0,200}aria-label="Reply without speaking"/,
  "the reply field is labelled for assistive tech",
);
assert.match(
  styles,
  /\.voice-call-overlay__transcript\s*\{[\s\S]*?overflow-y:\s*auto;/,
  "a long call scrolls inside the transcript rather than growing the dialog",
);
assert.match(
  styles,
  /\.voice-call-overlay__spoken\s*\{[\s\S]*?background:\s*color-mix\(in oklch, var\(--accent-presence\)/,
  "the speaking highlight is a token-derived tint, not a hardcoded color",
);
assert.match(
  styles,
  /\.voice-call-overlay__spoken\s*\{[\s\S]*?box-decoration-break:\s*clone;/,
  "a highlight that wraps across lines keeps its shape on every line",
);
assert.match(
  styles,
  /\.voice-call-overlay__reply-send:disabled\s*\{[\s\S]*?opacity:/,
  "the send button reads as disabled while the reply draft is empty",
);

// ── Arcade ───────────────────────────────────────────────────────────────────
// The point of mounting a game here is the dead air: mic prompt, session mint,
// connect. These assertions pin the three properties that make it acceptable
// to put a game inside a phone call — opt-in, silent, and disposable.
assert.match(
  component,
  /const WAITING_STATES = new Set\(\["requesting-mic", "minting-session", "connecting"\]\)/,
  "the arcade is offered exactly in the states where nothing is happening yet",
);
assert.match(
  component,
  /useState\(false\);\s*\n\s*const waiting = WAITING_STATES\.has\(state\.state\)/,
  "the arcade is opt-in — it never opens on its own",
);
assert.match(
  component,
  /\{waiting && !arcadeOpen && \(/,
  "the invitation only appears during the wait, never mid-conversation",
);
assert.match(
  component,
  /aria-pressed=\{arcadeOpen\}/,
  "the footer arcade control reports its pressed state to assistive tech",
);
assert.doesNotMatch(
  component,
  /<ArcadePanel[^>]*\bautoPlay\b/,
  "nothing auto-starts the game",
);
assert.match(
  styles,
  /\.arcade-panel__frame\s*\{[\s\S]*?aspect-ratio:/,
  "the game window holds a stable shape instead of collapsing to zero height",
);
assert.match(
  styles,
  /\.voice-call-overlay__arcade-invite\s*\{[\s\S]*?background:\s*color-mix\(in oklch, var\(--accent-presence\)/,
  "the invitation is a token-derived tint, not a hardcoded color",
);

console.log("voice-call-overlay.test.ts: ok");
