// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./proxy.ts", import.meta.url), "utf8");
const tauriSource = await readFile(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
const sidecarBridgeSource = await readFile(new URL("./components/security/sidecar-auth-bridge.tsx", import.meta.url), "utf8");
const sidecarMonitorSource = await readFile(new URL("./components/security/sidecar-auth-monitor.tsx", import.meta.url), "utf8");
const mobileScriptSource = await readFile(new URL("../scripts/mobile-tailscale.sh", import.meta.url), "utf8");
const mobileDocsSource = await readFile(new URL("../docs/mobile-tailscale.md", import.meta.url), "utf8");
const nextConfigSource = await readFile(new URL("../next.config.ts", import.meta.url), "utf8");

assert.match(source, /export async function proxy\(req: NextRequest\)/, "Next 16 proxy entrypoint should guard requests");
assert.match(source, /matcher:\s*\["\/\(\(\?!_next\/static\|_next\/image\|favicon\.ico\)\.\*\)"\]/, "proxy should guard API and mobile browser routes");
assert.match(source, /process\.env\.COVEN_CAVE_AUTH_TOKEN/, "proxy should require the per-launch sidecar token");
assert.match(source, /process\.env\.COVEN_CAVE_BUNDLE === "1"[\s\S]*missing sidecar auth token/, "bundled sidecar mode should fail closed when its auth token is missing");
assert.match(source, /req\.headers\.get\("origin"\)/, "middleware should reject unsafe origins");
assert.match(source, /req\.headers\.get\("host"\)/, "middleware should reject unsafe hosts");
assert.match(source, /const requestHost = req\.headers\.get\("host"\)/, "proxy should capture the forwarded request host once");
assert.match(source, /isAllowedApiHost\(requestHost, mobileAccessAuthenticated\)/, "valid mobile access should satisfy the API host gate");
assert.match(source, /isAllowedRequestSource\(req\.headers\.get\("origin"\), expectedOrigin\)/, "API origin gate should require same-origin sources unless header-CSRF-trusted");
assert.match(source, /isAllowedRequestSource\(req\.headers\.get\("referer"\), expectedOrigin\)/, "API referer gate should require same-origin sources unless header-CSRF-trusted");
assert.match(source, /unsupported content-type/, "middleware should reject unsafe content types before body parsing");

// Tailscale Serve fix (re-applies #618; #716 reverted it): a request bearing the
// sidecar token in the CSRF-immune CUSTOM HEADER bypasses the origin/referer gate
// — Serve forwards `Host: 127.0.0.1`, so the real ts.net identity survives only in
// the Origin header and otherwise 403s every mutating request. The bypass is keyed
// to the header ONLY; the access cookie / mobile-access path must NOT grant it
// (cookies auto-send cross-origin → CSRF).
assert.match(
  source,
  /const headerCsrfTrusted =\s*Boolean\(sidecarToken\) && req\.headers\.get\(TOKEN_HEADER\) === sidecarToken/,
  "origin/referer gate bypass must be keyed to the custom sidecar header token",
);
assert.match(
  source,
  /if \(!headerCsrfTrusted\) \{[\s\S]*?isAllowedRequestSource\(req\.headers\.get\("origin"\)/,
  "origin gate must run unless the request is header-CSRF-trusted",
);
assert.doesNotMatch(
  source,
  /csrfTrusted\s*=\s*mobileAccessAuthenticated/,
  "cookie-backed mobile-access must NOT bypass the CSRF origin gate",
);

// Ordering guard: dev-mode token-bypass (NextResponse.next() when no token is set)
// must sit AFTER the host / origin / referer / content-type checks. Pre-fix,
// the bypass ran first and silently let non-loopback callers through during
// `pnpm dev` if anything ever bound the dev server outside 127.0.0.1.
{
  const hostIdx = source.indexOf("isAllowedApiHost(requestHost, mobileAccessAuthenticated)");
  const originIdx = source.indexOf('isAllowedRequestSource(req.headers.get("origin")');
  const refererIdx = source.indexOf('isAllowedRequestSource(req.headers.get("referer")');
  const contentTypeIdx = source.indexOf("unsupported content-type");
  const bypassIdx = source.indexOf("missing sidecar auth token");
  assert.ok(hostIdx > 0, "host check should be present");
  assert.ok(originIdx > 0, "origin check should be present");
  assert.ok(refererIdx > 0, "referer check should be present");
  assert.ok(contentTypeIdx > 0, "content-type check should be present");
  assert.ok(bypassIdx > 0, "token-bypass branch should be present");
  assert.ok(
    bypassIdx > hostIdx &&
      bypassIdx > originIdx &&
      bypassIdx > refererIdx &&
      bypassIdx > contentTypeIdx,
    "dev-mode token bypass must run AFTER host/origin/referer/content-type guards",
  );
}
assert.match(source, /isValidMobileAccessCredential/, "mobile token bootstrap should verify signed or legacy credentials");
assert.match(
  source,
  /isValidMobileAccessCredential\(\{\s*supplied:\s*queryToken,\s*expectedSecret:\s*expected,\s*\}\)/,
  "mobile token bootstrap should validate the query token before writing cookie state",
);
assert.match(source, /if \(queryVerification\.ok\)/, "invalid query tokens should not overwrite the access cookie");
assert.match(source, /maxAge/, "signed mobile cookie lifetime should track token expiry");
assert.match(source, /req\.method === "GET" \|\| req\.method === "HEAD"/, "mobile token bootstrap should avoid redirects for mutating requests");
assert.match(sidecarBridgeSource, /window\.history\.replaceState/, "sidecar token bootstrap should remove the token from the visible URL");
assert.match(sidecarMonitorSource, /useIsTauriDesktop/, "sidecar auth warning should only run for desktop Tauri");
assert.doesNotMatch(sidecarMonitorSource, /Boolean\(window\.__TAURI_INTERNALS__\)/, "mobile Tauri should not be treated as a sidecar host");
assert.match(mobileScriptSource, /tailscale_cmd serve --bg "\$TAILSCALE_BACKEND"/, "mobile script should publish the exact loopback backend it started");
assert.match(mobileScriptSource, /"authorization": `Bearer \$\{createMobileAccessToken\(accessToken\)\}`/, "mobile script should authenticate its local invite API request with a derived token");
assert.match(nextConfigSource, /allowedDevOrigins:\s*\[[\s\S]*"\*\*\.ts\.net"/, "Next dev should allow Tailscale Serve origins for mobile browser access");
assert.match(nextConfigSource, /devIndicators:\s*false/, "Next dev tools launcher should not intercept mobile bottom-tab taps");
assert.match(mobileDocsSource, /signed (?:expiring )?invites?/, "mobile docs should describe the signed access token invite");
assert.match(tauriSource, /sidecar_auth_token\(\)/, "Tauri sidecar should generate a per-launch token");
assert.match(tauriSource, /\.env\("COVEN_CAVE_AUTH_TOKEN", &auth_token\)/, "Tauri sidecar should pass the token to Next.js");
assert.match(tauriSource, /\.env\("COVEN_CAVE_ACCESS_TOKEN", &mobile_access_token\)/, "Tauri sidecar should pass the mobile access secret to Next.js");
assert.match(tauriSource, /\?covenCaveToken=\{\}&coven_access_token=\{\}/, "Tauri app URL should bootstrap both tokens into the webview");
