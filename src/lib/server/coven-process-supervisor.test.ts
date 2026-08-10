import assert from "node:assert/strict";
import test from "node:test";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  COVEN_PROCESS_SUPERVISOR_PROTOCOL,
  CovenProcessSupervisorUnavailableError,
  resolveCovenProcessSupervisorCommand,
  validatedNativeCovenPath,
} from "./coven-process-supervisor.ts";

const TMP = mkdtempSync(path.join(tmpdir(), "coven-process-supervisor-"));
const NATIVE = path.join(TMP, process.platform === "win32" ? "coven.exe" : "coven");
const magic = process.platform === "win32"
  ? Buffer.from([0x4d, 0x5a, 0, 0])
  : process.platform === "darwin"
    ? Buffer.from([0xfe, 0xed, 0xfa, 0xcf])
    : Buffer.from([0x7f, 0x45, 0x4c, 0x46]);
writeFileSync(NATIVE, Buffer.concat([magic, Buffer.from("fixture")]));
chmodSync(NATIVE, 0o755);

test("machine-path output accepts only one absolute native Coven executable", () => {
  assert.equal(validatedNativeCovenPath(`${NATIVE}\n`), NATIVE);
  assert.equal(validatedNativeCovenPath(NATIVE), null, "missing protocol newline is rejected");
  assert.equal(validatedNativeCovenPath(`${NATIVE}\r\n`), null, "CRLF is not the exact wrapper contract");
  assert.equal(validatedNativeCovenPath(`${NATIVE}\n${NATIVE}\n`), null, "extra output cannot become argv");
  assert.equal(validatedNativeCovenPath(`relative/${path.basename(NATIVE)}\n`), null);
  assert.equal(validatedNativeCovenPath(`${path.join(TMP, "not-coven")}\n`), null);

  const scriptDir = path.join(TMP, "script-provider");
  mkdirSync(scriptDir);
  const script = path.join(scriptDir, process.platform === "win32" ? "coven.exe" : "coven");
  writeFileSync(script, "#!/bin/sh\nexit 0\n");
  chmodSync(script, 0o755);
  assert.equal(validatedNativeCovenPath(`${script}\n`), null, "a script cannot impersonate the native owner");
});

test("an already-native Coven path bypasses the npm wrapper and uses exact supervisor argv", async () => {
  let probes = 0;
  const resolved = await resolveCovenProcessSupervisorCommand({
    launchCommand: () => ({ command: NATIVE, fixedArgs: [] }),
    execFileImpl: (() => { probes += 1; throw new Error("must not probe"); }) as never,
  });
  assert.equal(probes, 0);
  assert.deepEqual(resolved, {
    command: NATIVE,
    fixedArgs: ["process-supervisor", "--protocol", COVEN_PROCESS_SUPERVISOR_PROTOCOL],
  });
});

test("the npm wrapper is only a bounded machine-path oracle", async () => {
  const wrapper = path.join(TMP, "print-native-path.cjs");
  writeFileSync(wrapper, `
if (process.argv.length !== 3 || process.argv[2] !== "--print-native-binary-path") process.exit(19);
process.stdout.write(${JSON.stringify(`${NATIVE}\n`)});
`);
  const resolved = await resolveCovenProcessSupervisorCommand({
    launchCommand: () => ({ command: process.execPath, fixedArgs: [wrapper] }),
    env: { ...process.env },
  });
  assert.deepEqual(resolved, {
    command: NATIVE,
    fixedArgs: ["process-supervisor", "--protocol", COVEN_PROCESS_SUPERVISOR_PROTOCOL],
  });
});

test("unsupported, ambiguous, and malformed providers fail closed", async () => {
  const unsupported = path.join(TMP, "unsupported-wrapper.cjs");
  writeFileSync(unsupported, "process.exit(2);\n");
  await assert.rejects(
    resolveCovenProcessSupervisorCommand({
      launchCommand: () => ({ command: process.execPath, fixedArgs: [unsupported] }),
      env: { ...process.env },
    }),
    CovenProcessSupervisorUnavailableError,
  );

  const noisy = path.join(TMP, "noisy-wrapper.cjs");
  writeFileSync(noisy, `process.stdout.write(${JSON.stringify(`${NATIVE}\nextra\n`)});\n`);
  await assert.rejects(
    resolveCovenProcessSupervisorCommand({
      launchCommand: () => ({ command: process.execPath, fixedArgs: [noisy] }),
      env: { ...process.env },
    }),
    CovenProcessSupervisorUnavailableError,
  );

  const warning = path.join(TMP, "warning-wrapper.cjs");
  writeFileSync(warning, `
process.stdout.write(${JSON.stringify(`${NATIVE}\n`)});
process.stderr.write("not the machine-readable provider contract\\n");
`);
  await assert.rejects(
    resolveCovenProcessSupervisorCommand({
      launchCommand: () => ({ command: process.execPath, fixedArgs: [warning] }),
      env: { ...process.env },
    }),
    CovenProcessSupervisorUnavailableError,
  );

  await assert.rejects(
    resolveCovenProcessSupervisorCommand({
      launchCommand: () => ({
        command: process.platform === "win32" ? "coven.cmd" : "coven",
        fixedArgs: [],
        unresolvedWindowsShim: true,
      }),
    }),
    CovenProcessSupervisorUnavailableError,
  );
});
