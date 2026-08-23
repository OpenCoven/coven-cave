import { chmod, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * Legacy `hermes-coven` adapter shim retained as pinned migration/test
 * material for pre-1.0.3 manifests. Current Cave scaffolds the accepted native
 * `hermes --query` adapter and does not auto-install this shim.
 *
 * Why it existed: the older Coven harness appended the user prompt as a
 * POSITIONAL argument behind an options terminator, i.e.
 * `hermes chat <prefix…> -- "<p>"`. But `hermes chat` has no positional
 * prompt slot — the query is only accepted via `-q/--query <value>` — so the
 * raw invocation fails with:
 *     hermes chat: error: argument -q/--query: expected one argument
 * The shim captures the trailing positional prompt and re-emits it as the
 * inline value of `-q`. Keep this byte-for-byte in sync with
 * OpenCoven/coven-runtimes:shims/hermes-coven. Its embedded comments describe
 * that historical installer contract and are intentionally left byte-identical.
 *
 * @deprecated Legacy migration/test fixture only; current Cave uses the native
 * Hermes 1.0.3 adapter.
 */
export const HERMES_COVEN_SHIM = `#!/usr/bin/env bash
# hermes-coven — adapter shim so the Coven harness can drive \`hermes chat\`.
# Installed automatically by Cave after Hermes setup. Keep in sync with
# OpenCoven/coven-runtimes:shims/hermes-coven.
set -euo pipefail

pre=()
prompt=""
seen_term=0

for arg in "$@"; do
  if [[ "$seen_term" -eq 0 && "$arg" == "--" ]]; then
    seen_term=1
    continue
  fi
  if [[ "$seen_term" -eq 1 ]]; then
    if [[ -z "$prompt" ]]; then prompt="$arg"; else prompt="$prompt $arg"; fi
  else
    pre+=("$arg")
  fi
done

strip_query() {
  cleaned=()
  local skip_next=0 a
  for a in "$@"; do
    if [[ "$skip_next" -eq 1 ]]; then
      skip_next=0
      continue
    fi
    case "$a" in
      -q|--query)
        skip_next=1
        continue
        ;;
      -q=*|--query=*)
        continue
        ;;
      *)
        cleaned+=("$a")
        ;;
    esac
  done
}

strip_query \${pre[@]:+"\${pre[@]}"}

if [[ -n "\${prompt//[[:space:]]/}" ]]; then
  exec hermes \${cleaned[@]:+"\${cleaned[@]}"} -q "$prompt"
else
  exec hermes \${cleaned[@]:+"\${cleaned[@]}"}
fi
`;

export type ShimInstallResult =
  | { ok: true; path: string }
  | { ok: false; error: string };

/**
 * Install the legacy `hermes-coven` shim next to a resolved `hermes` binary.
 * Current Cave does not call this installer; it remains available only for
 * explicit migration/testing of pre-1.0.3 manifests. POSIX only.
 *
 * @param hermesBinaryPath absolute path to the `hermes` executable (from the
 *   post-install PATH lookup). The shim is written to its parent directory.
 * @deprecated Current Cave uses the native Hermes 1.0.3 `--query` adapter and
 * does not auto-install this shim.
 */
export async function installHermesShim(
  hermesBinaryPath: string,
): Promise<ShimInstallResult> {
  if (process.platform === "win32") {
    return { ok: false, error: "hermes-coven shim is POSIX-only" };
  }
  try {
    const dir = dirname(hermesBinaryPath);
    await mkdir(dir, { recursive: true });
    const shimPath = join(dir, "hermes-coven");
    await writeFile(shimPath, HERMES_COVEN_SHIM, { mode: 0o755 });
    // writeFile honors mode only on create; enforce it explicitly so an
    // existing non-executable file is corrected.
    await chmod(shimPath, 0o755);
    return { ok: true, path: shimPath };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
