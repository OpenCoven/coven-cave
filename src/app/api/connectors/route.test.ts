// @ts-nocheck
import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

const KEYS = [
  "GITHUB_PAT", "GITHUB_TOKEN", "COVEN_GITHUB_TOKEN", "GH_TOKEN",
  "GITHUB_PERSONAL_ACCESS_TOKEN", "GITHUB_USERNAME",
  "ASANA_PAT", "ASANA_ACCESS_TOKEN", "ASANA_USER", "PATH", "GH_CONFIG_DIR",
];

async function withEnv(setup, run) {
  const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
  for (const key of KEYS) delete process.env[key];
  try {
    await setup();
    await run();
  } finally {
    for (const key of KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

test("reports desktop connection status without returning a credential", async () => {
  // An empty PATH: no gh binary, so no stored login can be reported.
  const emptyBin = await mkdtemp(path.join(tmpdir(), "connectors-no-gh-"));
  try {
    await withEnv(
      async () => {
        process.env.PATH = emptyBin;
        process.env.GH_CONFIG_DIR = path.join(emptyBin, "gh-config");
        process.env.ASANA_PAT = "asana-secret-value";
        process.env.ASANA_USER = "val@example.com";
      },
      async () => {
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
      },
    );
  } finally {
    await rm(emptyBin, { recursive: true, force: true });
  }
});

test("a stored gh login counts as GitHub connected, with no account or token", {
  skip: process.platform === "win32" ? "fake gh is a POSIX shell script" : false,
}, async () => {
  const bin = await mkdtemp(path.join(tmpdir(), "connectors-fake-gh-"));
  try {
    // A fake gh that reports a stored login only for `auth status`.
    const gh = path.join(bin, "gh");
    await writeFile(gh, '#!/bin/sh\n[ "$1" = auth ] && [ "$2" = status ] && exit 0\nexit 1\n');
    await chmod(gh, 0o755);
    await withEnv(
      async () => {
        process.env.PATH = bin;
        process.env.GH_CONFIG_DIR = path.join(bin, "gh-config");
      },
      async () => {
        const { GET } = await import("./route.ts");
        const body = await (await GET()).json();
        const github = body.connectors.find((c) => c.id === "github");
        assert.equal(github.connected, true);
        assert.equal(github.account, null);
      },
    );
  } finally {
    await rm(bin, { recursive: true, force: true });
  }
});
