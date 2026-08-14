// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./proxy.ts", import.meta.url), "utf8");
const tauriSource = (
  await Promise.all(
    ["sidecar_auth.rs", "sidecar_startup.rs"].map((file) =>
      readFile(new URL(`../src-tauri/src/${file}`, import.meta.url), "utf8"),
    ),
  )
).join("\n");
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
assert.match(source, /isValidResearchMediaTicketRequest/, "proxy should accept only the restricted native media ticket when a media element cannot send the sidecar header");
assert.match(source, /process\.env\.COVEN_CAVE_BUNDLE === "1"[\s\S]*missing sidecar auth token/, "bundled sidecar mode should fail closed when its auth token is missing");
assert.match(
  source,
  /forbidden peer: missing trusted local peer or verified remote ingress/,
  "tokenless peer failures should identify the missing authorization proof",
);
assert.match(source, /req\.headers\.get\("origin"\)/, "middleware should reject unsafe origins");
assert.match(source, /req\.headers\.get\("host"\)/, "middleware should reject unsafe hosts");
assert.match(source, /const requestHost = req\.headers\.get\("host"\)/, "proxy should capture the forwarded request host once");
// Remote ingress is a verified mobile invite OR an allowlisted tailnet device
// Tailnet forwarding metadata is not a credential: a local process can forge
// it. Remote ingress requires a bearer credential (mobile or sidecar).
assert.match(source, /const remoteIngress =\s*mobileAccessAuthenticated \|\| \(sidecarAuthenticatedAtGate && !trustedLocalPeer\)/, "remote ingress requires a verified bearer credential");
assert.match(source, /isAllowedApiHost\(requestHost, remoteIngress\)/, "verified remote ingress should satisfy the API host gate");
assert.doesNotMatch(source, /isAllowedApiHost\([^)]*tailnetTrusted[^)]*\)/, "tailnet membership alone must not relax the API host gate");
assert.match(source, /const tailnetTrusted = process\.env\.COVEN_CAVE_TAILNET_TRUST === "1"/, "the tailnet-trust flag should survive only as a taint marker that further restricts automation ingress");
// The tailnet half of remoteIngress must come from the server.ts-minted stamp
// verified against the per-boot secret — never from a client-controlled Host or
// from the env flag above.
assert.match(
  source,
  /const tailnetNodeId = verifiedTailnetNode\(\s*req\.headers\.get\(TAILNET_PEER_HEADER\),\s*process\.env\.COVEN_CAVE_TAILNET_PEER_SECRET,\s*\)/,
  "tailnet ingress is authorized by the verified per-boot stamp, not by a client-controlled header",
);
assert.match(
  source,
  /const tailnetPeerVerified = tailnetNodeId !== null/,
  "tailnet verification is derived from a resolved node id",
);
assert.match(
  source,
  /nextWithMobileAccessMarker\(req, remoteIngress\)/,
  "proxy should forward the verified remote-ingress state into downstream request headers",
);
// A tailnet device is remote by construction, so it must carry the mobile
// marker — otherwise desktop-only routes would treat a phone as local.
assert.doesNotMatch(
  source,
  /nextWithMobileAccessMarker\(req, mobileAccessAuthenticated\)/,
  "tailnet ingress must not be excluded from the mobile marker (desktop-only routes rely on it)",
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
assert.match(source, /isProductionWebhookGet\(req\.nextUrl\.pathname, req\.method\)/, "state-changing GET webhooks should have a dedicated tokenless CSRF guard");
assert.match(source, /isLocalOnlyAutomationRun\(req\.nextUrl\.pathname, req\.method\)/, "run-now automation execution should have a dedicated local-only proxy guard");
assert.match(source, /remoteIngress \|\| tailnetTrusted \|\| !isLoopbackHost\(requestHost\)/, "run-now automation execution must deny mobile, tailnet-device, tailnet-flagged, and non-loopback proxy ingress");
assert.match(source, /missing request source/, "tokenless GET webhooks should reject absent Origin and Referer headers");
// cave-gzje: a verified signed mobile invite is the paired phone's credential.
// The final sidecar gate must admit it (the phone can never learn the
// webview's per-launch token), and the webhook-GET missing-source guard must
// extend to mobile-cookie-authenticated requests in exchange.
assert.match(
  source,
  /if \(!sidecarAuthenticated && !mobileAccessVerified\) \{/,
  "the final sidecar gate must independently admit a verified access token",
);
assert.match(
  source,
  /\(!sidecarToken \|\| mobileAccessVerified\) &&\s*isProductionWebhookGet/,
  "the webhook-GET missing-source guard must cover tokenless servers and mobile-cookie-authenticated requests",
);

// Tailscale Serve fix (re-applies #618; #716 reverted it): a request bearing the
// sidecar token in the CSRF-immune CUSTOM HEADER bypasses the origin/referer gate
// — Serve forwards `Host: 127.0.0.1`, so the real ts.net identity survives only in
// the Origin header and otherwise 403s every mutating request. The bypass is keyed
// to the header ONLY; the access cookie / mobile-access path must NOT grant it
// (cookies auto-send cross-origin → CSRF).
assert.match(
  source,
  /const headerCsrfTrusted =\s*sidecarTokenMatches\(req\.headers\.get\(TOKEN_HEADER\)\) &&\s*isHeaderCsrfTrustedApiPath\(req\.nextUrl\.pathname\)/,
  "origin/referer gate bypass must be keyed to the custom sidecar header token (timing-safe) and mobile endpoint allowlist",
);
assert.match(
  source,
  /const sidecarTokenMatches = \(supplied: string \| null \| undefined\) => \{\s*if \(!sidecarToken \|\| !supplied\) return false;\s*return timingSafeEqualString\(supplied, sidecarToken\);\s*\}/,
  "sidecar auth must compare the supplied token with timingSafeEqualString",
);
assert.match(
  source,
  /const sidecarAuthenticated = sidecarTokenMatches\(suppliedToken\)/,
  "sidecarAuthenticated must use the shared timing-safe matcher",
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
assert.match(
  source,
  /HEADER_CSRF_TRUSTED_API_PATHS = new Set\(\[\s*"\/api\/app\/native-readiness",\s*"\/api\/mobile-handoff",\s*"\/api\/mobile-token\/refresh",\s*\]\)/,
  "header-token CSRF relaxation must be limited to explicitly sidecar-token-authenticated native/mobile APIs",
);
assert.doesNotMatch(
  source,
  /HEADER_CSRF_TRUSTED_API_PATHS[\s\S]*codex-automations|HEADER_CSRF_TRUSTED_API_PATHS[\s\S]*\/api\/inbox/,
  "local-only APIs must not be included in the header-token CSRF allowlist",
);

// Ordering guard: dev-mode token-bypass (NextResponse.next() when no token is set)
// must sit AFTER the host / origin / referer / content-type checks. Pre-fix,
// the bypass ran first and silently let non-loopback callers through during
// `pnpm dev` if anything ever bound the dev server outside 127.0.0.1.
{
  const hostIdx = source.indexOf("isAllowedApiHost(requestHost, remoteIngress)");
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

// ── User-bound local authentication (cave-ruw4z) ──────────────────────────
// The local-peer stamp still distinguishes direct from forwarded ingress, but
// cannot bypass authentication because TCP loopback does not identify an OS
// user. Only the per-launch sidecar credential exempts the owning Tauri app.
assert.match(
  source,
  /isTrustedLocalPeer\(\s*req\.headers\.get\(LOCAL_PEER_HEADER\),\s*process\.env\.COVEN_CAVE_LOCAL_PEER_SECRET,?\s*\)/,
  "local-peer classification must verify the server-stamped per-boot secret",
);
assert.doesNotMatch(
  source,
  /LOCAL_PEER_HEADER\)\s*===\s*"1"/,
  "a bare marker value must never satisfy local-peer classification",
);
assert.match(
  source,
  /shouldRequireMobileAccessCredential\(\s*req\.headers\.get\("host"\),\s*suppliedTokens\.length > 0,\s*trustedLocalPeer,\s*tailnetPeerVerified,\s*sidecarAuthenticated,?\s*\)/,
  "the mobile gate must require user-bound sidecar or mobile credentials even for local peers",
);
// ...with exactly one exemption: a stamped direct-loopback DOCUMENT navigation.
// That request cannot carry a credential (a navigation is not a fetch, so
// SidecarAuthBridge never sees it, and the sidecar token gets no cookie), so
// gating it serves the access page instead of the app on every hard reload —
// the v0.3.0 lockout. The stamp is only ever applied to unforwarded loopback
// sockets, so Serve/tailnet traffic can never reach this branch.
assert.match(
  source,
  /if \(\s*trustedLocalPeer &&\s*isHtmlNavigationRequest\(req\.method, req\.nextUrl\.pathname, req\.headers\.get\("accept"\)\)\s*\) \{\s*return null;/,
  "a stamped local-peer document navigation must skip the mobile gate so the app can always load",
);
// The exemption must be navigation-scoped, never a blanket local-peer bypass:
// `/api/*` keeps requiring the sidecar credential, which is what distinguishes
// this user from other OS users on a shared machine.
assert.doesNotMatch(
  source,
  /if \(trustedLocalPeer\) return null;/,
  "the local-peer exemption must not extend past document navigations to the API surface",
);
assert.match(
  source,
  /const sidecarAuthenticatedAtGate = sidecarTokenMatches\(\s*req\.headers\.get\(TOKEN_HEADER\) \?\? req\.nextUrl\.searchParams\.get\(TOKEN_PARAM\)(?: \?\? refererToken)?,?\s*\)/,
  "the Tauri bypass must validate its per-launch sidecar credential",
);
// The marker classifies mobile INGRESS, not credential possession: a mobile
// invite cookie in a local desktop browser (auto-sent after a pairing link
// was once opened there) must not reclassify a trusted local peer as a
// phone — that marker makes isLocalOrigin() 403 every desktop-only route
// (research missions/links, automations) for a genuinely local user.
assert.match(
  source,
  /const mobileAccessVerified = mobileAccessToken\s*\?[\s\S]*?const mobileAccessAuthenticated = !trustedLocalPeer && mobileAccessVerified/,
  "a trusted local peer must never be marked as mobile ingress, even when a mobile access cookie rides along",
);
assert.match(
  source,
  /mobileAccessGate\(\s*req,\s*trustedLocalPeer,\s*tailnetPeerVerified,\s*sidecarAuthenticatedAtGate,?\s*\)/,
  "the local-peer, tailnet, and sidecar evidence is shared with the mobile gate",
);

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
assert.match(
  tauriSource,
  /wait_for_sidecar_ready\(\s*port,\s*&auth_token,\s*&sidecar_output,\s*sidecar_start_timeout,\s*&should_cancel,\s*child_exited,\s*\)/,
  "Tauri sidecar should require its launch evidence, token, live child, and bounded authenticated handshake",
);
assert.match(
  tauriSource,
  /GET \/api\/app\/native-readiness HTTP\/1\.1[\s\S]*x-coven-cave-token: \{auth_token\}/,
  "Tauri readiness must make an authenticated end-to-end API request",
);
assert.match(
  tauriSource,
  /readiness\.version != env!\("CARGO_PKG_VERSION"\)/,
  "Tauri readiness must reject a sidecar from an incompatible app version",
);
assert.match(
  tauriSource,
  /let child_exited = \|\|[\s\S]*sidecar\.has_exited\(\)/,
  "Tauri sidecar readiness should detect an early child exit",
);
assert.doesNotMatch(
  tauriSource,
  /sidecar_log_path|sidecar-daemon-server\.log|create_fresh_log_file/,
  "Tauri sidecar should not persist daemon launch output",
);
