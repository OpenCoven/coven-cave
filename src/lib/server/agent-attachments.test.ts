// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
};

function restoreEnv() {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

const allowed = await mkdtemp(path.join(tmpdir(), "coven-agent-attach-allowed-"));
const outside = await mkdtemp(path.join(tmpdir(), "coven-agent-attach-outside-"));

try {
  // Make `allowed` the only project-defined root; clear the rest so the
  // outside dir is genuinely outside every allowed root.
  process.env.WORKSPACE_ROOT = allowed;
  process.env.COVEN_HOME = path.join(allowed, ".coven");
  process.env.CAVE_PROJECTS_PATH_OVERRIDE = path.join(allowed, "cave-projects.json");
  delete process.env.COVEN_WORKSPACES_ROOT;
  delete process.env.COVEN_WORKSPACE_ROOT;
  delete process.env.NEXT_PUBLIC_WORKSPACE_ROOT;
  delete process.env.OPENCLAW_WORKSPACE_ROOT;

  const imgPath = path.join(allowed, "diagram.png");
  const txtPath = path.join(allowed, "notes.txt");
  const outsidePath = path.join(outside, "secret.png");
  await writeFile(imgPath, Buffer.from(PNG_1x1_BASE64, "base64"));
  await writeFile(txtPath, "hello\nworld");
  await writeFile(outsidePath, Buffer.from(PNG_1x1_BASE64, "base64"));

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
    const out = parseAgentAttachments(text);
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
    const out = parseAgentAttachments(text);
    assert.equal(out.attachments.length, 1, "text attachment parsed");
    assert.equal(out.attachments[0].name, "notes.txt");
    assert.equal(out.attachments[0].text, "hello\nworld");
    assert.equal(out.attachments[0].dataUrl, undefined, "text attachment has no data URL");
  }

  // --- path outside allowed roots → dropped, but marker still stripped ---
  {
    const text = `nope\n\n\`\`\`coven:attachment\n${JSON.stringify({ path: outsidePath })}\n\`\`\``;
    const out = parseAgentAttachments(text);
    assert.equal(out.attachments.length, 0, "out-of-root path is dropped");
    assert.ok(!out.text.includes("coven:attachment"), "marker still stripped for dropped path");
    assert.equal(out.text, "nope");
  }

  // --- no marker → passthrough ---
  {
    const out = parseAgentAttachments("plain reply");
    assert.equal(out.attachments.length, 0);
    assert.equal(out.text, "plain reply");
  }
} finally {
  restoreEnv();
  await rm(allowed, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
}

console.log("agent-attachments.test.ts: ok");
