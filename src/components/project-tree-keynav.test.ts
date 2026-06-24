// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const t = readFileSync(new URL("./project-tree.tsx", import.meta.url), "utf8");
assert.match(t, /from "@\/lib\/tree-keynav"/, "imports pure nav helpers");
assert.match(t, /role="tree"[\s\S]{0,260}tabIndex=\{0\}/, "tree container is focusable");
assert.match(t, /aria-label="File tree"/, "tree labeled");
assert.match(t, /querySelectorAll<HTMLButtonElement>\("\[data-tree-row\]"\)/, "queries row buttons in DOM order");
assert.match(t, /nextVisibleIndex\(e\.key, i, rows\.length\)/, "linear nav uses helper");
assert.match(t, /parentIndexByDepth\(depths, i\)/, "ArrowLeft-to-parent uses helper");
assert.match(t, /tabIndex=\{-1\}/, "rows are roving (tabIndex -1)");
assert.match(t, /data-tree-row=""/, "rows tagged for query");
assert.match(t, /data-tree-depth=\{depth\}/, "rows carry depth");
assert.match(t, /data-selected=\{isSelected \? "true" : undefined\}/, "selected row marked for initial focus");

// ── ARIA tree semantics: selection + level/position are announced ───────────
assert.match(t, /aria-selected=\{isSelected \|\| undefined\}/, "open file's treeitem is aria-selected");
assert.match(t, /aria-level=\{depth \+ 1\}/, "treeitems carry their nesting level");
assert.match(t, /aria-posinset=\{index \+ 1\}/, "treeitems carry their position among siblings");
assert.match(t, /aria-setsize=\{siblingCount\}/, "treeitems carry their sibling count");

// ── A failed child/root fetch is distinguishable from an empty dir ──────────
assert.match(t, /Promise<TreeEntry\[\] \| null>/, "fetchChildren returns null on failure (not an empty array)");
assert.match(t, /headline="Couldn't load files"/, "the root shows a load-error state");
assert.match(t, /Couldn&apos;t load — retry/, "an errored folder offers an inline retry");

// ── Refresh keeps the tree mounted (no skeleton flash / lost expansion) ─────
assert.match(t, /const isRefresh = loadedKeyRef\.current === key/, "a same-key reload is treated as a refresh");
assert.match(t, /if \(!isRefresh\) setLoading\(true\)/, "skeletons only show on first load / project switch, not refresh");

console.log("project-tree-keynav.test.ts passed");
