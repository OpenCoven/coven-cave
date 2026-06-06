// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const settings = await readFile(new URL("./settings-shell.tsx", import.meta.url), "utf8");

assert.match(settings, /fetch\("\/api\/daemon\/start", \{ method: "POST" \}\)/);
assert.match(settings, /Start daemon/);
assert.match(settings, /rocket-launch-bold/);
assert.match(settings, /!loading && !status\?\.running/);
