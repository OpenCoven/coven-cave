// @ts-nocheck
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// 1x1 transparent PNG — small but valid (passes cleanImageDataUrl).
const PNG_1x1_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const originalEnv = {
  COVEN_HOME: process.env.COVEN_HOME,
  COVEN_WORKSPACES_ROOT: process.env.COVEN_WORKSPACES_ROOT,
  COVEN_WORKSPACE_ROOT: process.env.COVEN_WORKSPACE_ROOT,
  WORKSPACE_ROOT: process.env.WORKSPACE_ROOT,
  NEXT_PUBLIC_WORKSPACE_ROOT: process.env.NEXT_PUBLIC_WORKSPACE_ROOT,
  OPENCLAW_WORKSPACE_ROOT: process.env.OPENCLAW_WORKSPACE_ROOT,
  CAVE_PROJECTS_PATH_OVERRIDE: process.env.CAVE_PROJECTS_PATH_OVERRIDE,
  COVEN_CAVE_CHAT_ATTACHMENTS_DIR: process.env.COVEN_CAVE_CHAT_ATTACHMENTS_DIR,
};

function restoreEnv() {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

const allowed = await mkdtemp(path.join(tmpdir(), "coven-agent-attach-allowed-"));
const outside = await mkdtemp(path.join(tmpdir(), "coven-agent-attach-outside-"));
const globalOnly = await mkdtemp(path.join(tmpdir(), "coven-agent-attach-global-"));
const attachmentStore = await mkdtemp(path.join(tmpdir(), "coven-agent-attach-store-"));

try {
  // Make `globalOnly` globally allowed while tests pass only `allowed` as the
  // runtime-scoped grant set; clear the rest to keep `outside` isolated.
  process.env.WORKSPACE_ROOT = globalOnly;
  process.env.COVEN_HOME = path.join(allowed, ".coven");
  process.env.CAVE_PROJECTS_PATH_OVERRIDE = path.join(allowed, "cave-projects.json");
  process.env.COVEN_CAVE_CHAT_ATTACHMENTS_DIR = attachmentStore;
  delete process.env.COVEN_WORKSPACES_ROOT;
  delete process.env.COVEN_WORKSPACE_ROOT;
  delete process.env.NEXT_PUBLIC_WORKSPACE_ROOT;
  delete process.env.OPENCLAW_WORKSPACE_ROOT;

  const imgPath = path.join(allowed, "diagram.png");
  const txtPath = path.join(allowed, "notes.txt");
  const outsidePath = path.join(outside, "secret.png");
  const globalOnlyPath = path.join(globalOnly, "global-secret.txt");
  await writeFile(imgPath, Buffer.from(PNG_1x1_BASE64, "base64"));
  await writeFile(txtPath, "hello\nworld");
  await writeFile(outsidePath, Buffer.from(PNG_1x1_BASE64, "base64"));
  await writeFile(globalOnlyPath, "should not be read");

  const { extractAgentAttachmentMarkers } = await import("../chat-attachments.ts");
  const { parseAgentAttachments } = await import("./agent-attachments.ts");

  // --- pure marker extraction (client-safe, no fs) ---
  {
    const text = "before\n\n```coven:attachment\n{ \"path\": \"/x.png\" }\n```\n\nafter";
    const out = extractAgentAttachmentMarkers(text);
    assert.equal(out.markers.length, 1, "one marker body extracted");
    assert.ok(!out.text.includes("coven:attachment"), "marker block stripped from text");
    assert.ok(out.text.includes("before") && out.text.includes("after"), "surrounding text kept");
  }
  {
    const out = extractAgentAttachmentMarkers("just text, no markers");
    assert.equal(out.markers.length, 0);
    assert.equal(out.text, "just text, no markers");
  }

  // --- image attachment → bounded data URL ---
  {
    const text = `Here is the image.\n\n\`\`\`coven:attachment\n${JSON.stringify({ path: imgPath, name: "diagram.png" })}\n\`\`\``;
    const out = parseAgentAttachments(text, { allowedRoots: [allowed] });
    assert.equal(out.attachments.length, 1, "image attachment parsed");
    assert.equal(out.attachments[0].name, "diagram.png");
    assert.equal(out.attachments[0].mimeType, "image/png");
    assert.ok(out.attachments[0].dataUrl?.startsWith("data:image/png;base64,"), "image carries data URL");
    assert.ok(!out.text.includes("coven:attachment"), "marker stripped from cleaned text");
    assert.ok(out.text.includes("Here is the image."), "prose preserved");
  }

  // --- text attachment → inline text, no data URL ---
  {
    const text = `\`\`\`coven:attachment\n${JSON.stringify({ path: txtPath })}\n\`\`\``;
    const out = parseAgentAttachments(text, { allowedRoots: [allowed] });
    assert.equal(out.attachments.length, 1, "text attachment parsed");
    assert.equal(out.attachments[0].name, "notes.txt");
    assert.equal(out.attachments[0].text, "hello\nworld");
    assert.equal(out.attachments[0].dataUrl, undefined, "text attachment has no data URL");
  }

  // --- in-root names beginning with two dots remain allowed ---
  {
    const dotPrefixedDir = path.join(allowed, "..notes");
    const dotPrefixedPath = path.join(dotPrefixedDir, "notes.txt");
    await mkdir(dotPrefixedDir);
    await writeFile(dotPrefixedPath, "still allowed");

    const text = `\`\`\`coven:attachment\n${JSON.stringify({ path: dotPrefixedPath })}\n\`\`\``;
    const out = parseAgentAttachments(text, { allowedRoots: [allowed] });
    assert.equal(out.attachments[0]?.text, "still allowed", "in-root '..name' path is accepted");
  }

  // --- path outside allowed roots → dropped, but marker still stripped ---
  {
    const text = `nope\n\n\`\`\`coven:attachment\n${JSON.stringify({ path: outsidePath })}\n\`\`\``;
    const out = parseAgentAttachments(text, { allowedRoots: [allowed] });
    assert.equal(out.attachments.length, 0, "out-of-root path is dropped");
    assert.ok(!out.text.includes("coven:attachment"), "marker still stripped for dropped path");
    assert.equal(out.text, "nope");
  }

  // --- symlink escaping runtime-granted root → dropped ---
  {
    const outsideTextPath = path.join(outside, "secret.env");
    const symlinkPath = path.join(allowed, "linked-secret.env");
    await writeFile(outsideTextPath, "TOP_SECRET_TOKEN=symlink_escape");
    try {
      await symlink(outsideTextPath, symlinkPath);

      const text = `nope\n\n\`\`\`coven:attachment\n${JSON.stringify({ path: symlinkPath })}\n\`\`\``;
      const out = parseAgentAttachments(text, { allowedRoots: [allowed] });
      assert.equal(out.attachments.length, 0, "symlink target outside allowed root is dropped");
      assert.equal(out.text, "nope");
    } catch (error) {
      if (!["EPERM", "EACCES", "ENOSYS"].includes(error?.code)) throw error;
      console.warn(`agent-attachments.test.ts: symlink confinement skipped (${error.code})`);
    }
  }

  // --- globally allowed but not runtime-granted root → dropped ---
  {
    const text = `nope\n\n\`\`\`coven:attachment\n${JSON.stringify({ path: globalOnlyPath })}\n\`\`\``;
    const out = parseAgentAttachments(text, { allowedRoots: [allowed] });
    assert.equal(out.attachments.length, 0, "global-only path is dropped without runtime grant");
    assert.equal(out.text, "nope");
  }

  // --- no runtime-granted roots → no local file reads ---
  {
    const text = `nope\n\n\`\`\`coven:attachment\n${JSON.stringify({ path: txtPath })}\n\`\`\``;
    const out = parseAgentAttachments(text);
    assert.equal(out.attachments.length, 0, "default parser does not read local files");
    assert.equal(out.text, "nope");
  }

  // --- media attachment → durable store copy + storedId, no data URL ---
  {
    const mp4Path = path.join(allowed, "teaser.mp4");
    const clip = Buffer.from("fake-mp4-bytes-for-agent-marker");
    await writeFile(mp4Path, clip);
    const { readChatImageAttachment } = await import("./chat-attachment-store.ts");

    const text = `Watch this.\n\n\`\`\`coven:attachment\n${JSON.stringify({ path: mp4Path })}\n\`\`\``;
    const out = parseAgentAttachments(text, { allowedRoots: [allowed] });
    assert.equal(out.attachments.length, 1, "media attachment parsed");
    assert.equal(out.attachments[0].name, "teaser.mp4");
    assert.equal(out.attachments[0].mimeType, "video/mp4");
    assert.equal(out.attachments[0].size, clip.byteLength);
    assert.equal(out.attachments[0].dataUrl, undefined, "media never inlines as a data URL");
    assert.ok(out.attachments[0].storedId, "media carries a durable stored id");
    const read = await readChatImageAttachment(out.attachments[0].storedId);
    assert.equal(read.mimeType, "video/mp4");
    assert.deepEqual(read.data, clip, "the stored copy holds the exact bytes");
  }

  // --- media larger than the image cap still rides through ---
  {
    const bigPath = path.join(allowed, "long.mp3");
    await writeFile(bigPath, Buffer.alloc(6 * 1024 * 1024, 3));
    const text = `\`\`\`coven:attachment\n${JSON.stringify({ path: bigPath })}\n\`\`\``;
    const out = parseAgentAttachments(text, { allowedRoots: [allowed] });
    assert.equal(out.attachments.length, 1, "6MB audio is admitted under the media cap");
    assert.equal(out.attachments[0].mimeType, "audio/mpeg");
    assert.ok(out.attachments[0].storedId, "oversize-for-image audio still stores");
  }

  // --- media outside allowed roots → dropped like any other path ---
  {
    const outsideMedia = path.join(outside, "secret.mp4");
    await writeFile(outsideMedia, "not yours");
    const text = `nope\n\n\`\`\`coven:attachment\n${JSON.stringify({ path: outsideMedia })}\n\`\`\``;
    const out = parseAgentAttachments(text, { allowedRoots: [allowed] });
    assert.equal(out.attachments.length, 0, "out-of-root media is dropped");
    assert.equal(out.text, "nope");
  }

  // --- no marker → passthrough ---
  {
    const out = parseAgentAttachments("plain reply", { allowedRoots: [allowed] });
    assert.equal(out.attachments.length, 0);
    assert.equal(out.text, "plain reply");
  }
} finally {
  restoreEnv();
  await rm(allowed, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
  await rm(globalOnly, { recursive: true, force: true });
  await rm(attachmentStore, { recursive: true, force: true });
}

console.log("agent-attachments.test.ts: ok");
