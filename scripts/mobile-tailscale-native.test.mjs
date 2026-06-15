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
assert.match(infoPlist, /<key>ITSAppUsesNonExemptEncryption<\/key>\s*<false\/>/);
assert.match(
  infoPlist,
  /<key>CFBundleURLTypes<\/key>\s*<array>[\s\S]*<key>CFBundleURLSchemes<\/key>\s*<array>[\s\S]*<string>opencoven<\/string>[\s\S]*<\/array>[\s\S]*<\/array>/,
  "iOS Info.plist should register the opencoven URL scheme",
);

const sourceInfoPlist = read("src-tauri/Info.ios.plist");
assert.equal(sourceInfoPlist.trimEnd(), infoPlist.trimEnd());

const entitlements = read("src-tauri/gen/apple/app_iOS/app_iOS.entitlements");
assert.match(entitlements, /com\.apple\.developer\.networking\.wifi-info/);

const libRs = read("src-tauri/src/lib.rs");
assert.match(libRs, /CAVE_MOBILE_DEV_URL/);
assert.match(libRs, /\.ts\.net/);
assert.match(libRs, /WebviewUrl::External/);
assert.match(libRs, /127\.0\.0\.1/);
assert.match(libRs, /cfg!\(debug_assertions\)/);
assert.match(libRs, /WebviewUrl::App\("index\.html"\.into\(\)\)/);

const frontendStub = read("src-tauri/frontend-stub/index.html");
assert.match(frontendStub, /Connect to CovenCave/);
assert.match(frontendStub, /coven-cave:mobile-server-url/);
assert.match(frontendStub, /window\.location\.assign/);
assert.doesNotMatch(frontendStub, /Loading CovenCave/);

const mobileScript = read("scripts/mobile-tailscale.sh");
assert.match(mobileScript, /native_command\(\)/);
assert.match(mobileScript, /CAVE_MOBILE_NATIVE=1 start_next_server/);
assert.match(mobileScript, /create_invite/);
assert.match(mobileScript, /CAVE_MOBILE_DEV_URL="\$\(cat "\$INVITE_FILE"\)"/);
assert.doesNotMatch(mobileScript, /unset COVEN_CAVE_ACCESS_TOKEN/);
assert.doesNotMatch(mobileScript, /env -u COVEN_CAVE_ACCESS_TOKEN/);
assert.match(mobileScript, /tauri ios dev/);

assert.equal(
  packageJson.scripts["mobile:tailscale:native"],
  "bash scripts/mobile-tailscale.sh native",
);
