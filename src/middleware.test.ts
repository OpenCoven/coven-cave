// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./middleware.ts", import.meta.url), "utf8");
const tauriSource = await readFile(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");

assert.match(source, /matcher:\s*"\/api\/:path\*"/, "middleware should guard all API routes");
assert.match(source, /process\.env\.COVEN_CAVE_AUTH_TOKEN/, "middleware should require the per-launch sidecar token");
assert.match(source, /req\.headers\.get\("origin"\)/, "middleware should reject unsafe origins");
assert.match(source, /req\.headers\.get\("host"\)/, "middleware should reject unsafe hosts");
assert.match(source, /unsupported content-type/, "middleware should reject unsafe content types before body parsing");
assert.match(tauriSource, /sidecar_auth_token\(\)/, "Tauri sidecar should generate a per-launch token");
assert.match(tauriSource, /\.env\("COVEN_CAVE_AUTH_TOKEN", &auth_token\)/, "Tauri sidecar should pass the token to Next.js");
assert.match(tauriSource, /\?covenCaveToken=\{\}/, "Tauri app URL should bootstrap the token into the webview");
