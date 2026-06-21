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
console.log("project-tree-keynav.test.ts passed");
