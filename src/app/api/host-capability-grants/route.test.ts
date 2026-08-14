// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const route = await readFile(new URL("./route.ts", import.meta.url), "utf8");
const core = await readFile(new URL("../../../lib/host-capabilities.ts", import.meta.url), "utf8");
assert.match(route, /requireTrustedHumanGrantMutation\(req\)/, "host grants require the same direct-human gate as project grants");
assert.match(route, /rejectRelayedApproval\(payload\)/, "chat-provided approval claims are rejected");
assert.match(route, /targetFamiliarId, sessionId, and a supported capability are required/, "grants are explicitly familiar and session bound");
assert.match(route, /isVerifiedMobileRequest\(req\) \? "mobile" : "loopback"/, "the actor is derived from the trusted transport, never the payload");
assert.match(core, /const DEFAULT_GRANT_MS = 30 \* 60 \* 1000/, "host grants expire by default");
assert.match(core, /const MAX_GRANT_MS = 8 \* 60 \* 60 \* 1000/, "host grants cannot become permanent through the API");
assert.match(core, /hostCapabilityById\(grant\.capability\)\?\.platform === platform/, "effective grants fail closed when used from another platform");
