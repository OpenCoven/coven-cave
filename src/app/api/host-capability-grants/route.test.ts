// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const route = await readFile(new URL("./route.ts", import.meta.url), "utf8");
const core = await readFile(new URL("../../../lib/host-capabilities.ts", import.meta.url), "utf8");
assert.match(route, /requireTrustedHumanGrantMutation\(req\)/, "host grants require the same direct-human gate as project grants");
assert.match(route, /rejectRelayedApproval\(payload\)/, "chat-provided approval claims are rejected");
assert.match(route, /import \{ listConversations, loadConversation \} from "@\/lib\/cave-conversations"/, "server ownership checks use Cave-owned conversation metadata");
assert.match(route, /const conversation = await loadConversation\(sessionId\);[\s\S]*if \(!conversation \|\| conversation\.familiarId !== familiarId\) return null/, "absent or mismatched session ownership is rejected before mutation");
assert.match(route, /async function revokeInput[\s\S]*if \(conversation && conversation\.familiarId !== familiarId\) return null/, "a deleted session can be revoked while a live mismatched session remains protected");
assert.match(route, /const parsed = await revokeInput\(payload\);[\s\S]*revokeHostCapability/, "DELETE uses the cleanup-specific ownership rule");
assert.match(route, /conversation\.familiarId === familiarId/, "the selector exposes only sessions owned by the requested familiar");
assert.match(route, /if \(!familiarId \|\| !isValidFamiliarId\(familiarId\)\)[\s\S]*grants: \[\], audit: \[\], sessions: \[\]/, "unscoped GET never exposes a global authority ledger");
assert.match(route, /const grants = allGrants\.filter\(\(grant\) => grant\.familiarId === familiarId\);[\s\S]*const audit = allAudit\.filter\(\(entry\) => entry\.familiarId === familiarId\);/, "GET filters grants and audit server-side before serializing them");
assert.match(route, /choose a Cave session that belongs to this familiar/, "an unowned session is rejected with a direct operator error");
assert.match(route, /isVerifiedMobileRequest\(req\) \? "mobile" : "loopback"/, "the actor is derived from the trusted transport, never the payload");
assert.match(core, /const DEFAULT_GRANT_MS = 30 \* 60 \* 1000/, "host grants expire by default");
assert.match(core, /const MAX_GRANT_MS = 8 \* 60 \* 60 \* 1000/, "host grants cannot become permanent through the API");
assert.match(core, /hostCapabilityById\(grant\.capability\)\?\.platform === platform/, "effective grants fail closed when used from another platform");
