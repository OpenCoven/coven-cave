// @ts-nocheck
import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const root = await mkdtemp(path.join(tmpdir(), "library-chat-doc-"));
const researchRoot = path.join(root, "sage", "research");
const outsideFile = path.join(root, "secret.md");

const { readLibraryChatDocument, resolveLibraryChatDocPath } = await import("./chat-doc-path.ts");

try {
  await mkdir(path.join(researchRoot, "papers"), { recursive: true });
  const allowedPath = path.join(researchRoot, "papers", "paper.md");
  await writeFile(allowedPath, "# Paper\n\nLocal research note.\n", "utf-8");
  await writeFile(outsideFile, "secret outside research\n", "utf-8");
  await symlink(outsideFile, path.join(researchRoot, "papers", "secret-link.md"));

  const allowed = readLibraryChatDocument(allowedPath, { researchRoot });
  assert.equal(allowed.ok, true);
  assert.equal(allowed.content, "# Paper\n\nLocal research note.\n");
  assert.equal(allowed.path, await realpath(allowedPath));

  assert.deepEqual(
    resolveLibraryChatDocPath(path.join(researchRoot, "papers", "..", "..", "..", "secret.md"), { researchRoot }),
    { ok: false, reason: "forbidden" },
    "path traversal outside the research root is rejected",
  );

  assert.deepEqual(
    readLibraryChatDocument(path.join(researchRoot, "papers", "secret-link.md"), { researchRoot }),
    { ok: false, reason: "forbidden" },
    "symlink escapes outside the research root are rejected before reading",
  );
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("library chat-doc-path.test.ts: ok");
