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

// ── Parity: the home composer carries the same chip (cave-v25g) ─────────────
assert.match(
  homeComposer,
  /<ComposerRuntimeChip\s*\n\s*runtime=\{selectedRuntime\}\s*\n\s*modelValue=\{selectedModelId\}\s*\n\s*modelOptions=\{runtimeModelOptions\}\s*\n\s*onPickRuntime=\{handleSelectRuntime\}\s*\n\s*onPickModel=\{handleSelectModel\}/,
  "the home composer renders the same runtime chip from its own model state",
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
  /if \(json\.ok\) \{\s*\n[\s\S]{0,200}?window\.dispatchEvent\(new Event\("cave:familiars-refresh"\)\);/,
  "a home runtime switch fires the roster refresh (only on a successful PATCH)",
);

// ── The chip is always in the composer control row, wired to live state ─────
assert.match(
  chatView,
  /<ComposerRuntimeChip\s*\n\s*runtime=\{modelHarness\}\s*\n\s*modelValue=\{composerModelValue\}\s*\n\s*modelOptions=\{composerModelOptions\}\s*\n\s*onPickRuntime=\{handleSelectRuntime\}\s*\n\s*onPickModel=\{handleSelectModel\}/,
  "the chat composer renders the runtime chip from the live model state (runtime + effective model)",
);
assert.match(
  chatView,
  /className="cave-composer-footer-band__context"[\s\S]{0,700}?<ComposerRuntimeChip/,
  "the chip sits in the composer footer band's context cluster — always visible, session or not",
);

// ── Runtime switching is real: familiar-level config, optimistic + refetch ──
assert.match(
  chatView,
  /const handleSelectRuntime = useCallback\(\s*\n\s*\(runtime: string\) => \{\s*\n\s*const nextModel = defaultModelForRuntime\(runtime\);/,
  "a runtime pick lands with the runtime's default model (a bare harness flip would keep a foreign model id)",
);
assert.match(
  chatView,
  /fetch\("\/api\/config", \{\s*\n\s*method: "PATCH",[\s\S]{0,200}?familiars: \{ \[familiar\.id\]: \{ harness: runtime, model: nextModel \} \}/,
  "runtime switches persist through /api/config — the same channel the home composer's selectRuntime uses; the send route re-resolves the binding per turn, so the switch applies from the next message",
);
const selectRuntimeBlock = chatView.match(/const handleSelectRuntime = useCallback\([\s\S]*?\n  \);/)?.[0] ?? "";
assert.match(
  selectRuntimeBlock,
  /setModelState\(\(current\) =>[\s\S]{0,300}?harness: runtime, effectiveModel: nextModel/,
  "the chip flips optimistically before the network round-trip",
);
assert.match(
  selectRuntimeBlock,
  /finally \{\s*\n\s*await refreshModelState\(\);/,
  "the model-state refetch reconciles the optimistic flip (even when the PATCH fails)",
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
  /modelOptions\.length > 0 && \([\s\S]*?<PopoverLabel>Model<\/PopoverLabel>/,
  "the model group only renders for runtimes with a curated catalog (hermes/openclaw run their own adapters)",
);

// ── Two-step pick: a runtime pick keeps the menu open for the model pick ─────
// Collapsing on the runtime click stranded the switch halfway — the user had
// to reopen the menu to choose a model. The menu now stays up (the Model group
// re-lists from the optimistic state flip) and only a model pick, or picking a
// menu-less runtime with no model step, completes the visit.
assert.match(
  chip,
  /onPickRuntime\(catalog\.runtime\);[\s\S]{0,400}?if \(catalog\.models\.length === 0\) setOpen\(false\);/,
  "a runtime pick closes the menu only for menu-less runtimes (hermes/openclaw); curated runtimes keep it open until a model is picked",
);
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

console.log("composer-runtime-chip.test.ts: ok");
