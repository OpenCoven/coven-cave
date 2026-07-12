// @ts-nocheck
import assert from "node:assert/strict";
import { buildSafeToolDiagnostics, sanitizeAboutDiagnosticText } from "./about-diagnostics.ts";

const secret = "ghp_1234567890abcdefghijklmnopqrstuv";
const diagnostics = buildSafeToolDiagnostics({
  tools: [{
    id: "coven-cli",
    label: "Coven CLI",
    packageName: "@opencoven/cli",
    binary: "coven",
    installed: true,
    current: "0.0.54",
    latest: "0.0.55",
    outdated: true,
    compatible: true,
    minimumVersion: "0.0.54",
    path: "C:\\Users\\timot\\AppData\\Roaming\\npm\\coven.cmd",
    installCommand: "npm i -g @opencoven/cli@latest",
  }],
  checking: false,
  error: `request failed at https://example.invalid/settings?token=${secret}`,
  lastSuccessfulCheckedAt: "2026-07-12T12:00:00.000Z",
  installJobs: {
    "coven-cli": { status: "done", elapsedMs: 1024, tail: `raw output ${secret} C:\\Users\\timot\\secret.log` },
  },
  installResults: {
    "coven-cli": { ok: false, detail: `failed at /home/timot/.npmrc with token=${secret}` },
  },
  href: `http://localhost:3000/settings?access_token=${secret}#about`,
  sidecarTokenPresent: true,
  tauriInternalsPresent: true,
});

assert.match(diagnostics, /included/, "diagnostics disclose what is copied");
assert.match(diagnostics, /excluded/, "diagnostics disclose what is omitted");
assert.match(diagnostics, /outputCaptured/, "diagnostics identify that output existed without copying it");
assert.match(diagnostics, /http:\/\/localhost:3000\/settings\/?/, "the route remains useful without its query values");
assert.doesNotMatch(diagnostics, /ghp_|access_token|C:\\Users\\timot|\/home\/timot|npm i -g|raw output/, "secrets, queries, local paths, commands, and raw output are excluded");
assert.match(
  sanitizeAboutDiagnosticText(`https://example.invalid/path?secret=${secret} C:\\Users\\timot\\x`),
  /\[redacted\]|\[local path omitted\]/,
  "freeform result text is redacted before inclusion",
);

console.log("about-diagnostics.test.ts: ok");
