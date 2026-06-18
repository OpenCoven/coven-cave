import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const topBar = await readFile(new URL("./top-bar.tsx", import.meta.url), "utf8");
const workspace = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");
const sidebar = await readFile(new URL("./sidebar-minimal.tsx", import.meta.url), "utf8");
const modal = await readFile(new URL("./mobile-handoff-modal.tsx", import.meta.url), "utf8");
const handoffRoute = await readFile(new URL("../app/api/mobile-handoff/route.ts", import.meta.url), "utf8");
const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const mobileStub = await readFile(new URL("../../src-tauri/frontend-stub/index.html", import.meta.url), "utf8");
const tauriConfig = await readFile(new URL("../../src-tauri/tauri.conf.json", import.meta.url), "utf8");
const tauriLib = await readFile(new URL("../../src-tauri/src/lib.rs", import.meta.url), "utf8");

assert.match(topBar, /onOpenMobileHandoff/, "TopBar should accept a mobile handoff opener");
assert.match(topBar, /ph:device-mobile/, "TopBar should render a mobile-phone icon");
assert.match(topBar, /top-bar__mobile-handoff/, "TopBar handoff button should have a stable desktop-only class");
assert.match(sidebar, /onOpenMobileHandoff/, "Sidebar should accept a mobile handoff opener");
assert.match(sidebar, /aria-label="Open on phone"/, "Sidebar should expose the phone handoff as an icon button");
assert.match(sidebar, /ph:device-mobile/, "Sidebar should render the mobile-phone handoff icon");
assert.match(workspace, /MobileHandoffModal/, "Workspace should mount the mobile handoff modal");
assert.match(workspace, /setMobileHandoffCopyRequest\(\(value\) => value \+ 1\)/, "Sidebar handoff trigger should request invite copy");
assert.match(workspace, /autoCopyRequest=\{mobileHandoffCopyRequest\}/, "Workspace should pass sidebar copy intent into the modal");
assert.match(modal, /\/api\/mobile-handoff/, "Modal should call the mobile handoff API");
assert.match(modal, /dangerouslySetInnerHTML/, "Modal should render the QR SVG returned by the API");
assert.match(modal, /expiresAtIso/, "Modal should display the invite expiry");
assert.match(modal, /copyText\(/, "Modal should support copying the authenticated URL");
assert.match(modal, /autoCopyRequest/, "Modal should accept an auto-copy request from sidebar handoff");
assert.match(modal, /lastAutoCopyRequestRef/, "Modal should copy the invite only once per sidebar request");
assert.match(modal, /Copy invite/, "Modal should make the invite link copyable");
assert.match(modal, /handoff\?\.inviteUrl \|\| handoff\?\.url/, "Modal should prefer inviteUrl while supporting url fallback");
assert.match(modal, /mobile-handoff__link[\s\S]*href=\{handoff\.inviteUrl \|\| handoff\.url\}/, "Modal should display the invite link as a clickable link");
assert.match(css, /\.mobile-handoff__link/, "Invite link should have stable styling");
assert.match(modal, /action: "reset"/, "Modal should expose explicit Tailscale Serve reset");
assert.match(handoffRoute, /inviteUrl: invite\.url/, "API should expose inviteUrl as the canonical invite field");
assert.match(handoffRoute, /appUrl: invite\.url/, "API should keep appUrl as an inviteUrl alias for compatibility");
assert.match(handoffRoute, /NODE_ENV !== "production"[\s\S]*pnpm mobile:tailscale/, "API should give an actionable dev hint when the access token is missing");
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
  /magicDnsServeUrl\(selfStatus\)/,
  "route falls back to the MagicDNS host when the serve config can't be read",
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
