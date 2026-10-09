// @ts-nocheck
// Source pins for the composer runtime · model · control chips (cave-yq5l,
// split into separate Runtime / Model / Thinking / Speed chips in #5896): the
// chat composer always shows the active runtime's mark and the effective
// model as separately labelled chips, switching either is one click away, and
// the selected model's reported controls appear as their own chips only while
// the runtime reports them. These pin the contracts that make the chips
// honest: real switching (familiar-level /api/config, the only channel that
// rebinds a harness), an optimistic flip reconciled by a refetch,
// menuitemradio semantics in every popover, and capability-driven control
// chips that never invent a knob the send route could not deliver.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const chip = readFileSync(new URL("./composer-runtime-chip.tsx", import.meta.url), "utf8");
const logo = readFileSync(new URL("./runtime-logo.tsx", import.meta.url), "utf8");
const chatView = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");
const homeComposer = readFileSync(new URL("./home-composer.tsx", import.meta.url), "utf8");
const homeModelState = readFileSync(new URL("./home/use-home-model-state.ts", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles/composer-runtime-chip.css", import.meta.url), "utf8");
const contextPill = readFileSync(new URL("./composer-context-pill.tsx", import.meta.url), "utf8");
const actionsMenu = readFileSync(new URL("./composer-actions-menu.tsx", import.meta.url), "utf8");

// ── Parity: the home composer carries the same picker (cave-v25g) ───────────
// The runtime/model pickers open from the composer context chips (chat
// revamp 1d) — same ComposerRuntimePopover / ComposerModelPopover, same live
// model state.
assert.match(
  homeComposer,
  /<ComposerContextChips[\s\S]*?runtime=\{selectedRuntime\}[\s\S]*?modelValue=\{selectedModelId\}[\s\S]*?modelOptions=\{runtimeModelOptions\}[\s\S]*?onPickRuntime=\{handleSelectRuntime\}[\s\S]*?onPickModel=\{handleSelectModel\}/,
  "the home composer's context chips host the runtime and model pickers from its own model state",
);
assert.match(
  homeComposer,
  /className="cave-composer-footer-band[^"]*"[^>]*>[\s\S]*?<ComposerContextChips/,
  "the chips anchor the composer footer band",
);

// ── Split grammar (#5896): Runtime and Model are separate chips ─────────────
assert.match(
  contextPill,
  /aria-label=\{`Runtime: \$\{context\.runtimeName\} — change runtime`\}/,
  "the runtime chip is a separately labelled control",
);
assert.match(
  contextPill,
  /aria-label=\{`Model: \$\{modelLabel\} — change model`\}/,
  "the model chip is a separately labelled control",
);
assert.match(
  contextPill,
  /<RuntimeLogo runtime=\{context\.config\.runtime\} size=\{13\} \/>/,
  "the runtime chip receives the actual runtime id for the shared RuntimeLogo",
);
assert.match(
  contextPill,
  /runtimeModelLabel\(config\.modelValue, config\.modelOptions\) \?\? "Runtime default \(unresolved\)"/,
  "runtime default remains explicitly unresolved until the runtime reports a model",
);
assert.match(
  contextPill,
  /const context = useComposerContextActions\(props\);[\s\S]*?<ComposerRuntimePopover[\s\S]*?anchorRef=\{runtimeRef\}[\s\S]*?<ComposerModelPopover[\s\S]*?anchorRef=\{modelRef\}[\s\S]*?onPickModel=\{context\.config\.onPickModel\}/,
  "each chip anchors its own popover from the same context controller",
);
// A runtime pick is not a complete switch until a model is chosen (cave-bfwk):
// the runtime menu closes and the model menu opens on the model chip.
assert.match(
  contextPill,
  /<ComposerRuntimePopover[\s\S]*?onPickRuntime=\{\(runtime\) => \{\s*\n\s*context\.config\.onPickRuntime\(runtime\);[\s\S]*?setMenu\("model"\);/,
  "a runtime pick from the chip chains into the Model menu",
);
assert.match(
  contextPill,
  /export function ComposerContextPickers[\s\S]*?<ComposerRuntimePopover[\s\S]*?onPickRuntime=\{\(runtime\) => \{\s*\n\s*context\.config\.onPickRuntime\(runtime\);[\s\S]*?onViewChange\("model"\);/,
  "a runtime pick from the Tools menu chains into the Model menu as well",
);
assert.match(
  actionsMenu,
  /label="Runtime…"[\s\S]*?openContextPicker\("runtime"\)[\s\S]*?label="Model & tuning…"[\s\S]*?openContextPicker\("model"\)/,
  "the Tools menu reaches both pickers",
);

// ── Control chips (#5896): Thinking · Speed, capability-driven ─────────────
assert.match(
  chip,
  /export const COMPOSER_CONTROL_CHIP_FAMILIES: readonly ModelControlFamily\[\] = \[\s*\n\s*"reasoning",\s*\n\s*"performance",\s*\n\];/,
  "only the reasoning and performance families earn a chip; the rest stay under Tools → Response options",
);
assert.match(chip, /reasoning: "Thinking",\s*\n\s*performance: "Speed",/, "the chips carry people's words, not the wire families");
assert.match(
  chip,
  /export function composerControlChips\([\s\S]*?capability\.delivery !== "unsupported"/,
  "chips come only from the reported capability list, so a model without a control shows no chip",
);
assert.match(
  chip,
  /export function controlDeliveryNote[\s\S]*?case "runtime-cli":\s*\n\s*return "Applied by the runtime";[\s\S]*?case "prompt-only":\s*\n\s*return "Sent as prompt guidance";/,
  "each control chip says how its pick reaches the model, so guidance is never mistaken for a setting",
);
assert.match(
  contextPill,
  /\{context\.controlChips\.map\(\(capability\) => \{[\s\S]*?aria-label=\{`\$\{label\}: \$\{valueLabel\} — change \$\{label\.toLowerCase\(\)\}`\}[\s\S]*?title=\{`\$\{label\}: \$\{valueLabel\} · \$\{controlDeliveryNote\(capability\)\}`\}/,
  "control chips are separately labelled and name their delivery",
);
assert.match(
  contextPill,
  /<ComposerModelControlPopover[\s\S]*?value=\{props\.modelControls\?\.\[capability\.family\]\}[\s\S]*?onChange=\{\(value\) => props\.onModelControlChange\?\.\(capability\.family, value\)\}/,
  "a control pick writes the same typed modelControls the Tools sections and the send body use",
);
assert.match(
  chip,
  /export function ComposerModelControlPopover[\s\S]*?checked=\{!value\}[\s\S]*?if \(value\) onChange\(null\);[\s\S]*?\{CONTROL_AUTO_LABEL\}[\s\S]*?\{capability\.values\.map\(\(option\) =>/,
  "the control menu offers Auto (unset: nothing is sent) plus the capability's reported values",
);
assert.match(
  chatView,
  /<ComposerContextChips[\s\S]*?modelCapabilities=\{modelCapabilities\}\s*\n\s*modelControls=\{modelControls\}\s*\n\s*onModelControlChange=\{handleModelControlChange\}/,
  "chat threads the live capability report and typed controls into the chips",
);
assert.match(
  chatView,
  /const handleModelControlChange = useCallback\(\s*\n\s*\(family: ModelControlFamily, value: string \| null\) => \{\s*\n\s*setModelControls\(\(current\) => \{[\s\S]*?else delete next\[family\];/,
  "Auto removes the family from the typed controls instead of sending an empty value",
);
// ── Home parity (#5902): the same chips before the first send ───────────────
assert.match(
  homeModelState,
  /controls\?: ModelControlCapability\[\];[\s\S]*?setModelCapabilities\(responseCapabilities\(json\)\);[\s\S]*?setModelCapabilities\(responseCapabilities\(json\)\);/,
  "the home model-state hook keeps the controls from both the initial GET and every refetch",
);
assert.match(
  homeModelState,
  /if \(json\.ok && json\.state\) setModelState\(json\.state\);\s*\n[\s\S]{0,200}?refetchModelState\(selectionRevision, familiarId\);/,
  "a Home model pick re-reads the state so the controls follow the newly saved model",
);
assert.match(
  homeComposer,
  /<ComposerContextChips[\s\S]*?modelCapabilities=\{modelCapabilities\}\s*\n\s*modelControls=\{modelControls\}\s*\n\s*onModelControlChange=\{handleModelControlChange\}/,
  "home threads the capability report and typed controls into the chips",
);
assert.match(
  homeComposer,
  /runtimeHost \|\| initialModelOverride !== undefined \|\| hasModelControls[\s\S]*?\.\.\.\(hasModelControls \? \{ modelControls \} : \{\}\)/,
  "a Home Thinking · Speed pick rides the new-chat handoff",
);
assert.match(
  chatView,
  /const handoffModelControls = cleanModelControlValues\(initialControls\?\.modelControls\);\s*\n\s*if \(Object\.keys\(handoffModelControls\)\.length > 0\) setModelControls\(handoffModelControls\);[\s\S]*?\? \{ modelControls: handoffModelControls \}/,
  "the opened chat seeds its chips from the handoff and sends the same picks on its first turn",
);

// ── Runtime switches refresh the familiar roster immediately (cave-v25g) ────
// The roster's familiar.harness feeds the chat empty-state identity line;
// without this it lags a switch until the next natural reload.
assert.match(
  workspace,
  /window\.addEventListener\("cave:familiars-refresh", onFamiliarsRefresh\)/,
  "workspace reloads the familiar roster on cave:familiars-refresh",
);
assert.match(
  chatView,
  /if \(res\.ok\) window\.dispatchEvent\(new Event\("cave:familiars-refresh"\)\);/,
  "a chat runtime switch fires the roster refresh (only on a successful PATCH)",
);
assert.match(
  homeModelState,
  /if \(\n\s*!ok\n\s*\|\| familiarId !== selectedFamiliarIdRef\.current[\s\S]{0,500}?window\.dispatchEvent\(new Event\("cave:familiars-refresh"\)\);/,
  "a home runtime switch fires the roster refresh (only on a successful PATCH)",
);

// ── The pickers are always reachable from the composer Tools edge ───────────
assert.match(
  chatView,
  /<ComposerActionsMenu[\s\S]*?context=\{\{[\s\S]*?runtime: modelHarness,[\s\S]*?modelValue: composerModelValue,[\s\S]*?modelOptions: composerModelOptions,[\s\S]*?onPickRuntime: handleSelectRuntime,[\s\S]*?onPickModel: handleSelectModel,[\s\S]*?\}\}/,
  "the chat composer threads live runtime/model state into ComposerActionsMenu's shared context props",
);
assert.match(
  chatView,
  /className="cave-composer-edge-actions">[\s\S]{0,4000}?<ComposerActionsMenu[\s\S]*?triggerVariant="tools"/,
  "the chat options trigger sits at the composer edge — always visible, session or not",
);
assert.match(
  chatView,
  /const chatContextControls = \([\s\S]*?<ComposerContextChips[\s\S]*?runtime=\{modelHarness\}[\s\S]*?onPickRuntime=\{handleSelectRuntime\}[\s\S]*?onPickModel=\{handleSelectModel\}/,
  "chatContextControls is constructed once with live runtime/model state; new chat (inlineComposer) mounts it in the footer cluster, active chat inline on the title row (plus a mobile-only strip)",
);

// ── Runtime switching is real: familiar-level config, optimistic + refetch ──
assert.match(
  chatView,
  /const handleSelectRuntime = useCallback\(\s*\n\s*\(runtime: string\) => \{[\s\S]*?const nextModel = modelForRuntimeSwitch\(runtime\);/,
  "a runtime pick uses the runtime-switch policy instead of carrying a foreign model id",
);
assert.match(
  chatView,
  /fetch\("\/api\/config", \{\s*\n\s*method: "PATCH",[\s\S]{0,300}?familiars: \{[\s\S]*?\[familiar\.id\]: \{[\s\S]*?harness: runtime,[\s\S]*?model: nextModel,/,
  "runtime switches persist through /api/config with explicit default intent",
);
const selectRuntimeBlock = chatView.match(/const handleSelectRuntime = useCallback\([\s\S]*?\n  \);/)?.[0] ?? "";
assert.match(
  selectRuntimeBlock,
  /sessionId[\s\S]*?fetch\("\/api\/chat\/model-state", \{[\s\S]*?scope: "runtime-handoff",[\s\S]*?runtime,/,
  "an active conversation persists a fresh-session runtime handoff after the familiar binding changes",
);
assert.match(
  selectRuntimeBlock,
  /const optimistic: ChatModelState = \{[\s\S]*?harness: runtime,[\s\S]*?effectiveModel: nextModel,[\s\S]*?modelStateRef\.current = optimistic;\s*\n\s*setModelState\(optimistic\)/,
  "the chip flips optimistically before the network round-trip",
);
assert.match(
  selectRuntimeBlock,
  /finally\(async \(\) => \{[\s\S]{0,220}?await refreshModelState\(/,
  "the model-state refetch reconciles the optimistic flip (even when the PATCH fails)",
);

const selectModelBlock = chatView.match(/const handleSelectModel = useCallback\([\s\S]*?\n  \);/)?.[0] ?? "";
assert.match(
  selectModelBlock,
  /effectiveModel: stagedModel,[\s\S]*?source: modelId \? \(sessionId \? "session" : "familiar-default"\) : "runtime-default"[\s\S]*?modelStateRef\.current = optimistic;\s*\n\s*setModelState\(optimistic\)/,
  "clearing a model synchronously stages the runtime default before its PATCH",
);
assert.match(
  selectModelBlock,
  /if \(json\.ok && json\.state\) \{[\s\S]*?setModelState\(json\.state\);[\s\S]{0,260}?await refreshModelState\(/,
  "a successful model selection refreshes capability controls from the authoritative state response",
);
assert.match(
  chatView,
  /const currentModelState = modelStateRef\.current;[\s\S]{0,500}?const modelOverrideForRequest =[\s\S]{0,300}?currentModelState\?\.source === "session"/,
  "send snapshots the synchronously staged model state rather than the prior render",
);
assert.match(
  chatView,
  /const stagedInitialModelOverride = initialModelOverride !== undefined[\s\S]{0,420}?initialControls\?\.modelOverride[\s\S]{0,260}?modelOverrideScope: stagedInitialModelScope/,
  "a Home handoff carries its staged model intent into the first Chat send",
);

// ── Popover semantics ───────────────────────────────────────────────────────
assert.match(
  chip,
  /ariaLabel="Runtime"[\s\S]*?checked=\{catalog\.runtime === runtime\}/,
  "runtime rows are menuitemradio options with the active runtime checked",
);
assert.match(
  chip,
  /ariaLabel="Model"[\s\S]*?Runtime default[\s\S]*?No models reported · use runtime default/,
  "the model menu exposes runtime-owned defaults even when no inventory is available",
);
assert.match(
  chip,
  /modelIsOutsideInventory[\s\S]*?Current selection · \{modelValue\} \(not in current inventory\)/,
  "a persisted custom or stale model remains visible and explicitly marked when scoped inventory omits it",
);
// A runtime pick closes its own menu BEFORE the pick, so the caller's chained
// Model menu wins the state batch.
const runtimeSelection = chip.match(/onSelect=\{\(\) => \{[\s\S]*?onPickRuntime\(catalog\.runtime\);[\s\S]*?\}\}/)?.[0] ?? "";
assert.ok(runtimeSelection, "runtime selection is wired");
assert.match(
  runtimeSelection,
  /onOpenChange\(false\);\s*\n\s*if \(catalog\.runtime !== runtime\) onPickRuntime\(catalog\.runtime\);/,
  "runtime selection closes its menu first, then picks",
);
const modelRowBlock = chip.match(/\{modelOptions\.map\(\(m\) =>[\s\S]*?\)\)\}/)?.[0] ?? "";
assert.match(
  modelRowBlock,
  /onSelect=\{\(\) => \{\s*\n\s*if \(m\.id !== modelValue\) onPickModel\(m\.id\);\s*\n\s*onOpenChange\(false\);/,
  "a model pick completes the runtime→model switch and closes the menu",
);

// ── Brand marks: real logos for provider runtimes, glyphs for the rest ──────
assert.match(logo, /codex: OPENAI_PATH,\s*\n\s*claude: ANTHROPIC_PATH,/, "codex and claude carry their providers' brand marks");
assert.match(logo, /hermes: "ph:plug-bold",\s*\n\s*openclaw: "ph:paw-print-bold",/, "brand-less runtimes reuse the glyph language skill-card established");
assert.match(logo, /opencode: "ph:code-bold",/, "opencode carries a deliberate glyph (skill-card's /code/ rule) instead of the generic robot fallback");
assert.match(logo, /fill="currentColor"[\s\S]{0,80}?aria-hidden/, "brand SVGs inherit currentColor and stay decorative (the trigger carries the name)");

// ── Tokens only; the mark reads as presence ──────────────────────────────────
assert.match(css, /\.cave-runtime-chip__logo \{[\s\S]*?color: var\(--accent-presence\);/, "the runtime mark uses the presence accent token");
assert.match(css, /\.cave-context-chip--control \.cave-context-chip__lead \{[\s\S]*?color: var\(--accent-presence\);/, "control chip marks share the presence accent");
assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, "chip styles stay on semantic tokens — no hardcoded hex");

assert.match(
  chatView,
  /const composerModelValue =\s*\n\s*pendingModelOverrideRef\.current !== undefined\s*\n\s*\? pendingModelOverrideRef\.current[\s\S]*?modelState\?\.effectiveModel && modelState\.effectiveModel !== "unknown"[\s\S]*?: "";/,
  "the composer preserves a pending explicit model intent and otherwise carries an explicit empty runtime-default value",
);
assert.match(
  chatView,
  /\{\s*value: "",\s*label: "Runtime default"/,
  "the empty model entry is labeled as the durable runtime-default clear action",
);
assert.match(contextPill, /<span className="cave-context-chip__text">\{context\.runtimeName\}<\/span>/, "the visible runtime chip includes the runtime name");
assert.match(contextPill, /<span className="cave-context-chip__text">\{modelLabel\}<\/span>/, "the visible model chip includes the model");
assert.match(chip, /return modelValue \|\| null/, "exact model IDs are never shortened to a path segment or alias");

console.log("composer-runtime-chip.test.ts: ok");
