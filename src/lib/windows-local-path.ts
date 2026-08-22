// windows-local-path: the one place that decides whether a Windows path can
// still be on this machine.
//
// Two callers used to answer that separately — `coven-daemon.ts` for the
// daemon socket and `coven-bin.ts` for the CLI binary — and they drifted. The
// socket side moved to the allowlist below; the binary side kept a two-regex
// denylist, so a `COVEN_BIN` or PATH entry written in any of the spellings
// this module refuses still sourced and spawned `coven.exe` from an
// attacker-controlled share. One predicate is the point: the next spelling
// anyone measures has to be closed once, not once per caller.

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
 * are not space/dot-trimmed. `\\?\` skips canonicalization entirely, so a `..`
 * there is a literal name and also ENOENT — it is refused anyway rather than
 * relying on that, since the difference between the two prefixes is not
 * something a reader should have to hold.
 *
 * Neither caller has a legitimate `..`: the daemon publishes a flat pipe name
 * and its fallback is built by `path.join`, and an installed launcher is found
 * by joining a PATH entry to a file name. This only ever refuses a value that
 * was written to traverse.
 */
const WINDOWS_PARENT_SEGMENT = /(?:^|\\)\.\.(?:\\|$)/;

function failsToProveLocal(candidate: string, localRoot: RegExp): boolean {
  const normalized = candidate.trim().replaceAll("/", "\\");
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
 * Every spelling {@link isRemoteWindowsPath} refuses was measured reaching
 * another machine as a *file* too — `fs.readFileSync` read
 * `\\localhost\C$\Windows\win.ini` through each of the extended forms — so the
 * CLI binary needs the same allowlist and not the narrower `\\host\` /
 * `\\?\UNC\` denylist it replaces. It is stricter in one direction: the pipe
 * device is not a place a launcher can live.
 *
 * Callers still canonicalize and re-check, because this reads the spelling and
 * cannot see a reparse point aimed off-machine.
 */
export function isWindowsRemoteExecutablePath(candidate: string): boolean {
  return failsToProveLocal(candidate, WINDOWS_LOCAL_FILESYSTEM_ROOT);
}
