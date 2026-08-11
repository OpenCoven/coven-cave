import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Bare-host port discovery (bead cave-y482 part 3, extended by cave-l3vsw).
//
// Originally: the dev wrapper walked 3000-3010, so a phone that paired against
// :3000 had to rediscover a desktop that came back on :3001+. Cave now has
// DEDICATED ports (scripts/ports.mjs) and the wrapper no longer scans, so the
// dedicated pair must lead the candidate list — that is the address a paired
// phone should find first, and finding it first is the whole point of fixing it.
//
// The 3000-3010 sweep is kept behind them rather than deleted: the macOS
// background-availability daemon still falls back into that range when the
// dedicated port is occupied (src-tauri/src/desktop_reachability.rs), and a
// phone paired before this change may still be pointed at one of them.
// Discovery probes candidates concurrently, so the extra entries cost no
// wall-clock time — but order still decides adjudication.

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");
const connection = await read("apps/ios/CovenCave/CovenCave/Networking/CaveConnection.swift");
const devScript = await read("scripts/dev-app.sh");
const model = await read("apps/ios/CovenCave/CovenCave/State/AppModel.swift");

// --- CaveConnection: the full wrapper range is probed ------------------------
assert.match(
  connection,
  /for port in 3000\.\.\.3010 \{ add\("http:\/\/\\\(hostname\):\\\(port\)"\) \}/,
  "bare-host discovery must probe the whole 3000-3010 dev-wrapper port range",
);
assert.match(
  connection,
  /for port in \["4500", "4555", "8443"\] \{ add\("http:\/\/\\\(hostname\):\\\(port\)"\) \}/,
  "legacy alternate ports stay probed after the 3000-3010 range",
);
assert.match(
  connection,
  /for port in 3000\.\.\.3010[\s\S]*?for port in \["4500", "4555", "8443"\]/,
  "the 3000-3010 range must come first so lower dev ports win adjudication",
);

// --- The dedicated ports lead, and the wrapper no longer scans ---------------
assert.match(
  connection,
  /add\("http:\/\/\\\(hostname\):\\\(CavePorts\.production\)"\)[\s\S]*?add\("http:\/\/\\\(hostname\):\\\(CavePorts\.dev\)"\)[\s\S]*?for port in 3000\.\.\.3010/,
  "the dedicated production and dev ports must be probed before the legacy sweep",
);
assert.doesNotMatch(
  devScript,
  /seq 3000 3010/,
  "the dev wrapper no longer scans for a free port — it resolves the dedicated one",
);
assert.match(
  devScript,
  /resolvePort\('dev', process\.env\)/,
  "the dev wrapper takes its port from the shared contract (scripts/ports.mjs)",
);
assert.match(
  devScript,
  /dev-port-owner\.mjs/,
  "a busy dedicated port is resolved by identity — attach if it is ours, refuse if not",
);

// --- Discovery semantics the widened range relies on -------------------------
assert.match(
  model,
  /withTaskGroup[\s\S]*?group\.addTask \{ \(index, await Self\.probe\(base\)\) \}/,
  "candidates must still be probed concurrently — 14 candidates, one probe's wall time",
);
assert.match(
  model,
  /for \(index, result\) in results\.enumerated\(\)[\s\S]*?case \.ok: return \.found\(candidates\[index\]\)/,
  "adjudication stays in candidate order so the configured/lowest port wins",
);
