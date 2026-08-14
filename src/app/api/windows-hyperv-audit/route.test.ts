// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const route = await readFile(new URL("./route.ts", import.meta.url), "utf8");
const adapter = await readFile(new URL("../../../lib/windows-hyperv-audit.ts", import.meta.url), "utf8");
assert.match(route, /loadConversation\(sessionId\)/, "the route binds audit requests to a Cave-owned session");
assert.match(route, /conversation\.familiarId !== familiarId/, "mismatched familiar/session pairs are rejected");
assert.doesNotMatch(route, /body\.(?:command|powershell|helperPath|script)\b/i, "the route accepts no arbitrary command surface");
assert.match(adapter, /const HELPER_ARGS = \["hyperv-inventory", "--format", "json"\]/, "the broker command is a fixed allow-list entry");
assert.match(adapter, /shell: false/, "the helper is never run through a shell");
assert.match(adapter, /platform !== "win32"/, "the adapter fails closed off Windows");
assert.match(adapter, /activeHostCapabilities/, "an unexpired session capability is required before helper execution");
assert.match(adapter, /host: \{ name: string; version: string; hypervAvailable: boolean \}/, "structured host inventory is returned");
assert.match(adapter, /vms: Array/, "structured VM inventory is returned");
assert.match(adapter, /switches: Array/, "structured switch inventory is returned");
assert.match(adapter, /checkpoints: Array/, "structured checkpoint inventory is returned");
assert.match(adapter, /vhdChains: Array/, "structured VHD-chain inventory is returned");
assert.match(adapter, /integrationServices: Array/, "structured integration-service inventory is returned");
