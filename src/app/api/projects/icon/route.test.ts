// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

assert.match(route, /export async function POST\(req: Request\)/, "icon route should expose POST");
assert.match(route, /resolveIconImageProvider\(connectedModel, resolveSecret\)/, "icon route should pick the provider from the connected model via the vault");
assert.match(route, /config\.defaults\.model/, "icon route should fall back to the selected runtime's configured model");
assert.match(route, /vault_key_unresolved/, "missing key must return a structured hint, not a bare 500");
assert.match(route, /buildProjectIconPrompt/, "icon route should build prompts through the shared lib");
assert.match(route, /missing_fields/, "POST should validate name and root");
assert.match(route, /status:\s*502/, "provider failures should surface as 502");
assert.match(route, /b64_json/, "icon route should read the OpenAI base64 image payload");
assert.match(route, /bytesBase64Encoded/, "icon route should read the Gemini base64 image payload");
assert.doesNotMatch(route, /console\.(log|error|warn)/, "icon route must not log (key safety)");

console.log("projects icon route.test.ts: ok");
