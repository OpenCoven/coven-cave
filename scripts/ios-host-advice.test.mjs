import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Smart address advice on the iOS connect screen: dead-end addresses
// (loopback, LAN-only, .local mDNS) get a specific, actionable nudge BEFORE a
// doomed probe — instead of the generic unreachable shrug afterwards. The
// advice is advisory only; Connect never gets disabled by it.

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");
const advice = await read("apps/ios/CovenCave/CovenCave/Networking/CaveHostAdvice.swift");
const view = await read("apps/ios/CovenCave/CovenCave/Views/ConnectionView.swift");

// --- Classifier cases ---------------------------------------------------------
assert.match(
  advice,
  /enum CaveHostAdvice: Equatable \{[\s\S]*?case hasSpace[\s\S]*?case loopback[\s\S]*?case lanAddress[\s\S]*?case mdnsLocal/,
  "classifier covers stray spaces, loopback, LAN addresses, and .local names",
);
assert.match(
  advice,
  /static func evaluate\(_ input: String\) -> CaveHostAdvice\?/,
  "single evaluate() entry point returns nil for clean addresses",
);

// --- Loopback: this phone, not the desktop -------------------------------------
assert.match(
  advice,
  /case \.loopback:[\s\S]*?this phone, not your desktop/,
  "loopback advice explains the address points at the phone itself",
);
assert.match(
  advice,
  /100\.x or \*\.ts\.net/,
  "loopback advice points at the Tailscale address as the fix",
);

// --- LAN: same-Wi-Fi only — prefer the tailnet ---------------------------------
assert.match(
  advice,
  /case \.lanAddress:[\s\S]*?both devices share a network/,
  "LAN advice explains the same-network limitation",
);
assert.match(
  advice,
  /isPrivateLANAddress/,
  "RFC1918 detection is a named, testable helper",
);
// Tailscale's CGNAT range (100.64.0.0/10) is the GOOD case — it must never be
// classified as a LAN address.
assert.match(
  advice,
  /100\.64\.0\.0\/10|first == 100/,
  "the classifier explicitly reasons about Tailscale's 100.64.0.0/10 space",
);

// --- Wiring: ConnectionView delegates, simulator keeps its dev loopback --------
assert.match(
  view,
  /private var hostAdvice: CaveHostAdvice\? \{[\s\S]*?CaveHostAdvice\.evaluate\(host\)/,
  "ConnectionView delegates hint classification to CaveHostAdvice",
);
assert.match(
  view,
  /#if targetEnvironment\(simulator\)[\s\S]*?\.loopback \{ return nil \}[\s\S]*?#endif/,
  "the loopback warning is suppressed on the simulator — loopback IS the dev desktop there",
);
assert.match(
  view,
  /private var hostHint: String\? \{ hostAdvice\?\.message \}/,
  "the field hint renders the classifier's message",
);

console.log("ios-host-advice: OK");
