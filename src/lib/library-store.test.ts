// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createLibraryStore } from "./library-store.ts";

const root = await mkdtemp(path.join(tmpdir(), "lib-store-"));
const store = createLibraryStore(root);

// fresh store reports empty
assert.deepStrictEqual(await store.readBookmarks(), []);
assert.deepStrictEqual(await store.readReading(), []);
assert.deepStrictEqual(await store.readGithub(), []);
assert.deepStrictEqual(await store.readIndex(), { version: 1, entries: [] });

// append bookmark + read back
const bm = { id: "bm_1", url: "https://a.com", title: "A", domain: "a.com", tags: [], savedAt: "2026-06-06T00:00:00Z", familiar: "cody" };
await store.appendBookmark(bm);
assert.deepStrictEqual(await store.readBookmarks(), [bm]);

// dedup index roundtrip
await store.appendIndexEntry({ url: "https://a.com", sessionId: null, turnId: null, list: "bookmarks", itemId: "bm_1" });
const idx = await store.readIndex();
assert.equal(idx.entries.length, 1);
assert.equal(idx.entries[0].itemId, "bm_1");

// hasIndexEntry
assert.equal(await store.hasIndexEntry("https://a.com", null, null), true);
assert.equal(await store.hasIndexEntry("https://b.com", null, null), false);

await rm(root, { recursive: true, force: true });
