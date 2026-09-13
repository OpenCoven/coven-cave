// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, delimiter } from "node:path";

const root = mkdtempSync(join(tmpdir(), "cave-passive-github-"));
const previousEnv = { ...process.env };
const previousFetch = globalThis.fetch;
try {
  const bin = join(root, "bin");
  mkdirSync(bin);
  const log = join(root, "op.log");
  writeFileSync(log, "");
  writeFileSync(join(bin, "op"), `#!${process.execPath}\nrequire("node:fs").appendFileSync(${JSON.stringify(log)}, "read\\n");process.exit(1);\n`, { mode: 0o755 });
  process.env.PATH = `${bin}${delimiter}${process.env.PATH}`;
  process.env.COVEN_CAVE_REF_FAILURE_CACHE_MS = "0";
  process.env.COVEN_HOME = root;
  process.env.COVEN_CAVE_HOME = join(root, "cave");
  process.env.COVEN_VAULT_FILE = join(root, "vault.yaml");
  process.env.COVEN_CAVE_LOCAL_VAULT_FILE = join(root, "local-vault.enc.json");
  process.env.COVEN_CAVE_LOCAL_VAULT_KEY_FILE = join(root, "local-vault.key");
  process.env.COVEN_CAVE_ENV_FILE = join(root, ".env.local");
  for (const key of ["ASANA_PAT", "ASANA_USER", "ASANA_ACCESS_TOKEN", "ELEVENLABS_API_KEY", "GITHUB_PAT", "GITHUB_USERNAME", "GITHUB_TOKEN", "COVEN_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_PERSONAL_ACCESS_TOKEN"]) delete process.env[key];
  globalThis.fetch = async () => new Response(JSON.stringify({ message: "fixture not found" }), { status: 404 });
  const { saveVaultMap } = await import("./vault.ts");
  saveVaultMap({
    ASANA_PAT: { ref: "op://Test/Asana/password", scope: "shared" },
    ELEVENLABS_API_KEY: { ref: "op://Test/ElevenLabs/password", scope: "shared" },
    GITHUB_PAT: { ref: "op://Test/GitHub/password", scope: "shared" },
    GITHUB_USERNAME: { ref: "op://Test/GitHub/username", scope: "shared" },
    GH_TOKEN: { ref: "op://Test/GitHub/token", scope: "shared" },
  });
  const { NextRequest } = await import("next/server");
  for (const route of ["pat", "assigned", "checks", "runs", "item", "comments", "commit", "reactions", "repos", "user", "diff", "labels"]) {
    const { GET } = await import(`../app/api/github/${route}/route.ts`);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await GET(new NextRequest("http://localhost/api/github/" + route + "?repo=OpenCoven/coven-cave&number=1&kind=pr&sha=abcdef&login=test-user"));
      assert.equal(readFileSync(log, "utf8"), "", `${route} refresh must not invoke a denied external provider`);
    }
  }
  const { GET: commitGET } = await import("../app/api/github/commit/route.ts");
  await commitGET(new NextRequest("http://localhost/api/github/commit?repo=OpenCoven/coven-cave&sha=abcdef1234"));
  assert.equal(readFileSync(log, "utf8"), "", "single SHA hydration stays passive");
  for (const route of ["asana/pat", "asana/assigned", "asana/workspaces", "voice/elevenlabs/catalog"]) {
    const { GET } = await import(`../app/api/${route}/route.ts`);
    await GET(new NextRequest(`http://localhost/api/${route}`));
    await GET(new NextRequest(`http://localhost/api/${route}`));
    assert.equal(readFileSync(log, "utf8"), "", `${route} polling stays passive`);
  }
  for (const provider of ["github", "asana"]) {
    const { GET } = await import(`../app/api/${provider}/pat/route.ts`);
    const status = await (await GET()).json();
    assert.equal(status.hasPat, true, `${provider} retains cold external configuration`);
    assert.equal(status.needsInitialization, true);
  }
  for (const route of ["github/assigned", "github/repos", "asana/assigned", "asana/workspaces"]) {
    const { GET } = await import(`../app/api/${route}/route.ts`);
    const response = await GET(new NextRequest(`http://localhost/api/${route}`));
    assert.equal((await response.json()).configured, true, `${route} preserves cold configuration`);
  }
  const { openClawSpawnEnv } = await import("./openclaw-bin.ts");
  openClawSpawnEnv({ credentialMode: "passive" });
  assert.equal(readFileSync(log, "utf8"), "", "passive OpenClaw journal generation never resolves an external provider");
  const { resolveGitHubToken } = await import("./github-token.ts");
  resolveGitHubToken();
  assert.notEqual(readFileSync(log, "utf8"), "", "explicit credential use still invokes the external provider");
  writeFileSync(join(bin, "op"), `#!${process.execPath}\nrequire("node:fs").appendFileSync(${JSON.stringify(log)}, "read\\n");process.stdout.write("fixture-token");\n`, { mode: 0o755 });
  for (const provider of ["github", "asana"]) {
    let authenticated = false;
    globalThis.fetch = async (_url, init) => {
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer fixture-token");
      authenticated = true;
      return new Response(JSON.stringify(provider === "github" ? { login: "fixture-user" } : { data: { name: "Fixture User" } }));
    };
    const { POST, GET } = await import(`../app/api/${provider}/pat/route.ts`);
    const response = await POST(new NextRequest(`http://localhost/api/${provider}/pat`, {
      method: "POST", body: JSON.stringify({ initialize: true }),
    }));
    assert.equal(response.status, 200);
    assert.equal((await response.clone().text()).includes("fixture-token"), false, "initialization never exposes token material");
    assert.equal(authenticated, true, `${provider} explicit initialization authenticates upstream`);
    assert.equal((await (await GET()).json()).needsInitialization, false);
  }
  console.log("github-token-passive.test.ts: ok");
} finally {
  globalThis.fetch = previousFetch;
  for (const key of Object.keys(process.env)) if (!(key in previousEnv)) delete process.env[key];
  Object.assign(process.env, previousEnv);
  rmSync(root, { recursive: true, force: true });
}
