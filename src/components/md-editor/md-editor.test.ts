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
// (cave-mglw) the "Saved" flash is the only save confirmation — it must be a
// polite status so screen readers hear saves (incl. debounced autosaves) too.
assert.match(shell, /savedFlash \? \(\s*\n[\s\S]{0,220}?<span role="status"/, "the Saved flash is a polite live region");

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
assert.match(visual, /\[Crepe\.Feature\.CodeMirror\]: \{ theme: caveCodeMirrorTheme \}/, "code blocks use the shared Cave CodeMirror theme, not Crepe's bundled one-dark");

// ── Memory wiring: reveal load + guarded PUT ─────────────────────────────────

assert.match(memory, /reveal: true/, "editing loads the un-redacted file");
assert.match(memory, /method: "PUT"/, "saves go through PUT /api/memory/file");
assert.match(memory, /\/api\/memory\/file/, "memory save endpoint");
assert.match(memory, /expectedMtimeMs/, "saves carry the mtime conflict baseline");
assert.match(memory, /res\.status === 409/, "conflicts get dedicated handling");
assert.match(memory, /json\.currentMtimeMs/, "a 409 re-baselines on the server-reported disk mtime");
assert.match(
  memory,
  /conflict: \{ currentText: json\.currentText \}/,
  "a 409 forwards the disk text to the editor's conflict panel",
);
assert.match(memory, /<MdEditor\s/, "memory editor renders the shared MdEditor");
assert.match(memory, /key=\{`\$\{path\}:\$\{refreshToken\}`\}/, "editor remounts per document path and disk reload");

// ── Live-follow: agents write open memory docs (cave-e3b) ────────────────────

assert.match(memory, /export const LIVE_FOLLOW_INTERVAL_MS = 5000/, "poll cadence is a named constant");
assert.match(memory, /stat=1/, "the poll uses the cheap stat-only route mode");
assert.match(memory, /document\.hidden/, "polling pauses while the tab is hidden");
assert.match(memory, /dirty[\s\S]*?setDiskChanged\(true\)[\s\S]*?reloadFromDisk\(\)/, "dirty docs banner; clean docs follow the disk automatically");
assert.match(memory, /role="status"/, "the disk-change banner is announced politely");
assert.match(memory, /Reload from disk/, "the banner offers an explicit reload");
assert.match(memory, /Keep editing/, "the banner never forces a reload — drafts are preserved");
assert.match(memory, /draftRef\.current = raw/, "onChange mirrors the draft for dirty detection");

const fileRoute = await readFile(new URL("../../app/api/memory/file/route.ts", import.meta.url), "utf8");
assert.match(fileRoute, /searchParams\.get\("stat"\) === "1"/, "GET supports a stat-only mode");
assert.match(fileRoute, /if \(url\.searchParams\.get\("stat"\) === "1"\) \{[\s\S]*?await stat\(/, "stat mode stats without reading the file");
assert.match(fileRoute, /resolveAllowedMemoryFilePath\(target\)[\s\S]*?stat/, "stat mode sits behind the same path allowlist");

// ── Autosave: idempotent surfaces only (cave-b2v) ────────────────────────────

assert.match(shell, /autoSave = false/, "autoSave is opt-in, off by default");
assert.match(
  shell,
  /if \(!autoSave \|\| readOnly \|\| saving \|\| conflict !== null \|\| !dirty \|\| !raw\.trim\(\)\) return/,
  "autosave skips when off, read-only, mid-save, conflicted, clean, or empty",
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

// ── Conflict panel: diff + keep-mine / take-theirs / merge (cave-utl) ────────

assert.match(shell, /MdEditorConflictPanel/, "conflicts render a dedicated resolution panel");
assert.match(shell, /aria-label="Resolve edit conflict"/, "the conflict panel is a labelled region");
assert.match(shell, /diffLines\(theirs, mine\)/, "the panel diffs the disk version against the draft");
assert.match(shell, /Keep my draft/, "keep-mine action offered");
assert.match(shell, /Take disk version/, "take-theirs action offered");
assert.match(shell, /Merge both/, "merge action offered");
assert.match(shell, /mergeThreeWay\(baseline, rawRef\.current, current\.currentText\)/, "merge is a three-way merge from the saved baseline");
assert.match(
  shell,
  /if \(merged\.conflicts > 0\) switchMode\("markdown"\)/,
  "marker-bearing merges land in MARKDOWN mode where the markers are editable",
);
assert.match(shell, /setBaseline\(current\.currentText\)/, "take-theirs re-baselines on the disk text");

// ── Theme: crepe vars ride the Cave tokens ───────────────────────────────────

assert.match(css, /--crepe-color-primary: var\(--accent-presence\)/, "crepe accent mapped to app accent");
assert.match(css, /--crepe-color-on-background: var\(--text-primary\)/, "crepe ink mapped to app ink");
// Light-theme legibility (cave-nar): inline code is the app's theme-aware
// lavender pill, and code blocks keep the always-dark --code-surface with
// fixed light-on-dark chrome inks — never the old fixed-dark inline mapping.
assert.match(css, /--crepe-color-inline-code: color-mix\(in oklch, var\(--accent-presence\) 85%, var\(--text-primary\)\)/, "inline code ink is theme-aware");
assert.match(css, /--crepe-color-inline-area: color-mix\(in oklch, var\(--accent-presence\) 14%, transparent\)/, "inline code pill bg is theme-aware");
assert.doesNotMatch(css, /--crepe-color-inline-area: var\(--code-surface\)/, "inline code must NOT ride the fixed-dark code surface");
assert.match(css, /\.milkdown-code-block \{[\s\S]*?background: var\(--code-surface\)/, "code blocks stay on the always-dark code surface");
assert.match(globals, /@import "\.\.\/styles\/md-editor\.css"/, "md-editor.css imported in globals");

// The shared CodeMirror theme is one module for all three editor surfaces.
const sharedTheme = await readFile(new URL("../code-editor-theme.ts", import.meta.url), "utf8");
assert.match(sharedTheme, /export const caveCodeMirrorTheme/, "shared theme exported");
const codeEditor = await readFile(new URL("../code-editor.tsx", import.meta.url), "utf8");
assert.match(codeEditor, /from "@\/components\/code-editor-theme"/, "code-editor consumes the shared theme");

// ── onDirtyChange: hosts can observe unsaved-edits transitions (cave-vv2h) ───
// The shell reports dirty flips through a ref so an unstable callback identity
// never re-fires the effect; MemoryMdEditor forwards it to the inner editor.
assert.match(shell, /onDirtyChange\?: \(dirty: boolean\) => void/, "MdEditor exposes an onDirtyChange prop");
assert.match(shell, /const onDirtyChangeRef = useRef\(onDirtyChange\)/, "dirty reporting rides a ref, not the callback identity");
assert.match(shell, /useEffect\(\(\) => \{\s*\n\s*onDirtyChangeRef\.current\?\.\(dirty\);\s*\n\s*\}, \[dirty\]\)/, "dirty transitions fire only when dirty actually flips");
assert.match(memory, /onDirtyChange=\{onDirtyChange\}/, "MemoryMdEditor forwards onDirtyChange to the shell");

console.log("md-editor.test: ok");

// ── (grimoire-audit cave-say6) editor lazy-load skeleton ─────────────────────
// The visual editor chunk used to flash a bare "Loading editor…" line while
// Milkdown loaded — it now renders skeleton text lines like the other panes.
assert.match(shell, /loading: \(\) => \(\s*\n\s*\/\/ Skeleton lines/, "the dynamic import has a skeleton fallback");
assert.match(shell, /<Skeleton key=\{i\} variant="text" width=\{w\} \/>/, "the fallback uses the shared Skeleton primitive");
assert.match(shell, /aria-label="Loading editor" aria-busy="true"/, "the fallback is announced as busy");
assert.ok(!shell.includes("Loading editor…"), "the bare text flash is gone");
