import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./flow-node.tsx", import.meta.url), "utf8");

// The node card renders a required badge driven by requiredParams.
assert.match(src, /requiredParams/);
assert.match(src, /flow-node-required-badge/);
assert.match(src, /required/);
