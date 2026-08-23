// pdf.js parses in a Web Worker. This is the first Web Worker in the codebase,
// so rather than depending on Turbopack's worker handling we copy the asset to
// public/ and reference it by URL — which is also what the packaged desktop
// shell serves.
//
// ── Why this file verifies rather than just copies (cave-9hc) ──────────────
// The staged worker used to be produced ONLY by the root `postinstall`, was
// `.gitignore`d, and nothing downstream checked it. That made a live surface
// depend on an install side effect: a build run without lifecycle scripts, or
// a `pdfjs-dist` bump with no reinstall, shipped a research paper viewer whose
// `getDocument()` rejected during worker setup.
//
// That failure is close to undiagnosable from the UI. pdf.js reconstructs only
// five exception names across the worker boundary, and EVERY http failure
// becomes `ResponseException` — which the viewer maps to a specific sentence.
// A missing or stale worker instead raises `UnknownErrorException` ("Setting
// up fake worker failed") or a bare `Error` ("The API version … does not match
// the Worker version"), both of which fall through to the generic
// "Couldn't render this paper" banner in src/lib/research/research-paper-view.ts. The
// reader is told the paper is broken when the app's own asset is the problem.
//
// So the worker is now staged by `prebuild` as well, and both the staged copy
// and the packaged bundle are checked against the installed package. The check
// is a byte comparison rather than a version-string parse: identity catches
// missing, truncated, hand-edited, and version-skewed copies at once, and it
// cannot rot against a minifier change the way a regex over minified output
// would.

import { copyFile, mkdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Repo-relative location of the staged worker; the URL the viewer requests. */
export const PDF_WORKER_PUBLIC_PATH = "public/pdf.worker.min.mjs";

/** The URL `GlobalWorkerOptions.workerSrc` is set to (research-paper-viewer). */
export const PDF_WORKER_URL_PATH = "/pdf.worker.min.mjs";

const require = createRequire(import.meta.url);

/** Absolute path of the worker inside the installed `pdfjs-dist`. */
export function resolvePdfWorkerSource() {
  return require.resolve("pdfjs-dist/build/pdf.worker.min.mjs");
}

/** The installed API's version — what the worker must agree with at runtime. */
export function installedPdfjsVersion() {
  return require("pdfjs-dist/package.json").version;
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function readOrNull(filePath) {
  try {
    return await readFile(filePath);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Copy the installed worker into `public/`, skipping the write when the staged
 * bytes already match. Idempotent so `prebuild` and `postinstall` can both run
 * it without churning the file's mtime on every build.
 */
export async function stagePdfWorker(root = process.cwd()) {
  const source = resolvePdfWorkerSource();
  const target = path.join(root, PDF_WORKER_PUBLIC_PATH);
  const wanted = await readFile(source);
  const current = await readOrNull(target);
  const changed = current === null || digest(current) !== digest(wanted);

  if (changed) {
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target);
  }
  return { source, target, changed, version: installedPdfjsVersion() };
}

/**
 * Throw unless `root` holds a worker byte-identical to the installed package.
 *
 * Callers are gates, so the message names the repair rather than only the
 * fault — a red build that does not say `pnpm exec node
 * scripts/copy-pdf-worker.mjs` just moves the guesswork somewhere else.
 */
export async function verifyStagedPdfWorker(root = process.cwd()) {
  const source = resolvePdfWorkerSource();
  const target = path.join(root, PDF_WORKER_PUBLIC_PATH);
  const version = installedPdfjsVersion();
  const repair = "run `node scripts/copy-pdf-worker.mjs` (or reinstall) to restage it";

  const current = await readOrNull(target);
  if (current === null) {
    throw new Error(
      `${PDF_WORKER_PUBLIC_PATH} is missing: the paper viewer cannot boot its pdf.js worker; ${repair}`,
    );
  }
  const wanted = await readFile(source);
  if (digest(current) !== digest(wanted)) {
    throw new Error(
      `${PDF_WORKER_PUBLIC_PATH} does not match the installed pdfjs-dist ${version}: ` +
        `pdf.js refuses a worker whose version differs from the API; ${repair}`,
    );
  }
  return { source, target, version, bytes: current.byteLength };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // `--verify` matches the flag sidecar-runtime-closure.mjs already uses, so a
  // release build can assert the asset without restaging it.
  if (process.argv[2] === "--verify") {
    try {
      const { target, version, bytes } = await verifyStagedPdfWorker();
      console.log(`[copy-pdf-worker] verified pdfjs-dist ${version}: ${target} (${bytes} bytes)`);
    } catch (error) {
      console.error(`[copy-pdf-worker] ${error.message}`);
      process.exit(1);
    }
  } else {
    const { source, target, changed, version } = await stagePdfWorker();
    console.log(
      `[copy-pdf-worker] pdfjs-dist ${version}: ${source} -> ${target}${changed ? "" : " (already current)"}`,
    );
  }
}
