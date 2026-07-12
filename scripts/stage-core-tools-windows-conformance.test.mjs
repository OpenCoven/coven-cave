import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { createDefaultCoreToolsDependencies } from "./stage-core-tools.mjs";

const execFileAsync = promisify(execFile);

if (process.platform !== "win32") {
  console.log("stage-core-tools-windows-conformance.test.mjs: skipped (Windows only)");
} else {
  const root = await mkdtemp(path.join(os.tmpdir(), "cave-windows-extraction-"));
  try {
    const inputDir = path.join(root, "input");
    const binaryName = "coven-code.exe";
    const inputPath = path.join(inputDir, binaryName);
    const archivePath = path.join(root, "coven-code-windows-x86_64.zip");
    const creatorPath = path.join(root, "create-fixture-archive.ps1");
    const expectedBytes = Buffer.from("local Windows ZIP extraction fixture\r\n");

    await mkdir(inputDir, { recursive: true });
    await writeFile(inputPath, expectedBytes);
    await writeFile(
      creatorPath,
      [
        "param([string]$InputPath, [string]$ArchivePath)",
        "Set-StrictMode -Version Latest",
        "$ErrorActionPreference = 'Stop'",
        "Compress-Archive -LiteralPath $InputPath -DestinationPath $ArchivePath -Force",
        "",
      ].join("\r\n"),
    );
    await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-File",
      creatorPath,
      inputPath,
      archivePath,
    ]);

    const dependencies = createDefaultCoreToolsDependencies({ platform: "win32" });
    const extracted = await dependencies.extractCodeBinary({
      archiveBytes: await readFile(archivePath),
      archiveName: path.basename(archivePath),
      binaryName,
      timeoutMs: 30_000,
    });
    assert.deepEqual(extracted, expectedBytes);
    console.log(
      "stage-core-tools-windows-conformance.test.mjs: local ZIP extraction ok",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
