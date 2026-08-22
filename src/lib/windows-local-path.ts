// windows-local-path: the shared boundary for the two resolvers that take a
// Windows path from outside Cave and then dial or spawn it — the daemon socket
// (`coven-daemon.ts`) and the CLI binary (`coven-bin.ts`, and `codex-bin.ts`
// through it).
//
// Those two used to answer separately and they drifted. The socket side moved
// to the allowlist below; the binary side kept a two-regex denylist, so a
// `COVEN_BIN` or PATH entry written in any of the spellings this module
// refuses still sourced and spawned `coven.exe` from an attacker-controlled
// share. One predicate is the point: the next spelling anyone measures has to
// be closed once, not once per caller.
//
// It is not the only Windows-locality test in the tree, and should not be read
// as one. `research-launch-policy.ts` and `research-session-authority.ts` each
// keep a narrower `\\.\pipe\`-prefix test for the unattended-write authority,
// on values this module's callers have already admitted upstream.

/**
 * The rooted Windows shapes that provably stay on this machine: the local
 * named-pipe device, and a drive letter behind a device prefix.
 */
const WINDOWS_LOCAL_DEVICE_ROOT = /^\\\\[?.]\\(?:pipe\\|[a-z]:\\)/i;

/**
 * The same allowlist minus the pipe device, for a target that has to be a file
 * on a local volume. An executable is never a named pipe, and admitting one
 * would hand `realpathSync`/`statSync` a device path for no reason.
 */
const WINDOWS_LOCAL_FILESYSTEM_ROOT = /^\\\\[?.]\\[a-z]:\\/i;

/**
 * A `..` component, which walks back out of whichever root was allowed.
 *
 * `\\.\` paths are canonicalized by Win32 before they reach the object
 * manager, so a `..` pops the very component the allowlist above matched on
 * and lands back at the device root — from which `UNC\` and
 * `GLOBALROOT\Device\Mup\` re-enter the SMB redirector. Measured on Windows 11
 * against a local `net.createServer` pipe, all of these connected to it
 * through the redirector while spelled as an allowed local root:
 *
 *     \\.\pipe\..\UNC\host\pipe\p          \\.\pipe\..\..\UNC\host\pipe\p
 *     \\.\C:\..\..\UNC\host\pipe\p         //./pipe/../UNC/host/pipe/p
 *     \\.\pipe\..\GLOBALROOT\Device\Mup\host\pipe\p
 *
 * Only an exact `..` component escapes: `.. `, `...` and `. .` were all
 * measured ENOENT, because a `\\.\` path is canonicalized but its components
 * are not space/dot-trimmed.
 *
 * ⚠️ `\\?\` does NOT make a `..` inert, and do not relax this check on the
 * belief that it does. That reading holds for a *pipe* name, where the
 * component is literal, and it does not carry over to a *file* path: measured
 * on Windows 11, `fs.readFileSync` read `\\localhost\C$\Windows\win.ini`
 * through `\\?\C:\..\..\UNC\localhost\C$\Windows\win.ini`. For the executable
 * boundary this refusal is therefore load-bearing under both prefixes.
 *
 * Refusing `..` outright costs the callers close to nothing. The daemon
 * publishes a flat pipe name and its fallback is built by `path.join`; an
 * installed launcher is found by joining a PATH entry to a file name. Only a
 * hand-written `COVEN_BIN` could carry a `..` innocently, and only while also
 * rooted at `\\` — which is the one shape whose traversal cannot be told apart
 * from an attack by spelling, so it is refused rather than guessed about.
 */
const WINDOWS_PARENT_SEGMENT = /(?:^|\\)\.\.(?:\\|$)/;

/**
 * The edge whitespace both this module and its Rust mirror fold away before
 * deciding — deliberately spelled out rather than left to each language's
 * default, because those defaults are not the same set.
 *
 * `String.prototype.trim` folds U+FEFF and not U+0085; Rust's `str::trim` folds
 * U+0085 (it is `White_Space`) and not U+FEFF (it is not). A differential over
 * 203 spellings found exactly those two disagreements and nothing else, each
 * one a `\\host\share\…` value that one copy refused and the other admitted.
 * Both were inert only because every caller of the executable boundary tests
 * `isAbsolute` before asking, and neither character is a path root — which is
 * a property of those callers, not of this boundary, so the union is folded
 * here rather than left resting on them.
 */
const WINDOWS_EDGE_WHITESPACE = /^[\s\x85]+|[\s\x85]+$/g;

function failsToProveLocal(candidate: string, localRoot: RegExp): boolean {
  const normalized = candidate.replace(WINDOWS_EDGE_WHITESPACE, "").replaceAll("/", "\\");
  if (!normalized.startsWith("\\\\")) return false;
  if (WINDOWS_PARENT_SEGMENT.test(normalized)) return true;
  return !localRoot.test(normalized);
}

/**
 * Whether a Windows path fails to prove it stays on this machine.
 *
 * This is an allowlist, and it has to be: enumerating off-machine spellings
 * does not converge. Measured on Windows 11 with `net.connect({ path })`
 * against a local `net.createServer` pipe, every one of these delivered to it
 * through the SMB redirector, and the last shows the nesting is open-ended
 * rather than a fixed set to denylist:
 *
 *     \\host\pipe\p
 *     \\?\UNC\host\pipe\p                    \\.\UNC\host\pipe\p
 *     \\?\GLOBALROOT\Device\Mup\host\pipe\p
 *     \\?\GLOBALROOT\Device\LanmanRedirector\host\pipe\p
 *     \\?\GLOBALROOT\??\UNC\host\pipe\p
 *
 * A path not rooted at `\\` — a drive letter, a bare pipe name, a relative
 * name — cannot leave the machine by spelling alone and is accepted without
 * enumeration. Note this is only true of the value as written: a relative name
 * is one `normalizeWindowsDaemonSocket` call away from being rooted at the
 * pipe device, which is why the caller re-checks the normalized value too.
 * A path rooted at `\\` must match one of the two local device roots above and
 * must not walk back out of it via {@link WINDOWS_PARENT_SEGMENT}; everything
 * else is refused, including spellings nobody has written down yet. The local
 * daemon is owner-local by definition, so a target outside those roots is
 * never it — it is a redirection, and every request Cave would send (commands,
 * conversation content, whatever the daemon is asked to do) would reach the
 * remote listener instead.
 *
 * What this cannot see: a drive letter mapped to a share
 * (`net use Z: \\host\share`) resolves off-machine while spelled `Z:\…`. No
 * syntactic check reaches that; it needs the connected pipe's owner.
 */
export function isRemoteWindowsPath(candidate: string): boolean {
  return failsToProveLocal(candidate, WINDOWS_LOCAL_DEVICE_ROOT);
}

/**
 * The same boundary for an executable Cave is about to read or spawn.
 *
 * The spellings {@link isRemoteWindowsPath} was written against reach another
 * machine as *files* too, so the CLI binary needs the same allowlist and not
 * the narrower `\\host\` / `\\?\UNC\` denylist it replaces. Measured on
 * Windows 11, `fs.readFileSync` read `\\localhost\C$\Windows\win.ini` through
 * every one of these, and the first five are exactly what that denylist let
 * past:
 *
 *     \\.\UNC\host\C$\…                    \\?\GLOBALROOT\Device\Mup\host\C$\…
 *     \\?\GLOBALROOT\Device\LanmanRedirector\host\C$\…
 *     \\?\GLOBALROOT\??\UNC\host\C$\…      \\.\C:\..\..\UNC\host\C$\…
 *     \\?\C:\..\..\UNC\host\C$\…           \\host\C$\…
 *     \\?\UNC\host\C$\…
 *
 * It is stricter than the socket boundary in one direction: the pipe device is
 * not a place a launcher can live.
 *
 * Callers still canonicalize and re-check, because this reads the spelling and
 * cannot see a reparse point aimed off-machine.
 */
export function isWindowsRemoteExecutablePath(candidate: string): boolean {
  return failsToProveLocal(candidate, WINDOWS_LOCAL_FILESYSTEM_ROOT);
}
