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
    path: "C:\\Users\\example-user\\AppData\\Roaming\\npm\\coven.cmd",
    executablePath: "C:\\Users\\Example Person\\AppData\\Roaming\\npm\\node_modules\\@opencoven\\cli\\bin\\coven.js",
    packagePath: "C:\\Users\\Example Person\\AppData\\Roaming\\npm\\node_modules\\@opencoven\\cli",
    installCommand: "npm i -g @opencoven/cli@latest",
  }],
  checking: false,
  error: `request failed at https://example.invalid/settings?token=${secret}`,
  lastSuccessfulCheckedAt: "2026-07-12T12:00:00.000Z",
  installJobs: {
    "coven-cli": { status: "done", elapsedMs: 1024, tail: `raw output ${secret} C:\\Users\\example-user\\secret.log` },
  },
  installResults: {
    "coven-cli": { ok: false, detail: `failed at /home/example-user/.npmrc with token=${secret}` },
  },
  href: `http://localhost:3000/settings?access_token=${secret}#about`,
  sidecarTokenPresent: true,
  tauriInternalsPresent: true,
});

assert.match(diagnostics, /included/, "diagnostics disclose what is copied");
assert.match(diagnostics, /excluded/, "diagnostics disclose what is omitted");
assert.match(diagnostics, /outputCaptured/, "diagnostics identify that output existed without copying it");
assert.match(diagnostics, /http:\/\/localhost:3000\/settings\/?/, "the route remains useful without its query values");
assert.equal(
  /ghp_|access_token|example-user|npm i -g|raw output/.test(diagnostics),
  false,
  "secrets, queries, local paths, commands, and raw output are excluded",
);
assert.equal(
  /executablePath|packagePath|Example Person/.test(diagnostics),
  false,
  "future machine-local tool path fields are excluded by an explicit diagnostics allowlist",
);
assert.equal(
  /\[redacted\]|\[local path omitted\]/.test(
    sanitizeAboutDiagnosticText(`https://example.invalid/path?secret=${secret} C:\\Users\\example-user\\x`),
  ),
  true,
  "freeform result text is redacted before inclusion",
);

const pathCases = [
  String.raw`C:\Users\name\file`,
  "C:/Users/name/file",
  String.raw`\\server\share\file`,
  "file:///C:/Users/name/file",
  "/root/file",
  "/opt/app/file",
];

for (const [index, localPath] of pathCases.entries()) {
  const sanitized = sanitizeAboutDiagnosticText(`before ${localPath} after`);
  assert.equal(sanitized.includes(localPath), false, `path form ${index} is not exposed in test failures`);
  assert.equal(sanitized.startsWith("before [local path omitted]"), true, `path form ${index} is redacted`);
  assert.equal(sanitized.endsWith(" after"), true, `prose after path form ${index} is preserved`);
}

const mixed = sanitizeAboutDiagnosticText(
  `first C:/Users/name/one then ${secret} then /opt/app/two and https://example.com/docs/page?token=${secret}#install done`,
);
assert.equal(mixed.includes("[local path omitted]"), true, "mixed diagnostics redact local paths");
assert.equal(mixed.match(/\[local path omitted\]/g)?.length, 2, "multiple local paths are independently redacted");
assert.equal(mixed.includes(secret), false, "multiple sensitive values do not expose secrets");
assert.equal(mixed.includes("https://example.com/docs/page"), true, "safe HTTPS URLs remain useful");
assert.equal(mixed.includes("?token="), false, "safe HTTPS URL query values are removed");
assert.equal(mixed.endsWith(" done"), true, "ordinary prose around paths is preserved");

const ambiguousAfterAnotherPath = String.raw`first C:/safe/path then C:\Users\Example Person\secret.log after update`;
const ambiguousAfterAnotherPathSanitized = sanitizeAboutDiagnosticText(ambiguousAfterAnotherPath);
assert.equal(
  ambiguousAfterAnotherPathSanitized.includes("Example Person"),
  false,
  "a later space-containing path cannot leak after an earlier path",
);
assert.equal(
  ambiguousAfterAnotherPathSanitized.match(/\[local path omitted\]/g)?.length,
  2,
  "paths before a fail-closed path are also redacted",
);

for (const [index, safeText] of [
  "plain prose with no filesystem reference",
  "relative/path/to/file",
  "version 1/2 is available",
  "https://example.com/opt/app/file?channel=stable#download",
  "C: is a drive label",
  "/ is the root symbol",
].entries()) {
  const sanitized = sanitizeAboutDiagnosticText(safeText);
  const expected = index === 3 ? "https://example.com/opt/app/file" : safeText;
  assert.equal(sanitized, expected, `non-path form ${index} is preserved`);
}

for (const text of [
  "failed at /Users/Example Person/.npmrc after update",
  "failed at C:\\Users\\Example Person\\secret.log after update",
]) {
  const sanitized = sanitizeAboutDiagnosticText(text);
  assert.equal(sanitized.includes("[local path omitted]"), true, "local paths with spaces are identified");
  assert.equal(
    /Example|Person|npmrc|secret\.log|after update/.test(sanitized),
    false,
    "diagnostics fail closed at a local path instead of leaking its whitespace-delimited suffix",
  );
}

console.log("about-diagnostics.test.ts: ok");
