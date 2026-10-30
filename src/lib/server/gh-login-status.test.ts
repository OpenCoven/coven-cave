// @ts-nocheck
import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  ghStatusProbeEnv,
  hasGhStoredLogin,
  resetGhStoredLoginCache,
  runGhAuthStatus,
} from "./gh-login-status.ts";

// The probe env carries no token variables and can never prompt.
{
  const probe = ghStatusProbeEnv({
    HOME: "/home/f",
    PATH: "/bin",
    GH_TOKEN: "a",
    GITHUB_TOKEN: "b",
    GITHUB_PAT: "c",
    gh_token: "d",
    GH_ENTERPRISE_TOKEN: "e",
  });
  assert.equal(probe.HOME, "/home/f");
  assert.equal(probe.PATH, "/bin");
  for (const key of ["GH_TOKEN", "GITHUB_TOKEN", "GITHUB_PAT", "gh_token", "GH_ENTERPRISE_TOKEN"]) {
    assert.equal(probe[key], undefined, `${key} is not passed to gh auth status`);
  }
  assert.equal(probe.GH_PROMPT_DISABLED, "1");
}

// Cached per HOME/config/PATH within a minute; re-probed after it.
{
  resetGhStoredLoginCache();
  let calls = 0;
  const run = async () => {
    calls += 1;
    return true;
  };
  const env = { HOME: "/home/a", PATH: "/bin" };
  assert.equal(await hasGhStoredLogin(env, { run, now: () => 0 }), true);
  assert.equal(await hasGhStoredLogin(env, { run, now: () => 59_999 }), true);
  assert.equal(calls, 1, "a second turn inside the TTL does not spawn gh");
  await hasGhStoredLogin(env, { run, now: () => 60_000 });
  assert.equal(calls, 2, "the TTL expires");
  await hasGhStoredLogin({ HOME: "/home/b", PATH: "/bin" }, { run, now: () => 60_001 });
  assert.equal(calls, 3, "a different HOME is probed separately");
}

// A failing or non-boolean probe means "no stored login".
{
  resetGhStoredLoginCache();
  assert.equal(
    await hasGhStoredLogin({ HOME: "/x" }, { run: async () => { throw new Error("boom"); }, now: () => 0 }),
    false,
  );
  assert.equal(await hasGhStoredLogin({ HOME: "/y" }, { run: async () => "yes", now: () => 0 }), false);
}

// The real runner: exit status only, against a fake gh on PATH.
if (process.platform !== "win32") {
  const bin = await mkdtemp(path.join(tmpdir(), "gh-login-status-"));
  try {
    const gh = path.join(bin, "gh");
    // Fails if any token reaches it, so a stored-login answer never depends on a token.
    await writeFile(
      gh,
      '#!/bin/sh\n[ -n "$GH_TOKEN$GITHUB_TOKEN" ] && exit 3\n[ "$1 $2 $3 $4" = "auth status --hostname github.com" ] && exit 0\nexit 1\n',
    );
    await chmod(gh, 0o755);
    assert.equal(await runGhAuthStatus({ PATH: bin, GH_TOKEN: "leak" }), true);
    await writeFile(gh, "#!/bin/sh\nexit 1\n");
    assert.equal(await runGhAuthStatus({ PATH: bin }), false, "not logged in");
  } finally {
    await rm(bin, { recursive: true, force: true });
  }
}
{
  const empty = await mkdtemp(path.join(tmpdir(), "gh-login-status-empty-"));
  try {
    assert.equal(await runGhAuthStatus({ PATH: empty }), false, "gh not installed");
  } finally {
    await rm(empty, { recursive: true, force: true });
  }
}

console.log("gh-login-status.test.ts: ok");
