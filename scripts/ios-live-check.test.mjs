import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Live reachability preview on the iOS connect screen: as the user edits the
// address, a debounced, single-flight, credential-free probe reports
// "Desktop found" / a classified failure under the field — the first signal
// no longer waits for a failed Connect. Purely advisory: never auto-connects,
// never persists, never sends the stored token at a user-typed host.

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");
const view = await read("apps/ios/CovenCave/CovenCave/Views/ConnectionView.swift");
const model = await read("apps/ios/CovenCave/CovenCave/State/AppModel.swift");

// --- Debounce + cancel-on-edit lifecycle ---------------------------------------
assert.match(
  view,
  /\.task\(id: host\) \{\s*await runLiveCheck\(\)\s*\}/,
  "the preview re-keys on every edit — SwiftUI cancels the in-flight run (single-flight by construction)",
);
assert.match(
  view,
  /try\? await Task\.sleep\(for: \.milliseconds\(800\)\)/,
  "an ~800ms debounce coalesces keystrokes before probing",
);
assert.match(
  view,
  /guard !Task\.isCancelled, !busy, scenePhase == \.active else \{ return \}/,
  "a superseded or backgrounded check never mutates state",
);

// --- Suppression: only probe when a preview is actually useful ------------------
assert.match(
  view,
  /guard !busy, scenePhase == \.active, hostPresent, hostAdvice == nil else \{ return \}/,
  "suppressed while connecting, backgrounded, empty, or already flagged by address advice",
);
assert.match(
  view,
  /guard let invite = CaveInvite\.parse\(cleanHost\(host\)\), invite\.token == nil else \{ return \}/,
  "credential-carrying invites auto-connect via apply() — no preview probe for them",
);

// --- Advisory only: never connects, never persists ------------------------------
const liveCheckBody = view.slice(view.indexOf("private func runLiveCheck()"));
assert.ok(
  !liveCheckBody.slice(0, liveCheckBody.indexOf("\n    }")).includes("app.configure"),
  "the preview never auto-connects",
);
assert.match(
  view,
  /enum LiveCheckState: Equatable \{[\s\S]*?case idle[\s\S]*?case checking[\s\S]*?case found\(port: Int\?\)[\s\S]*?case pairingRequired[\s\S]*?case failed\(ProbeFailure\?\)/,
  "preview states cover checking/found/pairing-required/classified-failure",
);

// --- Status row copy -------------------------------------------------------------
assert.match(
  view,
  /Desktop found · responding on :\\\(\$0\)/,
  "success names the discovered port",
);
assert.match(
  view,
  /Desktop found — pairing needed\. Connect will walk you through it\./,
  "a token-gated desktop reads as found-but-pairing-required, not as a failure",
);
assert.match(
  view,
  /failure\.map\(\\\.previewLine\)/,
  "failures render the classified one-line story (DNS vs refused vs timeout…)",
);

// --- Credential safety: the preview sweep never sends the stored token ----------
assert.match(
  model,
  /static func previewDiscoverBaseURL\(_ candidates: \[URL\]\) async -> DiscoveryOutcome \{[\s\S]*?probe\(base, sendCredential: false\)/,
  "the preview sweep probes credential-free",
);
assert.match(
  model,
  /private static func probe\(_ base: URL, sendCredential: Bool = true\) async -> ProbeResult/,
  "probe() defaults to sending the credential so the paired discovery path is unchanged",
);
assert.match(
  model,
  /if sendCredential, let token = CaveConnection\.accessToken \{/,
  "the Authorization header is gated on sendCredential",
);

console.log("ios-live-check: OK");
