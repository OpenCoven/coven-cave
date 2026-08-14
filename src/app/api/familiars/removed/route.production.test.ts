// @ts-nocheck
import assert from "node:assert/strict";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const workspace = path.resolve(".test-tmp", `familiar-remove-restore-${process.pid}`);
const home = path.join(workspace, "home");
const coven = path.join(home, ".coven");
const originalHome = process.env.HOME;
process.env.HOME = home;
process.env.COVEN_HOME = coven;
delete process.env.COVEN_CAVE_HOME;
delete globalThis.__caveHomeMigration;

const id = "transactional-familiar";
const toml = `# User familiars for this Coven.

[[familiar]]
id = "${id}"
display_name = "Transactional Familiar"
description = "Exercises lifecycle rollback."
harness = "codex"
`;

try {
  await rm(workspace, { recursive: true, force: true });
  await mkdir(path.join(coven, "cave"), { recursive: true });
  const { loadConfig, saveConfig } = await import("../../../../lib/cave-config.ts");
  const { readTombstones } = await import("../../../../lib/server/familiar-tombstones.ts");
  const { DELETE } = await import("../[id]/route.ts");
  const { POST } = await import("./route.ts");

  await saveConfig({ familiars: { [id]: { harness: "codex", note: "preserve" } } });
  const tomlPath = path.join(coven, "familiars.toml");
  await writeFile(tomlPath, toml);

  await chmod(coven, 0o555);
  try {
    await assert.rejects(() =>
      DELETE(new Request(`http://local/api/familiars/${id}`, { method: "DELETE" }), {
        params: Promise.resolve({ id }),
      }));
  } finally {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    await chmod(coven, 0o755);
  }
  assert.equal(await readFile(tomlPath, "utf8"), toml);
  assert.ok((await loadConfig()).familiars[id], "failed remove preserves the binding");
  assert.equal(
    (await readTombstones()).some((entry) => entry.id === id),
    false,
    "failed remove rolls its tombstone back",
  );

  const removed = await DELETE(
    new Request(`http://local/api/familiars/${id}`, { method: "DELETE" }),
    { params: Promise.resolve({ id }) },
  );
  assert.equal(removed.status, 200);
  assert.equal((await loadConfig()).familiars[id], undefined);

  await chmod(path.join(coven, "cave"), 0o555);
  try {
    await assert.rejects(() =>
      POST(new Request("http://local/api/familiars/removed", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      })));
  } finally {
    await chmod(path.join(coven, "cave"), 0o755);
  }
  assert.equal((await loadConfig()).familiars[id], undefined);
  assert.doesNotMatch(await readFile(tomlPath, "utf8"), new RegExp(`id = "${id}"`));
  assert.equal(
    (await readTombstones()).some((entry) => entry.id === id),
    true,
    "failed restore retains the tombstone for retry",
  );

  const restored = await POST(new Request("http://local/api/familiars/removed", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id }),
  }));
  assert.equal(restored.status, 200);
  assert.equal((await loadConfig()).familiars[id]?.note, "preserve");
  assert.match(await readFile(tomlPath, "utf8"), new RegExp(`id = "${id}"`));
  assert.equal((await readTombstones()).some((entry) => entry.id === id), false);

  console.log("familiar remove/restore production transaction tests: ok");
} finally {
  delete process.env.COVEN_HOME;
  delete globalThis.__caveHomeMigration;
  await chmod(coven, 0o755).catch(() => {});
  await chmod(path.join(coven, "cave"), 0o755).catch(() => {});
  await rm(workspace, { recursive: true, force: true });
}
