// @ts-nocheck
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
const previousGrokRegistryKeys = process.env.COVEN_GROK_SCHEMA_REGISTRY_PUBLIC_KEYS;
const previousGrokRegistryCheckpoint = process.env.COVEN_GROK_SCHEMA_REGISTRY_CHECKPOINT;
process.env.COVEN_HOME = home;
process.env.COVEN_CAVE_HOME = path.join(home, "cave");
process.env.PATH = `${bin}${path.delimiter}${previousPath ?? ""}`;
process.env.XAI_API_KEY = "probe-must-not-receive-this";

// These event names are a deterministic signed-registry fixture only; they
// make no claim about Grok Build's undocumented tool protocol.
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
process.env.COVEN_GROK_SCHEMA_REGISTRY_PUBLIC_KEYS = JSON.stringify({ fixture: publicKey.export({ format: "pem", type: "spki" }).toString() });
const { grokSchemaBundlePayloadHash, grokSchemaBundleSigningPayload } = await import("@/lib/grok-compatibility");
const fixtureBundle = {
  format: 1 as const,
  runtime: "grok-build" as const,
  sequence: 2,
  issuedAt: "2026-07-26T00:00:00.000Z",
  expiresAt: "2030-01-01T00:00:00.000Z",
  keyId: "fixture",
  schemas: [{
    id: "grok-build-fixture-tool-events",
    priority: 1,
    requires: { streamingJson: true as const, options: ["--output-format"], versions: ["1.0.0"] },
    eventTypes: {
      ignored: ["thought"], text: ["text"], end: ["end"], error: ["error"],
      toolStart: ["fixture_tool_start"], toolProgress: ["fixture_tool_progress"],
      toolEnd: ["fixture_tool_end"], toolComplete: ["fixture_tool_complete"],
    },
    fields: {
      type: ["type"], text: ["data"], sessionId: ["sessionId"], message: ["message"],
      usage: [], totalCostUsd: [], id: ["id"], name: ["name"], input: ["input"],
      output: ["output"], state: ["state"], error: ["error"], terminalStates: [], errorStates: ["error"],
    },
    launch: { outputOption: "--output-format" as const, outputValue: "streaming-json" as const },
  }],
};
// Keep the builtin text-only contract inside the same signed fixture bundle.
const { BUILTIN_GROK_SCHEMA_BUNDLE } = await import("@/lib/grok-compatibility");
fixtureBundle.schemas.push({
  ...BUILTIN_GROK_SCHEMA_BUNDLE.schemas[0],
  requires: { streamingJson: true, options: ["--output-format"], versions: ["2.0.0"] },
});
const nativeProposal = JSON.parse(await readFile(new URL("../../../../lib/fixtures/grok/1.0.46-unsigned-proposal.json", import.meta.url), "utf8"));
fixtureBundle.schemas.push(nativeProposal.schemas[0]);
const nativeFrames = JSON.parse(await readFile(new URL("../../../../lib/fixtures/grok/1.0.46-tool-read.json", import.meta.url), "utf8"));
const nativeFramesPath = path.join(bin, "native-acp.jsonl");
await writeFile(nativeFramesPath, [...nativeFrames,
  { type: "usage", signature: "private-opaque-signature" },
  { type: "thought", data: "private-hidden-thought" },
  { type: "text", data: "Native fixture complete." },
  { type: "end", sessionId: "native_acp_session" },
].map((frame) => JSON.stringify(frame)).join("\n") + "\n");
fixtureBundle.signature = {
  algorithm: "ed25519" as const,
  value: sign(null, Buffer.from(grokSchemaBundleSigningPayload(fixtureBundle)), privateKey).toString("base64"),
};
const fixtureHash = grokSchemaBundlePayloadHash(fixtureBundle);
process.env.COVEN_GROK_SCHEMA_REGISTRY_CHECKPOINT = JSON.stringify({ sequence: fixtureBundle.sequence, payloadHash: fixtureHash });
const fixtureCachePath = path.join(process.env.COVEN_CAVE_HOME, "grok-schema-bundle-v1.json");
await mkdir(`${fixtureCachePath}.anchor.journal`, { recursive: true });
await writeFile(fixtureCachePath, JSON.stringify({ checkedAt: Date.now(), bundle: fixtureBundle }));
await writeFile(`${fixtureCachePath}.anchor.journal/${fixtureBundle.sequence}-${fixtureHash}.json`, JSON.stringify({ sequence: fixtureBundle.sequence, payloadHash: fixtureHash }));

const executable = process.platform === "win32" ? "grok.cmd" : "grok";
const windowsShimTarget = path.join(bin, "grok-launcher.js");
const windowsShimProgram = [
  "const [command] = process.argv.slice(2);",
  `if (process.env.GROK_TEST_MODE === 'native-acp') { if (command === '--version') console.log('1.0.46'); else if (command === '--help') console.log('  --output-format <FORMAT>\\n      streaming-json: ACP native format'); else console.log(require('node:fs').readFileSync(${JSON.stringify(nativeFramesPath)}, 'utf8')); process.exit(0); }`,
  "if (command === '--help') { if (process.env.XAI_API_KEY) process.exit(12); console.log(['plain', 'plain-structured', 'plain-structured-array', 'plain-bracketed-text'].includes(process.env.GROK_TEST_MODE ?? '') ? '  --output-format <format>  Output format: text' : '  --output-format <format>  Output format: text, streaming-json'); process.exit(0); }",
  "if (command === '--version') { if (process.env.XAI_API_KEY) process.exit(12); console.log(process.env.GROK_TEST_MODE === 'text-only-schema' ? '2.0.0' : '1.0.0'); process.exit(0); }",
  "if (process.env.GROK_TEST_MODE === 'plain') console.log('plain fallback reply');",
  "else if (process.env.GROK_TEST_MODE === 'plain-structured') console.log(' {\\\"opaque\\\":\\\"private structured payload\\\"}');",
  "else if (process.env.GROK_TEST_MODE === 'plain-structured-array') console.log('[{\\\"opaque\\\":\\\"private array payload\\\"}]');",
  "else if (process.env.GROK_TEST_MODE === 'plain-bracketed-text') console.log('[a safe plain-text reply]');",
  "else if (process.env.GROK_TEST_MODE === 'tool-activity') console.log(['{\"type\":\"fixture_tool_end\",\"id\":\"reordered\",\"output\":\"first terminal result\"}', '{\"type\":\"fixture_tool_progress\",\"id\":\"reordered\",\"output\":\"early progress\"}', '{\"type\":\"fixture_tool_complete\",\"id\":\"reordered\",\"name\":\"fixture_call\",\"input\":{\"safe\":true},\"output\":\"duplicate terminal result\"}', '{\"type\":\"fixture_tool_complete\",\"id\":\"terminal-error\",\"name\":\"fixture_error\",\"input\":{},\"output\":\"terminal error\",\"error\":true}', '{\"type\":\"end\",\"sessionId\":\"native_grok_session\"}'].join('\\n'));",
  "else if (process.env.GROK_TEST_MODE === 'malformed') console.log('unframed private tool payload');",
  "else if (process.env.GROK_TEST_MODE === 'exit-error') { console.error('private Grok stderr payload'); process.exit(3); }",
  "else console.log('{\\\"type\\\":\\\"text\\\",\\\"data\\\":\\\"verified route reply\\\"}\\n{\\\"type\\\":\\\"end\\\",\\\"sessionId\\\":\\\"native_grok_session\\\"}');",
].join("\n");
const launcher = process.platform === "win32"
  ? [
      "@echo off",
      "\"%~dp0\\grok-launcher.js\" %*",
    ].join("\r\n")
  : [
      "#!/bin/sh",
      `if [ "$GROK_TEST_MODE" = "native-acp" ]; then if [ "$1" = "--version" ]; then printf '%s\\n' '1.0.46'; elif [ "$1" = "--help" ]; then printf '%s\\n' '  --output-format <FORMAT>' '      streaming-json: ACP native format'; else cat '${nativeFramesPath}'; fi; exit 0; fi`,
      "if [ \"$1\" = \"--help\" ]; then",
      "  [ -z \"$XAI_API_KEY\" ] || exit 12",
       "  if [ \"$GROK_TEST_MODE\" = \"plain\" ] || [ \"$GROK_TEST_MODE\" = \"plain-structured\" ] || [ \"$GROK_TEST_MODE\" = \"plain-structured-array\" ] || [ \"$GROK_TEST_MODE\" = \"plain-bracketed-text\" ]; then printf '%s\\n' '  --output-format <format>  Output format: text'; else printf '%s\\n' '  --output-format <format>  Output format: text, streaming-json'; fi",
      "  exit 0",
      "fi",
      "if [ \"$1\" = \"--version\" ]; then [ -z \"$XAI_API_KEY\" ] || exit 12; if [ \"$GROK_TEST_MODE\" = \"text-only-schema\" ]; then printf '%s\\n' '2.0.0'; else printf '%s\\n' '1.0.0'; fi; exit 0; fi",
      "if [ \"$GROK_TEST_MODE\" = \"plain\" ]; then printf '%s\\n' 'plain fallback reply'; exit 0; fi",
       "if [ \"$GROK_TEST_MODE\" = \"plain-structured\" ]; then printf '%s\\n' ' {\"opaque\":\"private structured payload\"}'; exit 0; fi",
       "if [ \"$GROK_TEST_MODE\" = \"plain-structured-array\" ]; then printf '%s\\n' '[{\"opaque\":\"private array payload\"}]'; exit 0; fi",
       "if [ \"$GROK_TEST_MODE\" = \"plain-bracketed-text\" ]; then printf '%s\\n' '[a safe plain-text reply]'; exit 0; fi",
      "if [ \"$GROK_TEST_MODE\" = \"tool-activity\" ]; then printf '%s\\n' '{\"type\":\"fixture_tool_end\",\"id\":\"reordered\",\"output\":\"first terminal result\"}' '{\"type\":\"fixture_tool_progress\",\"id\":\"reordered\",\"output\":\"early progress\"}' '{\"type\":\"fixture_tool_complete\",\"id\":\"reordered\",\"name\":\"fixture_call\",\"input\":{\"safe\":true},\"output\":\"duplicate terminal result\"}' '{\"type\":\"fixture_tool_complete\",\"id\":\"terminal-error\",\"name\":\"fixture_error\",\"input\":{},\"output\":\"terminal error\",\"error\":true}' '{\"type\":\"end\",\"sessionId\":\"native_grok_session\"}'; exit 0; fi",
      "if [ \"$GROK_TEST_MODE\" = \"malformed\" ]; then printf '%s\\n' 'unframed private tool payload'; exit 0; fi",
      "if [ \"$GROK_TEST_MODE\" = \"exit-error\" ]; then printf '%s\\n' 'private Grok stderr payload' >&2; exit 3; fi",
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
    body: JSON.stringify({ familiarId: "opal", prompt: "fixture", projectRoot: familiarWorkspace, modelOverride: "xai/grok-4.2", modelOverrideScope: "next-message" }),
  })));
  assert.match(structured.body, /"kind":"assistant_chunk","text":"verified route reply"/, "a source-verified selected JSON schema renders assistant text");
  const structuredDone = structured.events.findLast((event) => event.kind === "done");
  assert.equal(typeof structuredDone?.sessionId, "string");
  const conversation = await loadConversation(structuredDone.sessionId);
  assert.equal(conversation?.harnessSessionId, "native_grok_session", "the route persists Grok's native resume id separately from Cave's id");
  assert.deepEqual(structuredDone.responseMetadata?.runtimeIdentity, {
    schemaVersion: 1, harness: "grok", version: "1.0.0", model: null,
    activity: { schemaVersion: 1, path: "direct", tools: "supported", reasoning: "unsupported" },
  }, "a successful Grok launch records its probed version without inventing a model report");
  assert.equal(structuredDone.responseMetadata?.confirmedModel, undefined, "successful execution does not confirm the requested model");
  assert.equal(structuredDone.responseMetadata?.requestedModel, "xai/grok-4.2");
  assert.deepEqual(conversation?.turns.at(-1)?.responseMetadata?.runtimeIdentity, structuredDone.responseMetadata.runtimeIdentity, "history preserves the same identity evidence as the stream");

  process.env.GROK_TEST_MODE = "text-only-schema";
  const textOnly = await readSse(await POST(new Request("http://localhost/api/chat/send", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ familiarId: "opal", prompt: "text-only fixture", projectRoot: familiarWorkspace }),
  })));
  const textOnlyDone = textOnly.events.findLast((event) => event.kind === "done");
  assert.equal(textOnlyDone?.responseMetadata?.runtimeIdentity?.version, "2.0.0");
  assert.equal(textOnlyDone?.responseMetadata?.runtimeIdentity?.activity?.tools, "unsupported",
    "structured text frames cannot advertise tool details when the selected schema has no tool events");
  assert.match(textOnly.body, /verified route reply/);
  const textOnlyConversation = await loadConversation(textOnlyDone.sessionId);
  assert.deepEqual(textOnlyConversation?.turns.at(-1)?.responseMetadata?.runtimeIdentity,
    textOnlyDone.responseMetadata.runtimeIdentity, "history retains the text-only adapter availability");
  delete process.env.GROK_TEST_MODE;

  const guardedModel = await POST(new Request("http://localhost/api/chat/send", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      familiarId: "opal",
      prompt: "guard an unsafe transformed model",
      projectRoot: familiarWorkspace,
      modelOverride: "provider/--sandbox",
      modelOverrideScope: "next-message",
    }),
  }));
  assert.equal(guardedModel.status, 400, "unsafe model ids are rejected before a runtime spawn");
  const guardedModelBody = await guardedModel.json() as {
    code?: string;
    modelApplicationState?: string;
    modelApplicationReason?: string;
  };
  assert.equal(
    guardedModelBody.code,
    "invalid_model_override",
    "the launch boundary reports unsafe model input with a stable machine-readable code",
  );
  assert.equal(
    guardedModelBody.modelApplicationState,
    "rejected",
    "unsafe model input is represented as rejected rather than silently falling back",
  );

  process.env.GROK_TEST_MODE = "native-acp";
  const nativeActivity = await readSse(await POST(new Request("http://localhost/api/chat/send", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ familiarId: "opal", prompt: "native ACP fixture", projectRoot: familiarWorkspace }),
  })));
  const nativeTools = nativeActivity.events.filter((event) => event.kind === "tool_use");
  assert.deepEqual(nativeTools.map((event) => [event.name, event.status]), [
    ["read_file", "requested"], ["read_file", "ok"],
  ], "a signed fixture preserves the captured request-to-result lifecycle without inventing running");
  assert.equal(new Set(nativeTools.map((event) => event.id)).size, 1);
  assert.match(nativeTools.at(-1)?.output ?? "", /CAVE_GROK_READ_FIXTURE/);
  assert.doesNotMatch(nativeActivity.body, /private-hidden-thought|private-opaque-signature/);
  const nativeDone = nativeActivity.events.findLast((event) => event.kind === "done");
  assert.equal(nativeDone.responseMetadata?.runtimeIdentity?.version, "1.0.46");
  assert.equal(nativeDone.responseMetadata?.runtimeIdentity?.model, null);
  assert.equal(nativeDone.responseMetadata?.runtimeIdentity?.activity?.tools, "supported");
  const nativeConversation = await loadConversation(nativeDone.sessionId);
  assert.equal(nativeConversation?.turns.at(-1)?.tools?.[0]?.status, "ok");
  assert.match(nativeConversation?.turns.at(-1)?.tools?.[0]?.output ?? "", /CAVE_GROK_READ_FIXTURE/);

  process.env.GROK_TEST_MODE = "tool-activity";
  const toolActivity = await readSse(await POST(new Request("http://localhost/api/chat/send", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ familiarId: "opal", prompt: "tool fixture", projectRoot: familiarWorkspace }),
  })));
  const toolEvents = toolActivity.events.filter((event) => event.kind === "tool_use");
  assert.deepEqual(
    toolEvents.map((event) => [event.name, event.status, event.output]),
    [
      ["fixture_call", "requested", undefined],
      ["fixture_call", "running", undefined],
      ["fixture_call", "ok", "first terminal result"],
      ["fixture_error", "requested", undefined],
      ["fixture_error", "error", "terminal error"],
    ],
    "a selected signed fixture preserves stable tool activity across reordered, duplicate, and error terminal frames",
  );
  assert.doesNotMatch(toolActivity.body, /duplicate terminal result/, "the first terminal result wins when a combined completion is retransmitted");
  assert.doesNotMatch(toolActivity.body, /early progress/, "unclassified progress payloads remain private");
  const toolConversation = await loadConversation(toolActivity.events.findLast((event) => event.kind === "done")?.sessionId);
  assert.deepEqual(toolConversation?.turns.at(-1)?.tools?.map((tool) => [tool.name, tool.status, tool.output]), [
    ["fixture_call", "ok", "first terminal result"],
    ["fixture_error", "error", "terminal error"],
  ], "selected-schema tool activity persists through the real chat route");

  process.env.GROK_TEST_MODE = "plain";
  const plain = await readSse(await POST(new Request("http://localhost/api/chat/send", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ familiarId: "opal", prompt: "fallback", projectRoot: familiarWorkspace }),
  })));
  assert.match(plain.body, /"kind":"assistant_chunk","text":"plain fallback reply\\n"/, "an unverified output format remains safe plain assistant text");
  assert.match(plain.body, /without tool activity/, "plain fallback provides an accessible compatibility diagnostic");
  const plainConversation = await loadConversation(plain.events.findLast((event) => event.kind === "done")?.sessionId);
  assert.ok(plainConversation?.turns.at(-1)?.progress?.some((event) => event.id === "grok-compatibility"), "plain fallback persists its value-free compatibility diagnostic for reload");

  process.env.GROK_TEST_MODE = "plain-bracketed-text";
  const bracketedText = await readSse(await POST(new Request("http://localhost/api/chat/send", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ familiarId: "opal", prompt: "bracketed fallback", projectRoot: familiarWorkspace }),
  })));
  assert.match(bracketedText.body, /\[a safe plain-text reply\]/, "plain fallback preserves prose that merely starts with a bracket");

  process.env.GROK_TEST_MODE = "plain-structured";
  const unverifiedStructured = await readSse(await POST(new Request("http://localhost/api/chat/send", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ familiarId: "opal", prompt: "unsafe fallback", projectRoot: familiarWorkspace }),
  })));
  assert.match(unverifiedStructured.body, /unverified-structured-output/, "plain fallback reports an accessible fixed diagnostic for raw structured output");
  assert.doesNotMatch(unverifiedStructured.body, /private structured payload/, "plain fallback never persists unverified structured payload values as assistant text or diagnostics");

  process.env.GROK_TEST_MODE = "plain-structured-array";
  const unverifiedArray = await readSse(await POST(new Request("http://localhost/api/chat/send", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ familiarId: "opal", prompt: "unsafe array fallback", projectRoot: familiarWorkspace }),
  })));
  assert.match(unverifiedArray.body, /unverified-structured-output/, "plain fallback also rejects array-shaped structured output");
  assert.doesNotMatch(unverifiedArray.body, /private array payload/, "plain fallback never persists unverified array payload values");

  process.env.GROK_TEST_MODE = "malformed";
  const malformed = await readSse(await POST(new Request("http://localhost/api/chat/send", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ familiarId: "opal", prompt: "malformed", projectRoot: familiarWorkspace }),
  })));
  assert.match(malformed.body, /unframed-jsonl-event/, "unframed selected-schema output emits an accessible compatibility diagnostic");
  assert.doesNotMatch(malformed.body, /private tool payload/, "unframed structured payloads never enter assistant text or diagnostics");

  process.env.GROK_TEST_MODE = "exit-error";
  const exited = await readSse(await POST(new Request("http://localhost/api/chat/send", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ familiarId: "opal", prompt: "exit error", projectRoot: familiarWorkspace }),
  })));
  assert.equal(exited.events.findLast((event) => event.kind === "done")?.isError, true, "a non-zero Grok process cannot be persisted as a successful turn");
  const exitFailure = exited.events.find((event) => event.kind === "error");
  assert.equal(exitFailure?.code, "runtime_process_failed", "a silent Grok process failure is not downgraded to the empty-output fallback");
  assert.match(exitFailure?.message ?? "", /interactive sign-in.*`grok`/i, "the direct Grok failure gives the actionable first-run sign-in recovery");
  assert.doesNotMatch(exited.body, /No error output captured|produced no output/i, "Grok's silent exit must not render the ambiguous empty-output diagnosis");
  assert.doesNotMatch(exited.body, /private Grok stderr payload/, "Grok stderr values never enter assistant-visible or persisted diagnostics");
} finally {
  if (previousHome === undefined) delete process.env.COVEN_HOME; else process.env.COVEN_HOME = previousHome;
  if (previousCaveHome === undefined) delete process.env.COVEN_CAVE_HOME; else process.env.COVEN_CAVE_HOME = previousCaveHome;
  if (previousPath === undefined) delete process.env.PATH; else process.env.PATH = previousPath;
  if (previousGrokBin === undefined) delete process.env.GROK_BIN; else process.env.GROK_BIN = previousGrokBin;
  if (previousGrokTestMode === undefined) delete process.env.GROK_TEST_MODE; else process.env.GROK_TEST_MODE = previousGrokTestMode;
  if (previousXaiApiKey === undefined) delete process.env.XAI_API_KEY; else process.env.XAI_API_KEY = previousXaiApiKey;
  if (previousGrokRegistryKeys === undefined) delete process.env.COVEN_GROK_SCHEMA_REGISTRY_PUBLIC_KEYS; else process.env.COVEN_GROK_SCHEMA_REGISTRY_PUBLIC_KEYS = previousGrokRegistryKeys;
  if (previousGrokRegistryCheckpoint === undefined) delete process.env.COVEN_GROK_SCHEMA_REGISTRY_CHECKPOINT; else process.env.COVEN_GROK_SCHEMA_REGISTRY_CHECKPOINT = previousGrokRegistryCheckpoint;
  await rm(home, { recursive: true, force: true });
}

console.log("route-grok-compatibility.integration.test.ts: ok");
