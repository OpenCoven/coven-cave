// @ts-nocheck
// Source pins for the composer runtime chip (cave-yq5l): the chat composer
// always shows the active runtime's mark + effective model, and switching
// runtimes is one click away. These pin the contracts that make the chip
// honest: real switching (familiar-level /api/config, the only channel that
// rebinds a harness), an optimistic flip reconciled by a refetch, and
// menuitemradio semantics in the popover.
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

// ── Parity: the home composer carries the same picker (cave-v25g) ───────────
// The runtime/model picker now opens from the composer context pill (chat
// revamp 1d) — same ComposerRuntimePopover, same live model state.
assert.match(
  homeComposer,
  /<ComposerContextChips[\s\S]*?runtime=\{selectedRuntime\}[\s\S]*?modelValue=\{selectedModelId\}[\s\S]*?modelOptions=\{runtimeModelOptions\}[\s\S]*?onPickRuntime=\{handleSelectRuntime\}[\s\S]*?onPickModel=\{handleSelectModel\}/,
  "the home composer's context chips host the runtime picker from its own model state",
);
assert.match(
  homeComposer,
  /className="cave-composer-footer-band[^"]*"[^>]*>[\s\S]*?<ComposerContextChips/,
  "the chips anchor the composer footer band",
);
assert.match(
  contextPill,
  /aria-label=\{`Runtime: \$\{context\.runtimeName\} · Model: \$\{modelLabel\} — change model`\}/,
  "the model chip is a separately labelled control (split grammar, cave-g21f)",
);
assert.match(
  contextPill,
  /<RuntimeLogo runtime=\{context\.config\.runtime\} size=\{13\} \/>/,
  "reusable context rows receive the actual runtime id for the shared RuntimeLogo",
);
assert.match(
  contextPill,
  /runtimeModelLabel\(config\.modelValue, config\.modelOptions\) \?\? "Runtime default \(unresolved\)"/,
  "runtime default remains explicitly unresolved until the runtime reports a model",
);
assert.match(
  contextPill,
  /const context = useComposerContextActions\(props\);[\s\S]*?<ComposerRuntimePopover[\s\S]*?onPickModel=\{context\.config\.onPickModel\}/,
  "the chips mount the shared runtime popover from the same context controller",
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

// ── The picker is always reachable from the composer Tools edge ─────────────
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

// ── The chip face: runtime logo + model, one accessible name ─────────────────
assert.match(
  chip,
  /aria-label=\{`Runtime: \$\{runtimeName\}\$\{modelLabel \? ` · Model: \$\{modelLabel\}` : ""\}`\}/,
  "the chip's accessible name carries both the runtime and the model",
);
assert.match(
  chip,
  /aria-haspopup="menu"\s*\n\s*aria-expanded=\{open\}/,
  "the chip is a proper menu trigger (ComposerHostChip conventions)",
);
assert.match(
  chip,
  /checked=\{catalog\.runtime === runtime\}/,
  "runtime rows are menuitemradio options with the active runtime checked",
);
assert.match(
  chip,
  /<PopoverLabel>Model<\/PopoverLabel>[\s\S]*?Runtime default[\s\S]*?No models reported · use runtime default/,
  "the model group exposes runtime-owned defaults even when no inventory is available",
);
assert.match(
  chip,
  /modelIsOutsideInventory[\s\S]*?Current selection · \{modelValue\} \(not in current inventory\)/,
  "a persisted custom or stale model remains visible and explicitly marked when scoped inventory omits it",
);

// A runtime pick stays open while scoped model discovery resolves.
const runtimeSelection = chip.match(/onSelect=\{\(\) => \{[\s\S]*?onPickRuntime\(catalog\.runtime\);[\s\S]*?\}\}/)?.[0] ?? "";
assert.ok(runtimeSelection, "runtime selection is wired");
assert.doesNotMatch(runtimeSelection, /setOpen\(false\)/, "runtime selection keeps the model picker open");
const modelRowBlock = chip.match(/\{modelOptions\.map\(\(m\) =>[\s\S]*?\)\)\}/)?.[0] ?? "";
assert.match(
  modelRowBlock,
  /onSelect=\{\(\) => \{\s*\n\s*if \(m\.id !== modelValue\) onPickModel\(m\.id\);\s*\n\s*setOpen\(false\);/,
  "a model pick completes the runtime→model switch and closes the menu",
);

// ── Brand marks: real logos for provider runtimes, glyphs for the rest ──────
assert.match(logo, /codex: OPENAI_PATH,\s*\n\s*claude: ANTHROPIC_PATH,/, "codex and claude carry their providers' brand marks");
assert.match(logo, /hermes: "ph:plug-bold",\s*\n\s*openclaw: "ph:paw-print-bold",/, "brand-less runtimes reuse the glyph language skill-card established");
assert.match(logo, /opencode: "ph:code-bold",/, "opencode carries a deliberate glyph (skill-card's /code/ rule) instead of the generic robot fallback");
assert.match(logo, /fill="currentColor"[\s\S]{0,80}?aria-hidden/, "brand SVGs inherit currentColor and stay decorative (the trigger carries the name)");

// ── Tokens only; the mark reads as presence ──────────────────────────────────
assert.match(css, /\.cave-runtime-chip__logo \{[\s\S]*?color: var\(--accent-presence\);/, "the runtime mark uses the presence accent token");
assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, "chip styles stay on semantic tokens — no hardcoded hex");

// ── Standardized radius ──────────────────────────────────────────────────────
// The chip sits between the pill composer icon buttons (attach/voice/options/
// send), so it must share their curvature — via the --radius-pill token, which
// tracks the corner radius appearance setting (999px by default, squared at
// `sharp`). The squarer --radius-control made it read as a different family.
assert.match(css, /\.cave-composer-runtime-chip \{[\s\S]*?border-radius: var\(--radius-pill\);/, "the runtime chip uses the pill token, matching the composer icon buttons");
const hostCss = readFileSync(new URL("../styles/composer-host-chip.css", import.meta.url), "utf8");
assert.match(hostCss, /\.cave-composer-host-chip \{[\s\S]*?border-radius: var\(--radius-pill\);/, "the host chip matches the same pill token");

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

console.log("composer-runtime-chip.test.ts: ok");

assert.match(contextPill, /\{context\.runtimeName\} · \{modelLabel\}/, "the visible chip includes the runtime name");
assert.match(chip, /return modelValue \|\| null/, "exact model IDs are never shortened to a path segment or alias");
