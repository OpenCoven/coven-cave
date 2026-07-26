// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

// Exercise the real Grok route with a deterministic local launcher. This covers
// the boundary pure parser tests cannot: secret-free capability probing,
// verified JSON launch, plain fallback, and persisted native session handling.
const home = await mkdtemp(path.join(homedir(), "cave-grok-route-"));
const bin = path.join(home, "bin");
const familiarWorkspace = path.join(home, "familiars", "opal");
await mkdir(bin, { recursive: true });
await mkdir(familiarWorkspace, { recursive: true });

const previousHome = process.env.COVEN_HOME;
const previousCaveHome = process.env.COVEN_CAVE_HOME;
const previousPath = process.env.PATH;
const previousGrokBin = process.env.GROK_BIN;
const previousGrokTestMode = process.env.GROK_TEST_MODE;
const previousXaiApiKey = process.env.XAI_API_KEY;
process.env.COVEN_HOME = home;
process.env.COVEN_CAVE_HOME = path.join(home, "cave");
process.env.PATH = `${bin}${path.delimiter}${previousPath ?? ""}`;
process.env.XAI_API_KEY = "probe-must-not-receive-this";

const executable = process.platform === "win32" ? "grok.cmd" : "grok";
const windowsShimTarget = path.join(bin, "grok-launcher.js");
const windowsShimProgram = [
  "const [command] = process.argv.slice(2);",
  "if (command === '--help') { if (process.env.XAI_API_KEY) process.exit(12); console.log(['plain', 'plain-structured'].includes(process.env.GROK_TEST_MODE ?? '') ? '  --output-format <format>  Output format: text' : '  --output-format <format>  Output format: text, streaming-json'); process.exit(0); }",
  "if (command === '--version') { if (process.env.XAI_API_KEY) process.exit(12); console.log('1.0.0'); process.exit(0); }",
  "if (process.env.GROK_TEST_MODE === 'plain') console.log('plain fallback reply');",
  "else if (process.env.GROK_TEST_MODE === 'plain-structured') console.log('{\\\"type\\\":\\\"tool_started\\\",\\\"input\\\":\\\"private tool payload\\\"}');",
  "else if (process.env.GROK_TEST_MODE === 'malformed') console.log('unframed private tool payload');",
  "else console.log('{\\\"type\\\":\\\"text\\\",\\\"data\\\":\\\"verified route reply\\\"}\\n{\\\"type\\\":\\\"end\\\",\\\"sessionId\\\":\\\"native_grok_session\\\"}');",
].join("\n");
const launcher = process.platform === "win32"
  ? [
      "@echo off",
      "\"%~dp0\\grok-launcher.js\" %*",
    ].join("\r\n")
  : [
      "#!/bin/sh",
      "if [ \"$1\" = \"--help\" ]; then",
      "  [ -z \"$XAI_API_KEY\" ] || exit 12",
      "  if [ \"$GROK_TEST_MODE\" = \"plain\" ] || [ \"$GROK_TEST_MODE\" = \"plain-structured\" ]; then printf '%s\\n' '  --output-format <format>  Output format: text'; else printf '%s\\n' '  --output-format <format>  Output format: text, streaming-json'; fi",
      "  exit 0",
      "fi",
      "if [ \"$1\" = \"--version\" ]; then [ -z \"$XAI_API_KEY\" ] || exit 12; printf '%s\\n' '1.0.0'; exit 0; fi",
      "if [ \"$GROK_TEST_MODE\" = \"plain\" ]; then printf '%s\\n' 'plain fallback reply'; exit 0; fi",
      "if [ \"$GROK_TEST_MODE\" = \"plain-structured\" ]; then printf '%s\\n' '{\"type\":\"tool_started\",\"input\":\"private tool payload\"}'; exit 0; fi",
      "if [ \"$GROK_TEST_MODE\" = \"malformed\" ]; then printf '%s\\n' 'unframed private tool payload'; exit 0; fi",
      "printf '%s\\n' '{\"type\":\"text\",\"data\":\"verified route reply\"}' '{\"type\":\"end\",\"sessionId\":\"native_grok_session\"}'",
    ].join("\n");
const launcherPath = path.join(bin, executable);
await writeFile(launcherPath, launcher, { mode: 0o755 });
if (process.platform === "win32") await writeFile(windowsShimTarget, windowsShimProgram);
process.env.GROK_BIN = launcherPath;

async function readSse(response: Response) {
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.text();
  return {
    body,
    events: body.split("\n").filter((line) => line.startsWith("data: ")).map((line) => JSON.parse(line.slice(6))),
  };
}

try {
  const { saveConfig } = await import("@/lib/cave-config");
  const { loadConversation } = await import("@/lib/cave-conversations");
  const { createProject } = await import("@/lib/cave-projects");
  const { grantProjectToFamiliar } = await import("@/lib/project-permissions");
  const { POST } = await import("./route.ts");
  await saveConfig({ familiars: { opal: { harness: "grok" } } });
  const project = await createProject({ name: "Grok route fixture", root: familiarWorkspace });
  await grantProjectToFamiliar({ familiarId: "opal", projectId: project.id, source: "human", access: "write" });

  const structured = await readSse(await POST(new Request("http://localhost/api/chat/send", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ familiarId: "opal", prompt: "fixture", projectRoot: familiarWorkspace }),
  })));
  assert.match(structured.body, /"kind":"assistant_chunk","text":"verified route reply"/, "a source-verified selected JSON schema renders assistant text");
  const structuredDone = structured.events.findLast((event) => event.kind === "done");
  assert.equal(typeof structuredDone?.sessionId, "string");
  const conversation = await loadConversation(structuredDone.sessionId);
  assert.equal(conversation?.harnessSessionId, "native_grok_session", "the route persists Grok's native resume id separately from Cave's id");

  process.env.GROK_TEST_MODE = "plain";
  const plain = await readSse(await POST(new Request("http://localhost/api/chat/send", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ familiarId: "opal", prompt: "fallback", projectRoot: familiarWorkspace }),
  })));
  assert.match(plain.body, /"kind":"assistant_chunk","text":"plain fallback reply\\n"/, "an unverified output format remains safe plain assistant text");
  assert.match(plain.body, /without tool activity/, "plain fallback provides an accessible compatibility diagnostic");

  process.env.GROK_TEST_MODE = "plain-structured";
  const unverifiedStructured = await readSse(await POST(new Request("http://localhost/api/chat/send", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ familiarId: "opal", prompt: "unsafe fallback", projectRoot: familiarWorkspace }),
  })));
  assert.match(unverifiedStructured.body, /unverified-structured-output/, "plain fallback reports an accessible fixed diagnostic for raw structured output");
  assert.doesNotMatch(unverifiedStructured.body, /private tool payload/, "plain fallback never persists unverified structured payload values as assistant text or diagnostics");

  process.env.GROK_TEST_MODE = "malformed";
  const malformed = await readSse(await POST(new Request("http://localhost/api/chat/send", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ familiarId: "opal", prompt: "malformed", projectRoot: familiarWorkspace }),
  })));
  assert.match(malformed.body, /unframed-jsonl-event/, "unframed selected-schema output emits an accessible compatibility diagnostic");
  assert.doesNotMatch(malformed.body, /private tool payload/, "unframed structured payloads never enter assistant text or diagnostics");
} finally {
  if (previousHome === undefined) delete process.env.COVEN_HOME; else process.env.COVEN_HOME = previousHome;
  if (previousCaveHome === undefined) delete process.env.COVEN_CAVE_HOME; else process.env.COVEN_CAVE_HOME = previousCaveHome;
  if (previousPath === undefined) delete process.env.PATH; else process.env.PATH = previousPath;
  if (previousGrokBin === undefined) delete process.env.GROK_BIN; else process.env.GROK_BIN = previousGrokBin;
  if (previousGrokTestMode === undefined) delete process.env.GROK_TEST_MODE; else process.env.GROK_TEST_MODE = previousGrokTestMode;
  if (previousXaiApiKey === undefined) delete process.env.XAI_API_KEY; else process.env.XAI_API_KEY = previousXaiApiKey;
  await rm(home, { recursive: true, force: true });
}

console.log("route-grok-compatibility.integration.test.ts: ok");
