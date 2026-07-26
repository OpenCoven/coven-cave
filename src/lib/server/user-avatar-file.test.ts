// src/lib/server/user-avatar-file.test.ts
import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import {
  deleteUserAvatarFile, readUserAvatarFile, writeUserAvatarFile,
} from "./user-avatar-file.ts";

const dir = await mkdtemp(path.join(tmpdir(), "cave-avatar-"));
after(() => rm(dir, { recursive: true, force: true }));

// 1x1 transparent PNG
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const PNG_DATAURL = `data:image/png;base64,${PNG_B64}`;

describe("user avatar file store", () => {
  it("writes, reads back, and reports mime", async () => {
    const res = await writeUserAvatarFile({ dataUrl: PNG_DATAURL, mime: "image/png" }, dir);
    assert.ok(res.ok);
    const read = await readUserAvatarFile(dir);
    assert.ok(read);
    assert.equal(read.mime, "image/png");
    assert.ok(read.bytes.byteLength > 0);
    assert.ok(read.updatedAt);
  });
  it("replacing with another format removes the old file", async () => {
    const webp = `data:image/webp;base64,${PNG_B64}`; // content irrelevant; store trusts declared mime
    const res = await writeUserAvatarFile({ dataUrl: webp, mime: "image/webp" }, dir);
    assert.ok(res.ok);
    const read = await readUserAvatarFile(dir);
    assert.equal(read?.mime, "image/webp");
    // Verify png file no longer exists (exactly one avatar file invariant)
    await assert.rejects(() => stat(path.join(dir, "user-avatar.png")));
  });
  it("rejects svg and oversized payloads", async () => {
    const svg = await writeUserAvatarFile({ dataUrl: "data:image/svg+xml;base64,AAA", mime: "image/svg+xml" }, dir);
    assert.ok(!svg.ok);
    const big = await writeUserAvatarFile(
      { dataUrl: `data:image/png;base64,${"A".repeat(3 * 1024 * 1024)}`, mime: "image/png" }, dir);
    assert.ok(!big.ok);
  });
  it("rejects a dataUrl whose header mime disagrees with the declared mime", async () => {
    const res = await writeUserAvatarFile({ dataUrl: PNG_DATAURL, mime: "image/webp" }, dir);
    assert.ok(!res.ok);
  });
  it("delete removes the file; read returns null", async () => {
    await deleteUserAvatarFile(dir);
    assert.equal(await readUserAvatarFile(dir), null);
  });
});
