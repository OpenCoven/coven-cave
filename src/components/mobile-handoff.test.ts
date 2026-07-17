import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const topBar = await readFile(new URL("./top-bar.tsx", import.meta.url), "utf8");
const workspace = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");
const sidebar = await readFile(new URL("./sidebar-minimal.tsx", import.meta.url), "utf8");
const modal = await readFile(new URL("./mobile-handoff-modal.tsx", import.meta.url), "utf8");
const settings = await readFile(new URL("./settings-shell.tsx", import.meta.url), "utf8");
const mobileModePref = await readFile(new URL("../lib/mobile-mode-pref.ts", import.meta.url), "utf8");
const mobileModeReconcile = await readFile(new URL("../lib/mobile-mode-reconcile.ts", import.meta.url), "utf8");
const handoffRoute = await readFile(new URL("../app/api/mobile-handoff/route.ts", import.meta.url), "utf8");
const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const mobileStub = await readFile(new URL("../../src-tauri/frontend-stub/index.html", import.meta.url), "utf8");
const tauriConfig = await readFile(new URL("../../src-tauri/tauri.conf.json", import.meta.url), "utf8");
const tauriLib = await readFile(new URL("../../src-tauri/src/lib.rs", import.meta.url), "utf8");

assert.match(topBar, /onOpenMobileHandoff/, "TopBar should accept a mobile handoff opener");
assert.match(topBar, /ph:device-mobile/, "TopBar should render a mobile-phone icon");
assert.match(topBar, /top-bar__mobile-handoff/, "TopBar handoff button should have a stable desktop-only class");
// The desktop sidebar no longer carries a phone-handoff button — the feature is
// reached from the (mobile) TopBar. The sidebar must not re-introduce it.
assert.doesNotMatch(sidebar, /onOpenMobileHandoff/, "Sidebar should not carry a mobile handoff button");
assert.doesNotMatch(sidebar, /Open on phone/, "Sidebar should not expose an Open-on-phone control");
assert.match(workspace, /MobileHandoffModal/, "Workspace should mount the mobile handoff modal");
assert.match(workspace, /readMobileModeEnabled, writeMobileModeEnabled/, "Workspace should use the shared canonical mobile preference adapter");
assert.match(workspace, /useState\(readMobileModeEnabled\)/, "Workspace should default mobile mode from persisted state");
assert.match(workspace, /writeMobileModeEnabled\(enabled\)/, "Workspace should persist mobile-mode changes through the canonical adapter");
assert.match(settings, /readMobileModeEnabled, writeMobileModeEnabled/, "Settings should share the same canonical mobile preference adapter");
assert.match(
  mobileModePref,
  /return readAppPreferences\(\)\.phone\.mobileMode/,
  "mobile mode reads the server-bootstrapped preference instead of the current origin",
);
assert.match(
  mobileModePref,
  /updateAppPreferences\(\{ phone: \{ mobileMode: enabled \} \}\)/,
  "mobile mode writes a typed patch to the canonical preference store",
);
assert.doesNotMatch(
  mobileModePref,
  /localStorage\.(?:getItem|setItem|removeItem)/,
  "the shared mobile-mode adapter must not treat one loopback origin as authority",
);
assert.match(mobileModeReconcile, /action: enabled \? "app-start" : "app-stop"/, "the shared reconciler should start or stop the native route from the desired state");
assert.match(workspace, /reconcileMobileModeRequest/, "Workspace should share the mobile-mode request circuit breaker");
assert.match(settings, /reconcileMobileModeRequest/, "Settings should share the mobile-mode request circuit breaker");
assert.match(mobileModeReconcile, /json\.unavailable === true \|\| response\.status === 503/, "current clean unavailability and legacy 503 responses block automatic retries");
assert.match(mobileModeReconcile, /options\?\.force/, "user Retry and toggle actions bypass the automatic circuit breaker");
assert.match(workspace, /mobileModeHost/, "Workspace should keep the current native app host returned by the route");
assert.match(workspace, /setMobileModeEnabled/, "Workspace should expose a way to toggle mobile mode from Settings");
assert.match(modal, /\/api\/mobile-handoff/, "Modal should call the mobile handoff API");
assert.match(modal, /dangerouslySetInnerHTML/, "Modal should render the QR SVG returned by the API");
assert.match(modal, /expiresAtIso/, "Modal should display the invite expiry");
assert.match(modal, /copyText\(/, "Modal should support copying the authenticated URL");
assert.match(modal, /autoCopyRequest/, "Modal should accept an auto-copy request from sidebar handoff");
assert.match(modal, /lastAutoCopyRequestRef/, "Modal should copy the invite only once per sidebar request");
assert.match(modal, /Copy invite/, "Modal should make the invite link copyable");
assert.match(modal, /nativeHost/, "Modal should understand the stable native app host returned by mobile mode");
assert.match(modal, /Copy host/, "Modal should make the stable native app host copyable");
assert.match(modal, /action: "app-start"/, "Modal should refresh native app mode without requiring an invite");
assert.match(modal, /handoff\?\.inviteUrl \|\| handoff\?\.url/, "Modal should prefer inviteUrl while supporting url fallback");
assert.match(modal, /mobile-handoff__link[\s\S]*href=\{handoff\.inviteUrl \|\| handoff\.url\}/, "Modal should display the invite link as a clickable link");
assert.match(css, /\.mobile-handoff__link/, "Invite link should have stable styling");
assert.match(modal, /action: "reset"/, "Modal should expose explicit Tailscale Serve reset");
// cave-i74f: the invite may carry a #chat-<id> fragment (Continue on phone),
// so the canonical field is the fragment-aware inviteUrl.
assert.match(handoffRoute, /const inviteUrl = withChatFragment\(invite\.url, chatId\);/, "the web invite rides the chat fragment when a handoff targets a conversation");
assert.match(handoffRoute, /inviteUrl,\r?\n\s*url: inviteUrl,/, "API should expose inviteUrl as the canonical invite field");
assert.match(handoffRoute, /appUrl: inviteUrl/, "API should keep appUrl as an inviteUrl alias for compatibility");
assert.match(handoffRoute, /action === "app-start"/, "API should expose a native app mobile-mode start action");
assert.match(handoffRoute, /action === "app-stop"/, "API should expose a native app mobile-mode stop action");
assert.match(handoffRoute, /nativeHost/, "API should return the exact host the native iOS app should connect to");
assert.match(handoffRoute, /nativeUrl/, "API should return the full Tailscale Serve URL for smoke checks and copying");
assert.match(handoffRoute, /ensureNativeAppServe/, "API should share one reconcile path for stale Tailscale Serve targets");
assert.match(handoffRoute, /nativeAppBackendUrl/, "native mobile mode should choose a backend separately from invite handoff");
assert.match(handoffRoute, /COVEN_CAVE_NATIVE_APP_BACKEND_URL/, "native mobile mode should allow an explicit loopback backend override");
// cave-gzje: the packaged bundle publishes ITS OWN sidecar and mints signed
// invites — it must not depend on a dev checkout's tokenless :3000 server.
assert.doesNotMatch(
  handoffRoute,
  /http:\/\/127\.0\.0\.1:3000/,
  "bundled app-start must not hard-depend on the dev checkout's tokenless :3000 server",
);
assert.match(handoffRoute, /function nativeTokenlessMode\(\)/, "the tokenless/invite trust decision should be a single named predicate");
assert.match(
  handoffRoute,
  /if \(!nativeTokenlessMode\(\)\) \{[\s\S]*?createMobileInvite\(\{[\s\S]*?accessSecret: mobileAccessSecret\(\),[\s\S]*?sidecarToken: process\.env\.COVEN_CAVE_AUTH_TOKEN/,
  "token-gated app-start mints the signed invite the packaged phone pairs with",
);
assert.match(
  handoffRoute,
  /qrTarget = withChatFragment\(invite\.url, chatId\)/,
  "the token-gated app-start QR is the SIGNED invite, still carrying the chat fragment",
);
assert.match(
  handoffRoute,
  /appInviteUrl: invite\.appInviteUrl/,
  "app-start returns the covencave:// deep link so the Copy-app-link button works",
);
assert.match(handoffRoute, /verifyNativeAppBackend/, "native mobile mode should verify the tokenless backend before publishing Serve");
assert.match(handoffRoute, /\/api\/familiars/, "native backend readiness should use the same lightweight endpoint as the iOS connection probe");
assert.match(handoffRoute, /pnpm mobile:tailscale:app/, "native backend readiness errors should point to the documented app-mode command");
assert.match(
  handoffRoute,
  /function trustedBackendPort\(\)[\s\S]*process\.env\.PORT \|\| "3000"/,
  "API should derive the backend port from the trusted sidecar PORT instead of the request Host",
);
assert.match(
  handoffRoute,
  /function rejectMismatchedHostPort[\s\S]*hostPort && hostPort !== expectedPort[\s\S]*status: 400/,
  "API should reject request Host ports that do not match the trusted sidecar port",
);
assert.match(
  handoffRoute,
  /const backend = backendUrl\(\)/,
  "API should build the backend URL without passing the request-derived URL into the backend target",
);
assert.doesNotMatch(
  handoffRoute,
  /const port = url\.port \|\| process\.env\.PORT/,
  "API must not use the request URL Host port as the backend Serve target",
);
assert.match(handoffRoute, /NODE_ENV !== "production"[\s\S]*pnpm mobile:tailscale/, "API should give an actionable dev hint when the access token is missing");
assert.match(
  handoffRoute,
  /async function ensureNativeAppServe[\s\S]*if \(!mobileAccessSecret\(\)\)[\s\S]*return mobileAccessUnavailableResponse\(\)/,
  "native app mobile-mode start must require the mobile access token before starting Tailscale Serve",
);
assert.match(settings, /MobileModeToggle/, "Settings should render a mobile mode toggle component");
assert.match(settings, /mobileModeEnabled/, "Settings should receive the live mobile mode enabled state");
assert.match(settings, /onMobileModeChange/, "Settings should expose a toggle callback for mobile mode");
assert.match(settings, /usePausablePoll\(\(\) => void reconcileMobileMode\(true\), 60_000, \{\s*enabled: mobileModeEnabled && !autoRetryBlocked,?\s*\}\)/, "Settings should stop automatic polling after a known prerequisite 503");
assert.match(settings, /Mobile mode/, "Settings should label the one-click native iOS route switch");
assert.doesNotMatch(settings, /CopyValue value="pnpm mobile:tailscale:app"/, "Settings should not require copying a terminal command for normal mobile mode");

// ── The pairing card (cave-rkiw): one scan, plain language, jargon demoted ──
assert.match(settings, /describeMobileHandoffError/, "Settings translates handoff failures into plain language");
assert.match(
  settings,
  /Pairing runs in the packaged Cave app/,
  "the plain-dev failure tells users to open the packaged app instead of quoting pnpm incantations",
);
assert.match(settings, /Technical details/, "the raw handoff error stays available behind a disclosure");

// ── Guided pairing checklist (cave-jr4r.1) ───────────────────────────────────
// The route reports its whole probe ladder as structured steps; the Phone
// card renders them instead of guessing which rung broke from one string.
assert.match(
  handoffRoute,
  /steps: buildPairingSteps\(\{\s*access: \{ ok: false, detail: error \}/,
  "a missing access token reports the ladder with the first rung failed",
);
assert.match(
  handoffRoute,
  /const tailscale = classifyTailscaleSelf\(self\);/,
  "the tailscale probe classifies BackendState (install vs start vs sign in)",
);
assert.match(
  handoffRoute,
  /route: \{ ok: false, detail: routeDetail \}/,
  "a dead tailnet route reports as the route rung, with the serve detail",
);
assert.match(
  handoffRoute,
  /phoneSeenAt: lastSeenAt,\s*\}\)/,
  "the success response carries the full ladder including the phone rung",
);
assert.match(settings, /aria-label="Pairing checklist"/, "the Phone card renders the ladder as a labelled checklist");
assert.match(
  settings,
  /PAIRING_STEP_GLYPH: Record<PairingStep\["state"\], \{ icon: IconName; className: string; announce: string \}>/,
  "each checklist state pairs an icon with screen-reader text — never color alone",
);
assert.match(
  settings,
  /mobileModeEnabled && friendly && error && !steps/,
  "the one-string friendly fallback only renders when the route couldn't report its ladder",
);
assert.match(
  settings,
  /text\.includes\("signed out"\)/,
  "the fallback vocabulary understands the signed-out failure the classifier can now surface",
);
assert.match(
  settings,
  /aria-label="Pairing code for your iPhone camera"[\s\S]{0,80}dangerouslySetInnerHTML=\{\{ __html: handoff\.qrSvg \}\}/,
  "Settings renders the pairing QR right in the phone section",
);
assert.match(settings, /Scan with your iPhone camera/, "the pairing card leads with the one-scan instruction");
assert.match(settings, /Manual setup/, "typing the address is demoted to a collapsed manual-setup path");
assert.doesNotMatch(
  settings,
  /Enter the address in the app/,
  "the four-step type-the-host walkthrough is retired from the section body",
);
assert.match(css, /\.mobile-handoff-qr/, "QR block should have stable layout CSS");
assert.match(css, /@media \(max-width: 1023px\)[\s\S]*\.top-bar__mobile-handoff[\s\S]*display: none/, "Phone handoff button should hide on mobile/tablet chrome");
assert.match(mobileStub, /Invite link or Tailscale URL/, "Mobile connection screen should label the real accepted input");
assert.doesNotMatch(mobileStub, /opencoven:\/\/connect/, "Mobile connection screen should not accept custom-scheme app links");
assert.doesNotMatch(mobileStub, /plugin:deep-link/, "Mobile connection screen should not consume native custom-scheme deep links");
assert.match(mobileStub, /Paste invite link/, "Mobile connection screen should make paste the fallback path");
assert.match(mobileStub, /id="clear-url"[\s\S]*hidden/, "Mobile connection screen should hide clear until a saved URL exists");
assert.doesNotMatch(tauriConfig, /"deep-link"[\s\S]*"scheme": \["opencoven"\]/, "iOS app should not register a custom app connect URL scheme");
assert.doesNotMatch(tauriLib, /tauri_plugin_deep_link::init/, "iOS shell should not install the deep-link plugin");

// Resilient handoff: when `tailscale serve --bg` fails (e.g. macOS "GUI failed
// to start, CLIError 3"), the route must NOT hard-fail. It should fall back to
// the MagicDNS host so the invite link + QR still generate, returning the serve
// error as a non-fatal warning instead.
assert.doesNotMatch(
  handoffRoute,
  /error: "failed to start tailscale serve"/,
  "serve --bg failure must not short-circuit the whole handoff",
);
assert.match(
  handoffRoute,
  /tailnetDiscoveryProof\(\{\s*selfStatus,\s*serveStatus,\s*backendUrl: backend\s*\}\)/,
  "route falls back through the shared Tailscale discovery proof when the serve config can't be read",
);
assert.match(
  handoffRoute,
  /nativeAppDiscoveryProof\(\{\s*selfStatus,\s*serveStatus,\s*backendUrl: backend\s*\}\)/,
  "native mobile mode should use a native-specific fallback when MagicDNS is unavailable",
);
assert.match(
  handoffRoute,
  /`--http=\$\{backendPort\(backend\)\}`/,
  "native mobile mode should ask Tailscale Serve for a plain HTTP port fallback",
);
assert.match(
  handoffRoute,
  /HTTP fallback failed:/,
  "native mobile mode should keep the HTTP Serve fallback stderr when that fallback fails",
);
assert.match(
  handoffRoute,
  /status", "--self", "--json"/,
  "route reads self status as JSON to source the MagicDNS fallback host",
);
assert.match(
  handoffRoute,
  /warning: serveWarning/,
  "route returns the serve-start failure as a non-fatal warning alongside the link",
);
assert.match(
  modal,
  /handoff\.warning \?\s*\(\s*<p className="mobile-handoff__warning">\{handoff\.warning\}/,
  "modal shows the non-fatal warning while still rendering the link and QR",
);
assert.match(css, /\.mobile-handoff__warning/, "the non-fatal warning has stable styling");

console.log("mobile-handoff.test.ts OK");
