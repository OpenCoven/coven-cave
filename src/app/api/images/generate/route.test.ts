// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

assert.match(route, /export async function POST\(req: Request\)/, "images route should expose POST");
assert.match(
  route,
  /resolveImageGeneration\(settings, connectedModel, resolveSecret/,
  "images route should resolve provider/model/size through the shared lib + vault",
);
assert.match(route, /bindingFor\(config, familiarId\)/, "images route should read the familiar's Brain-tab image settings");
assert.match(route, /config\.defaults\.model/, "images route should fall back to the workspace default model");
assert.match(route, /image_generation_disabled/, "an 'off' provider must return a structured error");
assert.match(route, /vault_key_unresolved/, "missing key must return a structured hint, not a bare 500");
assert.match(route, /missing_prompt/, "POST should validate the prompt");
assert.match(route, /prompt_too_long/, "POST should bound the prompt length");
assert.match(route, /status:\s*502/, "provider failures should surface as 502");
assert.match(route, /b64_json/, "images route should read the OpenAI base64 image payload");
assert.match(route, /bytesBase64Encoded/, "images route should read the Gemini base64 image payload");
assert.match(route, /output_format:\s*"webp"/, "gpt-image models should request compact webp output");
assert.match(route, /aspectRatio/, "Gemini sizes should map to aspect ratios");
assert.match(route, /dataUrl:\s*`data:\$\{mime\};base64,/, "success payload should carry a renderable data URL");
assert.doesNotMatch(route, /console\.(log|error|warn)/, "images route must not log (key safety)");

console.log("images generate route.test.ts: ok");
