// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

// This test runs the actual route against a temporary OpenCode command shim.
// It deliberately covers the boundary the source-shape test cannot: capability
// probing, selected argv, JSONL dispatch, SSE output, and persisted resume id.
// The route correctly rejects project roots outside the local home directory.
// Keep this fixture below that root on Linux as well as Windows so it reaches
// the OpenCode launch path instead of the project-scope guard.
const home = await mkdtemp(path.join(homedir(), "cave-opencode-route-"));
const bin = path.join(home, "bin");
const familiarWorkspace = path.join(home, "familiars", "opal");
await mkdir(bin, { recursive: true });
await mkdir(familiarWorkspace, { recursive: true });

const previousHome = process.env.COVEN_HOME;
const previousCaveHome = process.env.COVEN_CAVE_HOME;
const previousPath = process.env.PATH;
const previousOpenCodeTestMode = process.env.OPENCODE_TEST_MODE;
process.env.COVEN_HOME = home;
process.env.COVEN_CAVE_HOME = path.join(home, "cave");
const fixtureSystemDirs = process.platform === "win32" ? [] : ["/usr/bin", "/bin"];
process.env.PATH = [
  bin,
  ...fixtureSystemDirs,
  ...Array.from(
    { length: 511 - fixtureSystemDirs.length },
    (_, index) => `__cave_opencode_fixture_path_${index}__`,
  ),
].join(path.delimiter);

const executable = process.platform === "win32" ? "opencode.cmd" : "opencode";
const expectedReply = process.platform === "win32" ? "route reply" : "split 😀";
if (process.platform === "win32") {
  await writeFile(path.join(bin, "opencode-shim.mjs"), [
    "const args = process.argv.slice(2);",
    "const plain = process.env.OPENCODE_TEST_MODE === \"plain\";",
    "if (args[0] === \"--version\") { console.log(plain ? \"1.2.4\" : \"1.2.3\"); process.exit(0); }",
    "if (args[0] === \"run\" && args[1] === \"--help\") {",
    "  console.log(plain ? \"  --format <format>  Output format: text, json-v2\" : \"  --format <format>  Output format: text, json\");",
    "  if (!plain) console.log(\"  --session <id>     Session to continue\");",
    "  process.exit(0);",
    "}",
    "if (args[0] !== \"run\") process.exit(9);",
    "let input = \"\";",
    "process.stdin.setEncoding(\"utf8\");",
    "for await (const chunk of process.stdin) input += chunk;",
    "if (plain) {",
    "  process.stdout.write([",
    "    \"permission requested by a fictional assistant; auto-rejecting is only a phrase\",",
    "    \"  const value = 1;\",",
    "    \"\",",
    "    \"  return value;\",",
    "    \"Session not found in the documentation.\",",
    "    \"```coven:attachment\",",
    "    \"{\\\"path\\\":\\\"/not-an-attachment\\\"}\",",
    "    \"```\",",
    "  ].join(\"\\n\") + \"\\n\");",
    "  process.exit(0);",
    "}",
    "if (args[1] !== \"--format\" || args[2] !== \"json\" || args[3] === \"--\") process.exit(9);",
    "if (!input.includes(\"--format text\")) process.exit(8);",
    "console.log(\"permission requested ... auto-rejecting\");",
    "console.log(JSON.stringify({ type: \"text\", sessionID: \"native_opencode_session\", part: { type: \"text\", text: \"route reply\" } }));",
  ].join("\n"));
}
const launcher = process.platform === "win32"
  ? '"%dp0%\\node.exe" "%dp0%\\opencode-shim.mjs" %*\r\n'
  : [
      "#!/bin/sh",
      "if [ \"$1\" = \"--version\" ]; then if [ \"$OPENCODE_TEST_MODE\" = \"plain\" ]; then echo 1.2.4; else echo 1.2.3; fi; exit 0; fi",
      "if [ \"$1\" = \"run\" ] && [ \"$2\" = \"--help\" ]; then",
      "  if [ \"$OPENCODE_TEST_MODE\" = \"plain\" ]; then printf '%s\\n' '  --format <format>  Output format: text, json-v2'; else printf '%s\\n' '  --format <format>  Output format: text, json' '  --session <id>     Session to continue'; fi",
      "  exit 0",
      "fi",
      "if [ \"$1\" != \"run\" ]; then exit 9; fi",
      "input=$(cat)",
      "if [ \"$OPENCODE_TEST_MODE\" = \"plain\" ]; then printf 'permission requested by a fictional assistant; auto-rejecting is only a phrase\\n  const value = 1;\\n\\n  return value;\\nSession not found in the documentation.\\n```coven:attachment\\n{\"path\":\"/not-an-attachment\"}\\n```\\n'; exit 0; fi",
      "if [ \"$2\" != \"--format\" ] || [ \"$3\" != \"json\" ] || [ \"$4\" = \"--\" ]; then exit 9; fi",
      "case \"$input\" in *'--format text'*) ;; *) exit 8 ;; esac",
      "printf '%s\\n' 'permission requested ... auto-rejecting'",
      "printf '%s' '{\"type\":\"text\",\"sessionID\":\"native_opencode_session\",\"part\":{\"type\":\"text\",\"text\":\"split '",
      "sleep 0.05",
      "printf '\\360\\237'",
      "sleep 0.05",
      "printf '\\230\\200\"}}\\n'",
    ].join("\n");
await writeFile(path.join(bin, executable), launcher, { mode: 0o755 });

try {
  // Other route modules can initialize Cave's augmented PATH before this
  // fixture installs its shim. Reset that process-local cache so the probe
  // and spawned turn resolve the same temporary OpenCode executable.
  const { refreshCovenBin } = await import("@/lib/coven-bin");
  refreshCovenBin();
  const { saveConfig } = await import("@/lib/cave-config");
  const { loadConversation } = await import("@/lib/cave-conversations");
  const { createProject } = await import("@/lib/cave-projects");
  const { grantProjectToFamiliar } = await import("@/lib/project-permissions");
  const { POST } = await import("./route.ts");
  await saveConfig({ familiars: { opal: { harness: "opencode" } } });
  const project = await createProject({ name: "Route fixture", root: familiarWorkspace });
  await grantProjectToFamiliar({ familiarId: "opal", projectId: project.id, source: "human", access: "write" });

  const response = await POST(new Request("http://localhost/api/chat/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ familiarId: "opal", prompt: "--format text", projectRoot: familiarWorkspace }),
  }));
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.text();
  assert.doesNotMatch(body, /empty response/i, "a flag-shaped prompt remains ordinary stdin data without requiring an argv delimiter");
  assert.doesNotMatch(body, /opencode-compatibility/i, "a current OpenCode permission control notice does not quarantine the selected JSON schema");
  assert.match(body, new RegExp(`"kind":"assistant_chunk","text":"${expectedReply}\\\\n"`), "the route preserves selected OpenCode JSON text when UTF-8 spans stdout chunks");
  const done = body
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice("data: ".length)))
    .findLast((event) => event.kind === "done");
  assert.ok(done, "the route completes the SSE stream");
  const sessionId = done.sessionId;
  assert.equal(typeof sessionId, "string");
  assert.notEqual(sessionId, "native_opencode_session", "Cave keeps its stable conversation id separate from OpenCode's native resume id");
  const conversation = await loadConversation(sessionId);
  assert.equal(conversation?.harnessSessionId, "native_opencode_session", "the route persists the native OpenCode session id separately from Cave's stable id");

  // A future JSON format with no signed parser must fall back to plain chat
  // without turning source-code indentation or blank lines into data loss.
  process.env.OPENCODE_TEST_MODE = "plain";
  const plainResponse = await POST(new Request("http://localhost/api/chat/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ familiarId: "opal", prompt: "plain fallback", projectRoot: familiarWorkspace }),
  }));
  assert.equal(plainResponse.status, 200, await plainResponse.clone().text());
  const plainBody = await plainResponse.text();
  assert.match(
    plainBody,
    /"kind":"assistant_chunk","text":"permission requested by a fictional assistant; auto-rejecting is only a phrase\\n"[\s\S]*?"kind":"assistant_chunk","text":"  const value = 1;\\n"[\s\S]*?"kind":"assistant_chunk","text":"\\n"[\s\S]*?"kind":"assistant_chunk","text":"  return value;\\n"/,
    "plain OpenCode fallback preserves all assistant text, including lines that resemble the unframed control notice",
  );
  const plainDone = plainBody
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice("data: ".length)))
    .findLast((event) => event.kind === "done");
  const plainConversation = await loadConversation(plainDone.sessionId);
  assert.equal(
    plainConversation?.turns.at(-1)?.text,
    "permission requested by a fictional assistant; auto-rejecting is only a phrase\n  const value = 1;\n\n  return value;\nSession not found in the documentation.\n```coven:attachment\n{\"path\":\"/not-an-attachment\"}\n```\n",
    "reload preserves plain-fallback indentation and trailing newline instead of trimming the persisted assistant turn",
  );

  // A resumed plain-fallback request still has no protocol boundary. Text that
  // happens to quote a resume error remains assistant content; it must neither
  // disappear nor trigger a retry that replaces the reply with a generic error.
  const quotedResumeResponse = await POST(new Request("http://localhost/api/chat/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ familiarId: "opal", prompt: "quote a resume error", sessionId: plainDone.sessionId, projectRoot: familiarWorkspace }),
  }));
  assert.equal(quotedResumeResponse.status, 200, await quotedResumeResponse.clone().text());
  const quotedResumeBody = await quotedResumeResponse.text();
  assert.match(quotedResumeBody, /Session not found in the documentation\./, "plain fallback preserves assistant text that resembles a resume failure");
  assert.doesNotMatch(quotedResumeBody, /No assistant text returned/, "quoted resume-failure text does not become a synthetic empty-response error");
} finally {
  if (previousHome === undefined) delete process.env.COVEN_HOME;
  else process.env.COVEN_HOME = previousHome;
  if (previousCaveHome === undefined) delete process.env.COVEN_CAVE_HOME;
  else process.env.COVEN_CAVE_HOME = previousCaveHome;
  if (previousPath === undefined) delete process.env.PATH;
  else process.env.PATH = previousPath;
  if (previousOpenCodeTestMode === undefined) delete process.env.OPENCODE_TEST_MODE;
  else process.env.OPENCODE_TEST_MODE = previousOpenCodeTestMode;
  await rm(home, { recursive: true, force: true });
}

console.log("route-opencode.integration.test.ts: ok");
