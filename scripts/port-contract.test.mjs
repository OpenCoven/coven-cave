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
  /port_is_occupied\(port\)/,
  "an occupied dedicated port is reported, not silently relocated",
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
