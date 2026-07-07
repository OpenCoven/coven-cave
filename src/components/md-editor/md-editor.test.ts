// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const shell = await readFile(new URL("./md-editor.tsx", import.meta.url), "utf8");
const visual = await readFile(new URL("./md-editor-visual.tsx", import.meta.url), "utf8");
const memory = await readFile(new URL("./memory-md-editor.tsx", import.meta.url), "utf8");
const grimoire = await readFile(new URL("../grimoire-view.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../../styles/md-editor.css", import.meta.url), "utf8");
const globals = await readFile(new URL("../../app/globals.css", import.meta.url), "utf8");

// ── Shell: modes, header, footer, save ───────────────────────────────────────

assert.match(shell, /export function MdEditor\(/, "MdEditor must be exported");
assert.match(shell, /\(\["visual", "markdown"\] as const\)/, "VISUAL/MARKDOWN mode toggle present");
assert.match(shell, /aria-pressed=\{mode === m\}/, "mode toggle uses aria-pressed");
assert.match(shell, /"cave:md-editor:mode"/, "mode preference persisted under the cave: key");
assert.match(shell, /dynamic\(\(\) => import\("\.\/md-editor-visual"\)/, "visual mode loads via next/dynamic");
assert.match(shell, /ssr: false/, "visual editor never renders on the server");
assert.match(shell, /<CodeEditor/, "MARKDOWN mode reuses the shared CodeMirror editor");
assert.match(shell, /parseMdDocument|serializeMdDocument/, "raw doc round-trips through md-frontmatter");
assert.match(shell, /formatMdDocStats\(stats\)/, "footer shows word · char · ~token counts");
assert.match(shell, /aria-label="Document title"/, "frontmatter title field is labelled");
assert.match(shell, /aria-label="Add tag"/, "tag input is labelled");
assert.match(shell, /aria-label=\{`Remove tag \$\{tag\}`\}/, "tag chips are removable");
assert.match(shell, /e\.key\.toLowerCase\(\) === "s"/, "Cmd/Ctrl+S saves from the shell");
assert.match(shell, /const dirty = raw !== baseline/, "dirty tracks the saved baseline");
assert.match(shell, /disabled=\{!dirty \|\| saving\}/, "save button disabled when clean/saving");
assert.match(shell, /role="alert"/, "save errors are announced");

// Untouched docs must round-trip byte-identical: raw is canonical state.
assert.match(shell, /const \[raw, setRaw\] = useState\(value\)/, "raw document string is the canonical state");

// ── Visual mode: Milkdown Crepe wiring ───────────────────────────────────────

assert.match(visual, /new Crepe\(\{/, "visual mode is Milkdown Crepe");
assert.match(visual, /markdownUpdated\(/, "edits stream back via markdownUpdated");
assert.match(visual, /\[Crepe\.Feature\.AI\]: false/, "Crepe AI feature disabled");
assert.match(visual, /\[Crepe\.Feature\.Latex\]: false/, "Crepe LaTeX feature disabled (katex weight)");
assert.match(visual, /\[Crepe\.Feature\.TopBar\]: false/, "Crepe top bar disabled — shell owns chrome");
assert.match(visual, /void crepe\.destroy\(\)/, "Crepe destroyed on unmount");
assert.match(visual, /setReadonly/, "read-only state forwarded to Crepe");
assert.match(visual, /@milkdown\/crepe\/theme\/common\/style\.css/, "crepe common theme imported");

// ── Memory wiring: reveal load + guarded PUT ─────────────────────────────────

assert.match(memory, /reveal: true/, "editing loads the un-redacted file");
assert.match(memory, /method: "PUT"/, "saves go through PUT /api/memory/file");
assert.match(memory, /\/api\/memory\/file/, "memory save endpoint");
assert.match(memory, /expectedMtimeMs/, "saves carry the mtime conflict baseline");
assert.match(memory, /res\.status === 409/, "conflicts get a dedicated message");
assert.match(memory, /<MdEditor\s/, "memory editor renders the shared MdEditor");
assert.match(memory, /key=\{path\}/, "editor remounts per document path");

// ── Autosave: idempotent surfaces only (cave-b2v) ────────────────────────────

assert.match(shell, /autoSave = false/, "autoSave is opt-in, off by default");
assert.match(
  shell,
  /if \(!autoSave \|\| readOnly \|\| saving \|\| !dirty \|\| !raw\.trim\(\)\) return/,
  "autosave skips when off, read-only, mid-save, clean, or empty",
);
assert.match(
  shell,
  /setTimeout\(\(\) => void saveRef\.current\(\), AUTOSAVE_DEBOUNCE_MS\)/,
  "autosave is debounced and routes through the shared save path",
);
assert.match(shell, /clearTimeout\(timer\)/, "a pending autosave is cancelled on change/unmount");
// Idempotent surfaces opt in; the mtime-guarded memory editor must NOT.
assert.match(grimoire, /showHeader=\{false\}[\s\S]*?autoSave\b/, "the journal editor autosaves");
assert.match(
  grimoire,
  /autoSave=\{entry != null\}/,
  "knowledge autosaves only once the entry exists (a new entry's first save remounts)",
);
assert.doesNotMatch(
  memory,
  /autoSave/,
  "memory files stay explicit-save — agents write those roots concurrently (mtime conflicts)",
);

// ── Theme: crepe vars ride the Cave tokens ───────────────────────────────────

assert.match(css, /--crepe-color-primary: var\(--accent-presence\)/, "crepe accent mapped to app accent");
assert.match(css, /--crepe-color-on-background: var\(--text-primary\)/, "crepe ink mapped to app ink");
assert.match(globals, /@import "\.\.\/styles\/md-editor\.css"/, "md-editor.css imported in globals");

console.log("md-editor.test: ok");
