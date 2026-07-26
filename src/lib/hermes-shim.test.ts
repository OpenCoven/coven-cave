import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { HERMES_COVEN_SHIM, installHermesShim } from "./hermes-shim.ts";

const execFileAsync = promisify(execFile);

// Run the shim with `hermes` stubbed by a script that just prints its argv,
// so we can assert the exact command the shim would exec — no real Hermes.
async function shimArgv(args: string[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "hermes-shim-"));
  try {
    // Fake `hermes` on PATH that echoes a stable, parseable argv line.
    const fakeHermes = join(dir, "hermes");
    await writeFile(
      fakeHermes,
      '#!/usr/bin/env bash\nprintf "ARGV"; for a in "$@"; do printf " [%s]" "$a"; done; printf "\\n"\n',
      { mode: 0o755 },
    );
    const shimPath = join(dir, "hermes-coven");
    await writeFile(shimPath, HERMES_COVEN_SHIM, { mode: 0o755 });
    const { stdout } = await execFileAsync("bash", [shimPath, ...args], {
      env: { ...process.env, PATH: `${dir}:${process.env.PATH ?? ""}` },
      timeout: 5000,
    });
    return stdout.trim();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// Non-interactive: the harness sends `... -- "<prompt>"`; the shim must remap
// the trailing positional prompt onto `-q`'s inline value.
assert.equal(
  await shimArgv(["chat", "--source", "coven", "-Q", "--", "hello world"]),
  "ARGV [chat] [--source] [coven] [-Q] [-q] [hello world]",
  "trailing positional prompt becomes the inline value of -q",
);

// A stray bare `-q` in the prefix (older manifest) must not duplicate.
assert.equal(
  await shimArgv(["chat", "--source", "coven", "-q", "--", "hi"]),
  "ARGV [chat] [--source] [coven] [-q] [hi]",
  "a bare -q in the prefix is stripped, not duplicated",
);

// A VALUED -q in the prefix must drop BOTH the flag and its value — otherwise
// the value would leak as a stray positional to hermes.
assert.equal(
  await shimArgv(["chat", "--source", "coven", "-q", "STALE", "-Q", "--", "real"]),
  "ARGV [chat] [--source] [coven] [-Q] [-q] [real]",
  "-q <value> in the prefix is fully stripped before the real prompt is added",
);

// `--query=<value>` inline form is also stripped whole.
assert.equal(
  await shimArgv(["chat", "--source", "coven", "--query=STALE", "--", "real"]),
  "ARGV [chat] [--source] [coven] [-q] [real]",
  "--query=<value> inline form is stripped",
);

// Interactive: no prompt after `--` → launch the REPL with a query-free prefix
// (and any valued -q fully removed, so nothing leaks as a positional).
assert.equal(
  await shimArgv(["chat", "--source", "coven", "-q", "STALE", "--", ""]),
  "ARGV [chat] [--source] [coven]",
  "empty prompt launches the REPL with the query flag and its value stripped",
);

// A prompt that begins with a dash stays intact (it's -q's value, not a flag).
assert.equal(
  await shimArgv(["chat", "--source", "coven", "-Q", "--", "--tricky"]),
  "ARGV [chat] [--source] [coven] [-Q] [-q] [--tricky]",
  "dash-leading prompt is preserved as -q's value",
);

// installHermesShim writes an executable shim next to the hermes binary.
{
  const dir = await mkdtemp(join(tmpdir(), "hermes-install-"));
  try {
    const hermesBin = join(dir, "hermes");
    await writeFile(hermesBin, "#!/usr/bin/env bash\n", { mode: 0o755 });
    const result = await installHermesShim(hermesBin);
    assert.ok(result.ok, "shim install should succeed next to the hermes binary");
    if (result.ok) {
      assert.equal(result.path, join(dir, "hermes-coven"), "shim lands beside hermes");
      const body = await readFile(result.path, "utf8");
      assert.equal(body, HERMES_COVEN_SHIM, "installed shim matches the pinned source");
      const st = await stat(result.path);
      assert.equal(st.mode & 0o111, 0o111, "installed shim is executable");
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

console.log("hermes-shim: ok");
