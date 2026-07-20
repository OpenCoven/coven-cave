import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./board-inspector-debug.tsx", import.meta.url), "utf8");
assert.match(source, /export function BoardInspectorDebug/, "diagnostics have their own component boundary");
assert.match(source, /aria-expanded=\{open\}/, "the debug disclosure preserves its accessibility state");
assert.match(source, /JSON\.stringify\(card, null, 2\)/, "raw-card diagnostics preserve full serialization");
assert.match(source, /useCopy\(\)/, "raw-card copy stays on the shared clipboard hook");
