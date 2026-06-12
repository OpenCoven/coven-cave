// @ts-nocheck
// `/save <url>` in the command palette must save a link with a chooseable
// destination — not fall through to "Create task: /save https://…".
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const palette = await readFile(
  new URL("./command-palette.tsx", import.meta.url),
  "utf8",
);
const workspace = await readFile(
  new URL("./workspace.tsx", import.meta.url),
  "utf8",
);

// ── Palette: slash queries carry args ───────────────────────────────────────

assert.match(
  palette,
  /const slashMatch = rest\.trim\(\)\.match\(\/\^\(\\\/\\S\+\)/,
  "palette parses the slash token separately from its arguments",
);

assert.match(
  palette,
  /\.\.\.\(slashArgs \? \{ args: slashArgs \} : \{\}\)/,
  "command rows thread typed arguments into the slash intent",
);

assert.match(
  palette,
  /c\.name\.startsWith\(slashToken\)/,
  "slash queries match commands by first token, not the whole query",
);

// ── Palette: /save destination choice ───────────────────────────────────────

assert.match(
  palette,
  /slashSaveParse\(slashArgs\)/,
  "palette validates the /save URL before offering destinations",
);

for (const dest of [
  'dest\\("Save link"\\)',
  'dest\\("Save → Bookmarks", "bookmarks"\\)',
  'dest\\("Save → Reading", "reading"\\)',
  'dest\\("Save → GitHub", "github"\\)',
]) {
  assert.match(
    palette,
    new RegExp(dest),
    `palette offers the destination row (${dest})`,
  );
}

assert.match(
  palette,
  /args: `\$\{parsed\.url\}\$\{listHint \? ` \$\{listHint\}` : ""\}\$\{tagSuffix\}`/,
  "each destination row carries the URL, its list hint, and typed tags",
);

// Create-task fallthrough is suppressed for recognized slash commands.
assert.match(
  palette,
  /const createRows: Row\[\] = trimmedTitle && !slashCanonical/,
  "a recognized slash command never becomes a task title",
);

// ── Workspace: /save executes outside chat ──────────────────────────────────

assert.match(
  workspace,
  /case "\/save":\s*\n\s*case "\/bookmark":\s*\n\s*case "\/read": \{/,
  "workspace handles /save and its aliases from palette/home invocations",
);

assert.match(
  workspace,
  /fetch\("\/api\/library\/route-link"/,
  "workspace routes the URL through the library route-link API",
);

assert.match(
  workspace,
  /pushToast\("Usage: \/save <url> \[bookmarks\|reading\|github\] \[#tag\]"\)/,
  "invalid input surfaces usage as a toast instead of failing silently",
);

assert.match(
  workspace,
  /pushToast\(`Saved to \$\{list\}\.`\)/,
  "successful saves confirm the destination with a toast",
);

console.log("command-palette-save-link.test.ts: ok");
