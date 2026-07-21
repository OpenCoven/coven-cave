// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Source pins for the shared Enhance UI (cave-b6c2) and its wiring into the
// three composers (home, chat, quick-chat). The hook's lifecycle is pinned in
// use-prompt-enhance.test.ts; this file holds the control's a11y contract,
// the strip's four phases, and the every-surface-mounts-it guarantee.

const source = await readFile(new URL("./composer-enhance.tsx", import.meta.url), "utf8");
const actionsMenu = await readFile(new URL("./composer-actions-menu.tsx", import.meta.url), "utf8");
const home = await readFile(new URL("./home-composer.tsx", import.meta.url), "utf8");
const chat = await readFile(new URL("./chat-view.tsx", import.meta.url), "utf8");
const quick = await readFile(new URL("./quick-chat-controls.tsx", import.meta.url), "utf8");

// ── EnhanceControl: split-button a11y ────────────────────────────────────────
assert.match(
  source,
  /aria-label="Enhance prompt"/,
  "the main sparkle button keeps the established accessible name",
);
assert.match(
  source,
  /aria-haspopup="menu"[\s\S]*?aria-expanded=\{menuOpen\}/,
  "the chevron advertises the intent menu (haspopup + expanded)",
);
assert.match(
  source,
  /if \(e\.key === "ArrowDown"\) \{[\s\S]*?setMenuOpen\(true\)/,
  "ArrowDown on the main button opens the intent menu (keyboard path to variants)",
);
assert.match(
  source,
  /pressTimer\.current = setTimeout\(\(\) => setMenuOpen\(true\), LONG_PRESS_MS\)/,
  "long-pressing the main button opens the intent menu (board-kanban timer idiom)",
);
assert.match(
  source,
  /onPointerUp=\{clearPress\}[\s\S]*?onPointerLeave=\{clearPress\}/,
  "releasing or leaving cancels the long-press timer",
);
assert.match(
  source,
  /if \(loading\) onCancel\(\);\s*\n\s*else onEnhance\("auto"\)/,
  "click = smart enhance; clicking again while loading cancels",
);
assert.match(
  source,
  /ENHANCE_INTENTS\.map\([\s\S]*?onEnhance\(intent\.id\)/,
  "the menu lists every intent and fires the picked one",
);
assert.match(
  source,
  /PopoverBody role="menu"/,
  "the intent list is a real menu (shared Popover primitives)",
);
assert.match(
  source,
  /animate-pulse text-\[var\(--accent-presence\)\]/,
  "accent marks presence only — the sparkle tints while loading, never at rest",
);

// ── EnhanceControl: one combined rectangle, not two floating rounds ──────────
// The sparkle + caret live inside a single hairline control-radius rectangle
// split by a hairline divider — minimal, and height-matched to the hosting
// composer's Send button via the size prop.
assert.match(
  source,
  /inline-flex items-stretch overflow-hidden rounded-\[var\(--radius-control\)\] border border-\[var\(--border-hairline\)\]/,
  "the control is one bordered control-radius rectangle wrapping both segments",
);
assert.match(
  source,
  /border-l border-\[var\(--border-hairline\)\]/,
  "the caret segment joins through a hairline divider, not its own outline",
);
{
  const controlSrc = source.slice(
    source.indexOf("export function EnhanceControl"),
    source.indexOf("export function EnhanceStrip"),
  );
  assert.doesNotMatch(
    controlSrc,
    /rounded-full/,
    "no rounded-full inside the control — the pill geometry belongs to the strip only",
  );
}
assert.match(
  source,
  /size = "md",/,
  "the height prop defaults to the 30px composer rows; quick chat opts into sm",
);
assert.match(
  source,
  /size === "sm" \? "h-\[26px\]" : "h-\[30px\]"/,
  'sm matches the 26px Button size="sm" Send; md the 30px icon-button rows',
);

// ── EnhanceStrip: one status row, four phases ────────────────────────────────
assert.match(source, /if \(state\.phase === "idle"\) return null/, "the strip renders nothing at rest");
assert.match(source, /role="status"/, "the strip is a status live region");
assert.match(
  source,
  /state\.phase === "loading" \?[\s\S]*?\{state\.preview \? state\.preview : "Enhancing…"\}[\s\S]*?Cancel/,
  "loading shows the streaming preview with a Cancel action",
);
assert.match(
  source,
  /state\.phase === "suggested" \?[\s\S]*?Apply[\s\S]*?Dismiss/,
  "a suggestion (draft changed mid-flight) offers Apply and Dismiss — never a silent overwrite",
);
assert.match(
  source,
  /state\.phase === "applied" \?[\s\S]*?Revert/,
  "an in-place apply offers one-tap Revert",
);
assert.match(
  source,
  /aria-label="Dismiss enhance error"/,
  "errors are dismissible",
);
assert.match(
  source,
  /rounded-\[var\(--radius-pill\)\] border border-\[var\(--border-hairline\)\]/,
  "strip actions use the pill token + hairline language (tracks the corner radius setting)",
);

// ── All three composers mount the shared enhance ─────────────────────────────
// Home keeps enhance under the "+" menu, chat reaches it through Chat options →
// Improve, and quick-chat keeps the inline split control.
for (const [name, src] of [["home-composer", home], ["chat-view", chat], ["quick-chat-controls", quick]]) {
  assert.match(
    src,
    /usePromptEnhance\(\{/,
    `${name} mounts the shared enhance hook`,
  );
  assert.match(
    src,
    name === "home-composer"
      ? /<ComposerPlusMenu[\s\S]*?enhance=\{\{\s*\n\s*onEnhance: promptEnhance\.enhance/
      : name === "chat-view"
        ? /<ComposerActionsMenu[\s\S]*?improve=\{\{[\s\S]*?enhance:\s*\{[\s\S]*?onEnhance: promptEnhance\.enhance/
        : /<EnhanceControl[\s\S]*?state=\{promptEnhance\.state\}[\s\S]*?onEnhance=\{promptEnhance\.enhance\}/
    ,
    `${name} wires the shared enhance action`,
  );
  assert.match(
    src,
    name === "quick-chat-controls"
      ? /<EnhanceControl[\s\S]*?state=\{promptEnhance\.state\}[\s\S]*?onEnhance=\{promptEnhance\.enhance\}/
      : /<EnhanceStrip[\s\S]*?onApply=\{promptEnhance\.apply\}[\s\S]*?onRevert=\{promptEnhance\.revert\}/,
    `${name} renders the shared status strip`,
  );
  assert.doesNotMatch(
    src,
    /setEnhanceStatus|setEnhanceOriginal|buildPromptEnhancement/,
    `${name} carries no bespoke enhance state — the hook owns the lifecycle`,
  );
}
// Chat options' Improve section preserves the smart-enhance + intent-list reachability.
assert.match(
  actionsMenu,
  /<section[\s\S]*?className="composer-actions__section composer-actions__improve"[\s\S]*?aria-labelledby="composer-actions-improve-label"[\s\S]*?<PopoverLabel id="composer-actions-improve-label">Improve<\/PopoverLabel>/,
  "Chat options exposes a dedicated Improve section with the stable Improve label id",
);
assert.match(
  actionsMenu,
  /closePanel\(\);\s*\n\s*improve\.enhance\.onEnhance\("auto"\)/,
  "Improve → Smart enhance still fires the smart enhance intent",
);
assert.match(
  actionsMenu,
  /onSelect=\{\(\) => setEnhanceView\(true\)\}[\s\S]*?Enhance options…/,
  "Improve offers an Enhance options entry that opens the intent list",
);
assert.match(
  actionsMenu,
  /ENHANCE_INTENTS\.map\(\(intent\) => \([\s\S]*?improve\.enhance\.onEnhance\(intent\.id\)/,
  "Enhance options lists every shared enhance intent",
);

// Surface-specific mode + context wiring.
assert.match(
  home,
  /mode: destination === "board" \? "task" : "chat"/,
  "home optimizes for the active Chat/Task destination",
);
assert.match(
  chat,
  /mode: activeProjectRoot \? "code" : "chat"/,
  "chat optimizes for code when a project is active",
);
assert.match(
  chat,
  /selectedFiles: \[\.\.\.mentionedFiles, \.\.\.attachments\.map\(\(attachment\) => attachment\.name\)\]/,
  "chat feeds @-mentioned files and attachments as context",
);
assert.match(
  quick,
  /familiarId: familiar\?\.id \?\? null/,
  "quick-chat enhances through the picked familiar (local fallback when none)",
);

console.log("composer-enhance.test.ts: ok");
