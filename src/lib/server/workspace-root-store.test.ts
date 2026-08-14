import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import {
  covenWorkspaceRoot,
  readWorkspaceRootOverride,
  workspaceRootEnvPin,
  workspaceRootOverrideFile,
} from "../coven-paths.ts";
import {
  clearWorkspaceRoot,
  saveWorkspaceRoot,
  validateWorkspaceRoot,
  workspaceRootStatus,
} from "./workspace-root-store.ts";

const TEST_ARTIFACTS_ROOT = path.join(process.cwd(), ".test-artifacts");

const ENV_KEYS = [
  "COVEN_HOME",
  "COVEN_CAVE_HOME",
  "COVEN_WORKSPACES_ROOT",
  "COVEN_WORKSPACE_ROOT",
  "WORKSPACE_ROOT",
  "NEXT_PUBLIC_WORKSPACE_ROOT",
] as const;

/** Run `body` against a scratch Cave home with every workspace env var cleared. */
async function withScratchHome(body: (base: string) => Promise<void> | void) {
  const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  fs.mkdirSync(TEST_ARTIFACTS_ROOT, { recursive: true });
  const base = fs.mkdtempSync(path.join(TEST_ARTIFACTS_ROOT, "workspace-root-"));
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.COVEN_HOME = base;
  try {
    await body(base);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(base, { recursive: true, force: true });
  }
}

test("with nothing saved the root falls back to the default beneath the Cave home", async () => {
  await withScratchHome((base) => {
    assert.equal(readWorkspaceRootOverride(), null);
    assert.equal(covenWorkspaceRoot(), path.join(base, "workspaces"));
    assert.deepEqual(workspaceRootStatus(), {
      workspacePath: path.join(base, "workspaces"),
      envPin: null,
      chosen: false,
    });
  });
});

test("a saved root is what covenWorkspaceRoot resolves to", async () => {
  await withScratchHome(async (base) => {
    const target = path.join(base, "elsewhere", "workspaces");
    fs.mkdirSync(target, { recursive: true });

    const result = await saveWorkspaceRoot(target);

    assert.deepEqual(result, { ok: true, workspacePath: target });
    assert.equal(readWorkspaceRootOverride(), target);
    assert.equal(covenWorkspaceRoot(), target);
    assert.equal(workspaceRootStatus().chosen, true);
  });
});

test("the saved root survives a reread and can be cleared", async () => {
  await withScratchHome(async (base) => {
    const target = path.join(base, "picked");
    fs.mkdirSync(target, { recursive: true });
    await saveWorkspaceRoot(target);
    assert.equal(covenWorkspaceRoot(), target);

    await clearWorkspaceRoot();

    assert.equal(readWorkspaceRootOverride(), null);
    assert.equal(covenWorkspaceRoot(), path.join(base, "workspaces"));
  });
});

test("an env pin wins over a saved root and blocks saving a new one", async () => {
  await withScratchHome(async (base) => {
    const saved = path.join(base, "saved");
    const pinned = path.join(base, "pinned");
    fs.mkdirSync(saved, { recursive: true });
    fs.mkdirSync(pinned, { recursive: true });
    await saveWorkspaceRoot(saved);

    process.env.COVEN_WORKSPACE_ROOT = pinned;

    assert.deepEqual(workspaceRootEnvPin(), { name: "COVEN_WORKSPACE_ROOT", value: pinned });
    assert.equal(covenWorkspaceRoot(), pinned, "the env pin wins the resolution");
    assert.equal(workspaceRootStatus().envPin, "COVEN_WORKSPACE_ROOT");
    // Saving under a pin would persist a preference the app then ignores.
    assert.deepEqual(await saveWorkspaceRoot(path.join(base, "saved")), {
      ok: false,
      reason: "env-pinned",
    });
  });
});

test("a malformed override file degrades to the default instead of throwing", async () => {
  await withScratchHome((base) => {
    fs.mkdirSync(path.dirname(workspaceRootOverrideFile()), { recursive: true });
    fs.writeFileSync(workspaceRootOverrideFile(), "{not json");
    assert.equal(readWorkspaceRootOverride(), null);
    assert.equal(covenWorkspaceRoot(), path.join(base, "workspaces"));

    fs.writeFileSync(workspaceRootOverrideFile(), JSON.stringify({ workspacePath: "   " }));
    assert.equal(readWorkspaceRootOverride(), null, "a blank value is not a choice");
  });
});

test("validation refuses relative, missing, and unbounded roots", async () => {
  await withScratchHome((base) => {
    const real = path.join(base, "real");
    fs.mkdirSync(real, { recursive: true });

    assert.deepEqual(validateWorkspaceRoot(real), { ok: true, workspacePath: real });
    assert.deepEqual(validateWorkspaceRoot(""), { ok: false, reason: "invalid-path" });
    assert.deepEqual(validateWorkspaceRoot("relative/dir"), { ok: false, reason: "invalid-path" });
    assert.deepEqual(validateWorkspaceRoot(path.join(base, "ghost")), {
      ok: false,
      reason: "invalid-path",
    });
    // A whole drive (or "/") is never a sane place to store workspaces.
    assert.deepEqual(validateWorkspaceRoot(path.parse(real).root), {
      ok: false,
      reason: "unbounded",
    });
  });
});

test("a file (not a directory) is never accepted as a workspace root", async () => {
  await withScratchHome((base) => {
    const file = path.join(base, "notes.txt");
    fs.writeFileSync(file, "x");
    assert.deepEqual(validateWorkspaceRoot(file), { ok: false, reason: "invalid-path" });
  });
});

test("$HOME itself is refused, matching what the picker lets you select", async () => {
  await withScratchHome(() => {
    // The picker disables selecting bare $HOME (selectDisabled), and the
    // server has to mirror it or the two disagree about the same click.
    assert.deepEqual(validateWorkspaceRoot(homedir()), { ok: false, reason: "unbounded" });
  });
});

// The writer refuses relative paths and bare volume roots, but the override is
// plain JSON in the user's Cave home. covenWorkspaceRoot() feeds project-paths'
// allowed-root list, so a hand-edited file must not be able to widen it past
// what a save would have permitted.
test("a hand-edited override cannot widen past what saving allows", async () => {
  await withScratchHome((base) => {
    const write = (workspacePath: string) => {
      fs.mkdirSync(path.dirname(workspaceRootOverrideFile()), { recursive: true });
      fs.writeFileSync(workspaceRootOverrideFile(), JSON.stringify({ workspacePath }));
    };
    const fallback = path.join(base, "workspaces");

    write(path.parse(process.cwd()).root);
    assert.equal(readWorkspaceRootOverride(), null, "a bare volume root is rejected on read");
    assert.equal(covenWorkspaceRoot(), fallback);

    write("relative/dir");
    assert.equal(
      readWorkspaceRootOverride(),
      path.resolve("relative/dir"),
      "a relative value is resolved rather than handed on raw",
    );

    write(42 as unknown as string);
    assert.equal(readWorkspaceRootOverride(), null, "a non-string value is rejected");
  });
});

// covenWorkspaceRoot() is sync and sits on hot paths (one call per directory
// entry in fs-browse), so the parse is cached against the file's stat. The
// cache must never outlive a write or a delete.
test("the cached override is invalidated by a rewrite and by a delete", async () => {
  await withScratchHome(async (base) => {
    const first = path.join(base, "first");
    const second = path.join(base, "second-with-a-different-length");
    fs.mkdirSync(first, { recursive: true });
    fs.mkdirSync(second, { recursive: true });

    await saveWorkspaceRoot(first);
    assert.equal(covenWorkspaceRoot(), first);
    assert.equal(covenWorkspaceRoot(), first, "a repeat read is served from cache");

    await saveWorkspaceRoot(second);
    assert.equal(covenWorkspaceRoot(), second, "a save is visible immediately");

    await clearWorkspaceRoot();
    assert.equal(
      covenWorkspaceRoot(),
      path.join(base, "workspaces"),
      "a deleted override stops resolving to the root it named",
    );
  });
});
