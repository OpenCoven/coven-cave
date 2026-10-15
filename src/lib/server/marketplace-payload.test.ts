import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createMarketplacePayloadStore, type MarketplacePayloadIndex } from "./marketplace-payload.ts";

async function fixture(t: test.TestContext, filePath = "skills/example/SKILL.md") {
  const root = await mkdtemp(path.join(tmpdir(), "cave-payload-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bytes = Buffer.from(JSON.stringify({ schemaVersion: 1, name: "example", version: "1.0.0", files: [
    { path: filePath, executable: false, content: Buffer.from("skill instructions").toString("base64") },
  ] }));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const index: MarketplacePayloadIndex = { schemaVersion: 1, baseUrl: "https://github.com/OpenCoven/marketplace/releases/download/test/", plugins: {
    example: { version: "1.0.0", sha256, bytes: bytes.length, asset: "example-" + sha256 + ".json" },
  } };
  return { root, bytes, index, filePath };
}

test("coalesces cold downloads, materializes exact bytes, and reuses cache offline", async t => {
  const f = await fixture(t);
  let requests = 0;
  const fetcher: typeof fetch = async () => { requests++; return new Response(f.bytes); };
  const store = createMarketplacePayloadStore({ index: f.index, cacheRoot: f.root, fetcher });
  const [first, second] = await Promise.all([store.ensure("example"), store.ensure("example")]);
  assert.equal(first, second);
  assert.equal(requests, 1);
  assert.equal(await readFile(path.join(first, f.filePath), "utf8"), "skill instructions");
  const offline = createMarketplacePayloadStore({ index: f.index, cacheRoot: f.root, fetcher: async () => { throw new Error("offline"); } });
  assert.equal(await offline.ensure("example"), first);
});

test("rejects unknown IDs without fetching or constructing paths", async t => {
  const f = await fixture(t);
  const store = createMarketplacePayloadStore({ index: f.index, cacheRoot: f.root, fetcher: async () => { assert.fail("must not fetch"); } });
  for (const id of ["../example", "missing", "__proto__"]) await assert.rejects(store.ensure(id), /Unknown or invalid/);
});

test("fails closed on tampered bytes and retries a failed request", async t => {
  const f = await fixture(t);
  let correct = false;
  const store = createMarketplacePayloadStore({ index: f.index, cacheRoot: f.root, fetcher: async () => new Response(correct ? f.bytes : Buffer.alloc(f.bytes.length, 32)) });
  await assert.rejects(store.ensure("example"), /integrity/);
  correct = true;
  await store.ensure("example");
});

test("rejects oversized responses", async t => {
  const f = await fixture(t);
  const store = createMarketplacePayloadStore({ index: f.index, cacheRoot: f.root, fetcher: async () => new Response(Buffer.alloc(f.bytes.length + 1)) });
  await assert.rejects(store.ensure("example"), /exceeds its pinned size/);
});

for (const unsafe of ["../escape", "/absolute", "a\\b", "a/../b", "CON.txt", "a:b", "a./b"]) {
  test("rejects unsafe package path " + unsafe, async t => {
    const f = await fixture(t, unsafe);
    const store = createMarketplacePayloadStore({ index: f.index, cacheRoot: f.root, fetcher: async () => new Response(f.bytes) });
    await assert.rejects(store.ensure("example"), /Unsafe payload path/);
  });
}

test("refuses modified, incomplete, or symlinked installed files", async t => {
  const f = await fixture(t);
  const options = { index: f.index, cacheRoot: f.root, fetcher: (async () => new Response(f.bytes)) as typeof fetch };
  const directory = await createMarketplacePayloadStore(options).ensure("example");
  const target = path.join(directory, f.filePath);
  await writeFile(target, "modified");
  await assert.rejects(createMarketplacePayloadStore(options).ensure("example"), /modified/);
  await rm(target);
  await assert.rejects(createMarketplacePayloadStore(options).ensure("example"), /incomplete/);
  const outside = path.join(f.root, "outside");
  await writeFile(outside, "skill instructions");
  try { await symlink(outside, target); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "EPERM") return; throw error; }
  await assert.rejects(createMarketplacePayloadStore(options).ensure("example"), /modified/);
});
