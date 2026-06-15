// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const papersDir = await mkdtemp(path.join(tmpdir(), "library-pdf-"));
const outsideFile = path.join(tmpdir(), `library-pdf-secret-${process.pid}.txt`);

const { readLocalPdfFile } = await import("./pdf-file.ts");

try {
  await writeFile(path.join(papersDir, "paper.pdf"), "%PDF-1.7\nlocal paper\n");
  await writeFile(outsideFile, "secret outside papers\n");
  await symlink(outsideFile, path.join(papersDir, "secret.pdf"));

  const allowed = await readLocalPdfFile(papersDir, "paper.pdf");
  assert.equal(allowed.basename, "paper.pdf");
  assert.equal(allowed.buffer.toString(), "%PDF-1.7\nlocal paper\n");

  await assert.rejects(
    () => readLocalPdfFile(papersDir, "secret.pdf"),
    /file not found/,
    "symlinks inside the papers directory must not be followed",
  );

  await assert.rejects(
    () => readLocalPdfFile(papersDir, "../secret.pdf"),
    /invalid filename/,
    "path traversal remains rejected",
  );
} finally {
  await rm(papersDir, { recursive: true, force: true });
  await rm(outsideFile, { force: true });
}

console.log("library pdf route.test.ts: ok");
