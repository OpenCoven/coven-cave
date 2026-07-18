import { chmod, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * The `hermes-coven` adapter shim, embedded as a pinned constant so Cave can
 * install it automatically after Hermes's own installer runs — no dependency
 * on a repo file at runtime.
 *
 * Why it exists: the Coven harness appends the user prompt as a POSITIONAL
 * argument behind an options terminator, i.e. `hermes chat <prefix…> -- "<p>"`.
 * But `hermes chat` has no positional prompt slot — the query is only accepted
 * via `-q/--query <value>` — so the raw invocation fails with:
 *     hermes chat: error: argument -q/--query: expected one argument
 * The shim captures the trailing positional prompt and re-emits it as the
 * inline value of `-q`. Keep this byte-for-byte in sync with
 * OpenCoven/coven-runtimes:shims/hermes-coven.
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
 * Install the `hermes-coven` shim next to the resolved `hermes` binary so it
 * sits on the same PATH entry Hermes was installed to. POSIX only — the shim
 * is bash and the Hermes runtime is POSIX-only in the registry.
 *
 * @param hermesBinaryPath absolute path to the `hermes` executable (from the
 *   post-install PATH lookup). The shim is written to its parent directory.
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
