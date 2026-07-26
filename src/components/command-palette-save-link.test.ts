// @ts-nocheck
// Slash commands in the command palette carry typed arguments and do not fall
// through to "Create task: /command args" rows.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const palette = await readFile(
  new URL("./command-palette.tsx", import.meta.url),
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

// Create-task fallthrough is suppressed for recognized slash commands.
assert.match(
  palette,
  /const createRows: Row\[\] = trimmedTitle && !slashCanonical/,
  "a recognized slash command never becomes a task title",
);

assert.doesNotMatch(
  palette,
  /slashSaveParse|Save → Bookmarks|Save → Reading|Save → GitHub/,
  "feature/library /save destination rows stay out of the integrated palette",
);

console.log("command-palette-save-link.test.ts: ok");
