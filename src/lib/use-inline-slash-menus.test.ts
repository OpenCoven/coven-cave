// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./use-inline-slash-menus.ts", import.meta.url), "utf8");

// ── Signature: pick semantics stay per-composer via callbacks ────────────────
assert.match(
  src,
  /export function useInlineSlashMenus\(opts: \{\s*text: string;\s*setText: \(t: string\) => void;\s*modelHarness: string;\s*modelOptionsOverride\?: RuntimeModelOption\[\];\s*onPickModel:[\s\S]*?onPickSkill:[\s\S]*?onInsertPrompt:[\s\S]*?onRunCommand:[\s\S]*?onNoMatchEnter\?:/,
  "useInlineSlashMenus takes the text pair + pick callbacks — what a pick DOES stays per-composer",
);
assert.match(
  src,
  /const cbRef = useRef\(opts\);\s*\n\s*cbRef\.current = opts;/,
  "pick callbacks ride a latest-ref so inline arrows at call sites don't churn handleKeyDown identity",
);

// ── The keyboard dispatcher never owns Enter-send or Esc-busy-cancel ─────────
assert.match(
  src,
  /handleKeyDown: \(e: KeyboardEvent<HTMLTextAreaElement>\) => boolean;/,
  "handleKeyDown reports consumption so callers keep their own branch ordering around it",
);
assert.doesNotMatch(
  src,
  /cancelSend|isComposing|\bsend\(\)|handleSubmit/,
  "the hook must never own Enter-send or Esc-cancel — chat's pinned ordering is mention → menus → history → IME-guarded send → busy-cancel",
);
assert.match(
  src,
  /return false;\s*\n\s*\},/,
  "unconsumed keys report false so history recall and Enter-send still run",
);

// ── First-token-only matching (menus never open mid-sentence) ────────────────
assert.match(
  src,
  /const firstWord = text\.trimStart\(\)\.split\(\/\\s\/\)\[0\] \?\? "";\s*\n\s*if \(!firstWord\.startsWith\("\/"\) \|\| text\.trimStart\(\)\.includes\(" "\)\) return \[\];/,
  "slash suggestions surface only while the user is still typing the command token",
);

// ── Esc-dismiss: one flag, all four pickers, typing re-opens ─────────────────
assert.match(
  src,
  /const slashSuggestions: SlashCommand\[\] = slashDismissed \? \[\] : slashMatches;/,
  "dismissal empties the command list",
);
assert.match(
  src,
  /slashDismissed \? null : modelSlashOptions\(text, modelHarness, modelOptionsOverride\)/,
  "dismissal nulls the /model options",
);
assert.match(
  src,
  /useEffect\(\(\) => \{\s*\n\s*setSlashIdx\(0\);\s*\n\s*setSlashDismissed\(false\);\s*\n\s*\}, \[text\]\);/,
  "any edit re-arms the menus and resets the roving index",
);

// ── Roving index runs from the command list into the Skills group ────────────
assert.match(
  src,
  /const total = slashSuggestions\.length \+ skillCommandRows\.length;/,
  "one roving index spans commands then the Skills group",
);
assert.match(
  src,
  /const skillAt = \(i: number\): SkillOption \| undefined =>\s*\n\s*skillCommandRows\[i - slashSuggestions\.length\];/,
  "the Skills group indexes after the command rows",
);

// ── Enter on a command: autocomplete-then-run ────────────────────────────────
assert.match(
  src,
  /if \(cmd && cmd\.argPlaceholder && canonicalize\(text\.trim\(\)\) !== cmd\.name\) \{\s*\n\s*setText\(cmd\.name \+ " "\);\s*\n\s*\} else if \(cmd\) \{\s*\n\s*cbRef\.current\.onRunCommand\(cmd\);\s*\n\s*\} else if \(s\) \{\s*\n\s*cbRef\.current\.onPickSkill\(s\);\s*\n\s*\} else \{\s*\n\s*cbRef\.current\.onNoMatchEnter\?\.\(\);\s*\n\s*\}/,
  "Enter autocompletes argument-taking commands, runs exact ones, picks skills, and defers no-match to the caller (home submits; chat consumes)",
);

// ── Shared listbox id + fetches ──────────────────────────────────────────────
assert.match(src, /const slashListboxId = useId\(\);/, "the listbox id is per-mount — home and chat composers can be mounted simultaneously");
assert.match(src, /fetch\("\/api\/skills\/local", \{ cache: "no-store" \}\)/, "skills come from the local skill scan");
assert.match(src, /fetch\("\/api\/prompts", \{ cache: "no-store" \}\)/, "prompts come from /api/prompts, seeded with the built-ins");

console.log("use-inline-slash-menus.test.ts: ok");
