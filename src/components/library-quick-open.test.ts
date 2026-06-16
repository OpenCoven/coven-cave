// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const palette = readFileSync(new URL("./library-quick-open.tsx", import.meta.url), "utf8");
const view = readFileSync(new URL("./library-view.tsx", import.meta.url), "utf8");
const rail = readFileSync(new URL("./library-collection-rail.tsx", import.meta.url), "utf8");

// ── Palette: keyboard-first, listbox a11y (mirrors BrowserQuickOpen) ─────────
assert.match(palette, /export function LibraryQuickOpen/, "exports the LibraryQuickOpen palette");
assert.match(palette, /inputRef\.current\?\.focus\(\)/, "focuses the search input on open");
assert.match(palette, /role="listbox"/, "results are a listbox");
assert.match(palette, /role="option"/, "each result is an option");
assert.match(palette, /aria-activedescendant=/, "input points at the active option for screen readers");
assert.match(palette, /role="dialog"[\s\S]{0,80}aria-modal="true"/, "palette is a modal dialog");
for (const key of ['"ArrowDown"', '"ArrowUp"', '"Enter"', '"Escape"']) {
  assert.match(palette, new RegExp(`e\\.key === ${key}`), `palette handles ${key}`);
}
assert.match(palette, /it\.title\.toLowerCase\(\)\.includes\(q\)[\s\S]{0,80}it\.hint\.toLowerCase\(\)\.includes\(q\)/, "filters by title and hint");
// Covers all four library kinds.
assert.match(palette, /doc: "Doc"[\s\S]{0,120}github: "GitHub"/, "labels all four kinds (doc/bookmark/reading/github)");

// ── library-view wiring ──────────────────────────────────────────────────────
assert.match(view, /import \{ LibraryQuickOpen, type LibraryQuickItem \} from "@\/components\/library-quick-open"/, "library-view imports the palette");
// "/" opens it (when not typing), distinct from the global ⌘K command palette.
assert.match(view, /e\.key !== "\/" \|\| e\.metaKey \|\| e\.ctrlKey \|\| e\.altKey/, '"/" opens quick-open and ignores modifier combos');
assert.match(view, /tag === "input" \|\| tag === "textarea" \|\| tag === "select"/, "/-shortcut is ignored while typing");
// Opening fetches a fresh global snapshot: all docs + every captured link.
assert.match(view, /fetch\("\/api\/library\/all"[\s\S]{0,200}fetch\("\/api\/library\?collection=all"/, "quick-open fetches captured links + all docs on open");
// Selecting navigates to the item and opens it.
assert.match(view, /const handleQuickSelect = useCallback\(/, "library-view defines a quick-select navigator");
assert.match(view, /item\.kind === "doc"[\s\S]{0,200}handleSelectDoc\(doc\)/, "selecting a doc opens it via handleSelectDoc");
assert.match(view, /setActiveSection\(entry\.list\)[\s\S]{0,200}setSelectedItem\(/, "selecting a link jumps to its section and opens the preview");
assert.match(view, /<LibraryQuickOpen[\s\S]{0,160}onSelect=\{handleQuickSelect\}/, "renders the palette wired to the navigator");

// ── Rail trigger (discoverable button) ───────────────────────────────────────
assert.match(rail, /onQuickOpen\?: \(\) => void/, "rail accepts an onQuickOpen handler");
assert.match(rail, /aria-label="Search the library"[\s\S]{0,40}<Icon name="ph:magnifying-glass"/, "rail shows a labeled search button");

console.log("library-quick-open.test.ts: ok");
