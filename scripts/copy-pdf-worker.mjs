// pdf.js parses in a Web Worker. This is the first Web Worker in the codebase,
// so rather than depending on Turbopack's worker handling we copy the asset to
// public/ and reference it by URL — which is also what the packaged desktop
// shell serves.
import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const source = require.resolve("pdfjs-dist/build/pdf.worker.min.mjs");
const target = path.join(process.cwd(), "public", "pdf.worker.min.mjs");

await mkdir(path.dirname(target), { recursive: true });
await copyFile(source, target);
console.log(`[copy-pdf-worker] ${source} -> ${target}`);
