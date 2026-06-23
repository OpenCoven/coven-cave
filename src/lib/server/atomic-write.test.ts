import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeFileAtomic, writeJsonAtomic } from "./atomic-write.ts";

const dir = await mkdtemp(path.join(tmpdir(), "atomic-write-"));
const target = path.join(dir, "data.json");
const tmps = async () => (await readdir(dir)).filter((f) => f.endsWith(".tmp"));

// 1. Replaces contents; leaves no temp files behind.
await writeFileAtomic(target, "hello");
assert.equal(await readFile(target, "utf8"), "hello", "first write lands");
await writeJsonAtomic(target, { a: 1 });
assert.deepEqual(JSON.parse(await readFile(target, "utf8")), { a: 1 }, "second write replaces");
assert.deepEqual(await tmps(), [], "no .tmp lingers after a write");

// 2. Concurrent writers all settle without ENOENT. A shared `.tmp` made the
//    second rename race to ENOENT and crash (#1516); unique temp names let each
//    writer rename its own file. Last writer wins; the file is never torn.
await Promise.all(Array.from({ length: 25 }, (_, i) => writeJsonAtomic(target, { i })));
const final = JSON.parse(await readFile(target, "utf8"));
assert.equal(typeof final.i, "number", "a complete JSON object survives concurrent writes");
assert.deepEqual(await tmps(), [], "no .tmp lingers after concurrent writes");

// 3. On failure (target directory missing) the error propagates and the temp
//    file does not leak.
await assert.rejects(() => writeFileAtomic(path.join(dir, "nope", "data.json"), "x"), "write into a missing dir rejects");
assert.deepEqual(await tmps(), [], "a failed write leaves no .tmp behind");

await rm(dir, { recursive: true, force: true });
console.log("atomic-write.test.ts: ok");
