// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./familiar-studio-brain-tab.tsx", import.meta.url),
  "utf8",
);
const css = readFileSync(new URL("../styles/globals/shell-responsive.css", import.meta.url), "utf8");

assert.match(source, /export function FamiliarStudioBrainTab/);
assert.match(source, /harness/);
assert.match(source, /model/);
assert.match(source, /familiar-studio-brain__label">Runtime<\/span>/, "Brain tab should label harness selection as Runtime");
assert.doesNotMatch(source, /familiar-studio-brain__label">Harness<\/span>/, "Brain tab should not show Harness as the product label");
assert.match(
  source,
  /catalogForRuntime/,
  "Brain tab model menu should source options from the runtime → provider catalog",
);
assert.match(
  source,
  /modelOptions\.map/,
  "Brain tab should render a model select from the catalog options",
);
assert.match(
  source,
  /modelOptions\.length > 0[\s\S]{0,160}<StandardSelect/,
  "A runtime with catalog models, including Hermes, must render the dropdown instead of only free text",
);
assert.match(
  source,
  /allowCustomModel/,
  "Brain tab should keep a free-text fallback for ids not in the curated catalog",
);
// ── Model select: Inherit default must be representable (2026-07-12) ─────────
// The select's value used to be `draftModelIsListed ? draftModel : "__custom__"`,
// so "" (Inherit default) always rendered as Custom... with an empty text box.
// Custom mode is now explicit state; "" only means inherit.
assert.match(
  source,
  /const \[modelCustomMode, setModelCustomMode\] = useState\(false\)/,
  "Custom model mode must be explicit state, not inferred from an empty draft",
);
assert.match(
  source,
  /modelCustomMode \|\| \(draftModel !== "" && !draftModelIsListed\)/,
  "Only a non-empty unlisted id (or explicit Custom...) switches the select to Custom",
);
assert.match(
  source,
  /value=\{modelIsCustom \? "__custom__" : draftModel\}/,
  "Inherit default (empty draft) must render as the empty option, not Custom...",
);
assert.match(
  source,
  /if \(!trimmed\) setModelCustomMode\(false\)/,
  "Blurring an empty custom field falls back to Inherit default",
);
assert.match(
  source,
  /type="text"[\s\S]{0,800}autoCapitalize="none"[\s\S]{0,80}autoCorrect="off"[\s\S]{0,80}spellCheck=\{false\}/,
  "Brain tab custom model input should not auto-capitalize, autocorrect, or spellcheck model ids",
);
assert.match(source, /note/);
assert.match(source, /\/api\/harnesses/);
assert.match(source, /\/api\/config/);
assert.match(source, /method.*PATCH/);
assert.match(
  source,
  /defaultHarnessLabel/,
  "Brain tab should name the inherited workspace default runtime",
);
assert.match(
  source,
  /label: `Inherit workspace default: \$\{defaultHarnessLabel\}`/,
  "Default runtime copy should clarify that this familiar inherits the workspace default",
);
assert.match(
  source,
  /label: "Available runtimes"[\s\S]{0,240}harnesses\.map/,
  "Other available runtimes should be grouped below the inherited default option",
);
assert.match(
  source,
  /\/api\/capabilities\?harness=/,
  "Brain tab should fetch the daemon capabilities manifest for the selected harness",
);
assert.match(
  source,
  /familiar-studio-brain__capabilities/,
  "Brain tab should expose a per-familiar capabilities accordion",
);
assert.match(
  source,
  /familiar-studio-brain__workspace/,
  "Brain tab should render a full-width workspace shell",
);
assert.match(
  source,
  /familiar-studio-brain__primary/,
  "Brain tab should keep runtime, model, and prompt in the primary column",
);
assert.match(
  source,
  /familiar-studio-brain__sidecar/,
  "Brain tab should move voice and capabilities into a sidecar column",
);
assert.match(
  source,
  /Runtime & model/,
  "Brain tab should group runtime and model controls under a single section",
);
assert.match(
  css,
  /\.familiar-studio-brain__workspace\s*\{[\s\S]{0,220}grid-template-columns:\s*minmax\(0,\s*1fr\)\s*minmax\(260px,\s*320px\)/,
  "Brain workspace CSS should use a full-width primary column plus a bounded sidecar",
);
assert.match(
  css,
  /@media \(max-width: 860px\)[\s\S]*\.familiar-studio-brain__workspace\s*\{[\s\S]{0,120}grid-template-columns:\s*1fr/,
  "Brain workspace should collapse to one column on narrow surfaces",
);

// ── Reflection: autoSelfReport toggle (2026-07-06) ───────────────────────────
// The config field was wired end-to-end (GET /api/familiars → chat-view's
// session-close self-report) but had no UI. It saves through the tab's shared
// /api/config patch helper; `null` deletes the key (resolved default: false).
assert.match(source, /Auto self-report/, "Brain tab exposes the auto self-report toggle");
assert.match(source, /role="switch"[\s\S]{0,80}aria-checked=\{draftAutoSelfReport\}/, "the toggle is a proper switch");
assert.match(source, /autoSelfReport: next \? true : null/, "off deletes the config key instead of writing false");
assert.match(source, /if \("autoSelfReport" in patch\) setDraftAutoSelfReport/, "failed saves revert the toggle draft");

// 2026-07-15: the On/Off pill became the shared settings-switch track/knob
// toggle (same control as Settings → General), for both the Reflection card
// and the Asana section's enable row.
assert.match(
  source,
  /settings-switch focus-ring[\s\S]{0,40}draftAutoSelfReport \? " is-on" : ""/,
  "auto self-report renders the shared settings-switch toggle",
);
assert.match(source, /settings-switch__knob/, "the toggle carries the track knob");
assert.doesNotMatch(
  source,
  /draftAutoSelfReport \? "On" : "Off"/,
  "the pill-button On/Off text form is gone",
);

// ── Voice picker: traits + preview (2026-07-15) ──────────────────────────────
// The OpenAI voice menu is sourced from the shared realtime-voice catalog so
// every option carries a perceived gender/accent/vibe detail line, and both
// providers get a play/stop preview button beside the voice control.
assert.match(
  source,
  /OPENAI_REALTIME_VOICES\.map\(\(voice\) => \(\{[\s\S]{0,200}detail: openAiVoiceDetail\(voice\)/,
  "voice options come from the catalog with a gender/accent/vibe detail line",
);
assert.doesNotMatch(
  source,
  /\{ value: "alloy", label: "alloy" \}/,
  "hand-rolled voice options are gone — the catalog is the single source",
);
assert.match(
  source,
  /openAiVoiceDetail\(selectedOpenAiVoice\)/,
  "the current pick's traits stay visible under the closed select",
);
assert.match(
  source,
  /\/api\/voice\/preview\?voice=/,
  "OpenAI previews fetch the server-minted sample (fetch carries the sidecar token)",
);
assert.match(
  source,
  /URL\.createObjectURL\(blob\)/,
  "preview audio plays from a blob URL, not a bare <audio src> (auth bridge)",
);
assert.match(
  source,
  /SpeechSynthesisUtterance/,
  "the local provider previews through the system synthesizer",
);
assert.match(
  source,
  /aria-label=\{previewActive \? "Stop voice preview" : "Preview voice"\}/,
  "the preview button announces its play/stop state",
);
assert.match(
  source,
  /const previewActive = previewStatus !== "idle"/,
  "loading is cancellable — the button reads Stop for any non-idle state instead of disabling",
);
assert.doesNotMatch(
  source,
  /disabled=\{previewStatus/,
  "the preview button must not disable during loading (users can cancel in-flight previews)",
);
assert.match(
  source,
  /const gen = \+\+previewGenRef\.current/,
  "in-flight previews are generation-guarded so stop can't be overtaken by late audio",
);
assert.match(
  css,
  /\.familiar-studio-brain__voice-preview\s*\{/,
  "the preview button has dedicated styling beside the voice select",
);

console.log("familiar-studio-brain-tab.test.ts: ok");

// ── ElevenLabs pickers are account-backed dropdowns with a raw-id fallback ───
assert.match(
  source,
  /fetch\("\/api\/voice\/elevenlabs\/catalog"\)/,
  "Brain tab loads the user's ElevenLabs voice library through the vault-keyed catalog proxy",
);
assert.match(
  source,
  /options=\{elevenVoiceOptions\}/,
  "the ElevenLabs Voice picker renders the saved-voice dropdown options",
);
assert.match(
  source,
  /options=\{elevenModelOptions\}/,
  "the ElevenLabs Voice-model picker renders the account-model dropdown options",
);
assert.match(
  source,
  /Saved voice id/,
  "a saved voice id missing from the library stays selectable instead of being cleared",
);
assert.match(
  source,
  /elevenCatalog\.status === "error" && elevenCatalog\.note/,
  "catalog failures surface an actionable hint while the raw-id inputs remain usable",
);

// ── Voice ids survive to disk (cave-32er) ────────────────────────────────────
// The config round-trip is covered in cave-config.test.ts; what actually lost
// a typed voice id was the CLIENT: a monolithic draft-reset effect keyed on
// every familiar field (so the 4s roster poll landing one field's save wiped
// another field's in-progress draft), plus blur-only commits that unmount
// could skip. These pin the repaired shape.

// 1. The full reset is keyed on the familiar id alone — never on field values.
assert.match(
  source,
  /setToast\(null\);[\s\S]{0,1800}?\}, \[familiar\.id\]\)/,
  "the full draft reset fires only when the familiar itself changes",
);
assert.doesNotMatch(
  source,
  /\}, \[\s*familiar\.id,\s*familiar\.harnessOverride,[\s\S]{0,300}familiar\.voiceName/,
  "the all-fields reset dependency list is gone (it clobbered in-progress drafts)",
);

// 2. Per-field sync: each voice draft follows only its own backing value.
assert.match(
  source,
  /useEffect\(\(\) => \{\s*\n\s*setDraftVoiceName\(familiar\.voiceName \?\? ""\);\s*\n\s*\}, \[familiar\.voiceName\]\)/,
  "the voice-id draft syncs on its own backing value only",
);
assert.match(
  source,
  /useEffect\(\(\) => \{\s*\n\s*setDraftVoiceProvider\(familiar\.voiceProvider \?\? ""\);\s*\n\s*\}, \[familiar\.voiceProvider\]\)/,
  "the voice-provider draft syncs on its own backing value only",
);

// 3. Dirty voice text flushes on unmount, so closing the Studio (or leaving
//    the tab) without a blur still persists the typed id.
assert.match(
  source,
  /const dirtyTextRef = useRef[\s\S]{0,600}?pendingVoiceName !== \(familiar\.voiceName \?\? ""\)/,
  "unsaved voice text is tracked against the last saved values",
);
assert.match(
  source,
  /return \(\) => \{[\s\S]{0,700}?if \(pending\.familiarId !== familiar\.id\) return;[\s\S]{0,500}?familiars: \{ \[pending\.familiarId\]: pending\.patch \}/,
  "the id-reset cleanup flushes dirty voice text for the SAME familiar (unmount), never cross-writing on a switch",
);

// 4. Enter commits the free-text voice inputs through their blur handlers.
assert.match(
  source,
  /onBlur=\{\(\) => void save\(\{ voiceName: draftVoiceName\.trim\(\) \|\| null \}\)\}\s*\n\s*onKeyDown=\{\(e\) => \{[\s\S]{0,200}?if \(e\.key === "Enter"\) e\.currentTarget\.blur\(\);/,
  "Enter commits a typed voice id instead of leaving it unsaved",
);
const imeSafeVoiceEnterHandlers =
  source.match(
    /onKeyDown=\{\(e\) => \{\s*if \(e\.nativeEvent\.isComposing\) return;[\s\S]{0,200}?if \(e\.key === "Enter"\) e\.currentTarget\.blur\(\);/g,
  ) ?? [];
assert.equal(
  imeSafeVoiceEnterHandlers.length,
  3,
  "the free-text voice inputs and the custom image-model input all ignore Enter while an IME composition is active",
);

// 5. Successful saves catch the roster up immediately — every surface gating
//    on familiar.voiceProvider (the chat kebab's Call item) sees the new
//    voice without waiting for the next poll.
assert.match(
  source,
  /reportDaemonSyncSuccess\(\);[\s\S]{0,400}?window\.dispatchEvent\(new Event\("cave:familiars-refresh"\)\);/,
  "a successful config save dispatches cave:familiars-refresh (parity with the other /api/config writers)",
);

// ── Image generation card (cave-i6dx) ────────────────────────────────────────
assert.match(
  source,
  /familiar-studio-brain__card-title">Image generation<\/h3>/,
  "Brain tab should have an Image generation card in the sidecar",
);
assert.match(
  source,
  /\{ value: "", label: "Auto \(match chat model\)" \}/,
  "the image provider select defaults to Auto (provider inferred from the chat model)",
);
assert.match(
  source,
  /\{ value: IMAGE_GEN_OFF, label: "Off" \}/,
  "image generation can be turned off per familiar",
);
// Provider switches clear the dependent picks in the SAME save patch, so a
// stale model/size/quality can never ride along to the wrong provider.
assert.match(
  source,
  /imageProvider: next \|\| null,\s*imageModel: null,\s*imageSize: null,\s*imageQuality: null,/,
  "switching image provider clears model, size, and quality together",
);
// The custom image model mode mirrors the runtime model select's explicit
// Custom... state ("" must stay representable as Provider default).
assert.match(
  source,
  /const \[imageModelCustomMode, setImageModelCustomMode\] = useState\(false\)/,
  "custom image model mode must be explicit state, not inferred from an empty draft",
);
assert.match(
  source,
  /imageModelCustomMode \|\| \(draftImageModel !== "" && !draftImageModelIsListed\)/,
  "only a non-empty unlisted id (or explicit Custom...) switches the image model select to Custom",
);
// Per-field draft sync (the cave-32er convention) covers the image fields too.
assert.match(
  source,
  /setDraftImageProvider\(familiar\.imageProvider \?\? ""\);\s*\}, \[familiar\.imageProvider\]\);/,
  "draftImageProvider follows its own backing field only",
);
assert.match(
  source,
  /setDraftImageSize\(familiar\.imageSize \?\? ""\);\s*\}, \[familiar\.imageSize\]\);/,
  "draftImageSize follows its own backing field only",
);
// The blur-committed custom image model rides the same unmount-flush guard as
// the voice text fields (a typed id must survive closing the Studio).
assert.match(
  source,
  /const pendingImageModel = draftImageModel\.trim\(\);\s*if \(pendingImageModel !== \(familiar\.imageModel \?\? ""\)\) patch\.imageModel = pendingImageModel \|\| null;/,
  "a dirty custom image model id is tracked for the unmount flush",
);
