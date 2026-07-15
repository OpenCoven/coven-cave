// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./proxy.ts", import.meta.url), "utf8");
const tauriSource = await readFile(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
const sidecarBridgeSource = await readFile(new URL("./components/security/sidecar-auth-bridge.tsx", import.meta.url), "utf8");
const sidecarMonitorSource = await readFile(new URL("./components/security/sidecar-auth-monitor.tsx", import.meta.url), "utf8");
const layoutSource = await readFile(new URL("./app/layout.tsx", import.meta.url), "utf8");
const mobileScriptSource = await readFile(new URL("../scripts/mobile-tailscale.sh", import.meta.url), "utf8");
const mobileDocsSource = await readFile(new URL("../docs/mobile-tailscale.md", import.meta.url), "utf8");
const nextConfigSource = await readFile(new URL("../next.config.ts", import.meta.url), "utf8");
const proxyHelpersSource = await readFile(new URL("./proxy-helpers.ts", import.meta.url), "utf8");

assert.match(source, /export async function proxy\(req: NextRequest\)/, "Next 16 proxy entrypoint should guard requests");
assert.match(source, /matcher:\s*\["\/\(\(\?!_next\/static\|_next\/image\|favicon\.ico\)\.\*\)"\]/, "proxy should guard API and mobile browser routes");
assert.match(source, /process\.env\.COVEN_CAVE_AUTH_TOKEN/, "proxy should require the per-launch sidecar token");
assert.match(source, /process\.env\.COVEN_CAVE_BUNDLE === "1"[\s\S]*missing sidecar auth token/, "bundled sidecar mode should fail closed when its auth token is missing");
assert.match(source, /req\.headers\.get\("origin"\)/, "middleware should reject unsafe origins");
assert.match(source, /req\.headers\.get\("host"\)/, "middleware should reject unsafe hosts");
assert.match(source, /const requestHost = req\.headers\.get\("host"\)/, "proxy should capture the forwarded request host once");
assert.match(source, /isAllowedApiHost\(requestHost, mobileAccessAuthenticated \|\| tailnetTrusted\)/, "valid mobile access or tailnet-trust should satisfy the API host gate");
assert.match(source, /const tailnetTrusted = process\.env\.COVEN_CAVE_TAILNET_TRUST === "1"/, "tokenless app mode (COVEN_CAVE_TAILNET_TRUST) should relax the host gate for tailnet-forwarded requests");
assert.match(
  source,
  /const mobileAccessMarker =\s*mobileAccessAuthenticated \|\| \(tailnetTrusted && isTailscaleServeHost\(requestHost\)\)/,
  "tokenless tailnet-trust mode should still stamp the mobile-access marker for ts.net hosts",
);
assert.match(
  source,
  /nextWithMobileAccessMarker\(req, mobileAccessMarker\)/,
  "proxy should forward the derived mobile marker into downstream request headers",
);
assert.match(source, /const origin = req\.headers\.get\("origin"\)/, "API origin gate should read the source origin header once");
assert.match(source, /const referer = req\.headers\.get\("referer"\)/, "API referer gate should read the source referer header once");
assert.match(source, /isAllowedRequestSourceAny\(origin, expectedOrigins\)/, "API origin gate should require same-origin sources unless header-CSRF-trusted");
assert.match(source, /isAllowedRequestSourceAny\(referer, expectedOrigins\)/, "API referer gate should require same-origin sources unless header-CSRF-trusted");
// Port-fallback CSRF fix (cave-5sg): the accepted-origin set is derived from
// the request (nextUrl.origin is pinned to the configured, not the actual
// listen port), so the browser Origin on a fallback port still passes.
assert.match(
  source,
  /const expectedOrigins = expectedRequestOrigins\(\s*req\.nextUrl\.origin,\s*req\.nextUrl\.protocol,\s*requestHost,?\s*\)/,
  "the origin gate must compare against origins derived from the request's own Host, not just the configured-port nextUrl.origin",
);
assert.match(source, /unsupported content-type/, "middleware should reject unsafe content types before body parsing");
for (const mime of ["image/jpeg", "image/png", "image/webp"]) {
  assert.ok(
    proxyHelpersSource.includes(`"${mime}"`),
    `the authenticated local backdrop upload should allow raw ${mime} bodies`,
  );
}
assert.doesNotMatch(
  proxyHelpersSource,
  /image\/svg\+xml/,
  "the API content-type gate must not admit active SVG backdrop payloads",
);
assert.match(source, /isProductionWebhookGet\(req\.nextUrl\.pathname, req\.method\)/, "state-changing GET webhooks should have a dedicated tokenless-tailnet CSRF guard");
assert.match(source, /missing request source/, "tokenless tailnet GET webhooks should reject absent Origin and Referer headers");
// cave-gzje: a verified signed mobile invite is the paired phone's credential.
// The final sidecar gate must admit it (the phone can never learn the
// webview's per-launch token), and the webhook-GET missing-source guard must
// extend to mobile-cookie-authenticated requests in exchange.
assert.match(
  source,
  /if \(!sidecarAuthenticated && !mobileAccessAuthenticated\) \{/,
  "the sidecar gate must admit mobile-access-authenticated requests — packaged phones hold no sidecar token",
);
assert.match(
  source,
  /\(\(tailnetTrusted && !sidecarToken\) \|\| mobileAccessAuthenticated\) &&\s*isProductionWebhookGet/,
  "the webhook-GET missing-source guard must also cover mobile-cookie-authenticated requests",
);

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
  /if \(!headerCsrfTrusted\) \{[\s\S]*?isAllowedRequestSourceAny\(origin, expectedOrigins\)/,
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
  const hostIdx = source.indexOf("isAllowedApiHost(requestHost, mobileAccessAuthenticated || tailnetTrusted)");
  const originIdx = source.indexOf("isAllowedRequestSourceAny(origin, expectedOrigins)");
  const refererIdx = source.indexOf("isAllowedRequestSourceAny(referer, expectedOrigins)");
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

// ── HTML access gate for unauthenticated browser navigations ──────────────
// Same 401 fail-closed posture; only the body differs by client. The page's
// form re-enters the query-token exchange above — no new auth logic.
assert.match(
  source,
  /isHtmlNavigationRequest\(req\.method, req\.nextUrl\.pathname, req\.headers\.get\("accept"\)\)/,
  "unauthenticated browser page navigations should get the HTML access gate",
);
assert.match(
  source,
  /if \(!verification\) \{[\s\S]*?accessGatePage\(\{ invalidToken: suppliedTokens\.length > 0 \}\)[\s\S]*?status: 401[\s\S]*?return jsonError\(401, "unauthorized"\);[\s\S]*?\}/,
  "the HTML gate must live inside the failed-verification branch, still 401, with the JSON envelope retained for non-navigations",
);
assert.match(
  source,
  /"cache-control": "no-store"/,
  "the access gate page must never be cached",
);
assert.match(
  sidecarBridgeSource,
  /__COVEN_CAVE_SIDECAR_AUTH_REQUIRED__/,
  "sidecar bootstrap should expose whether this server requires a sidecar token",
);
assert.match(
  layoutSource,
  /export const dynamic = "force-dynamic"/,
  "root layout must render sidecar auth requirement from runtime env, not build-time env",
);
assert.match(sidecarBridgeSource, /window\.history\.replaceState/, "sidecar token bootstrap should remove the token from the visible URL");
assert.match(sidecarMonitorSource, /useIsTauriDesktop/, "sidecar auth warning should only run for desktop Tauri");
assert.match(
  sidecarMonitorSource,
  /__COVEN_CAVE_SIDECAR_AUTH_REQUIRED__[\s\S]*dismissBanner\(BANNER_ID\)/,
  "sidecar auth warning should stay quiet when the current server does not require a token",
);
assert.doesNotMatch(sidecarMonitorSource, /Boolean\(window\.__TAURI_INTERNALS__\)/, "mobile Tauri should not be treated as a sidecar host");
assert.match(mobileScriptSource, /tailscale_cmd serve --bg "\$TAILSCALE_BACKEND"/, "mobile script should publish the exact loopback backend it started");
assert.match(mobileScriptSource, /"authorization": `Bearer \$\{createMobileAccessToken\(accessToken\)\}`/, "mobile script should authenticate its local invite API request with a derived token");
assert.match(nextConfigSource, /allowedDevOrigins:\s*\[[\s\S]*"\*\*\.ts\.net"/, "Next dev should allow Tailscale Serve origins for mobile browser access");
assert.match(nextConfigSource, /devIndicators:\s*false/, "Next dev tools launcher should not intercept mobile bottom-tab taps");
assert.match(mobileDocsSource, /signed (?:expiring )?invites?/, "mobile docs should describe the signed access token invite");
assert.match(proxyHelpersSource, /export function isTailscaleServeHost\(host: string \| null\)/, "proxy helpers should expose ts.net host detection so marker logic is testable and shared");
assert.match(tauriSource, /sidecar_auth_token\(\)/, "Tauri sidecar should generate a per-launch token");
assert.match(tauriSource, /\.env\("COVEN_CAVE_AUTH_TOKEN", &auth_token\)/, "Tauri sidecar should pass the token to Next.js");
assert.match(tauriSource, /\.env\("COVEN_CAVE_ACCESS_TOKEN", &mobile_access_token\)/, "Tauri sidecar should pass the mobile access secret to Next.js");
assert.match(
  tauriSource,
  /\?covenCaveToken=\{auth_token\}&coven_access_token=\{mobile_access_token\}/,
  "Tauri app URL should bootstrap both named tokens into the webview",
);
