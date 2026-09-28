// @ts-nocheck
// #5679: rendered avatar thumbnails survive a server restart on disk.
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  AVATAR_THUMB_MAX_FILES,
  avatarThumbDir,
  avatarThumbKey,
  readAvatarThumb,
  writeAvatarThumb,
} from "./avatar-thumbnail-cache.ts";

const IEND = [0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, ...IEND]);
const source = { absPath: "/w/familiars/charm/avatars/charm.png", size: 34_329_645, mtimeMs: 1_750_000_000_123.4 };

function withHome(fn) {
  return async () => {
    const previous = process.env.COVEN_CAVE_HOME;
    const home = mkdtempSync(path.join(tmpdir(), "avatar-thumbs-"));
    process.env.COVEN_CAVE_HOME = home;
    try {
      await fn(home);
    } finally {
      if (previous === undefined) delete process.env.COVEN_CAVE_HOME;
      else process.env.COVEN_CAVE_HOME = previous;
      rmSync(home, { recursive: true, force: true });
    }
  };
}

test("the key changes with the source file and the render size", () => {
  const key = avatarThumbKey(source, 256);
  assert.match(key, /^[0-9a-f]{64}$/);
  assert.equal(avatarThumbKey({ ...source }, 256), key);
  assert.notEqual(avatarThumbKey({ ...source, mtimeMs: source.mtimeMs + 1000 }, 256), key);
  assert.notEqual(avatarThumbKey({ ...source, mtimeMs: source.mtimeMs + 0.25 }, 256), key, "sub-millisecond mtimes differ");
  assert.notEqual(avatarThumbKey({ ...source, size: source.size + 1 }, 256), key);
  assert.notEqual(avatarThumbKey({ ...source, absPath: "/w/other.png" }, 256), key);
  assert.notEqual(avatarThumbKey(source, 512), key);
});

test("a written thumbnail reads back", withHome(async (home) => {
  const key = avatarThumbKey(source, 256);
  assert.equal(await readAvatarThumb(key), null);
  await writeAvatarThumb(key, PNG);
  assert.deepEqual(await readAvatarThumb(key), PNG);
  assert.equal(avatarThumbDir(), path.join(home, "cache", "avatar-thumbs"));
  assert.deepEqual(readdirSync(avatarThumbDir()), [`${key}.png`], "no temp files are left behind");
}));

test("a file that is not a PNG is treated as a miss", withHome(async () => {
  const key = avatarThumbKey(source, 256);
  await writeAvatarThumb(key, PNG);
  writeFileSync(path.join(avatarThumbDir(), `${key}.png`), "truncated");
  assert.equal(await readAvatarThumb(key), null);
  writeFileSync(path.join(avatarThumbDir(), `${key}.png`), PNG.subarray(0, PNG.length - 4));
  assert.equal(await readAvatarThumb(key), null, "a PNG cut off before IEND is a miss");
}));

test("keys that are not a sha256 hex digest never touch the filesystem", withHome(async () => {
  await writeAvatarThumb("../escape", PNG);
  assert.equal(await readAvatarThumb("../escape"), null);
}));

test("nothing is cached when the Cave home is relative", async () => {
  const previous = process.env.COVEN_CAVE_HOME;
  process.env.COVEN_CAVE_HOME = "relative-home";
  try {
    assert.equal(avatarThumbDir(), null);
    const key = avatarThumbKey(source, 256);
    await writeAvatarThumb(key, PNG);
    assert.equal(await readAvatarThumb(key), null);
  } finally {
    if (previous === undefined) delete process.env.COVEN_CAVE_HOME;
    else process.env.COVEN_CAVE_HOME = previous;
  }
});

test("the directory is pruned to the newest thumbnails", withHome(async () => {
  const keys = [];
  for (let i = 0; i <= AVATAR_THUMB_MAX_FILES; i += 1) {
    const key = avatarThumbKey({ ...source, size: i }, 256);
    keys.push(key);
    await writeAvatarThumb(key, PNG);
    // Deterministic ages: the first key is the oldest.
    const at = new Date(1_700_000_000_000 + i * 1000);
    utimesSync(path.join(avatarThumbDir(), `${key}.png`), at, at);
  }
  await writeAvatarThumb(keys.at(-1), PNG);
  const left = readdirSync(avatarThumbDir());
  assert.equal(left.length, AVATAR_THUMB_MAX_FILES);
  assert.ok(!left.includes(`${keys[0]}.png`), "the oldest thumbnail is removed");
}));
