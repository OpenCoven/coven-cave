// Import before production modules: coven-bin captures homedir at module load.
// These suites test real Git and maintenance protocols against fixture CLIs,
// not the developer's login profile, version managers, or managed toolchain.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const home = mkdtempSync(path.join(tmpdir(), "cave-lifecycle-home-"));
// Register cleanup before creating anything else, including on setup failure.
process.once("exit", () => {
  rmSync(home, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
});

if (process.platform !== "win32") {
  const git = (process.env.PATH ?? "").split(path.delimiter)
    .map((entry) => path.join(entry, "git"))
    .find((candidate) => existsSync(candidate));
  if (!git) throw new Error("lifecycle fixtures require git on PATH");
  const bin = path.join(home, "bin");
  mkdirSync(bin);
  // Retain the selected runtimes, not their host manager's entire bin directory.
  symlinkSync(process.execPath, path.join(bin, "node"));
  symlinkSync(git, path.join(bin, "git"));
  process.env.PATH = [bin, "/usr/bin", "/bin"].join(path.delimiter);
}

const shell = path.join(home, "login-shell");
writeFileSync(shell, `#!/bin/sh
if [ "$#" -ne 2 ] || [ "$1" != "-ilc" ] || [ "$2" != 'echo $PATH' ]; then
  echo 'unexpected lifecycle fixture shell invocation' >&2
  exit 2
fi
printf '%s\\n' "$PATH"
`);
chmodSync(shell, 0o755);

Object.assign(process.env, {
  HOME: home,
  USERPROFILE: home,
  COVEN_HOME: path.join(home, ".coven"),
  COVEN_VAULT_FILE: path.join(home, "missing-vault.yaml"),
  // Individual protocol fixtures override this; idle cache resets must not
  // resolve a real Coven installation from a system-wide candidate directory.
  COVEN_BIN: process.execPath,
  XDG_DATA_HOME: path.join(home, ".local", "share"),
  LOCALAPPDATA: path.join(home, "AppData", "Local"),
  APPDATA: path.join(home, "AppData", "Roaming"),
  SHELL: shell,
});
