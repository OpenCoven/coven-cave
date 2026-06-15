import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const topBar = await readFile(new URL("./top-bar.tsx", import.meta.url), "utf8");
const workspace = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");
const modal = await readFile(new URL("./mobile-handoff-modal.tsx", import.meta.url), "utf8");
const handoffRoute = await readFile(new URL("../app/api/mobile-handoff/route.ts", import.meta.url), "utf8");
const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const mobileStub = await readFile(new URL("../../src-tauri/frontend-stub/index.html", import.meta.url), "utf8");
const tauriConfig = await readFile(new URL("../../src-tauri/tauri.conf.json", import.meta.url), "utf8");
const tauriLib = await readFile(new URL("../../src-tauri/src/lib.rs", import.meta.url), "utf8");

assert.match(topBar, /onOpenMobileHandoff/, "TopBar should accept a mobile handoff opener");
assert.match(topBar, /ph:phone/, "TopBar should render a recognizable phone icon");
assert.match(topBar, /top-bar__mobile-handoff/, "TopBar handoff button should have a stable desktop-only class");
assert.match(workspace, /MobileHandoffModal/, "Workspace should mount the mobile handoff modal");
assert.match(modal, /\/api\/mobile-handoff/, "Modal should call the mobile handoff API");
assert.match(modal, /dangerouslySetInnerHTML/, "Modal should render the QR SVG returned by the API");
assert.match(modal, /expiresAtIso/, "Modal should display the invite expiry");
assert.match(modal, /navigator\.clipboard\.writeText/, "Modal should support copying the authenticated URL");
assert.match(modal, /Copy invite/, "Modal should make the invite link copyable");
assert.match(modal, /handoff\?\.inviteUrl \|\| handoff\?\.url/, "Modal should prefer inviteUrl while supporting url fallback");
assert.match(modal, /action: "reset"/, "Modal should expose explicit Tailscale Serve reset");
assert.match(handoffRoute, /inviteUrl: invite\.url/, "API should expose inviteUrl as the canonical invite field");
assert.match(handoffRoute, /appUrl: invite\.url/, "API should keep appUrl as an inviteUrl alias for compatibility");
assert.match(css, /\.mobile-handoff-qr/, "QR block should have stable layout CSS");
assert.match(css, /@media \(max-width: 1023px\)[\s\S]*\.top-bar__mobile-handoff[\s\S]*display: none/, "Phone handoff button should hide on mobile/tablet chrome");
assert.match(mobileStub, /Invite link or Tailscale URL/, "Mobile connection screen should label the real accepted input");
assert.doesNotMatch(mobileStub, /opencoven:\/\/connect/, "Mobile connection screen should not accept custom-scheme app links");
assert.doesNotMatch(mobileStub, /plugin:deep-link/, "Mobile connection screen should not consume native custom-scheme deep links");
assert.match(mobileStub, /Paste invite link/, "Mobile connection screen should make paste the fallback path");
assert.match(mobileStub, /id="clear-url"[\s\S]*hidden/, "Mobile connection screen should hide clear until a saved URL exists");
assert.doesNotMatch(tauriConfig, /"deep-link"[\s\S]*"scheme": \["opencoven"\]/, "iOS app should not register a custom app connect URL scheme");
assert.doesNotMatch(tauriLib, /tauri_plugin_deep_link::init/, "iOS shell should not install the deep-link plugin");

console.log("mobile-handoff.test.ts OK");
