// The research paper viewer boots pdf.js against a worker staged into public/
// (cave-9hc). That asset is `.gitignore`d and generated, so nothing in the
// source tree proves it is there — and when it is absent or stale the viewer
// shows only "Couldn't render this paper", the same sentence it shows for an
// unrecognised parse error. These tests hold the two guards that keep a build
// from reaching a reader in that state: the stager is verifying and
// idempotent, and the packaged-bundle verifier requires the file by name.

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  PDF_WORKER_PUBLIC_PATH,
  PDF_WORKER_URL_PATH,
  installedPdfjsVersion,
  resolvePdfWorkerSource,
  stagePdfWorker,
  verifyStagedPdfWorker,
} from "./copy-pdf-worker.mjs";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

function scratchRoot() {
  return mkdtempSync(path.join(tmpdir(), "pdf-worker-asset-"));
}

test("staging writes the installed worker and reports the copy", async () => {
  const root = scratchRoot();
  try {
    const first = await stagePdfWorker(root);
    assert.equal(first.changed, true, "an empty root has nothing staged yet");
    assert.equal(first.version, installedPdfjsVersion());
    assert.deepEqual(
      readFileSync(path.join(root, PDF_WORKER_PUBLIC_PATH)),
      readFileSync(resolvePdfWorkerSource()),
      "the staged bytes are the installed package's, not a transformed copy",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("re-staging an already-current worker does not rewrite the file", async () => {
  const root = scratchRoot();
  try {
    await stagePdfWorker(root);
    const before = statSync(path.join(root, PDF_WORKER_PUBLIC_PATH)).mtimeMs;
    const second = await stagePdfWorker(root);
    assert.equal(second.changed, false, "prebuild and postinstall both run this; neither should churn it");
    assert.equal(statSync(path.join(root, PDF_WORKER_PUBLIC_PATH)).mtimeMs, before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("verification fails loudly, and with a repair, when nothing is staged", async () => {
  const root = scratchRoot();
  try {
    await assert.rejects(
      () => verifyStagedPdfWorker(root),
      (error) => {
        assert.match(error.message, /is missing/);
        assert.match(error.message, /copy-pdf-worker\.mjs/, "the message names the command that fixes it");
        return true;
      },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("verification rejects a stale worker rather than trusting its presence", async () => {
  const root = scratchRoot();
  try {
    // What a `pdfjs-dist` bump without a reinstall leaves behind: a plausible
    // file of the right name whose version pdf.js will refuse at runtime.
    mkdirSync(path.join(root, "public"), { recursive: true });
    writeFileSync(path.join(root, PDF_WORKER_PUBLIC_PATH), "/* an older pdf.js worker */\n");
    await assert.rejects(
      () => verifyStagedPdfWorker(root),
      (error) => {
        assert.match(error.message, /does not match the installed pdfjs-dist/);
        assert.ok(
          error.message.includes(installedPdfjsVersion()),
          "the message names the version the worker has to agree with",
        );
        return true;
      },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a freshly staged worker verifies", async () => {
  const root = scratchRoot();
  try {
    await stagePdfWorker(root);
    const verified = await verifyStagedPdfWorker(root);
    assert.equal(verified.version, installedPdfjsVersion());
    assert.ok(verified.bytes > 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the packaged sidecar verifier requires the worker by name", () => {
  const closure = readFileSync(path.join(REPO_ROOT, "scripts/sidecar-runtime-closure.mjs"), "utf8");
  assert.ok(
    closure.includes(`"${PDF_WORKER_PUBLIC_PATH}"`),
    "verifySidecarRuntime must list the worker, or a desktop bundle can ship without it",
  );
});

test("prebuild stages the worker, so a build cannot depend on postinstall alone", () => {
  const scripts = JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")).scripts;
  assert.match(scripts.prebuild, /copy-pdf-worker\.mjs/);
  assert.match(scripts.postinstall, /copy-pdf-worker\.mjs/);
});

test("the viewer requests the worker at the path this script stages it to", () => {
  const viewer = readFileSync(
    path.join(REPO_ROOT, "src/components/research-paper-viewer.tsx"),
    "utf8",
  );
  assert.ok(
    viewer.includes(`workerSrc = "${PDF_WORKER_URL_PATH}"`),
    "workerSrc and the staged public/ path have to stay the same URL",
  );
});
