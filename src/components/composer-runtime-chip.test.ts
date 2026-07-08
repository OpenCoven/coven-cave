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
const css = readFileSync(new URL("../styles/composer-runtime-chip.css", import.meta.url), "utf8");

// ── The chip is always in the composer control row, wired to live state ─────
assert.match(
  chatView,
  /<ComposerRuntimeChip\s*\n\s*runtime=\{modelHarness\}\s*\n\s*modelValue=\{composerModelValue\}\s*\n\s*modelOptions=\{composerModelOptions\}\s*\n\s*onPickRuntime=\{handleSelectRuntime\}\s*\n\s*onPickModel=\{handleSelectModel\}/,
  "the chat composer renders the runtime chip from the live model state (runtime + effective model)",
);
assert.match(
  chatView,
  /<ComposerOptionsMenu[\s\S]*?\/>\s*\n\s*<ComposerRuntimeChip/,
  "the chip sits in the utility row after the Options menu — always visible, session or not",
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

// ── Brand marks: real logos for provider runtimes, glyphs for the rest ──────
assert.match(logo, /codex: OPENAI_PATH,\s*\n\s*claude: ANTHROPIC_PATH,/, "codex and claude carry their providers' brand marks");
assert.match(logo, /hermes: "ph:plug-bold",\s*\n\s*openclaw: "ph:paw-print-bold",/, "brand-less runtimes reuse the glyph language skill-card established");
assert.match(logo, /fill="currentColor"[\s\S]{0,80}?aria-hidden/, "brand SVGs inherit currentColor and stay decorative (the trigger carries the name)");

// ── Tokens only; the mark reads as presence ──────────────────────────────────
assert.match(css, /\.cave-runtime-chip__logo \{[\s\S]*?color: var\(--accent-presence\);/, "the runtime mark uses the presence accent token");
assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, "chip styles stay on semantic tokens — no hardcoded hex");

console.log("composer-runtime-chip.test.ts: ok");
