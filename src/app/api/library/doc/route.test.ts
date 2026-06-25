// @ts-nocheck
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, stat } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

const root = await mkdtemp(path.join(tmpdir(), "library-doc-route-"));
const familiarRoot = path.join(root, "researcher");
const researchRoot = path.join(familiarRoot, "research");

try {
  await mkdir(path.join(researchRoot, "synthesis"), { recursive: true });
  await mkdir(path.join(researchRoot, "sources"), { recursive: true });

  const originalPath = path.join(researchRoot, "synthesis", "old-note.md");
  await import("node:fs/promises").then(({ writeFile }) => writeFile(originalPath, "# Old Note\n\nBody\n", "utf-8"));

  const { renameOrMoveResearchDoc } = await import("./doc-file.ts");
  const result = await renameOrMoveResearchDoc(
    {
      id: "research/synthesis/old-note.md",
      title: "New Note",
      collection: "sources",
    },
    { familiarId: "researcher", familiarRoot, researchRoot },
  );

  assert.equal(result.ok, true);
  assert.equal(result.doc.id, "research/sources/new-note.md");

  await assert.rejects(
    () => stat(originalPath),
    /ENOENT/,
    "renaming and moving should remove the old disk path",
  );

  const movedPath = path.join(researchRoot, "sources", "new-note.md");
  assert.equal(await readFile(movedPath, "utf-8"), "# New Note\n\nBody\n");
  assert.equal(result.doc.absolutePath, await realpath(movedPath));
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("library doc route.test.ts: ok");
