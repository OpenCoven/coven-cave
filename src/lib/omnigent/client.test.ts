// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pickDefaultAgentId, pickDefaultHostId } from "./client.ts";
import {
  isOmnigentEnvConfigured,
  isOmnigentFleetActive,
  isOmnigentServerUrlConfigured,
  normalizeOmnigentBaseUrl,
  resolveOmnigentAuth,
  resolveOmnigentBaseUrl,
} from "./token.ts";

// Sandbox the Cave Vault: OMNIGENT_TOKEN resolves through it (process env →
// .env.local → encrypted store → op/dl ref), so point every vault path at a
// fresh tmp dir and clear any real token so developer/CI machine state can't
// leak into auth-resolution assertions.
const vaultSandbox = mkdtempSync(path.join(os.tmpdir(), "omnigent-vault-sandbox-"));
process.env.COVEN_CAVE_HOME = path.join(vaultSandbox, "cave");
process.env.COVEN_VAULT_FILE = path.join(vaultSandbox, "vault.yaml");
process.env.COVEN_CAVE_ENV_FILE = path.join(vaultSandbox, ".env.local");
process.env.COVEN_CAVE_LOCAL_VAULT_FILE = path.join(vaultSandbox, "local-vault.enc.json");
process.env.COVEN_CAVE_LOCAL_VAULT_KEY_FILE = path.join(vaultSandbox, "local-vault.key");
delete process.env.OMNIGENT_TOKEN;
delete process.env.OMNIGENT_SERVER_URL;

test("normalizeOmnigentBaseUrl strips path and trailing slash", () => {
  assert.equal(
    normalizeOmnigentBaseUrl("https://omnigent.example.com/foo/"),
    "https://omnigent.example.com",
  );
});

test("normalizeOmnigentBaseUrl adds https when scheme missing", () => {
  assert.equal(normalizeOmnigentBaseUrl("omnigent.example.com"), "https://omnigent.example.com");
});

test("normalizeOmnigentBaseUrl handles adversarial slash runs in linear time", () => {
  const repeatedSlashes = `bad host${"/".repeat(25_000)}!`;
  assert.equal(normalizeOmnigentBaseUrl(repeatedSlashes), repeatedSlashes);
});

test("pickDefaultAgentId prefers preferred id then claude-native-ui", () => {
  const agents = [
    { id: "ag_a", name: "polly" },
    { id: "ag_b", name: "claude-native-ui", harness: "claude-native" },
  ];
  assert.equal(pickDefaultAgentId(agents, "ag_a"), "ag_a");
  assert.equal(pickDefaultAgentId(agents), "ag_b");
});

test("pickDefaultHostId prefers preferred id then online host", () => {
  const hosts = [
    { host_id: "host_offline", name: "down", status: "offline" },
    { host_id: "host_online", name: "up", status: "online" },
  ];
  assert.equal(pickDefaultHostId(hosts, "host_offline"), "host_offline");
  assert.equal(pickDefaultHostId(hosts), "host_online");
});

test("omnigent host option ids round-trip", async () => {
  const { omnigentHostOptionId, parseOmnigentHostOptionId, isOmnigentHostOptionId } = await import(
    "./ids.ts"
  );
  const id = omnigentHostOptionId("host_abc");
  assert.equal(id, "omnigent:host_abc");
  assert.equal(parseOmnigentHostOptionId(id), "host_abc");
  assert.equal(isOmnigentHostOptionId(id), true);
  assert.equal(isOmnigentHostOptionId("local"), false);
});

test("normalizeOmnigentConfig keeps hostMap, hostWorkspaceMap, exposeHostsInComposer", async () => {
  const { normalizeOmnigentConfig } = await import("../cave-config.ts");
  const cfg = normalizeOmnigentConfig({
    baseUrl: "https://omni.example.com/",
    hostMap: { "ubuntu-root": "host_9" },
    hostWorkspaceMap: {
      host_9: "/root/work",
      "Macbook-Pro-5.local": "/Users/a/proj",
    },
    exposeHostsInComposer: false,
  });
  assert.equal(cfg.baseUrl, "https://omni.example.com");
  assert.equal(cfg.hostMap["ubuntu-root"], "host_9");
  assert.equal(cfg.hostWorkspaceMap.host_9, "/root/work");
  assert.equal(cfg.hostWorkspaceMap["Macbook-Pro-5.local"], "/Users/a/proj");
  assert.equal(cfg.exposeHostsInComposer, false);
});

test("normalizeOmnigentConfig removes trailing slashes without a backtracking regex", async () => {
  const { normalizeOmnigentConfig } = await import("../cave-config.ts");

  assert.equal(
    normalizeOmnigentConfig({ baseUrl: "https://omni.example.com////" }).baseUrl,
    "https://omni.example.com",
  );
  assert.equal(normalizeOmnigentConfig({ baseUrl: "bad host///" }).baseUrl, "bad host");

  const repeatedSlashes = `bad host${"/".repeat(25_000)}!`;
  assert.equal(normalizeOmnigentConfig({ baseUrl: repeatedSlashes }).baseUrl, repeatedSlashes);
});

test("resolveWorkspaceForHost prefers host_id then name then hostMap alias", async () => {
  const { resolveWorkspaceForHost } = await import("./workspace-resolve.ts");
  const maps = {
    hostMap: {
      "ubuntu-root": "host_linux",
      "Macbook-Pro-5.local": "host_mbp",
    },
    hostWorkspaceMap: {
      host_studio: "/Users/a/Studio/proj",
      "Andrews-Mac-Studio.local": "/Users/a/Studio/by-name",
      "ubuntu-root": "/root/ubuntu-work",
    },
  };

  assert.equal(
    resolveWorkspaceForHost(maps, "host_studio", "ignored"),
    "/Users/a/Studio/proj",
  );
  assert.equal(
    resolveWorkspaceForHost(maps, "host_other", "Andrews-Mac-Studio.local"),
    "/Users/a/Studio/by-name",
  );
  assert.equal(
    resolveWorkspaceForHost(maps, "host_linux", "ubuntu-root"),
    "/root/ubuntu-work",
  );
  assert.equal(resolveWorkspaceForHost(maps, "host_mbp", "Macbook-Pro-5.local"), undefined);
});

test("resolveOmnigentAuth reads JWT and rejects expired", async () => {
  const prevHome = process.env.HOME;
  const tmp = await mkdtemp(path.join(os.tmpdir(), "omnigent-auth-"));
  process.env.HOME = tmp;
  try {
    const dir = path.join(tmp, ".omnigent");
    await mkdir(dir, { recursive: true });
    const base = "https://omni.example.com";
    await writeFile(
      path.join(dir, "auth_tokens.json"),
      JSON.stringify({
        [base]: {
          token: "jwt-live",
          user_id: "a",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        },
      }),
    );
    const live = await resolveOmnigentAuth(base);
    assert.equal(live.mode, "jwt");
    assert.equal(live.token, "jwt-live");
    assert.equal(live.authenticated, true);

    await writeFile(
      path.join(dir, "auth_tokens.json"),
      JSON.stringify({
        [base]: {
          token: "jwt-dead",
          user_id: "a",
          expires_at: Math.floor(Date.now() / 1000) - 10,
        },
      }),
    );
    delete process.env.OMNIGENT_TOKEN;
    const expired = await resolveOmnigentAuth(base);
    assert.equal(expired.token, null);
    assert.equal(expired.mode, "none");
  } finally {
    process.env.HOME = prevHome;
  }
});

test("resolveOmnigentAuth recognizes databricks pointer without requiring CLI mint", async () => {
  const prevHome = process.env.HOME;
  const tmp = await mkdtemp(path.join(os.tmpdir(), "omnigent-dbx-"));
  process.env.HOME = tmp;
  try {
    const dir = path.join(tmp, ".omnigent");
    await mkdir(dir, { recursive: true });
    const base = "https://myapp.aws.databricksapps.com";
    await writeFile(
      path.join(dir, "auth_tokens.json"),
      JSON.stringify({
        [base]: {
          auth_type: "databricks",
          workspace_host: "https://example.databricks.com",
          org_id: "12345",
        },
      }),
    );
    // databricks CLI may be missing — pointer still marks authenticated, mode databricks
    const auth = await resolveOmnigentAuth(base);
    assert.equal(auth.mode, "databricks");
    assert.equal(auth.authenticated, true);
    assert.equal(auth.extraHeaders["X-Databricks-Org-Id"], "12345");
  } finally {
    process.env.HOME = prevHome;
  }
});

test("resolveOmnigentAuth allows unauthenticated local mode", async () => {
  const prevHome = process.env.HOME;
  const prevTok = process.env.OMNIGENT_TOKEN;
  const tmp = await mkdtemp(path.join(os.tmpdir(), "omnigent-none-"));
  process.env.HOME = tmp;
  delete process.env.OMNIGENT_TOKEN;
  try {
    const auth = await resolveOmnigentAuth("http://127.0.0.1:6767");
    assert.equal(auth.mode, "none");
    assert.equal(auth.token, null);
    assert.equal(auth.authenticated, false);
  } finally {
    process.env.HOME = prevHome;
    if (prevTok === undefined) delete process.env.OMNIGENT_TOKEN;
    else process.env.OMNIGENT_TOKEN = prevTok;
  }
});

test("resolveOmnigentAuth resolves OMNIGENT_TOKEN through the Cave Vault", async () => {
  const prevHome = process.env.HOME;
  const tmp = await mkdtemp(path.join(os.tmpdir(), "omnigent-vault-"));
  process.env.HOME = tmp; // no ~/.omnigent/auth_tokens.json
  delete process.env.OMNIGENT_TOKEN;
  try {
    // Nothing in the sandboxed vault yet → env not configured, fleet stays hidden.
    assert.equal(isOmnigentEnvConfigured(), false);

    const { setLocalEncryptedSecret, deleteLocalEncryptedSecret } = await import(
      "../local-encrypted-vault.ts"
    );
    setLocalEncryptedSecret("OMNIGENT_TOKEN", "vault-token");
    try {
      assert.equal(isOmnigentEnvConfigured(), true);
      const auth = await resolveOmnigentAuth("https://omni.example.com");
      assert.equal(auth.mode, "env");
      assert.equal(auth.token, "vault-token");
      assert.equal(auth.authenticated, true);
    } finally {
      deleteLocalEncryptedSecret("OMNIGENT_TOKEN");
    }
  } finally {
    delete process.env.OMNIGENT_TOKEN; // resolveSecret caches into process.env
    process.env.HOME = prevHome;
  }
});

test("isOmnigentServerUrlConfigured reflects vault state", async () => {
  delete process.env.OMNIGENT_SERVER_URL;
  // Sandboxed vault is empty → not configured, Daemon-tab group stays hidden.
  assert.equal(isOmnigentServerUrlConfigured(), false);

  const { setLocalEncryptedSecret, deleteLocalEncryptedSecret } = await import(
    "../local-encrypted-vault.ts"
  );
  setLocalEncryptedSecret("OMNIGENT_SERVER_URL", "https://omni.example.com");
  try {
    assert.equal(isOmnigentServerUrlConfigured(), true);
  } finally {
    deleteLocalEncryptedSecret("OMNIGENT_SERVER_URL");
    delete process.env.OMNIGENT_SERVER_URL;
  }
  assert.equal(isOmnigentServerUrlConfigured(), false);
});

test("isOmnigentServerUrlConfigured sees process env", async () => {
  process.env.OMNIGENT_SERVER_URL = "https://env.example.com";
  try {
    assert.equal(isOmnigentServerUrlConfigured(), true);
  } finally {
    delete process.env.OMNIGENT_SERVER_URL;
  }
});

test("resolveOmnigentBaseUrl prefers the vault URL over Cave config", async () => {
  delete process.env.OMNIGENT_SERVER_URL;
  const { setLocalEncryptedSecret, deleteLocalEncryptedSecret } = await import(
    "../local-encrypted-vault.ts"
  );
  setLocalEncryptedSecret("OMNIGENT_SERVER_URL", "omni.example.com/api/");
  try {
    // Vault value wins over the config fallback and is normalized.
    assert.equal(
      resolveOmnigentBaseUrl("https://config.example.com"),
      "https://omni.example.com",
    );
  } finally {
    deleteLocalEncryptedSecret("OMNIGENT_SERVER_URL");
    delete process.env.OMNIGENT_SERVER_URL; // resolveSecret caches into process.env
  }
});

test("resolveOmnigentBaseUrl falls back to config when vault is empty", async () => {
  delete process.env.OMNIGENT_SERVER_URL;
  assert.equal(
    resolveOmnigentBaseUrl("  https://config.example.com  "),
    "https://config.example.com",
  );
  assert.equal(resolveOmnigentBaseUrl(undefined), "");
  assert.equal(resolveOmnigentBaseUrl(""), "");
});

test("isOmnigentFleetActive requires BOTH the vault URL and the enable toggle", async () => {
  delete process.env.OMNIGENT_SERVER_URL;
  // Toggle on but no vault key → inactive (config fallback can't activate it).
  assert.equal(isOmnigentFleetActive({ enabled: true }), false);

  process.env.OMNIGENT_SERVER_URL = "https://omni.example.com";
  try {
    assert.equal(isOmnigentFleetActive({ enabled: true }), true);
    // Vault key alone (toggle off / absent) → inactive.
    assert.equal(isOmnigentFleetActive({ enabled: false }), false);
    assert.equal(isOmnigentFleetActive({}), false);
    assert.equal(isOmnigentFleetActive(undefined), false);
  } finally {
    delete process.env.OMNIGENT_SERVER_URL;
  }
});

test("isOmnigentFleetActive sees a vault-stored server URL", async () => {
  delete process.env.OMNIGENT_SERVER_URL;
  const { setLocalEncryptedSecret, deleteLocalEncryptedSecret } = await import(
    "../local-encrypted-vault.ts"
  );
  setLocalEncryptedSecret("OMNIGENT_SERVER_URL", "https://omni.example.com");
  try {
    assert.equal(isOmnigentFleetActive({ enabled: true }), true);
    assert.equal(isOmnigentFleetActive({ enabled: false }), false);
  } finally {
    deleteLocalEncryptedSecret("OMNIGENT_SERVER_URL");
    delete process.env.OMNIGENT_SERVER_URL;
  }
});
