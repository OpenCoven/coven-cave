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
assert.match(
  model,
  /if sendCredential \{[\s\S]*?do \{[\s\S]*?try CaveConnection\.credentialForRequest[\s\S]*?catch \{[\s\S]*?return \.credentialFailure\(error\.localizedDescription\)/,
  "paired discovery must fail visibly when the stored credential cannot be sent to a candidate",
);
assert.doesNotMatch(
  model,
  /try\? CaveConnection\.credentialForRequest\(to: req\.url!\)/,
  "paired discovery must not suppress credential-origin or transport failures and adopt a tokenless sibling",
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
  /func handleSurfaceError[\s\S]*?case \.connected, \.degraded:[\s\S]*?connectionState = \.degraded\(\.generic\)[\s\S]*?requestConnectionRecovery\(\.surfaceFailure\)/,
  "a surface failure should enter degraded state and wake the shared supervisor",
);
assert.match(
  model,
  /func requestConnectionRecovery[\s\S]*?connectionSupervisorDelayTask\?\.cancel\(\)[\s\S]*?guard connectionSupervisorTask == nil/,
  "cascading failure signals must fold into one worker while waking its backoff",
);
assert.match(
  model,
  /func runConnectionSupervisor[\s\S]*?ConnectionRetryPolicy\.heartbeatSeconds[\s\S]*?connectionState == \.connected[\s\S]*?await client\.ping\(\)/,
  "the shared supervisor should heartbeat a nominally connected endpoint cheaply",
);
assert.match(
  app,
  /case \.active:[\s\S]*?app\.setConnectionSupervisorActive\(true\)/,
  "foregrounding should wake the shared supervisor",
);
assert.doesNotMatch(
  rootView,
  /connectedTicks|maintainConnectionWhileActive/,
  "RootView must not retain its own heartbeat loop",
);

// --- Quiet retry: the supervisor re-probes without UI bouncing --------------
assert.match(
  model,
  /func refreshConnection\(\s*reloadLoadedSurfaces: Bool = false,\s*quiet: Bool = false,\s*supervisorGeneration: UInt64\? = nil\s*\) async \{[\s\S]*?if !quiet \{ connectionState = \.checking \}/,
  "quiet refresh must not flip the state to .checking before it has an outcome",
);
assert.match(
  model,
  /func runConnectionSupervisor[\s\S]*?refreshConnection\([\s\S]*?quiet: true/,
  "the shared supervisor should quietly auto-retry so returning desktops reconnect",
);
assert.doesNotMatch(
  connectView,
  /case \.unreachable = app\.connectionState else \{ continue \}/,
  "ConnectionView must not retain a competing retry ticker",
);

// --- Chat stream interruption: recover the persisted turn, not a raw error --
assert.match(
  thread,
  /catch \{[\s\S]*?if serverError\?\.isDefinitiveServerResponse != true \{[\s\S]*?resumeInterruptedStream\([\s\S]*?resyncInterruptedTurn\(\s*familiarId: familiarId,\s*runId: runId/,
  "a transport failure mid-stream should try resume and persisted-turn resync before surfacing an error",
);
assert.match(
  thread,
  /func resyncInterruptedTurn[\s\S]*?adoptServerTurnIfPresent\([\s\S]*?runId: runId[\s\S]*?\$0\.role == "user" && \$0\.attentionClearOperationId == runId[\s\S]*?\$0\.role == "assistant" && \$0\.parentId == userTurn\.id/,
  "resync must adopt the exact run-owned user turn's direct assistant child, never an older equal prompt",
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
  /CaveConnection\.saveLastGoodBaseURL\(\s*working,\s*forHost: host(?:,\s*defaults: projectContextDefaults)?\s*\)/,
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
