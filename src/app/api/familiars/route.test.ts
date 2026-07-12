// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

assert.match(
  source,
  /const configEntry = config\.familiars\[f\.id\] \?\? \{\}/,
  "Familiars API should inspect the raw familiar config entry before resolving defaults",
);
assert.match(
  source,
  /defaultHarness: config\.defaults\.harness/,
  "Familiars API should expose the workspace default harness for UI copy",
);
assert.match(
  source,
  /harnessOverride: configEntry\.harness \?\? null/,
  "Familiars API should expose whether the familiar has an explicit harness override",
);
assert.match(
  source,
  /autoSelfReport: configEntry\.autoSelfReport \?\? false/,
  "Familiars API should expose per-familiar auto self-report config with a false default",
);
assert.match(
  source,
  /filterInstallSeedFamiliars\(/,
  "Familiars API should hide the known first-install default roster before the picker sees it",
);
assert.match(
  source,
  /explicitFamiliarIdsFromToml/,
  "Familiars API should distinguish user-authored familiar ids from daemon fallback defaults",
);

// The executable transport check below asserts the response body. Keep this
// lightweight guard too, so refactors cannot bypass the shared daemon-error
// parser and accidentally flatten a structured daemon error.
assert.match(
  source,
  /import\s*\{[^}]*\bextractDaemonError\b[^}]*\}\s*from\s*"@\/lib\/coven-daemon"/,
  "Familiars API should normalize structured daemon errors",
);

// ── POST: in-app "create a familiar" write path ──────────────────────────────
// Source-text guards (same pattern as src/app/api/onboarding/setup/route.test.ts).
// Deep-merge semantics are covered by src/lib/cave-config.test.ts; draft
// normalization by the onboarding-familiars helpers this route reuses.

assert.match(source, /export async function POST\(/, "route should create a familiar via POST");

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

// ── Executable daemon + COVEN_HOME regression ───────────────────────────────
// Use the actual route and local HTTP transport instead of source-only
// assertions. This catches both pieces of the failure path: an upstream
// `{ error: { code, message } }` envelope must survive the Cave proxy, and
// roster creation must stay inside an explicit COVEN_HOME.
const originalEnv = Object.fromEntries(
  [
    "HOME",
    "COVEN_HOME",
    "COVEN_SOCKET",
    "COVEN_WORKSPACES_ROOT",
    "COVEN_WORKSPACE_ROOT",
    "WORKSPACE_ROOT",
    "NEXT_PUBLIC_WORKSPACE_ROOT",
  ].map((key) => [key, process.env[key]]),
);
const tempRoot = await mkdtemp(path.join(tmpdir(), "coven-familiars-route-"));
const testHome = path.join(tempRoot, "home");
const covenHome = path.join(tempRoot, "isolated-coven-home");
const socket =
  process.platform === "win32"
    ? `\\\\.\\pipe\\coven-cave-familiars-${process.pid}-${Date.now()}`
    : path.join(covenHome, "coven.sock");

process.env.HOME = testHome;
process.env.COVEN_HOME = covenHome;
process.env.COVEN_SOCKET = socket;
for (const key of [
  "COVEN_WORKSPACES_ROOT",
  "COVEN_WORKSPACE_ROOT",
  "WORKSPACE_ROOT",
  "NEXT_PUBLIC_WORKSPACE_ROOT",
]) {
  delete process.env[key];
}

let server: ReturnType<typeof createServer> | null = null;
let listening = false;
try {
  await mkdir(covenHome, { recursive: true });
  server = createServer((req, res) => {
    assert.equal(req.method, "GET");
    assert.equal(req.url, "/api/v1/familiars");
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({
      error: {
        code: "internal_error",
        message: "The daemon could not process the request.",
      },
    }));
  });
  await new Promise<void>((resolve, reject) => {
    server?.once("error", reject);
    server?.listen(socket, () => {
      server?.off("error", reject);
      listening = true;
      resolve();
    });
  });

  const { GET, POST } = await import("./route.ts");
  const { DELETE } = await import("./[id]/route.ts");
  const { POST: restoreRemoved } = await import("./removed/route.ts");
  const { POST: onboardingSetup } = await import("../onboarding/setup/route.ts");

  const daemonFailure = await GET();
  assert.equal(daemonFailure.status, 503, "daemon registry errors map to Cave's roster-unavailable status");
  assert.deepEqual(await daemonFailure.json(), {
    ok: false,
    error: "The daemon could not process the request.",
    familiars: [],
  });

  const create = await POST(
    new Request("http://test/api/familiars", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        familiar: {
          id: "ash",
          displayName: "Ash",
          glyph: "ph:flask-fill",
          role: "Familiar",
          harness: "codex",
          model: "openai/gpt-5.5",
        },
      }),
    }),
  );
  assert.equal(create.status, 200, "create accepts a blank-description familiar");

  const toml = await readFile(path.join(covenHome, "familiars.toml"), "utf8");
  assert.match(toml, /id = "ash"/);
  assert.match(toml, /description = ""/, "Cave serializes the required empty description field");

  const config = JSON.parse(await readFile(path.join(covenHome, "cave-config.json"), "utf8"));
  assert.deepEqual(config.familiars.ash, {
    harness: "codex",
    model: "openai/gpt-5.5",
  });

  const remove = await DELETE(new Request("http://test/api/familiars/ash", { method: "DELETE" }), {
    params: Promise.resolve({ id: "ash" }),
  });
  assert.equal(remove.status, 200, "remove reads and writes the COVEN_HOME registry");
  const tombstones = JSON.parse(
    await readFile(path.join(covenHome, "cave-removed-familiars.json"), "utf8"),
  );
  assert.equal(tombstones.entries[0].id, "ash", "remove stores its undo record under COVEN_HOME");

  const restore = await restoreRemoved(
    new Request("http://test/api/familiars/removed", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "ash" }),
    }),
  );
  assert.equal(restore.status, 200, "restore writes back to the COVEN_HOME registry");
  assert.match(
    await readFile(path.join(covenHome, "familiars.toml"), "utf8"),
    /id = "ash"[\s\S]*description = ""/,
    "restore preserves the explicit empty description",
  );

  const setup = await onboardingSetup(
    new Request("http://test/api/onboarding/setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        familiar: {
          id: "briar",
          displayName: "Briar",
          glyph: "ph:code-fill",
          role: "Familiar",
          harness: "codex",
          model: "openai/gpt-5.5",
        },
      }),
    }),
  );
  assert.equal(setup.status, 200, "onboarding writes to an explicit COVEN_HOME");
  assert.equal((await setup.json()).covenDir, covenHome);
  assert.match(
    await readFile(path.join(covenHome, "familiars.toml"), "utf8"),
    /id = "briar"[\s\S]*description = ""/,
    "onboarding emits the same compatible blank-description registry entry",
  );
  await assert.rejects(
    readFile(path.join(testHome, ".coven", "familiars.toml"), "utf8"),
    { code: "ENOENT" },
    "an explicit COVEN_HOME wins over the default home-directory path",
  );
} finally {
  if (listening && server) {
    await new Promise<void>((resolve, reject) => {
      server?.close((error) => (error ? reject(error) : resolve()));
    });
  }
  if (process.platform !== "win32") await rm(socket, { force: true }).catch(() => {});
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await rm(tempRoot, { recursive: true, force: true });
}

console.log("familiars route.test.ts: ok");
