// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { createDefaultPreferences } from "../../../lib/preferences-schema.ts";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
const enrichmentSource = readFileSync(
  new URL("../../../lib/server/familiar-enrichment.ts", import.meta.url),
  "utf8",
);
const rosterHelper = readFileSync(new URL("../../../lib/server/familiar-roster.ts", import.meta.url), "utf8");

assert.match(
  enrichmentSource,
  /const configEntry = config\.familiars\[f\.id\] \?\? \{\}/,
  "Familiars API should inspect the raw familiar config entry before resolving defaults",
);
assert.match(
  enrichmentSource,
  /defaultHarness: config\.defaults\.harness/,
  "Familiars API should expose the workspace default harness for UI copy",
);
assert.match(
  enrichmentSource,
  /harnessOverride: configEntry\.harness \?\? null/,
  "Familiars API should expose whether the familiar has an explicit harness override",
);
assert.match(
  enrichmentSource,
  /autoSelfReport: configEntry\.autoSelfReport \?\? false/,
  "Familiars API should expose per-familiar auto self-report config with a false default",
);
assert.match(
  source,
  /import \{ loadVisibleFamiliarRoster \} from "@\/lib\/server\/familiar-roster";/,
  "Familiars API should delegate roster loading to the shared helper",
);
assert.match(
  rosterHelper,
  /parseFamiliarsToml/,
  "the shared familiar-roster helper should read the locally-declared familiars so they can be merged and exempted",
);

// ── GET: the list must reflect the coven's real state (cave-7cv4) ────────────
// Hub rosters are real registered familiars — the install-seed guard judges
// entries against the LOCAL familiars.toml, which knows nothing about a
// remote coven, so it must not run in hub mode.
assert.match(
  rosterHelper,
  /target\.mode === "hub"\s*\?\s*\(res\.data \?\? \[\]\)\s*:\s*filterInstallSeedFamiliars\(/,
  "hub rosters bypass the local-toml install-seed guard",
);
// Familiars declared in the local familiars.toml but missing from the daemon
// roster (not re-read yet / hub unaware) merge into the response — everything
// the POST duplicate check can 409 on must be visible in the list.
assert.match(
  rosterHelper,
  /const declaredOnly[^=]*= declaredEntries\s*\.filter\(\(entry\) => !rosterIds\.has\(entry\.id\.toLowerCase\(\)\) && !removedIds\.has\(entry\.id\)\)/,
  "locally-declared familiars missing from the daemon roster are merged in (minus tombstones)",
);
assert.match(
  source,
  /const rostersByProject[\s\S]*?filterFamiliarsForProject\(permissions!, rosterResult\.roster, projectId, "session-launch"\)/,
  "every project-scoped familiar request filters the roster with session-launch access",
);
assert.match(
  source,
  /searchParams\s*\.getAll\("projectId"\)/,
  "Familiars API accepts repeated projectId scopes for dependent task pickers",
);
assert.match(
  source,
  /familiarsByProject: Object\.fromEntries/,
  "the table can receive every project-scoped roster from one daemon/config lookup",
);
assert.match(
  source,
  /roster\.map\(/,
  "daemon roster and declared-only familiars still flow through the same enrichment path",
);
assert.match(
  source,
  /roster\.map\(\(familiar\) => enrichFamiliar\(familiar, config\)\)/,
  "Familiars API delegates enrichment to the shared server helper",
);
assert.match(
  rosterHelper,
  /const target = daemonTargetForConfig\(config\);/,
  "the shared familiar-roster helper resolves the roster authority from the same config snapshot used for the daemon call",
);
assert.match(
  rosterHelper,
  /callDaemonTarget[\s\S]{0,80}\(target, \{/,
  "the shared familiar-roster helper queries the roster against the resolved target, not a re-derived authority",
);
assert.equal(
  (source.match(/const covenDir = covenHome\(\)/g)?.length ?? 0) + (rosterHelper.match(/const covenDir = covenHome\(\)/g)?.length ?? 0),
  2,
  "Familiars GET helper and POST should honor a custom COVEN_HOME",
);

// ── POST: in-app "create a familiar" write path ──────────────────────────────
// Source-text guards (same pattern as src/app/api/onboarding/setup/route.test.ts).
// Deep-merge semantics are covered by src/lib/cave-config.test.ts; draft
// normalization by the onboarding-familiars helpers this route reuses.

assert.match(source, /export async function POST\(/, "route should create a familiar via POST");
assert.match(
  source,
  /await ensureAdapterManifestScaffold\(draft\.harness\)/,
  "POST should scaffold adapters through the COVEN_HOME-aware shared writer",
);
assert.match(
  source,
  /import \{ loadPreferences \} from "@\/lib\/server\/preferences-store";/,
  "POST should load the canonical Cave preferences on the server",
);
assert.match(
  source,
  /import \{ voiceBindingForNewFamiliar \} from "@\/lib\/voice\/new-familiar-defaults";/,
  "POST should validate new-familiar voice defaults through the shared helper",
);

// Reuses the shared onboarding write primitives so a UI-created familiar is
// identical to a setup-created one.
assert.match(
  source,
  /normalizeFamiliarDraft\(body\.familiar\)/,
  "POST should normalize input through the shared onboarding helper",
);
assert.match(
  source,
  /buildFamiliarsToml\(draft\)/,
  "POST should build the [[familiar]] block through the shared helper",
);

// Duplicate protection: never append a second block with the same id.
assert.match(
  source,
  /familiarsTomlContainsId\(existingToml, draft\.id\)/,
  "POST should detect an existing id before appending",
);
assert.match(source, /status:\s*409/, "POST should return 409 on a duplicate id");

// The local familiars.toml is only half the truth — in hub mode (or before
// the local daemon re-reads the file) the roster can hold ids this machine
// has never declared. POST checks the live roster best-effort (daemon failure
// must not block creation) so it never shadows an existing remote familiar;
// tombstoned ids are exempt so Remove → re-create keeps working (cave-7cv4).
assert.match(
  source,
  /liveRoster\.ok &&\s*!removed\.has\(draft\.id\) &&\s*\(liveRoster\.data \?\? \[\]\)\.some\(\(f\) => f\.id\.toLowerCase\(\) === draft\.id\.toLowerCase\(\)\)/,
  "POST rejects ids that already exist in the live roster (best-effort, tombstone-exempt)",
);

// CRITICAL: creating an additional familiar must NOT rewrite the global
// defaults (that's onboarding's job for the first familiar). The route only
// upserts this familiar's binding via saveConfig({ familiars }); deep-merge
// leaves defaults/roles/addons/marketplace untouched.
assert.match(
  source,
  /saveConfig\(\{\s*familiars:/,
  "POST should upsert the new familiar binding via saveConfig({ familiars })",
);
assert.doesNotMatch(
  source,
  /defaults:\s*\{/,
  "POST must NOT write a defaults object — creating a familiar must not change the user's global default harness/model",
);
assert.match(
  source,
  /const preferences = await loadPreferences\(\);\s*const voiceBinding = voiceBindingForNewFamiliar\(preferences\.voice\);\s*await saveConfig\(\{/,
  "POST should derive the voice binding from canonical preferences immediately before saveConfig",
);
assert.match(
  source,
  /\[draft\.id\]:\s*\{[\s\S]{0,320}?voiceProvider:\s*null,\s*voiceModel:\s*null,\s*voiceName:\s*null,\s*\.\.\.voiceBinding[\s\S]{0,320}?\}\s*,?\s*\}\s*,?\s*\}\);/,
  "POST should clear orphaned voice fields before spreading defaults inside only the new familiar binding",
);
assert.equal(
  source.match(/voiceProvider:\s*null/g)?.length,
  1,
  "the voice clear sentinels should exist only in the new-familiar upsert",
);
assert.ok(
  source.indexOf("await saveConfig({") < source.indexOf("await writeFile("),
  "POST persists a familiar binding before registering it in familiars.toml",
);

// Optional-body (fallback-empty) handling, per the API contract for this route.
assert.match(source, /let body[\s\S]{0,120}=\s*\{\}/, "POST should initialize an optional request body");
assert.match(
  source,
  /try\s*\{[\s\S]{0,120}req\.json\(\)[\s\S]{0,120}\}\s*catch\s*\{/,
  "POST should tolerate a malformed/empty JSON body",
);

// POST scaffolds the Familiar Contract so a new familiar is compliant from
// birth. Best-effort: the scaffold call is wrapped so a workspace write failure
// can't fail creation (the familiar is already registered in toml + config).
assert.match(
  source,
  /scaffoldFamiliarContractFiles\(\{[\s\S]*?id: draft\.id/,
  "POST should scaffold the familiar's contract files",
);
assert.match(
  source,
  /try\s*\{\s*contractWrote = await scaffoldFamiliarContractFiles\([\s\S]*?\}\s*catch\s*\{/,
  "contract scaffolding must be best-effort (never fail creation)",
);

// The scaffolder is handed the familiar's PURPOSE, never its description. The
// description is written by the rite's scry from the portrait, and passing it
// here is what made familiars declare "My purpose is to <a caption of my own
// face>" — a contract that scored five green properties while saying nothing
// about the job.
assert.match(
  source,
  /scaffoldFamiliarContractFiles\(\{[\s\S]*?purpose: draft\.purpose/,
  "POST must pass the purpose to the contract scaffolder",
);
assert.doesNotMatch(
  source,
  /scaffoldFamiliarContractFiles\(\{[\s\S]*?description: draft\.description/,
  "the description must NOT reach the contract scaffolder — it is prose about the likeness",
);

// Real POST behavior: exercise the route against isolated Cave/Coven homes and
// a controlled empty daemon roster so config/TOML ordering and deep-merge
// behavior are verified without touching a live install or external service.
const testRoot = await mkdtemp(path.join(tmpdir(), "familiars-post-route-"));
const testCovenHome = path.join(testRoot, "coven");
const testCaveHome = path.join(testRoot, "cave");
const socketPath = path.join(testRoot, "coven.sock");
const configPath = path.join(testCaveHome, "config.json");
const preferencesPath = path.join(testCaveHome, "preferences.json");
const familiarsTomlPath = path.join(testCovenHome, "familiars.toml");
const originalEnv = {
  COVEN_HOME: process.env.COVEN_HOME,
  COVEN_CAVE_HOME: process.env.COVEN_CAVE_HOME,
  COVEN_SOCKET: process.env.COVEN_SOCKET,
  COVEN_PREFERENCES_PATH: process.env.COVEN_PREFERENCES_PATH,
  COVEN_THEME_PATH: process.env.COVEN_THEME_PATH,
  COVEN_WORKSPACES_ROOT: process.env.COVEN_WORKSPACES_ROOT,
};

await mkdir(testCovenHome, { recursive: true });
await mkdir(testCaveHome, { recursive: true });
process.env.COVEN_HOME = testCovenHome;
process.env.COVEN_CAVE_HOME = testCaveHome;
process.env.COVEN_SOCKET = socketPath;
process.env.COVEN_PREFERENCES_PATH = preferencesPath;
process.env.COVEN_THEME_PATH = path.join(testCaveHome, "theme.json");
process.env.COVEN_WORKSPACES_ROOT = path.join(testCovenHome, "workspaces");

const daemonRequests: string[] = [];
const daemonServer = createServer((req, res) => {
  daemonRequests.push(req.url ?? "");
  if (req.method === "GET" && req.url === "/api/v1/familiars") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end("[]");
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not_found" }));
});
await new Promise<void>((resolve, reject) => {
  daemonServer.once("error", reject);
  daemonServer.listen(socketPath, () => {
    daemonServer.off("error", reject);
    resolve();
  });
});

after(async () => {
  await new Promise<void>((resolve) => {
    daemonServer.close(() => resolve());
    daemonServer.closeAllConnections();
  });
  for (const [name, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  await rm(testRoot, { recursive: true, force: true });
});

const { POST } = await import("./route.ts");

const existingToml = [
  "# User familiars for this Coven.",
  "",
  "[[familiar]]",
  'id = "existing"',
  'display_name = "Existing"',
  'role = "Familiar"',
  'description = "Already here"',
  'harness = "codex"',
  "",
].join("\n");

function baseConfig(familiars: Record<string, Record<string, unknown>>) {
  return {
    version: 1,
    defaults: { harness: "claude", model: "workspace/default" },
    familiars,
    roles: [],
    addons: {
      github: false,
      code: false,
      browser: false,
      flow: false,
      journal: false,
      docs: false,
    },
    marketplace: { installed: {}, knowledgePacks: [] },
    multiHost: { mode: "local", hubUrl: "", executorUrls: [] },
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
  };
}

async function writeBehaviorFixture(
  familiars: Record<string, Record<string, unknown>>,
  voice: { defaultProvider: unknown; defaultModel: unknown; defaultVoice: unknown },
  toml = existingToml,
) {
  const preferences = createDefaultPreferences(true);
  preferences.voice = voice as typeof preferences.voice;
  await rm(configPath, { recursive: true, force: true });
  await writeFile(configPath, JSON.stringify(baseConfig(familiars), null, 2));
  await writeFile(preferencesPath, JSON.stringify(preferences, null, 2));
  await writeFile(familiarsTomlPath, toml);
}

function createRequest(id: string): Request {
  return new Request("http://test/api/familiars", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      familiar: {
        id,
        displayName: id,
        description: `Description for ${id}`,
        harness: "codex",
        model: "openai/gpt-5.6-sol",
      },
    }),
  });
}

async function readConfig() {
  return JSON.parse(await readFile(configPath, "utf8")) as ReturnType<typeof baseConfig>;
}

test("POST seeds valid voice preferences only into the created familiar", async () => {
  const existing = {
    harness: "codex",
    model: "existing/model",
    voiceProvider: "local",
    voiceModel: "existing-voice-model",
    voiceName: "Existing Voice",
  };
  const initial = baseConfig({ existing });
  await writeBehaviorFixture(
    { existing },
    {
      defaultProvider: "openai",
      defaultModel: "gpt-realtime",
      defaultVoice: "cedar",
    },
  );

  const response = await POST(createRequest("valid-voice"));
  assert.equal(response.status, 200);
  const config = await readConfig();
  assert.deepEqual(config.familiars["valid-voice"], {
    harness: "codex",
    model: "openai/gpt-5.6-sol",
    voiceProvider: "openai",
    voiceModel: "gpt-realtime",
    voiceName: "cedar",
  });
  assert.equal(JSON.stringify(config.defaults), JSON.stringify(initial.defaults));
  assert.equal(JSON.stringify(config.familiars.existing), JSON.stringify(existing));
  assert.match(await readFile(familiarsTomlPath, "utf8"), /id = "valid-voice"/);
});

test("POST omits voice fields for none and invalid preferences", async () => {
  for (const [id, voice] of [
    ["none-voice", { defaultProvider: "", defaultModel: "", defaultVoice: "" }],
    ["invalid-voice", {
      defaultProvider: "openai",
      defaultModel: "gpt-4o-realtime-preview",
      defaultVoice: "alloy",
    }],
  ] as const) {
    await writeBehaviorFixture({}, voice, "# User familiars for this Coven.\n");
    const response = await POST(createRequest(id));
    assert.equal(response.status, 200);
    const binding = (await readConfig()).familiars[id];
    assert.ok(binding);
    assert.equal("voiceProvider" in binding, false);
    assert.equal("voiceModel" in binding, false);
    assert.equal("voiceName" in binding, false);
  }
});

test("POST retry clears stale orphan voice fields when preferences do not bind voice", async () => {
  await writeBehaviorFixture(
    {
      orphan: {
        harness: "claude",
        model: "old/model",
        voiceProvider: "elevenlabs",
        voiceModel: "eleven_turbo_v2_5",
        voiceName: "21m00Tcm4TlvDq8ikWAM",
        note: "preserve me",
      },
    },
    { defaultProvider: "", defaultModel: "", defaultVoice: "" },
    "# User familiars for this Coven.\n",
  );

  const response = await POST(createRequest("orphan"));
  assert.equal(response.status, 200);
  const binding = (await readConfig()).familiars.orphan;
  assert.equal(binding.harness, "codex");
  assert.equal(binding.model, "openai/gpt-5.6-sol");
  assert.equal(binding.note, "preserve me");
  assert.equal("voiceProvider" in binding, false);
  assert.equal("voiceModel" in binding, false);
  assert.equal("voiceName" in binding, false);
  assert.match(await readFile(familiarsTomlPath, "utf8"), /id = "orphan"/);
});

test("POST does not register TOML when config persistence fails", async () => {
  await writeBehaviorFixture(
    {},
    { defaultProvider: "", defaultModel: "", defaultVoice: "" },
    "# User familiars for this Coven.\n",
  );
  await rm(configPath, { force: true });
  await mkdir(configPath);

  await assert.rejects(() => POST(createRequest("config-failure")));
  assert.equal(
    await readFile(familiarsTomlPath, "utf8"),
    "# User familiars for this Coven.\n",
  );
});

test("behavior tests used only the controlled empty daemon roster", () => {
  assert.ok(daemonRequests.length >= 4);
  assert.deepEqual(new Set(daemonRequests), new Set(["/api/v1/familiars"]));
});

console.log("familiars route.test.ts: ok");
