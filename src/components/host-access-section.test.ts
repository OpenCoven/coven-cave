// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./host-access-section.tsx", import.meta.url), "utf8");
assert.match(source, /import \{ StandardSelect \} from "@\/components\/ui\/select"/, "host access uses the shared select primitive");
assert.match(source, /<StandardSelect[\s\S]*label="Cave session"/, "the trusted session picker is accessible");
assert.doesNotMatch(source, /<select\b/, "host access does not introduce an unapproved native select");
assert.match(source, /capability\.adapter \? <Button/, "only broker-backed capabilities expose an approval action");
assert.match(source, /never grants arbitrary shell/, "the UI does not overstate a broker grant as host authority");
