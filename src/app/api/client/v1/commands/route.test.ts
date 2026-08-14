// @ts-nocheck
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, test } from "node:test";
import crypto from "node:crypto";

import { CLIENT_V1_LOCAL_HEADER } from "@/proxy-helpers";

const testTmpRoot = path.join(process.cwd(), ".test-tmp");
await mkdir(testTmpRoot, { recursive: true });
const workdir = await mkdtemp(path.join(testTmpRoot, "client-v1-commands-"));
const covenHome = path.join(workdir, "home");
await mkdir(covenHome, { recursive: true });

// Isolate this test from the real host's ~/.coven — `computeClientSlashCommands`
// now reads `config.defaults.harness` (a genuinely local, hermetic read used
// only to decide capability, never returned in the response) to gate `/model`,
// so this route test must never touch a real Cave install's config.json.
process.env.COVEN_HOME = covenHome;
process.env.COVEN_CAVE_CLIENT_CREDENTIAL_STORE_PATH = path.join(workdir, "client-v1-credentials.json");

const LOCAL_PEER_SECRET = "test-per-boot-secret-do-not-reuse";
process.env.COVEN_CAVE_LOCAL_PEER_SECRET = LOCAL_PEER_SECRET;

const { GET } = await import("./route.ts");
const { issueCredential } = await import("@/lib/server/client-v1/credential-store.ts");
const { resetRateLimitsForTest } = await import("@/lib/server/client-v1/rate-limit.ts");
const { SLASH_COMMANDS } = await import("@/lib/slash-commands.ts");

const configPath = path.join(covenHome, "cave", "config.json");

after(async () => {
  await rm(workdir, { recursive: true, force: true });
});

function requestWith(opts: { marker?: string | null; bearer?: string | null } = {}) {
  const headers = new Headers();
  if (opts.marker !== null) headers.set(CLIENT_V1_LOCAL_HEADER, opts.marker ?? LOCAL_PEER_SECRET);
  if (opts.bearer !== undefined && opts.bearer !== null) headers.set("authorization", `Bearer ${opts.bearer}`);
  return new Request("http://127.0.0.1/api/client/v1/commands", { headers });
}

async function issue(scopes: readonly string[] = ["chat:read"]) {
  const { token } = await issueCredential({
    appName: "OpenCoven Chat",
    installationId: crypto.randomUUID(),
    scopes: [...scopes],
  });
  return token;
}

/** Writes a minimal, valid `cave/config.json` with the given default harness. */
async function writeConfigWithHarness(harness: string) {
  await mkdir(path.join(covenHome, "cave"), { recursive: true });
  await writeFile(
    configPath,
    JSON.stringify({
      version: 1,
      defaults: { harness, model: "" },
      familiars: {},
      roles: [],
      addons: { github: false, code: false, browser: false, flow: false, journal: false, docs: false },
      marketplace: { installed: {} },
      multiHost: { mode: "single", hubUrl: "", executorUrls: [] },
      omnigent: {
        enabled: false,
        baseUrl: "",
        defaultAgentId: "",
        defaultHostId: "",
        defaultWorkspace: "",
        hostMap: {},
        hostWorkspaceMap: {},
        exposeHostsInComposer: true,
      },
      remoteHosts: [],
    }),
  );
}

async function removeConfig() {
  await rm(configPath, { force: true });
}

test("an absent internal marker returns 403 unauthorized", async () => {
  resetRateLimitsForTest();
  const response = await GET(requestWith({ marker: null }));
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, "unauthorized");
});

test("a verified marker with no bearer returns 401 unauthorized", async () => {
  resetRateLimitsForTest();
  const response = await GET(requestWith());
  assert.equal(response.status, 401);
});

test("a credential missing chat:read is denied with 403 scope_denied", async () => {
  resetRateLimitsForTest();
  const token = await issue(["chat:write"]);
  const response = await GET(requestWith({ bearer: token }));
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, "scope_denied");
});

test("returns only the standalone-chat-safe command allowlist, never a Cave-only UI/daemon/launch command", async () => {
  resetRateLimitsForTest();
  await removeConfig(); // no config.json ⇒ default harness "codex", which has a model catalog
  const token = await issue();
  const response = await GET(requestWith({ bearer: token }));
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.json();
  assert.equal(body.ok, true);
  const names = body.commands.map((c: { name: string }) => c.name);
  assert.deepEqual(
    names,
    ["/help", "/clear", "/quit", "/new", "/model", "/skill", "/skills", "/prompt", "/prompts", "/image", "/auto"],
  );
  for (const excluded of [
    "/palette",
    "/shortcuts",
    "/save",
    "/familiar",
    "/agent",
    "/doctor",
    "/daemon",
    "/sessions",
    "/attach",
    "/tui",
    "/journal",
    "/canvas",
    "/board",
    "/chats",
    "/rituals",
    "/remind",
    "/projects",
    "/toggle-agent",
    "/run",
    "/codex",
    "/claude",
  ]) {
    assert.equal(names.includes(excluded), false, `${excluded} must never be exposed to a standalone client`);
  }
  // Every returned command must be a real, currently-registered SLASH_COMMANDS
  // entry — the allowlist can never invent a command name of its own.
  const registryNames = new Set(SLASH_COMMANDS.map((c) => c.name));
  for (const name of names) assert.ok(registryNames.has(name), `${name} must exist in the slash-commands registry`);
});

test("the command catalog is deterministic across repeated requests", async () => {
  resetRateLimitsForTest();
  await removeConfig();
  const token = await issue();
  const first = await (await GET(requestWith({ bearer: token }))).json();
  const second = await (await GET(requestWith({ bearer: token }))).json();
  assert.deepEqual(first, second);
});

test("each returned command has the stable client shape only", async () => {
  resetRateLimitsForTest();
  await removeConfig();
  const token = await issue();
  const body = await (await GET(requestWith({ bearer: token }))).json();
  for (const command of body.commands) {
    assert.deepEqual(Object.keys(command).sort(), ["aliases", "argPlaceholder", "description", "hint", "name"]);
    assert.ok(Array.isArray(command.aliases));
  }
});

// ── Runtime/model capability gating (Task 5 spec-review finding #3) ─────────
// `/model` must only be advertised when the configured default harness
// actually advertises a model catalog — reusing the SAME static registry
// `/api/chat/model-state` and the composer's `/model` menu already resolve
// from (`@/lib/runtime-models.ts`'s `catalogForRuntime`), never a duplicate.

test("capability present: a harness with a known model catalog still advertises /model", async () => {
  resetRateLimitsForTest();
  await writeConfigWithHarness("claude");
  const token = await issue();
  const body = await (await GET(requestWith({ bearer: token }))).json();
  assert.ok(
    body.commands.some((c: { name: string }) => c.name === "/model"),
    "/model should be advertised when the default harness has a model catalog",
  );
});

test("capability absent: an unrecognized default harness omits /model but keeps the rest of the allowlist", async () => {
  resetRateLimitsForTest();
  await writeConfigWithHarness("totally-unknown-harness-xyz");
  const token = await issue();
  const response = await GET(requestWith({ bearer: token }));
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.json();
  const names = body.commands.map((c: { name: string }) => c.name);
  assert.equal(names.includes("/model"), false, "/model must not be advertised for a harness with no known capability");
  assert.deepEqual(
    names,
    ["/help", "/clear", "/quit", "/new", "/skill", "/skills", "/prompt", "/prompts", "/image", "/auto"],
    "every other allowlisted command is unaffected by the /model capability gate",
  );
});

test("capability degraded: a corrupt config.json fails closed (no /model), not a 5xx", async () => {
  resetRateLimitsForTest();
  await mkdir(path.join(covenHome, "cave"), { recursive: true });
  await writeFile(configPath, "{ not valid json", "utf8");
  const token = await issue();
  const response = await GET(requestWith({ bearer: token }));
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.json();
  const names = body.commands.map((c: { name: string }) => c.name);
  assert.equal(names.includes("/model"), false, "a capability-resolution failure must fail CLOSED, never advertise /model");
  assert.ok(names.includes("/help"), "other allowlisted commands still render even when capability resolution fails");
  await removeConfig();
});

console.log("client/v1/commands route.test.ts: ok");
