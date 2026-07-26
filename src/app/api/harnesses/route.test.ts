import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

assert.match(
  source,
  /spawn\(launch\.command, \[\.\.\.launch\.fixedArgs, "--no-auto-update", "models"\]/,
  "the harness catalog probe must not trigger Grok's automatic updater on routine UI refreshes",
);

assert.match(
  source,
  /pickWindowsLauncher\(found\.split\(\/\\r\?\\n\/\)\)/,
  "Windows discovery must choose one spawnable launcher from multi-line where output",
);

assert.match(
  source,
  /grokLaunchCommandForBinary\(path\)/,
  "Grok probes must run npm .cmd shims through their spawn-safe launch command",
);
assert.match(
  source,
  /if \(id === "hermes"\) \{[\s\S]*?const hermesLaunch = resolveHermesLaunch\(\{ env \}\);[\s\S]*?hermesLaunch,[\s\S]*?const hermesLaunch = runtime\.hermesLaunch;[\s\S]*?h\.id === "hermes"\s*\?\s*hermesLaunch\?\.state === "ready" \? hermesLaunch\.command : null/,
  "Hermes status must use the same resolved native launch plan as chat instead of a generic which/where shim result",
);
assert.match(
  source,
  /h\.id === "hermes"\s*\?\s*hermesLaunch\?\.state === "ready" \? hermesLaunch\.command : null\s*:\s*await which\(h\.binary\)/,
  "an unready Hermes plan must not fall back to which/where and turn a Windows shim into a status path",
);
assert.match(
  source,
  /if \(id === "hermes"\) \{[\s\S]*?resolveHermesLaunch\(\{ env \}\)/,
  "the wire-safe runtime availability summary is derived from the Hermes resolver",
);
assert.match(
  source,
  /const resolvedBinary = h\.id === "grok" \? grokBin\(\) : h\.binary;[\s\S]*?h\.id === "grok" && resolvedBinary !== h\.binary[\s\S]*?: await which\(h\.binary\)/,
  "WSL must report a Windows grok.exe discovered by the native launcher even though Linux which does not use PATHEXT",
);
assert.match(
  source,
  /async function adapterAvailability[\s\S]*?id === "copilot"[\s\S]*?const copilotLaunch = await resolveCopilotRuntimeLaunch\(stream\.executable\)[\s\S]*?availability: summarizeRuntimeAvailability\(copilotLaunch\.availability\)[\s\S]*?copilotLaunch/,
  "Copilot availability retains the shared exact launch plan for internal catalog probes",
);
assert.match(
  source,
  /const runtime = await adapterAvailability\(h\.id\);[\s\S]*?const copilotLaunch = runtime\.copilotLaunch;[\s\S]*?const path =\s*copilotLaunch[\s\S]*?copilotLaunch\.availability\.state === "ready"[\s\S]*?copilotLaunch\.availability\.resolvedPath[\s\S]*?: await which\(h\.binary\)/,
  "the harness catalog reports the resolved Copilot launch target without running an independent which probe",
);
assert.match(
  source,
  /const version = await probeVersion\([\s\S]*?copilotLaunch\?\.command[\s\S]*?copilotLaunch\?\.fixedArgs[\s\S]*?copilotLaunch\?\.env/,
  "Copilot version discovery uses the exact resolved command, fixed arguments, and credential-free environment",
);
assert.match(
  source,
  /function probeVersion\([\s\S]*?env: NodeJS\.ProcessEnv = covenSpawnEnv\(\)[\s\S]*?spawn\(binary,[\s\S]*?\{ env,/,
  "version probing accepts the exact launch environment instead of always rebuilding one",
);
assert.doesNotMatch(
  source,
  /availability:\s*\{[\s\S]{0,200}\b(?:command|fixedArgs|env|resolvedPath)\b/,
  "the harness API never copies private Copilot launch-plan data onto availability",
);

console.log("harness route tests passed");
