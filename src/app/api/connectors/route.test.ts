// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";

const KEYS = [
  "GITHUB_PAT", "GITHUB_TOKEN", "COVEN_GITHUB_TOKEN", "GH_TOKEN",
  "GITHUB_PERSONAL_ACCESS_TOKEN", "GITHUB_USERNAME",
  "ASANA_PAT", "ASANA_ACCESS_TOKEN", "ASANA_USER",
];

test("reports desktop connection status without returning a credential", async () => {
  const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
  for (const key of KEYS) delete process.env[key];
  process.env.ASANA_PAT = "asana-secret-value";
  process.env.ASANA_USER = "val@example.com";
  try {
    const { GET } = await import("./route.ts");
    const res = await GET();
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.doesNotMatch(text, /asana-secret-value/, "never echoes a token");
    const body = JSON.parse(text);
    assert.equal(body.ok, true);
    assert.deepEqual(body.connectors.map((c) => c.id), ["github", "asana"]);
    const [github, asana] = body.connectors;
    assert.deepEqual(
      { name: asana.name, connected: asana.connected, account: asana.account },
      { name: "Asana", connected: true, account: "val@example.com" },
    );
    assert.equal(github.connected, false);
    assert.equal(github.account, null);
    assert.match(github.setupHint, /^Connect GitHub on your desktop/);
    assert.match(asana.setupHint, /^Connect Asana on your desktop/);
  } finally {
    for (const key of KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
});
