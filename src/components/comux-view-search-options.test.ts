// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Project search (#932) gains case-sensitivity + file-glob options. The route
// already accepted ?case= and ?glob=; this wires the UI to them.
const src = await readFile(new URL("./comux-view.tsx", import.meta.url), "utf8");

// State.
assert.match(src, /const \[searchCaseSensitive, setSearchCaseSensitive\] = useState\(false\)/, "case-sensitivity state");
assert.match(src, /const \[searchGlob, setSearchGlob\] = useState\(""\)/, "glob filter state");

// Fetch wires the params (and only when set).
assert.match(src, /if \(searchCaseSensitive\) params\.set\("case", "sensitive"\)/, "case param sent when sensitive");
assert.match(src, /const glob = searchGlob\.trim\(\);[\s\S]*?if \(glob\) params\.set\("glob", glob\)/, "glob param sent when present");
assert.match(src, /\}, \[searchInput, searchRegex, searchCaseSensitive, searchGlob, searchRoot\]\)/, "effect re-runs on the new options");

// UI controls.
assert.match(src, /onClick=\{\(\) => setSearchCaseSensitive\(\(v\) => !v\)\}[\s\S]*?aria-pressed=\{searchCaseSensitive\}/, "Aa case toggle wired");
assert.match(src, /onChange=\{\(e\) => setSearchGlob\(e\.target\.value\)\}/, "glob filter input updates state");
assert.match(src, /aria-label="Filter files by glob"/, "glob filter input is labelled");
assert.match(src, /placeholder="Filter files — e\.g\. \*\.ts/, "glob input has a helpful placeholder");

console.log("comux-view-search-options.test.ts: ok");
