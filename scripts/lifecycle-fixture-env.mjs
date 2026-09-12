// Import before production modules: coven-bin captures homedir at module load.
// These suites test real Git and maintenance protocols against fixture CLIs,
// not the developer's login profile, version managers, or managed toolchain.
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const home = mkdtempSync(path.join(tmpdir(), "cave-lifecycle-home-"));
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
  XDG_DATA_HOME: path.join(home, ".local", "share"),
  LOCALAPPDATA: path.join(home, "AppData", "Local"),
  APPDATA: path.join(home, "AppData", "Roaming"),
  SHELL: shell,
});

// The suite owns this directory; its CLI children inherit it, never remove it.
process.once("exit", () => {
  rmSync(home, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
});
