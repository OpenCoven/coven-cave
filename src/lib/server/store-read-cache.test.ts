import assert from "node:assert/strict";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  clearCaveStoreReadCache,
  getStoreReadCacheMetrics,
  invalidateCachedStore,
  readCachedStore,
} from "./store-read-cache.ts";

async function scratchFile(contents: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "store-read-cache-"));
  const file = path.join(dir, "store.json");
  await writeFile(file, contents);
  return file;
}

test("a second read of an unchanged file never calls the loader", async (t) => {
  clearCaveStoreReadCache();
  const file = await scratchFile('{"n":1}');
  t.after(() => rm(path.dirname(file), { recursive: true, force: true }));

  let loads = 0;
  const load = async () => {
    loads += 1;
    return { n: 1 };
  };

  assert.deepEqual(await readCachedStore(file, load), { n: 1 });
  assert.deepEqual(await readCachedStore(file, load), { n: 1 });
  assert.deepEqual(await readCachedStore(file, load), { n: 1 });
  assert.equal(loads, 1, "the locked loader ran once for three reads");
  assert.equal(getStoreReadCacheMetrics().hits, 2);
});

test("an external write is observed on the very next read", async (t) => {
  // The whole safety argument rests on this: the cache is keyed on the file's
  // stat, so anything that rewrites the file — another process, a migration
  // replacement, a user editing config.json by hand — invalidates it without
  // anyone having to remember to call invalidate().
  clearCaveStoreReadCache();
  const file = await scratchFile('{"n":1}');
  t.after(() => rm(path.dirname(file), { recursive: true, force: true }));

  const load = async () => JSON.parse(await import("node:fs").then((fs) => fs.readFileSync(file, "utf8")));

  assert.deepEqual(await readCachedStore(file, load), { n: 1 });
  await writeFile(file, '{"n":2}');
  assert.deepEqual(await readCachedStore(file, load), { n: 2 });
});

test("a same-size rewrite is still observed", async (t) => {
  // The failure mode a size-only key would miss. mtime/ctime carry it.
  clearCaveStoreReadCache();
  const file = await scratchFile('{"n":1}');
  t.after(() => rm(path.dirname(file), { recursive: true, force: true }));

  const load = async () => JSON.parse(await import("node:fs").then((fs) => fs.readFileSync(file, "utf8")));

  assert.deepEqual(await readCachedStore(file, load), { n: 1 });
  await writeFile(file, '{"n":9}');
  const before = await stat(file);
  assert.equal(before.size, 7, "the rewrite is byte-identical in length");
  assert.deepEqual(await readCachedStore(file, load), { n: 9 });
});

test("mutating a returned value cannot poison the cache", async (t) => {
  // Every loader hands out a freshly parsed object today and callers rewrite
  // parts of it (the archive sweeps do). Sharing one reference would let any
  // caller corrupt every later reader.
  clearCaveStoreReadCache();
  const file = await scratchFile('{"n":1}');
  t.after(() => rm(path.dirname(file), { recursive: true, force: true }));

  const load = async () => ({ nested: { n: 1 } });

  const first = (await readCachedStore(file, load)) as { nested: { n: number } };
  first.nested.n = 999;
  const second = (await readCachedStore(file, load)) as { nested: { n: number } };
  assert.equal(second.nested.n, 1, "the cached value survived a caller's mutation");
  assert.notEqual(first, second, "each read gets its own object");
});

test("invalidate forces the next read through the loader", async (t) => {
  clearCaveStoreReadCache();
  const file = await scratchFile('{"n":1}');
  t.after(() => rm(path.dirname(file), { recursive: true, force: true }));

  let loads = 0;
  const load = async () => {
    loads += 1;
    return { n: loads };
  };

  await readCachedStore(file, load);
  await readCachedStore(file, load);
  assert.equal(loads, 1);
  invalidateCachedStore(file);
  await readCachedStore(file, load);
  assert.equal(loads, 2, "a write path that invalidates is not made to wait for a stat");
});

test("a missing file is never cached", async (t) => {
  // A store with no file has no stat to key on, and the loader returns
  // defaults. Caching that would hide the file the moment it appears.
  clearCaveStoreReadCache();
  const dir = await mkdtemp(path.join(tmpdir(), "store-read-cache-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "absent.json");

  let loads = 0;
  const load = async () => {
    loads += 1;
    return { defaulted: true };
  };

  await readCachedStore(file, load);
  await readCachedStore(file, load);
  assert.equal(loads, 2, "no hit is served for a file that does not exist");
  assert.equal(getStoreReadCacheMetrics().statFailures, 2);

  await writeFile(file, '{"defaulted":false}');
  await readCachedStore(file, async () => {
    loads += 1;
    return { defaulted: false };
  });
  assert.equal(loads, 3, "the file appearing is picked up immediately");
});

test("an entry older than the ttl is re-read even with an unchanged stat", async (t) => {
  // Belt and braces for filesystems that quantize timestamps coarser than they
  // report them. The stat key does the real work; this bounds how long a
  // wrong answer could survive if it ever failed to.
  clearCaveStoreReadCache();
  const file = await scratchFile('{"n":1}');
  t.after(() => rm(path.dirname(file), { recursive: true, force: true }));

  let loads = 0;
  const load = async () => {
    loads += 1;
    return { n: loads };
  };

  let clock = 1_000;
  const now = () => clock;
  await readCachedStore(file, load, { ttlMs: 50, now });
  clock = 1_040;
  await readCachedStore(file, load, { ttlMs: 50, now });
  assert.equal(loads, 1, "still inside the ttl");
  clock = 1_100;
  await readCachedStore(file, load, { ttlMs: 50, now });
  assert.equal(loads, 2, "past the ttl, re-read despite an unchanged stat");
});

test("an atomic write drops the cached entry for the file it replaced", async (t) => {
  // The single integration point. writeFileAtomic invalidates by path, so every
  // store write — the seven config sites, the state site, and any added later —
  // is covered without a call-site edit that someone can forget. The stat key
  // would catch the change on the next read regardless; this makes a
  // same-process write-then-read exact whatever the filesystem's timestamp
  // resolution turns out to be.
  clearCaveStoreReadCache();
  const file = await scratchFile('{"n":1}');
  t.after(() => rm(path.dirname(file), { recursive: true, force: true }));

  let loads = 0;
  const load = async () => {
    loads += 1;
    return { n: loads };
  };

  await readCachedStore(file, load);
  await readCachedStore(file, load);
  assert.equal(loads, 1, "cached");

  const { writeJsonAtomic } = await import("./atomic-write.ts");
  await writeJsonAtomic(file, { n: 2 });

  await readCachedStore(file, load);
  assert.equal(loads, 2, "the write invalidated the entry");
});

test("distinct paths do not share an entry", async (t) => {
  // Tests repoint COVEN_CAVE_HOME per case; keying on the resolved absolute
  // path is what keeps one case's config out of the next one's.
  clearCaveStoreReadCache();
  const a = await scratchFile('{"which":"a"}');
  const b = await scratchFile('{"which":"b"}');
  t.after(() => rm(path.dirname(a), { recursive: true, force: true }));
  t.after(() => rm(path.dirname(b), { recursive: true, force: true }));

  assert.deepEqual(await readCachedStore(a, async () => ({ which: "a" })), { which: "a" });
  assert.deepEqual(await readCachedStore(b, async () => ({ which: "b" })), { which: "b" });
  assert.deepEqual(await readCachedStore(a, async () => ({ which: "unused" })), { which: "a" });
});
