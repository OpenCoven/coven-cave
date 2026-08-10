import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Connection seamlessness + stability (cave-30b). The app should hold one
// warm connection, survive long streams and transient drops, discover the
// desktop fast, and heal itself when the desktop restarts or moves — without
// the user touching anything.

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");
const client = await read("apps/ios/CovenCave/CovenCave/Networking/CaveClient.swift");
const devClient = await read("apps/ios/CovenCave/CovenCave/Networking/CaveClient+Dev.swift");
const connection = await read("apps/ios/CovenCave/CovenCave/Networking/CaveConnection.swift");
const terminal = await read("apps/ios/CovenCave/CovenCave/Networking/PtyTerminal.swift");
const model = await read("apps/ios/CovenCave/CovenCave/State/AppModel.swift");
const thread = await read("apps/ios/CovenCave/CovenCave/State/ChatThread.swift");
const app = await read("apps/ios/CovenCave/CovenCave/CovenCaveApp.swift");
const rootView = await read("apps/ios/CovenCave/CovenCave/Views/RootView.swift");
const connectView = await read("apps/ios/CovenCave/CovenCave/Views/ConnectionView.swift");

// --- Shared URLSessions: sessions are never deallocated, so per-request
// construction leaked them and re-negotiated TLS on every call ---------------
assert.match(
  client,
  /private static let restSession: URLSession = \{/,
  "CaveClient should hold ONE shared REST session",
);
assert.match(
  client,
  /private var session: URLSession \{ Self\.restSession \}/,
  "requests should route through the shared REST session",
);
assert.match(
  devClient,
  /data\(for: request\)/,
  "dev-tab calls should reuse the core shared REST session",
);
assert.doesNotMatch(
  devClient,
  /URLSessionConfiguration|URLSession\(/,
  "dev-tab calls should not allocate a separate session",
);
assert.match(
  terminal,
  /private static let wsSession = URLSession\(configuration: \.default\)/,
  "PTY websockets should come from one shared session",
);
assert.match(
  model,
  /private static let probeSession: URLSession = \{/,
  "discovery probes should share one ephemeral session",
);

// --- Streaming must NOT ride a session whose resource timeout caps the whole
// transfer — the old 60s cap killed any reply that streamed longer ----------
assert.match(
  client,
  /private static let streamSession: URLSession = \{[\s\S]*?timeoutIntervalForResource = 24 \* 3600/,
  "SSE streams need a day-long resource window (resource timeout caps the WHOLE transfer)",
);
assert.match(
  client,
  /Self\.streamSession\.bytes\(for: req\)/,
  "sendStream should use the dedicated streaming session",
);
assert.doesNotMatch(
  client,
  /timeoutIntervalForResource = 60\b/,
  "no 60s resource cap may return — it killed replies that streamed past a minute",
);

// --- Shared Projects request carries the paired credential ------------------
assert.match(
  devClient,
  /func projects[\s\S]*?if let token = try CaveConnection\.credentialForRequest\(to: url\) \{\s*\n\s*request\.setValue\("Bearer \\\(token\)", forHTTPHeaderField: "Authorization"\)/,
  "project requests must send only an origin-bound credential",
);

// --- Discovery: credential-safe probes, ordered adjudication, 401 terminal -
assert.match(
  model,
  /if CaveConnection\.accessToken != nil \{\s*\n\s*return await discoverBaseURLSequentially\(rest, seededWith: strongest\)/,
  "paired discovery must probe sequentially so Bearer tokens are not sent to speculative sibling ports",
);
assert.match(
  model,
  /let results = await withTaskGroup/,
  "unpaired discovery can still probe concurrently (wall-clock = one probe, not the sum)",
);
assert.match(
  model,
  /private static func adjudicateDiscoveryResults[\s\S]*?for \(index, result\) in results\.enumerated\(\)[\s\S]*?case \.ok: return \.found\(candidates\[index\]\)[\s\S]*?case \.unauthorized: return \.unauthorized/,
  "results must be adjudicated in candidate order with 401/403 still terminal (sibling-port safety)",
);

// --- Relocation keeps discovery alive --------------------------------------
assert.match(
  model,
  /static func canonicalHost\(for url: URL\) -> String/,
  "relocation should persist a canonical host",
);
assert.match(
  model,
  /CaveConnection\(host: Self\.canonicalHost\(for: working\)\)/,
  "relocation must store host:port (not a pinned explicit URL) when the scheme is derivable",
);
assert.match(
  connection,
  /let hostPart = trimmed\.split\(separator: ":"\)\.first[\s\S]*?hostPart\.lowercased\(\)\.hasSuffix\("\.ts\.net"\)/,
  "a .ts.net host WITH a port must still derive https (tailscale serve terminates TLS on :8443)",
);

// --- Self-healing: transport failures while "connected" trigger recovery ----
assert.match(
  model,
  /func handleSurfaceError[\s\S]*?else if connectionState == \.connected \{\s*\n\s*scheduleAutoRecover\(\)/,
  "a surface failure while connected should schedule background recovery",
);
assert.match(
  model,
  /func scheduleAutoRecover\(\)[\s\S]*?cooldown[\s\S]*?recoverConnectionInBackground\(\)/,
  "auto-recovery must be cooldown-bounded so cascading failures fold into one probe",
);
assert.match(
  model,
  /func validateConnectionOnForeground\(\) async[\s\S]*?client\.ping\(\)[\s\S]*?connectWithRetry\(\)/,
  "foregrounding while nominally connected should revalidate with one cheap probe",
);
assert.match(
  app,
  /else if app\.connectionState == \.connected \{\s*\n\s*Task \{ await app\.validateConnectionOnForeground\(\) \}/,
  "the app should validate a stale connected state on foreground",
);
assert.match(
  rootView,
  /case \.connected:[\s\S]*?connectedTicks >= 6[\s\S]*?maintainConnectionWhileActive\(\)/,
  "a long-lived active app should validate a nominally connected desktop once a minute",
);
assert.match(
  model,
  /func maintainConnectionWhileActive\(\) async[\s\S]*?validateCurrentConnection\(refreshProfile: false\)/,
  "the active heartbeat should use the shared connection validation path without reloading profile data",
);

// --- Quiet retry: the unreachable screen re-probes without UI bouncing ------
assert.match(
  model,
  /func refreshConnection\(reloadLoadedSurfaces: Bool = false, quiet: Bool = false\) async \{[\s\S]*?if !quiet \{ connectionState = \.checking \}/,
  "quiet refresh must not flip the state to .checking before it has an outcome",
);
assert.match(
  connectView,
  /case \.unreachable = app\.connectionState else \{ continue \}\s*\n\s*await app\.refreshConnection\(reloadLoadedSurfaces: true, quiet: true\)/,
  "the unreachable screen should quietly auto-retry so a returning desktop reconnects on its own",
);

// --- Chat stream interruption: recover the persisted turn, not a raw error --
assert.match(
  thread,
  /catch \{[\s\S]*?if serverError\?\.isDefinitiveServerResponse != true \{[\s\S]*?resumeInterruptedStream\([\s\S]*?resyncInterruptedTurn\(\s*familiarId: familiarId,\s*prompt: prompt/,
  "a transport failure mid-stream should try resume and persisted-turn resync before surfacing an error",
);
assert.match(
  thread,
  /func resyncInterruptedTurn[\s\S]*?convo\.turns\[lastUser\]\.text == prompt[\s\S]*?reply\.text\.hasPrefix\(streamed\)/,
  "resync must anchor on our own prompt and only extend what already streamed (never adopt an older reply)",
);

// --- Terminal: transient drops auto-reconnect within the server's grace -----
assert.match(
  terminal,
  /private static let maxAutoReconnects = 3/,
  "terminal auto-reconnect must be bounded",
);
assert.match(
  terminal,
  /func fail[\s\S]*?reconnectAttempt < Self\.maxAutoReconnects[\s\S]*?Task\.sleep[\s\S]*?self\.open\(\)/,
  "a transport failure should retry with backoff before surfacing the error",
);
assert.match(
  terminal,
  /func handle\(_ message[\s\S]*?reconnectAttempt = 0/,
  "any received frame should refill the reconnect budget",
);
assert.match(
  terminal,
  /guard let ws = self\?\.task else \{ return \}[\s\S]*?self\.task === ws/,
  "the receive loop must pin its socket — a replaced socket's stale error must not clobber the live connection",
);

// --- Host discovery: one probe on the common path, and the paired sweep stays
// --- sequential (cave-ioswipe.3) --------------------------------------------
// The paired path probes candidates ONE AT A TIME on purpose: every candidate
// carries the Bearer token, so racing them would fan the credential across
// ports. That is the property most likely to be "optimised" away by someone
// speeding up discovery, so it is pinned first and loudest.

// One probe on the ordinary reconnect: preferred endpoint alone, before any
// fan-out. Without this, a paired user walks up to 16 candidates at a 6s
// timeout each.
assert.match(
  model,
  /switch await Self\.probe\(preferred\) \{[\s\S]*?case \.ok: return \.found\(preferred\)/,
  "discovery must probe the preferred endpoint alone first",
);
assert.match(
  model,
  /let candidates = connection\.prioritizedCandidateBaseURLs/,
  "discovery must use the last-good-first ordering, or the fast path probes the wrong endpoint",
);

// The unpaired sweep stops paying for the slowest probe once one answers.
// Short-circuit, but not at the cost of ordered adjudication: candidate order
// is a preference ranking, so cancelling on the first .ok to ARRIVE would let a
// later port win on timing and be persisted over an earlier one that also
// worked. The sweep may only stop once every candidate ranked above the winner
// has reported.
assert.match(
  model,
  /group\.cancelAll\(\)/,
  "the concurrent sweep must cancel remaining probes once the answer is settled",
);
assert.match(
  model,
  /\(0\.\.<winner\)\.allSatisfy\(\{ collected\[\$0\] != nil \}\)/,
  "it may only stop once no higher-ranked candidate can still win — order is preference, not timing",
);

// Persisting the winner is what makes the fast path available next launch.
assert.match(
  model,
  /CaveConnection\.saveLastGoodBaseURL\(working, forHost: host\)/,
  "a successful probe must record the working URL for the next reconnect",
);
assert.match(
  connection,
  /var prioritizedCandidateBaseURLs: \[URL\] \{[\s\S]*?candidates\.contains\(remembered\)/,
  "a remembered URL is only honoured when it is still a candidate for this host",
);
assert.match(
  connection,
  /static func lastGoodBaseURL\(forHost host: String\)/,
  "the last-good URL is keyed by host so one desktop's port is never tried against another",
);
assert.match(
  connection,
  /static func clear\(\) \{[\s\S]*?removeObject\(forKey: lastGoodKey\)/,
  "disconnecting must drop remembered endpoints too",
);

console.log("ios-connection-stability: OK");
