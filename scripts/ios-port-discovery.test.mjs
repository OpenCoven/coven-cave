import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Bare-host port discovery (bead cave-y482 part 3): the desktop dev wrapper
// walks ports 3000-3010 when earlier ones are taken (scripts/dev-app.sh), so
// a phone that paired against :3000 must rediscover the desktop when it comes
// back on :3001+. Discovery probes candidates concurrently, so the widened
// range costs no wall-clock time — but every port in the wrapper's range must
// actually be a candidate, in ascending order, without disturbing the legacy
// alternates or the ordered .ok adjudication that relocation depends on.

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

// --- The Swift range and the wrapper's range must not drift ------------------
const seq = devScript.match(/seq (\d+) (\d+)/);
assert.ok(seq, "dev-app.sh should scan a port range via seq");
assert.equal(seq[1], "3000", "wrapper range start pinned to the Swift candidates");
assert.equal(seq[2], "3010", "wrapper range end pinned to the Swift candidates");

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
