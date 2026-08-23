import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { CAVE_PORTS, CAVE_PORT_ENV, parsePort, resolvePort } from "./ports.mjs";

// One port per channel, and every copy of those numbers agrees.
//
// scripts/ports.mjs is the source of truth, but three consumers cannot import
// it: Rust (src-tauri), Swift (apps/ios), and server.ts — the last because
// `build:server` runs esbuild with `--bundle=false`, so an import there has to
// resolve at runtime from wherever server.mjs is unpacked, and the packaged
// bundle ships server.mjs without scripts/. Each of those carries a copy, and
// this test fails if any of them drifts. Same two-place convention
// scripts/sidecar-bundle-deps.test.mjs uses for the sidecar file-count budget:
// a change stays a deliberate edit in reviewed places rather than a silent slide.
//
// It matters most for Swift, which CI does not compile at all — a wrong number
// there would otherwise reach a device with nothing having noticed.

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

// --- The contract itself -----------------------------------------------------
assert.equal(CAVE_PORTS.dev, 3000, "dev keeps the entrenched port");
assert.equal(CAVE_PORTS.production, 3020, "production has its own dedicated port");
assert.equal(CAVE_PORTS.e2e, 3100, "e2e keeps the port playwright.config.ts already used");

const distinct = new Set(Object.values(CAVE_PORTS));
assert.equal(
  distinct.size,
  Object.keys(CAVE_PORTS).length,
  "channels must not share a port — a packaged build, a dev server and an e2e run all coexist",
);

// --- Resolution order --------------------------------------------------------
assert.equal(resolvePort("production", {}), 3020, "channel default when nothing overrides");
assert.equal(
  resolvePort("production", { [CAVE_PORT_ENV]: "4000", PORT: "5000" }),
  4000,
  "COVEN_CAVE_PORT wins over PORT, so pinning Cave never depends on an inherited PORT",
);
assert.equal(resolvePort("dev", { PORT: "5000" }), 5000, "PORT is honoured when Cave's own is unset");
assert.equal(
  resolvePort("dev", { [CAVE_PORT_ENV]: "not-a-port" }),
  3000,
  "a malformed override falls back rather than refusing to start",
);
assert.throws(() => resolvePort("nope", {}), /unknown Cave channel/, "channels are closed");

// Port 0 is refused deliberately: "bind anything" is the behaviour the dedicated
// port exists to retire, and it is exactly what find_free_port() used to do.
assert.equal(parsePort("0"), null, "port 0 is not a usable dedicated port");
assert.equal(parsePort("70000"), null, "outside the TCP range");
assert.equal(parsePort(" 3020 "), 3020, "surrounding whitespace is tolerated");

// --- Rust copy ---------------------------------------------------------------
const rust = await read("src-tauri/src/sidecar_ports.rs");
assert.match(
  rust,
  new RegExp(`CAVE_PRODUCTION_PORT: u16 = ${CAVE_PORTS.production};`),
  "the Rust production port must match scripts/ports.mjs",
);
assert.match(
  rust,
  new RegExp(`CAVE_DEV_PORT: u16 = ${CAVE_PORTS.dev};`),
  "the Rust dev port must match scripts/ports.mjs",
);
assert.match(
  rust,
  new RegExp(`CAVE_PORT_ENV: &str = "${CAVE_PORT_ENV}";`),
  "the override env var name must match",
);

// The packaged app must not go back to asking the kernel for any free port.
const startup = await read("src-tauri/src/sidecar_startup.rs");
assert.doesNotMatch(
  startup,
  /TcpListener::bind\("127\.0\.0\.1:0"\)/,
  "the sidecar must bind its dedicated port, never an ephemeral one",
);
assert.match(
  startup,
  /sidecar_ports::dedicated_port\(\)/,
  "the sidecar takes its port from the contract",
);
assert.match(
  startup,
  /classify_port_occupant\(port\)/,
  "an occupied dedicated port is reported by identity, not silently relocated",
);
// A probe can only ever describe the instant it ran. Two copies launched
// together queue on the runtime-cache lock and are released into the same
// window, so the exclusion has to be a held claim rather than an observation —
// otherwise both spawn a node and the loser dies on EADDRINUSE (cave-2s5q0).
assert.match(
  startup,
  /sidecar_port_lock::claim_dedicated_port\(/,
  "the port is claimed before the sidecar spawns, not merely probed",
);
const portLock = await read("src-tauri/src/sidecar_port_lock.rs");
assert.match(
  portLock,
  new RegExp(`format!\\("sidecar-port-\\{port\\}`),
  "the claim is keyed on the resolved port, so COVEN_CAVE_PORT still lets a second copy run",
);

// --- the claim runs before anything a refused copy must not touch -------------
// This is a source-ORDER contract, and it exists because the ordering broke
// twice. The claim was hoisted into the setup hook precisely so a copy that is
// about to be refused does not first truncate the running copy's diagnostics,
// prune its reliability store, start a second Discord presence worker, or build
// a second tray icon. A later "move it below the translocation check" moved it
// below the whole prologue instead, silently restoring the harm; no test
// noticed, because every existing test checks behaviour of functions rather
// than the order they are called in.
const setup = await read("src-tauri/src/tauri_setup.rs");
const claimAt = setup.indexOf("sidecar_port_lock::claim_dedicated_port(");
assert.notEqual(claimAt, -1, "the setup hook must take the dedicated-port claim");
for (const [label, needle] of [
  ["the native diagnostics reset", "reset_native_diagnostics_file("],
  ["the reliability store", "app.state::<Arc<ReliabilityRecorder>>()"],
  ["the offline cache", "offline_cache::OfflineCacheState>>()"],
  ["Discord presence", "discord_presence::start()"],
  ["the tray icon", 'TrayIconBuilder::with_id("cave-tray")'],
]) {
  const at = setup.indexOf(needle);
  assert.notEqual(at, -1, `${label} must still be in the setup hook`);
  assert.ok(
    claimAt < at,
    `the port claim must run BEFORE ${label} — a copy that is about to be refused must not touch shared state`,
  );
}
// The translocation check is the one thing allowed above it: it shows a
// blocking dialog, and holding the port across that wait would refuse the good
// copy while naming a process that never binds anything.
const translocationAt = setup.indexOf("check_app_translocation()");
assert.notEqual(
  translocationAt,
  -1,
  "the translocation check must still be in the setup hook",
);
assert.ok(
  translocationAt < claimAt,
  "the translocation check must run before the claim, so a leaving copy never holds the port",
);

// --- server.ts copy ----------------------------------------------------------
const server = await read("server.ts");
assert.match(
  server,
  new RegExp(`const CAVE_DEV_PORT = ${CAVE_PORTS.dev};`),
  "server.ts dev port must match scripts/ports.mjs",
);
assert.match(
  server,
  new RegExp(`const CAVE_PRODUCTION_PORT = ${CAVE_PORTS.production};`),
  "server.ts production port must match scripts/ports.mjs",
);
assert.doesNotMatch(
  server,
  /process\.env\.PORT \?\? "3000"/,
  "server.ts resolves through cavePort(), not an inline default",
);

// --- a reaped-child exit must not hold the port across its dialog -----------
// `fatal_exit` blocks on osascript/zenity until a human clicks. The two
// SidecarStartError arms reap the child first, so nothing is on the port — and
// holding the claim through that wait refused the user's own retry, naming a
// process that never bound anything. Source-level because the wiring is what
// regressed: `release_all_claims` itself was unit-tested the whole time.
// Anchored on each arm's own `Err(SidecarStartError::…)` rather than on a
// character budget between the reap and the exit. A budget encodes an ordering
// as a distance, so adding a comment between them breaks the test while the
// property it names is intact — which is exactly what this change did to the
// sibling assertion in scripts/desktop-reachability.test.mjs. Widening the
// budget is not the fix either: an unbounded gap lets one arm's reap satisfy
// the other arm's exit, so dropping the release from a single arm would still
// pass.
const reapedThenExit = [
  ...setup.matchAll(/Err\(SidecarStartError::[\s\S]*?fatal_exit\(/g),
].map((m) => m[0]);
assert.equal(
  reapedThenExit.length,
  2,
  "expected exactly two reaped-child fatal_exit arms; re-check this contract if that changed",
);
for (const arm of reapedThenExit) {
  assert.ok(
    arm.includes("release_all_claims()"),
    "a fatal_exit that has already reaped the child must release the port claim first, or the user's retry is refused by a copy holding a port nothing is on",
  );
}

// --- the EADDRINUSE tail contract lives in two files --------------------------
// The Rust post-mortem recognises a failed bind by matching the sidecar's own
// output. Reword the server line without the matcher and the raw error object
// comes back with a green suite.
const bindConflictLiterals = [...startup.matchAll(/tail\.contains\("([^"]+)"\)/g)].map((m) => m[1]);
assert.ok(
  bindConflictLiterals.length >= 2,
  "tail_reports_bind_conflict must match on explicit literals",
);
const serverBindLine = bindConflictLiterals.find((literal) => server.includes(literal));
assert.ok(
  serverBindLine,
  `server.ts must still print a line the launcher recognises; it matches on ${JSON.stringify(bindConflictLiterals)}`,
);
assert.ok(
  bindConflictLiterals.includes("listen EADDRINUSE"),
  "Node's own listen error must stay recognised, not just our added line",
);


// --- Swift copy (never compiled by CI) ---------------------------------------
const swiftPorts = await read("apps/ios/CovenCave/CovenCave/Networking/CavePorts.swift");
assert.match(
  swiftPorts,
  new RegExp(`static let production = ${CAVE_PORTS.production}`),
  "the iOS production port must match scripts/ports.mjs",
);
assert.match(
  swiftPorts,
  new RegExp(`static let dev = ${CAVE_PORTS.dev}`),
  "the iOS dev port must match scripts/ports.mjs",
);

const connection = await read("apps/ios/CovenCave/CovenCave/Networking/CaveConnection.swift");
assert.match(
  connection,
  /http:\/\/\\\(trimmed\):\\\(CavePorts\.production\)/,
  "a bare host defaults to the packaged desktop's dedicated port",
);
assert.doesNotMatch(
  connection,
  /http:\/\/\\\(trimmed\):3000/,
  "the hardcoded :3000 default is retired",
);

// --- playwright ---------------------------------------------------------------
const playwright = await read("playwright.config.ts");
assert.match(
  playwright,
  /resolvePort\("e2e", process\.env\)/,
  "e2e takes its port from the contract instead of its own literal",
);

console.log("port-contract.test.mjs: ok");
