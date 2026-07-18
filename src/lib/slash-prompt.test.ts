// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  promptSlashOptions,
  resolvePromptArg,
  promptInsertion,
  formatPromptList,
} from "./slash-prompt.ts";
import { BUILTIN_PROMPTS } from "./prompt-defaults.ts";

const PROMPTS = [
  { id: "code-review", name: "Code review", description: "Audit the current change", body: "Review the current change.", source: "builtin" },
  { id: "implementation-plan", name: "Implementation plan", description: "Outline an approach", body: "Plan {{what to build}} first.", source: "builtin" },
  { id: "explain-this", name: "Explain this", description: "Walk through the code", body: "Explain how this works.", source: "user" },
];

// ── promptSlashOptions: null outside picker position, list/filter inside ─────
assert.equal(promptSlashOptions("hello", PROMPTS), null, "plain text → null (command menu)");
assert.equal(promptSlashOptions("/prompt", PROMPTS), null, "bare /prompt (no space) → null so both commands show in the menu");
assert.deepEqual(promptSlashOptions("/prompt ", PROMPTS), PROMPTS, "/prompt <space> → full list");
assert.deepEqual(promptSlashOptions("/prompts", PROMPTS), PROMPTS, "/prompts → full list (show all)");
assert.deepEqual(promptSlashOptions("/prompts ", PROMPTS), PROMPTS, "/prompts <space> → full list");
const filtered = promptSlashOptions("/prompt review", PROMPTS);
assert.equal(filtered.length, 1, "/prompt review filters to one");
assert.equal(filtered[0].id, "code-review", "filter matches name/description");
assert.equal(promptSlashOptions("/prompts explain", PROMPTS).length, 1, "/prompts also accepts a trailing filter");
assert.equal(promptSlashOptions("/prompt nomatch", PROMPTS).length, 0, "no match → empty (not null)");
assert.equal(promptSlashOptions("/skill rev", PROMPTS), null, "a different command → null");

// ── resolvePromptArg: exact then substring ───────────────────────────────────
assert.equal(resolvePromptArg("explain-this", PROMPTS)?.id, "explain-this", "exact id");
assert.equal(resolvePromptArg("CODE REVIEW", PROMPTS)?.id, "code-review", "case-insensitive exact name");
assert.equal(resolvePromptArg("plan", PROMPTS)?.id, "implementation-plan", "substring");
assert.equal(resolvePromptArg("", PROMPTS), null, "empty → null");
assert.equal(resolvePromptArg("zzz", PROMPTS), null, "unknown → null");

// ── promptInsertion: insert-for-editing, first {{placeholder}} selected ──────
const plain = promptInsertion(PROMPTS[0]);
assert.equal(plain.text, "Review the current change.", "insertion carries the body verbatim");
assert.equal(plain.selectStart, undefined, "no placeholder → no selection range");
const templated = promptInsertion(PROMPTS[1]);
assert.equal(templated.text.slice(templated.selectStart, templated.selectEnd), "{{what to build}}", "first placeholder is selected");
// Defaulted tokens ({{name|default}}) use the shared placeholder grammar —
// the old inline regex missed them (cave-jg6k).
const defaulted = promptInsertion({ id: "d", name: "D", body: "Ship {{env|production}} today.", source: "user" });
assert.equal(
  defaulted.text.slice(defaulted.selectStart, defaulted.selectEnd),
  "{{env|production}}",
  "a defaulted first token is selected whole (Tab can then accept the default)",
);

// Tags participate in the picker filter.
const TAGGED = [...PROMPTS, { id: "retro", name: "Retro notes", body: "x", source: "user", tags: ["meeting", "team"] }];
assert.equal(promptSlashOptions("/prompt meeting", TAGGED).length, 1, "a tag matches the /prompt filter");
assert.equal(promptSlashOptions("/prompt meeting", TAGGED)[0].id, "retro", "the tag match is the tagged template");

// ── formatPromptList ─────────────────────────────────────────────────────────
const list = formatPromptList(PROMPTS);
assert.match(list, /Available prompts/, "list has a header");
assert.match(list, /drops the template into the composer/, "list explains insert-not-send");
assert.match(list, /code-review/, "list includes each prompt");
assert.match(formatPromptList([]), /No prompt templates found/, "empty list is explained");

// ── Built-in defaults ────────────────────────────────────────────────────────
assert.ok(BUILTIN_PROMPTS.length >= 3, "ships at least the three starter templates");
for (const id of ["code-review", "implementation-plan", "explain-this"]) {
  const p = BUILTIN_PROMPTS.find((x) => x.id === id);
  assert.ok(p, `built-in "${id}" exists`);
  assert.ok(p.body.trim().length > 0, `built-in "${id}" has a body`);
  assert.equal(p.source, "builtin", `built-in "${id}" is marked builtin`);
}

// ── Catalog + composer wiring (source-text) ──────────────────────────────────
const slashCmds = await readFile(new URL("./slash-commands.ts", import.meta.url), "utf8");
assert.match(slashCmds, /name: "\/prompt",[\s\S]*?argPlaceholder: "name"/, "/prompt is registered with an arg placeholder");
assert.match(slashCmds, /name: "\/prompts"/, "/prompts is registered");

// The picker machinery (option memo, menuOpen union, the /api/prompts fetch,
// the built-in seed) lives in the shared use-inline-slash-menus hook, consumed
// by BOTH composers; the insert-not-send contract stays pinned per composer.
const chatView = await readFile(new URL("../components/chat-view.tsx", import.meta.url), "utf8");
const menusHook = await readFile(new URL("./use-inline-slash-menus.ts", import.meta.url), "utf8");
assert.match(menusHook, /promptSlashOptions\(text, prompts\)/, "the shared hook computes the inline /prompt options");
assert.match(menusHook, /const menuOpen = modelMenuActive \|\| skillMenuActive \|\| promptMenuActive \|\| slashSuggestions\.length > 0 \|\| skillCommandRows\.length > 0;/, "menuOpen includes the prompt picker");
assert.match(chatView, /command === "\/prompt" \|\| command === "\/prompts"/, "chat-view dispatches /prompt and /prompts");
assert.match(chatView, /role="listbox" aria-label="Prompts"/, "chat-view renders a Prompts listbox");
assert.match(menusHook, /fetch\("\/api\/prompts"/, "the shared hook sources templates from /api/prompts");
assert.match(menusHook, /useState<PromptOption\[\]>\(BUILTIN_PROMPTS\)/, "picker is seeded with the built-ins so it works offline");
assert.match(chatView, /onInsertPrompt: \(p\) => insertPrompt\(p\)/, "the hook's prompt picks route through chat-view's insert helper");
// The core contract: picking a prompt INSERTS into the composer — never sends.
assert.match(chatView, /const insertPrompt = \(p: PromptOption\)/, "chat-view has the shared insert helper");
assert.doesNotMatch(chatView, /sendRaw\([^)]*promptInsertion/, "prompt insertion is never routed into sendRaw");
assert.doesNotMatch(chatView, /sendRaw\([^)]*\.body\b/, "a template body is never sent directly");
// Prompt snippets fold into the composer Options overflow (cave-xsq.4): no
// standalone utility button, reachable via the menu's onOpenPromptSnippets.
assert.match(chatView, /<ComposerOptionsMenu[\s\S]*onOpenPromptSnippets=\{\(\) => setPromptSnippetsOpen\(true\)\}/, "the composer Options menu opens Prompt snippets");
assert.match(chatView, /onOpenPromptSnippets=\{\(\) => setPromptSnippetsOpen\(true\)\}/, "empty state / composer can open the snippets modal");

// ── Prompt snippets modal ────────────────────────────────────────────────────
const modal = await readFile(new URL("../components/prompt-snippets-modal.tsx", import.meta.url), "utf8");
assert.match(modal, /Pick a starter prompt to drop into the composer/, "modal keeps the insert-not-send subtitle");
assert.match(modal, /export function promptIconName/, "icon names from data are validated against the curated set");
assert.match(modal, /breadcrumb=\{\["Chat", "Prompt snippets"\]\}/, "modal is built on the shared Modal primitive");

const emptyState = await readFile(new URL("../components/chat-empty-state.tsx", import.meta.url), "utf8");
assert.match(emptyState, /onOpenPromptSnippets/, "empty state exposes the snippets entry point");

// ── Home composer parity ─────────────────────────────────────────────────────
// Parity is structural now: home consumes the same hook (asserted above), so
// only home's own pick plumbing needs pins.
const homeComposer = await readFile(new URL("../components/home-composer.tsx", import.meta.url), "utf8");
assert.match(homeComposer, /useInlineSlashMenus\(\{/, "home consumes the shared inline-menus hook");
assert.match(homeComposer, /onInsertPrompt: \(p\) => insertPromptTemplate\(p\)/, "the hook's prompt picks route through home's insert helper");
assert.match(homeComposer, /command === "\/prompt" \|\| command === "\/prompts"/, "home dispatches /prompt and /prompts");
assert.match(homeComposer, /const insertPromptTemplate = useCallback/, "home has the template-insert helper");
assert.doesNotMatch(homeComposer, /onStartChat\([^)]*promptInsertion/, "a template body never starts a chat directly");

// ── Placeholder Tab-cycling wiring (cave-jg6k) ───────────────────────────────
// Order is load-bearing in both composers: the inline menus own Tab-complete
// while open, so the placeholder branch sits AFTER handleMenuKey and only
// consumes Tab when the draft carries a token (native focus-move survives).
assert.match(
  homeComposer,
  /if \(handleMenuKey\(e\)\) return;[\s\S]{0,400}?if \(handlePlaceholderTab\(e, textareaRef\.current, setText\)\) return;/,
  "home: placeholder Tab runs after the inline menus",
);
assert.match(
  chatView,
  /if \(handleMenuKey\(e\)\) return;[\s\S]{0,400}?if \(handlePlaceholderTab\(e, inputRef\.current, setInput\)\) return;/,
  "chat: placeholder Tab runs after the inline menus",
);

// ── Recents + refresh + ordering (cave-jg6k) ─────────────────────────────────
assert.match(homeComposer, /recordPromptRecent\(p\.id\);/, "home records an insert as a recent");
assert.match(chatView, /recordPromptRecent\(p\.id\);/, "chat records an insert as a recent");
assert.match(
  menusHook,
  /window\.addEventListener\("cave:prompts-refresh", load\)/,
  "the picker hook re-scans on cave:prompts-refresh (save/delete broadcast)",
);
assert.match(
  menusHook,
  /orderPrompts\(options, readPromptFavorites\(\), readPromptRecents\(\)\)/,
  "picker options rank favorites > recents > scan order",
);

console.log("slash-prompt.test.ts: ok");
