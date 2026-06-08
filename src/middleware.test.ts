// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./proxy.ts", import.meta.url), "utf8");
const tauriSource = await readFile(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
const sidecarBridgeSource = await readFile(new URL("./components/security/sidecar-auth-bridge.tsx", import.meta.url), "utf8");
const mobileScriptSource = await readFile(new URL("../scripts/mobile-tailscale.sh", import.meta.url), "utf8");
const mobileDocsSource = await readFile(new URL("../docs/mobile-tailscale.md", import.meta.url), "utf8");

assert.match(source, /export function proxy\(req: NextRequest\)/, "Next 16 proxy entrypoint should guard requests");
assert.match(source, /matcher:\s*\["\/\(\(\?!_next\/static\|_next\/image\|favicon\.ico\)\.\*\)"\]/, "proxy should guard API and mobile browser routes");
assert.match(source, /process\.env\.COVEN_CAVE_AUTH_TOKEN/, "proxy should require the per-launch sidecar token");
assert.match(source, /process\.env\.COVEN_CAVE_BUNDLE === "1"[\s\S]*missing sidecar auth token/, "bundled sidecar mode should fail closed when its auth token is missing");
assert.match(source, /req\.headers\.get\("origin"\)/, "middleware should reject unsafe origins");
assert.match(source, /req\.headers\.get\("host"\)/, "middleware should reject unsafe hosts");
assert.match(source, /unsupported content-type/, "middleware should reject unsafe content types before body parsing");
assert.match(source, /timingSafeEqualString\(queryToken, expected\)/, "mobile token bootstrap should only store verified query tokens");
assert.match(source, /req\.method === "GET" \|\| req\.method === "HEAD"/, "mobile token bootstrap should avoid redirects for mutating requests");
assert.match(sidecarBridgeSource, /window\.history\.replaceState/, "sidecar token bootstrap should remove the token from the visible URL");
assert.match(mobileScriptSource, /tailscale_cmd serve --bg "\$TAILSCALE_BACKEND"/, "mobile script should publish the exact loopback backend it started");
assert.match(mobileDocsSource, /coven_access_token=<printed-token>/, "mobile docs should include the required access token query");
assert.match(tauriSource, /sidecar_auth_token\(\)/, "Tauri sidecar should generate a per-launch token");
assert.match(tauriSource, /\.env\("COVEN_CAVE_AUTH_TOKEN", &auth_token\)/, "Tauri sidecar should pass the token to Next.js");
assert.match(tauriSource, /\?covenCaveToken=\{\}/, "Tauri app URL should bootstrap the token into the webview");
