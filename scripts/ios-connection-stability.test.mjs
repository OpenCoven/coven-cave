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
  /private static let devSharedSession: URLSession = \{/,
  "dev-tab calls should share one session too",
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

// --- Dev-tab requests carry the paired credential ---------------------------
assert.match(
  devClient,
  /devRequest[\s\S]*?if let token = CaveConnection\.accessToken \{\s*\n\s*req\.setValue\("Bearer \\\(token\)", forHTTPHeaderField: "Authorization"\)/,
  "dev-tab requests must send the Bearer token — without it the Developer tab 401s on a paired desktop",
);

// --- Discovery: credential-safe probes, ordered adjudication, 401 terminal -
assert.match(
  model,
  /if CaveConnection\.accessToken != nil \{\s*\n\s*return await discoverBaseURLSequentially\(candidates\)/,
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
  /catch \{[\s\S]*?resyncInterruptedTurn\(familiarId: familiarId, prompt: prompt/,
  "a transport failure mid-stream should try to resync the persisted turn first",
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

console.log("ios-connection-stability: OK");
