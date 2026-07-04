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
  /private func connectionRecoveryCallout\(message: String, systemImage: String\) -> some View \{[\s\S]*?Open Cave on your desktop and scan the latest QR code/,
  "pairing-required state should render as a clear recovery callout",
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

console.log("ios-connect-screen-ux: OK");
