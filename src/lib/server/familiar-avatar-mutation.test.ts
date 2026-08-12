// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  removeAvatarFiles,
  writeCanonicalAvatar,
} from "./familiar-avatar-mutation.ts";

const root = await mkdtemp(path.join(os.tmpdir(), "cave-familiar-avatar-"));

{
  const dir = path.join(root, "write");
  const result = await writeCanonicalAvatar(dir, "cody", Buffer.from("png-bytes"));

  assert.equal(result.fileName, "cody.png");
  assert.ok(Number.isFinite(result.revision));
  assert.deepEqual(await readFile(path.join(dir, "cody.png")), Buffer.from("png-bytes"));
}

{
  const dir = path.join(root, "write-symlink");
  const target = path.join(root, "outside.png");
  await writeFile(target, "outside");
  await symlink(target, path.join(dir, "cody.png")).catch(async () => {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(dir, { recursive: true });
    await symlink(target, path.join(dir, "cody.png"));
  });

  await assert.rejects(
    writeCanonicalAvatar(dir, "cody", Buffer.from("replacement")),
    /symbolic link/i,
  );
  assert.equal(await readFile(target, "utf8"), "outside");
}

{
  const dir = path.join(root, "remove");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "cody.png"), "png");
  await writeFile(path.join(dir, "portrait.jpg"), "jpg");
  await writeFile(path.join(dir, "README.md"), "keep");

  assert.deepEqual(await removeAvatarFiles(dir), { removed: true });
  assert.equal(await readFile(path.join(dir, "README.md"), "utf8"), "keep");
  assert.deepEqual(await removeAvatarFiles(dir), { removed: false });
}

{
  const dir = path.join(root, "remove-symlink");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(dir, { recursive: true });
  const target = path.join(root, "outside-remove.png");
  await writeFile(target, "outside");
  await writeFile(path.join(dir, "cody.png"), "keep");
  await symlink(target, path.join(dir, "portrait.png"));

  await assert.rejects(removeAvatarFiles(dir), /symbolic link/i);
  assert.equal(await readFile(path.join(dir, "cody.png"), "utf8"), "keep");
  assert.equal(await readFile(target, "utf8"), "outside");
}

console.log("familiar-avatar-mutation.test.ts: ok");
