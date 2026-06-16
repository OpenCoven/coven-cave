// @ts-nocheck
import assert from "node:assert/strict";
import { pickAvatarFile, isImageFile, contentTypeForFile } from "./familiar-avatar.ts";

// isImageFile recognizes the supported extensions (case-insensitive) and nothing else.
assert.equal(isImageFile("cody.png"), true);
assert.equal(isImageFile("cody.PNG"), true);
assert.equal(isImageFile("cody.webp"), true);
assert.equal(isImageFile("cody.svg"), true);
assert.equal(isImageFile("SOUL.md"), false);
assert.equal(isImageFile("notes.txt"), false);
assert.equal(isImageFile("cody"), false);

// contentTypeForFile maps extensions; unknown → octet-stream.
assert.equal(contentTypeForFile("cody.png"), "image/png");
assert.equal(contentTypeForFile("a.JPG"), "image/jpeg");
assert.equal(contentTypeForFile("a.svg"), "image/svg+xml");
assert.equal(contentTypeForFile("a.bin"), "application/octet-stream");

// The canonical case: cody/avatars/cody.png.
assert.equal(pickAvatarFile(["cody.png"], "cody"), "cody.png");

// `<id>.<ext>` wins over other images regardless of alphabetical order.
assert.equal(pickAvatarFile(["aaa.png", "cody.png"], "cody"), "cody.png");

// `<id>` match is case-insensitive.
assert.equal(pickAvatarFile(["Cody.PNG"], "cody"), "Cody.PNG");

// Among multiple `<id>.<ext>`, png beats jpg/svg (EXT_PRIORITY).
assert.equal(pickAvatarFile(["cody.svg", "cody.jpg", "cody.png"], "cody"), "cody.png");
assert.equal(pickAvatarFile(["cody.svg", "cody.webp"], "cody"), "cody.webp");

// Non-image files are ignored when choosing.
assert.equal(pickAvatarFile(["README.md", "cody.png", ".keep"], "cody"), "cody.png");

// No `<id>` match → first image by sorted name.
assert.equal(pickAvatarFile(["zebra.png", "apple.png"], "cody"), "apple.png");

// No images at all → null.
assert.equal(pickAvatarFile(["SOUL.md", "notes.txt"], "cody"), null);
assert.equal(pickAvatarFile([], "cody"), null);

console.log("familiar-avatar.test.ts: ok");
