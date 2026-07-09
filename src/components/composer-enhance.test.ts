// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Source pins for the shared Enhance UI (cave-b6c2) and its wiring into the
// three composers (home, chat, quick-chat). The hook's lifecycle is pinned in
// use-prompt-enhance.test.ts; this file holds the control's a11y contract,
// the strip's four phases, and the every-surface-mounts-it guarantee.

const source = await readFile(new URL("./composer-enhance.tsx", import.meta.url), "utf8");
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
  /rounded-full border border-\[var\(--border-hairline\)\]/,
  "strip actions use the 999px pill + hairline language",
);

// ── All three composers mount the shared pair ────────────────────────────────
for (const [name, src] of [["home-composer", home], ["chat-view", chat], ["quick-chat-controls", quick]]) {
  assert.match(
    src,
    /usePromptEnhance\(\{/,
    `${name} mounts the shared enhance hook`,
  );
  assert.match(
    src,
    /<EnhanceControl[\s\S]*?state=\{promptEnhance\.state\}[\s\S]*?onEnhance=\{promptEnhance\.enhance\}/,
    `${name} renders the shared sparkle control`,
  );
  assert.match(
    src,
    /<EnhanceStrip[\s\S]*?onApply=\{promptEnhance\.apply\}[\s\S]*?onRevert=\{promptEnhance\.revert\}/,
    `${name} renders the shared status strip`,
  );
  assert.doesNotMatch(
    src,
    /setEnhanceStatus|setEnhanceOriginal|buildPromptEnhancement/,
    `${name} carries no bespoke enhance state — the hook owns the lifecycle`,
  );
}

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
