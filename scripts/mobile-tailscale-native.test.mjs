import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const packageJson = JSON.parse(read("package.json"));

const infoPlist = read("src-tauri/gen/apple/app_iOS/Info.plist");
assert.match(infoPlist, /<key>NSLocalNetworkUsageDescription<\/key>/);
assert.match(infoPlist, /CovenCave connects to your private Tailscale network/);
assert.match(infoPlist, /<key>NSBonjourServices<\/key>/);
assert.match(infoPlist, /<string>_tailscale\._tcp<\/string>/);
assert.match(infoPlist, /<string>_tailscale\._udp<\/string>/);
assert.match(infoPlist, /<key>NSAllowsArbitraryLoads<\/key>\s*<false\/>/);

const sourceInfoPlist = read("src-tauri/Info.ios.plist");
assert.equal(sourceInfoPlist.trimEnd(), infoPlist.trimEnd());

const entitlements = read("src-tauri/gen/apple/app_iOS/app_iOS.entitlements");
assert.match(entitlements, /com\.apple\.developer\.networking\.wifi-info/);

const libRs = read("src-tauri/src/lib.rs");
assert.match(libRs, /CAVE_MOBILE_DEV_URL/);
assert.match(libRs, /\.ts\.net/);
assert.match(libRs, /WebviewUrl::External/);
assert.match(libRs, /127\.0\.0\.1/);

const mobileScript = read("scripts/mobile-tailscale.sh");
assert.match(mobileScript, /native_command\(\)/);
assert.match(mobileScript, /HOME\/\.cargo\/bin/);
assert.match(mobileScript, /ios\s+dev\s+--no-dev-server-wait/);
assert.match(mobileScript, /--no-dev-server-wait/);
assert.match(mobileScript, /beforeDevCommand/);
assert.match(mobileScript, /const devUrl = process\.argv\[2\]/);
assert.match(mobileScript, /"\$tauri_config"/);
assert.match(mobileScript, /resolve_ios_device_name/);
assert.match(mobileScript, /pnpm exec tauri "\$\{tauri_args\[@\]\}"/);
assert.doesNotMatch(mobileScript, /tauri ios dev --device/);

// Native mode mints a per-launch sidecar auth token (COVEN_CAVE_AUTH_TOKEN) and
// authenticates the in-app webview, instead of running fully ungated. This is
// what satisfies the in-app SidecarAuthMonitor and gates /api/ over Tailscale.
assert.match(mobileScript, /SIDECAR_TOKEN_FILE=/);
assert.match(mobileScript, /load_or_create_sidecar_token\(\)/);
// The native server is now started WITH the sidecar auth token set (the old
// behavior unset both token vars together).
assert.match(mobileScript, /COVEN_CAVE_AUTH_TOKEN/);
assert.doesNotMatch(mobileScript, /unset COVEN_CAVE_ACCESS_TOKEN COVEN_CAVE_AUTH_TOKEN/);
assert.doesNotMatch(mobileScript, /-u COVEN_CAVE_ACCESS_TOKEN -u COVEN_CAVE_AUTH_TOKEN/);
// The dev URL handed to the webview carries the token so SidecarAuthBridge
// stores it and authenticates every /api/ request.
assert.match(mobileScript, /covenCaveToken/);
// The mobile access secret stays unset in native mode (Tailscale Serve proxies
// to loopback, so the host gate already passes without it).
assert.match(mobileScript, /unset COVEN_CAVE_ACCESS_TOKEN;/);

assert.equal(
  packageJson.scripts["mobile:tailscale:native"],
  "bash scripts/mobile-tailscale.sh native",
);
