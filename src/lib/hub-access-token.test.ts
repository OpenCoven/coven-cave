// @ts-nocheck
// Hub access token custody (cave-1v95, persistence P0): the signed hub token
// must never be persisted inside cave-config.json's multiHost.hubUrl. Pasting
// a tokened invite URL stays the pairing UX, but the credential is split into
// the local encrypted vault on write (and lazily on load, for pre-existing
// configs), and the daemon target resolves it back from custody.
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const home = await mkdtemp(path.join(tmpdir(), "cave-hub-token-"));
process.env.HOME = home;
process.env.COVEN_HOME = path.join(home, ".coven");
delete process.env.COVEN_CAVE_HOME;
delete process.env.COVEN_CAVE_HUB_ACCESS_TOKEN;

const { splitHubAccessToken, storedHubAccessToken, rememberHubAccessToken, HUB_ACCESS_TOKEN_KEY } =
  await import("./hub-access-token.ts");
const { getLocalEncryptedSecret, setLocalEncryptedSecret } = await import("./local-encrypted-vault.ts");
const { loadConfig, saveConfig } = await import("./cave-config.ts");
const { daemonTargetForConfig } = await import("./coven-daemon.ts");
const { writeJsonAtomic } = await import("./server/atomic-write.ts");

const CONFIG_PATH = path.join(process.env.COVEN_HOME, "cave", "config.json");

function decodedHubTokenCustody() {
  const raw = getLocalEncryptedSecret(HUB_ACCESS_TOKEN_KEY);
  return raw ? JSON.parse(raw) : null;
}

// ── splitHubAccessToken is pure and conservative ─────────────────────────────
{
  const split = splitHubAccessToken(
    "https://cave.tailnet.example.ts.net/?coven_access_token=v1.tok&covenCaveToken=sidecar",
  );
  assert.equal(split.token, "v1.tok", "the embedded access token is extracted");
  assert.doesNotMatch(split.url, /coven_access_token|v1\.tok/, "the cleaned URL drops the credential");
  assert.match(split.url, /covenCaveToken=sidecar/, "unrelated query params survive the split");

  assert.deepEqual(
    splitHubAccessToken("https://hub.example:8787"),
    { url: "https://hub.example:8787" },
    "a token-free URL is returned untouched",
  );
  const bare = splitHubAccessToken("hub.tailnet:8787?coven_access_token=v1.bare");
  assert.equal(bare.token, "v1.bare", "scheme-less hub hosts still split");
  assert.doesNotMatch(bare.url, /^https?:\/\//, "scheme-less input stays scheme-less");
  assert.doesNotMatch(bare.url, /coven_access_token/, "scheme-less input is cleaned too");
  assert.deepEqual(splitHubAccessToken(""), { url: "" }, "empty input passes through");
  assert.deepEqual(
    splitHubAccessToken("::not a url::"),
    { url: "::not a url::" },
    "unparseable input is left for the caller's own URL handling",
  );
}

// ── vault custody round-trip with env override precedence ────────────────────
{
  assert.equal(storedHubAccessToken("https://hub.example"), null, "no custody yet → null");
  assert.equal(
    rememberHubAccessToken("v1.vaulted", "https://hub.example"),
    true,
    "vault write succeeds",
  );
  assert.equal(
    storedHubAccessToken("https://hub.example/path"),
    "v1.vaulted",
    "vault value resolves for its origin",
  );
  assert.equal(
    storedHubAccessToken("https://other.example"),
    null,
    "vault value is not used for another origin",
  );
  assert.deepEqual(
    decodedHubTokenCustody(),
    { v: 1, origin: "https://hub.example", token: "v1.vaulted" },
    "the token lives in the encrypted local vault with its hub origin",
  );
  process.env.COVEN_CAVE_HUB_ACCESS_TOKEN = "v1.env";
  assert.equal(
    storedHubAccessToken("https://other.example"),
    "v1.env",
    "an explicit env override wins over the vault",
  );
  delete process.env.COVEN_CAVE_HUB_ACCESS_TOKEN;
  assert.equal(
    rememberHubAccessToken("   ", "https://hub.example"),
    false,
    "blank tokens are refused, not parked in the vault",
  );
  assert.equal(
    storedHubAccessToken("https://hub.example"),
    "v1.vaulted",
    "a refused write leaves prior custody intact",
  );
  assert.equal(
    rememberHubAccessToken("  v1.padded \n", "https://hub.example"),
    true,
    "padded input is trimmed before storage",
  );
  assert.equal(
    storedHubAccessToken("https://hub.example"),
    "v1.padded",
    "custody resolves trimmed, never truthy-but-padded",
  );
}

// ── saveConfig never persists the embedded token ──────────────────────────────
{
  const saved = await saveConfig({
    multiHost: {
      mode: "hub",
      hubUrl: "https://hub.tailnet.example.ts.net/?coven_access_token=v1.saved",
      executorUrls: [],
    },
  });
  assert.doesNotMatch(saved.multiHost.hubUrl, /coven_access_token|v1\.saved/, "the in-memory result is clean");
  const onDisk = await readFile(CONFIG_PATH, "utf8");
  assert.doesNotMatch(onDisk, /coven_access_token|v1\.saved/, "config.json never contains the credential");
  assert.deepEqual(
    decodedHubTokenCustody(),
    { v: 1, origin: "https://hub.tailnet.example.ts.net", token: "v1.saved" },
    "the credential moved to the vault with its origin",
  );
}

// ── the daemon target resolves the token back from custody ───────────────────
{
  const target = daemonTargetForConfig(await loadConfig());
  assert.equal(target.mode, "hub");
  assert.equal(target.url, "https://hub.tailnet.example.ts.net");
  assert.equal(target.accessToken, "v1.saved", "hub requests still authenticate after the split");
}

// ── a freshly pasted (embedded) token wins over stale custody ─────────────────
{
  const target = daemonTargetForConfig({
    multiHost: {
      mode: "hub",
      hubUrl: "https://hub.tailnet.example.ts.net/?coven_access_token=v1.pasted",
      executorUrls: [],
    },
  });
  assert.equal(target.accessToken, "v1.pasted", "an embedded token outranks the vaulted one");
}

// ── loadConfig self-heals a legacy config that still embeds the token ─────────
{
  const legacy = await loadConfig();
  await writeJsonAtomic(CONFIG_PATH, {
    ...legacy,
    multiHost: {
      mode: "hub",
      hubUrl: "https://hub.tailnet.example.ts.net/?coven_access_token=v1.legacy",
      executorUrls: [],
    },
  });
  const migrated = await loadConfig();
  assert.doesNotMatch(migrated.multiHost.hubUrl, /coven_access_token|v1\.legacy/, "load returns the clean URL");
  assert.deepEqual(
    decodedHubTokenCustody(),
    { v: 1, origin: "https://hub.tailnet.example.ts.net", token: "v1.legacy" },
    "the legacy token moved to the vault with its origin",
  );
  const rewritten = await readFile(CONFIG_PATH, "utf8");
  assert.doesNotMatch(rewritten, /coven_access_token|v1\.legacy/, "the file itself is rewritten clean");
  const target = daemonTargetForConfig(migrated);
  assert.equal(target.accessToken, "v1.legacy", "hub auth survives the migration");
}

// ── raw vaulted custody migrates once to the configured hub origin ──────────
{
  setLocalEncryptedSecret(HUB_ACCESS_TOKEN_KEY, "v1.raw-vault");
  const migrated = await loadConfig();
  assert.deepEqual(
    decodedHubTokenCustody(),
    { v: 1, origin: "https://hub.tailnet.example.ts.net", token: "v1.raw-vault" },
    "pre-origin custody is rebound once to the current configured hub",
  );
  const target = daemonTargetForConfig(migrated);
  assert.equal(target.accessToken, "v1.raw-vault", "raw-custody migration preserves hub auth");
}

// ── changing to a tokenless hub URL does not leak prior custody ──────────────
{
  const switched = await saveConfig({
    multiHost: {
      mode: "hub",
      hubUrl: "https://attacker.example",
      executorUrls: [],
    },
  });
  const target = daemonTargetForConfig(switched);
  assert.equal(target.mode, "hub");
  assert.equal(target.url, "https://attacker.example");
  assert.equal(
    target.accessToken,
    undefined,
    "prior hub token is not attached to a different origin",
  );
  assert.equal(
    getLocalEncryptedSecret(HUB_ACCESS_TOKEN_KEY),
    null,
    "origin change clears stale vaulted custody",
  );
}

console.log("hub-access-token.test.ts OK");
