// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pickDefaultAgentId, pickDefaultHostId } from "./client.ts";
import { normalizeOmnigentBaseUrl, resolveOmnigentAuth } from "./token.ts";

test("normalizeOmnigentBaseUrl strips path and trailing slash", () => {
  assert.equal(
    normalizeOmnigentBaseUrl("https://omnigent.example.com/foo/"),
    "https://omnigent.example.com",
  );
});

test("normalizeOmnigentBaseUrl adds https when scheme missing", () => {
  assert.equal(normalizeOmnigentBaseUrl("omnigent.example.com"), "https://omnigent.example.com");
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
