// @ts-nocheck
// #5679: GET serves a thumbnail rendered by an earlier server process from
// disk, and renders + persists one on a miss.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

const home = mkdtempSync(path.join(tmpdir(), "avatar-route-thumbs-"));
process.env.HOME = home;
process.env.COVEN_HOME = path.join(home, ".coven");
process.env.COVEN_CAVE_HOME = path.join(home, ".coven", "cave");
process.env.COVEN_WORKSPACES_ROOT = path.join(home, ".coven", "workspaces");

const { GET } = await import("./route.ts");
const { avatarThumbDir, avatarThumbKey } = await import("../../../../../lib/server/avatar-thumbnail-cache.ts");

async function seedAvatar(id, color) {
  const dir = path.join(process.env.COVEN_WORKSPACES_ROOT, "familiars", id, "avatars");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${id}.png`);
  const png = await sharp({ create: { width: 600, height: 400, channels: 3, background: color } }).png().toBuffer();
  writeFileSync(file, png);
  return file;
}

const get = (id) => GET(new Request(`http://cave.test/api/familiars/${id}/avatar`), { params: Promise.resolve({ id }) });

// Miss: renders from the source, answers with it, and persists it.
await seedAvatar("miss", "#336699");
const missRes = await get("miss");
assert.equal(missRes.status, 200);
assert.equal(missRes.headers.get("content-type"), "image/png");
const rendered = Buffer.from(await missRes.arrayBuffer());
const meta = await sharp(rendered).metadata();
assert.equal(meta.width, 256, "the render is downscaled to the thumbnail size");
const written = readdirSync(avatarThumbDir()).filter((name) => name.endsWith(".png"));
assert.equal(written.length, 1, "the render is persisted for the next server start");
assert.deepEqual(readFileSync(path.join(avatarThumbDir(), written[0])), rendered);

// Hit: a thumbnail an earlier process wrote for exactly this source is served
// as-is, without decoding the source.
const hitSource = await seedAvatar("hit", "#993366");
const st = statSync(hitSource);
const marker = await sharp({ create: { width: 7, height: 7, channels: 3, background: "#00ff00" } }).png().toBuffer();
writeFileSync(
  path.join(avatarThumbDir(), `${avatarThumbKey({ absPath: hitSource, size: st.size, mtimeMs: st.mtimeMs }, 256)}.png`),
  marker,
);
const hitRes = await get("hit");
assert.equal(hitRes.status, 200);
assert.deepEqual(Buffer.from(await hitRes.arrayBuffer()), marker, "the persisted thumbnail is served");

// Replacing the source changes the key, so the old thumbnail is never served.
await new Promise((resolve) => setTimeout(resolve, 20));
await seedAvatar("hit", "#112233");
const replacedRes = await get("hit");
const replaced = Buffer.from(await replacedRes.arrayBuffer());
assert.notDeepEqual(replaced, marker, "a replaced source re-renders");
assert.equal((await sharp(replaced).metadata()).width, 256);

console.log("route-thumbnail-cache.test.ts: ok");
