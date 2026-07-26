import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// The native connect screen is the first-run experience. Keep it pairing-first:
// a scan-first hierarchy (one prominent Scan QR Code action, manual entry folded
// behind a link), a branded hero, a distinct pairing-required recovery callout,
// and a trust footer that keeps the private Tailscale path explicit.

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");
const src = await read("apps/ios/CovenCave/CovenCave/Views/ConnectionView.swift");

// --- Scan-first hierarchy: scan hero leads, manual entry folds behind a link --
assert.match(
  src,
  /if scannerAvailable \{\s*scanHeroButton\s*\}/,
  "the scan action should lead whenever the camera is available",
);
assert.match(
  src,
  /if manualEntry \|\| !scannerAvailable \{[\s\S]*?manualSection[\s\S]*?\} else \{\s*manualEntryLink\s*\}/,
  "manual entry should stay folded behind a link until asked for (or no camera)",
);
assert.match(
  src,
  /Text\("Enter address manually"\)/,
  "manual entry stays discoverable under the scan hero",
);

assert.match(
  src,
  /private var glyph: some View \{[\s\S]*?appMark/,
  "hero should carry the branded app mark",
);
assert.match(
  src,
  /UIImage\(named: "AppIcon"\)[\s\S]*?Image\(systemName: "moon\.stars\.fill"\)/,
  "the app mark prefers the real icon and falls back to a themed symbol",
);

assert.match(
  src,
  /private var manualSection: some View \{[\s\S]*?Text\("MagicDNS name or address"\)[\s\S]*?TextField\("my-mac\.example\.ts\.net", text: \$host\)/,
  "address section should use concise MagicDNS labeling with a concrete placeholder",
);

assert.match(
  src,
  /else if case \.needsAuth\(let message\) = app\.connectionState \{[\s\S]*?title: "Pairing needed"[\s\S]*?Open Cave on your desktop and scan the latest QR code/,
  "pairing-required state should render as a clear recovery callout",
);

assert.match(
  src,
  /if case \.unreachable\(let diagnosis\) = app\.connectionState \{[\s\S]*?connectionRecoveryCallout\(\s*title: diagnosis\.title,\s*message: diagnosis\.message,\s*guidance: diagnosis\.guidance,\s*systemImage: diagnosis\.systemImage\s*\)/,
  "unreachable state should render the classified diagnosis (DNS vs refused vs timeout…), not one generic message",
);

// The unclassified fallback keeps the original Tailscale-first guidance.
const diagnosisSrc = await read("apps/ios/CovenCave/CovenCave/State/ConnectionDiagnosis.swift");
assert.match(
  diagnosisSrc,
  /static let generic = ConnectionDiagnosis\(\s*title: "Tailscale disconnected\?"[\s\S]*?guidance: "Open Tailscale on this phone and make sure it says Connected/,
  "the unclassified fallback still points at Tailscale before asking the user to re-pair",
);

assert.match(
  src,
  /else if case \.needsAuth\(let message\) = app\.connectionState \{[\s\S]*?connectionRecoveryCallout\(\s*title: "Pairing needed",[\s\S]*?guidance: "Open Cave on your desktop and scan the latest QR code/,
  "auth failures should keep the pairing-needed QR guidance",
);

assert.match(
  src,
  /Label\(\s*busy \? "Connecting…" : "Connect",\s*systemImage: busy \? "arrow\.triangle\.2\.circlepath" : "bolt\.horizontal\.circle\.fill"\s*\)/,
  "primary action should read as a connect, with a spinner glyph while busy",
);

assert.match(
  src,
  /Label\("Scan QR Code", systemImage: "qrcode\.viewfinder"\)/,
  "the scan hero action names the QR path",
);

assert.match(
  src,
  /private var trustFooter: some View \{[\s\S]*?Label\("Private & encrypted", systemImage: "lock\.fill"\)[\s\S]*?Traffic stays on your Tailscale network/,
  "trust footer should summarize the private encrypted path",
);

// --- The hero actions are real buttons wired to real flows --------------------
assert.match(
  src,
  /private var scanHeroButton: some View \{\s*Button \{\s*showScanner = true/,
  "the scan hero opens the QR scanner",
);
assert.match(
  src,
  /private var manualEntryLink: some View \{\s*Button \{\s*manualEntry = true\s*focused = true/,
  "the manual-entry link reveals the address field and focuses it",
);
assert.match(
  src,
  /Button\(action: pasteHost\) \{\s*Label\("Paste", systemImage: "doc\.on\.clipboard"\)/,
  "the paste affordance invokes the paste flow",
);
assert.match(
  src,
  /Button\(action: connect\) \{/,
  "the Connect button invokes connect",
);

// --- Connected moment ----------------------------------------------------------
assert.match(
  src,
  /if app\.connectionState == \.connected \{ Haptics\.success\(\) \}/,
  "a successful connect lands with success haptics",
);
assert.match(
  src,
  /\.animation\(reduceMotion \? nil : \.spring\(duration: 0\.32\), value: liveCheck\)/,
  "state-change springs respect Reduce Motion",
);

// The brief "Connected" confirmation lives in RootView, over the freshly
// mounted tabs — the swap is no longer an abrupt teleport.
const root = await read("apps/ios/CovenCave/CovenCave/Views/RootView.swift");
assert.match(
  root,
  /private struct ConnectedMomentOverlay: View \{[\s\S]*?Label\("Connected", systemImage: "checkmark\.circle\.fill"\)/,
  "a Connected confirmation chip appears when the connection lands",
);
assert.match(
  root,
  /\.task\(id: app\.connectedAt\) \{[\s\S]*?timeIntervalSince\(connectedAt\) < 3/,
  "the confirmation only fires for a connection that landed just now, not warm launches",
);
assert.match(
  root,
  /ConnectedMomentOverlay\(\)/,
  "RootView mounts the connected-moment overlay",
);

console.log("ios-connect-screen-ux: OK");
