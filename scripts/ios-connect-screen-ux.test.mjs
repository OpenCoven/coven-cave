import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// The native connect screen is the first-run experience. Keep it pairing-first:
// scan/paste/connect guidance, a branded hero, a distinct pairing-required
// recovery callout, and a trust footer that makes the private Tailscale path
// explicit.

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");
const src = await read("apps/ios/CovenCave/CovenCave/Views/ConnectionView.swift");

assert.match(
  src,
  /private var pairingSteps: some View \{[\s\S]*?Scan[\s\S]*?Paste[\s\S]*?Connect/,
  "connect screen should show the scan/paste/connect path as a compact step guide",
);

assert.match(
  src,
  /private var heroBadge: some View \{[\s\S]*?Image\(systemName: "cat\.fill"\)[\s\S]*?Image\(systemName: "wifi"\)/,
  "hero should pair the familiar mark with a network signal cue",
);

assert.match(
  src,
  /private var addressField: some View \{[\s\S]*?Text\("Desktop"\)[\s\S]*?Text\("Tailscale address or invite link"\)/,
  "address section should use concise desktop/invite labeling",
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
  /Label\(busy \? "Connecting…" : "Connect desktop", systemImage: busy \? "arrow\.triangle\.2\.circlepath" : "bolt\.horizontal\.circle\.fill"\)/,
  "primary action should read as connecting the desktop, not a generic form submit",
);

assert.match(
  src,
  /Label\("Scan QR", systemImage: "qrcode\.viewfinder"\)/,
  "secondary scan action should stay short enough for mobile buttons",
);

assert.match(
  src,
  /private var trustNote: some View \{[\s\S]*?Private Tailscale mesh[\s\S]*?No public internet exposure/,
  "trust footer should summarize the private encrypted path with scannable labels",
);

// --- The step chips are real buttons wired to real actions --------------------
assert.match(
  src,
  /stepChip\(\s*"Scan"[\s\S]*?\) \{ showScanner = true \}/,
  "Scan chip opens the QR scanner",
);
assert.match(
  src,
  /stepChip\(\s*"Paste"[\s\S]*?\) \{ pasteHost\(\) \}/,
  "Paste chip invokes the paste flow",
);
assert.match(
  src,
  /stepChip\(\s*"Connect"[\s\S]*?\) \{ connect\(\) \}/,
  "Connect chip invokes connect",
);
assert.match(
  src,
  /private func stepChip\([\s\S]*?action: @escaping \(\) -> Void\s*\) -> some View \{\s*Button\(action: action\)/,
  "chips are Buttons with accessibility hints, not decorative labels",
);
assert.match(
  src,
  /private var connectStep: StepState \{\s*if app\.connectionState == \.connected \{ return \.done \}/,
  "the Connect chip reflects the live connection state (done once connected)",
);
assert.match(
  src,
  /state == \.done \? "checkmark\.circle\.fill" : systemImage/,
  "completed steps swap to a checkmark",
);

// --- Scan-first hierarchy + connected moment -----------------------------------
assert.match(
  src,
  /private var scanFirst: Bool \{\s*QRScannerSheet\.isSupported && !hostPresent\s*\}/,
  "camera-first: scanning leads while no address exists yet",
);
assert.match(
  src,
  /or enter the address manually/,
  "manual entry stays discoverable under the scan hero",
);
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
