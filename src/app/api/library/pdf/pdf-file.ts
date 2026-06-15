import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

const MAX_PDF_BYTES = 50 * 1024 * 1024;

export class PdfRouteError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function isPathInside(parent: string, child: string) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function validatePdfFilename(file: string) {
  // Safety: no path traversal — only bare filenames allowed
  const basename = path.basename(file);
  if (basename !== file || file.includes("/") || file.includes("..")) {
    throw new PdfRouteError("invalid filename", 400);
  }
  if (!basename.toLowerCase().endsWith(".pdf")) {
    throw new PdfRouteError("only pdf files allowed", 400);
  }
  return basename;
}

export async function readLocalPdfFile(papersDir: string, file: string) {
  const basename = validatePdfFilename(file);
  const realPapersDir = await fs.realpath(papersDir);
  const fullPath = path.join(realPapersDir, basename);

  const entry = await fs.lstat(fullPath);
  if (entry.isSymbolicLink()) {
    throw new PdfRouteError("file not found", 404);
  }

  const realPath = await fs.realpath(fullPath);
  if (!isPathInside(realPapersDir, realPath)) {
    throw new PdfRouteError("file not found", 404);
  }

  const handle = await fs.open(fullPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) {
      throw new PdfRouteError("file not found", 404);
    }
    if (stat.size > MAX_PDF_BYTES) {
      throw new PdfRouteError("file too large", 413);
    }
    return { basename, buffer: await handle.readFile() };
  } finally {
    await handle.close();
  }
}
