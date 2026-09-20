import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * SIDs whose access to a client v1 path is not a finding.
 *
 * SYSTEM and the local Administrators group can already take ownership of any
 * file and rewrite its DACL, so denying them buys no confidentiality and only
 * breaks backup and anti-malware agents. Everything else — including the
 * `Users` and `Authenticated Users` groups that a machine-wide profile policy
 * may inherit onto `%USERPROFILE%` — is a principal that could mint a bearer,
 * so it is stripped and then refused if it survives.
 */
const WINDOWS_SYSTEM_SID = "S-1-5-18";
const WINDOWS_ADMINISTRATORS_SID = "S-1-5-32-544";
const WINDOWS_OWNER_RIGHTS_SID = "S-1-3-4";
const WINDOWS_WRITABLE_RIGHTS_MASK = 0x500d_0156;

// ── The unverified-ownership waiver ─────────────────────────────────────────
// The four constants below, `resolveUnverifiedOwnershipWaiver`, and the three
// message builders after it are duplicated verbatim in server.ts, for the same
// reason the PowerShell above is (`build:server` runs esbuild with
// `--bundle=false`, so server.mjs cannot import this module). discovery.test.ts
// compares each of those regions byte-for-byte and fails if they drift.
//
// This exists because reading the DACL is not possible on every Windows host.
// Measured on Windows 11: PowerShell under Constrained Language Mode answers
// the probe with `MethodInvocationNotSupportedInConstrainedLanguage` and exit
// 1, and a `powershell.exe` absent from %SystemRoot% answers with ENOENT. Both
// are WDAC/AppLocker-managed configurations, and on both the guard threw at
// boot — which server.ts turned into `process.exit(1)`, so the app would not
// start and there was no remedy reachable from inside it.
//
// The waiver is deliberately narrow. It covers ONE condition: the probe could
// not answer at all. It never covers a DACL that WAS read and found shared —
// that has a remedy the operator can run (`icacls <path> /reset`), and
// admitting it is exactly the "reads as protection, provides none" defect
// #4842 was filed about. Nor does it cover a POSIX uid mismatch, or a platform
// with neither a uid nor an ACL.
const UNVERIFIED_OWNERSHIP_ENV = "COVEN_CAVE_UNVERIFIED_PATH_OWNERSHIP";
const UNVERIFIED_OWNERSHIP_REASON_ENV = "COVEN_CAVE_UNVERIFIED_PATH_OWNERSHIP_REASON";
const UNVERIFIED_OWNERSHIP_TOKEN = "i-accept-unverified-path-ownership";
const UNVERIFIED_OWNERSHIP_MIN_REASON = 12;

export type UnverifiedOwnershipWaiver =
  | { granted: true; reason: string }
  | { granted: false; note: string };

/**
 * Whether the operator has explicitly, attributably waived an unreadable DACL.
 *
 * Three properties make this impossible to trip by accident, and they are the
 * point rather than ceremony:
 *
 * 1. The value is an exact sentence, not a boolean. Every other switch in this
 *    codebase is `=1`, so an operator working from memory reaches for that —
 *    and `1`, `true`, `yes` and a case-shifted token all do nothing here and
 *    say so. Nothing an init script, a container image, or a CI matrix sets by
 *    habit can satisfy it.
 * 2. A second variable must carry a real sentence naming who accepted this and
 *    why. Setting one variable is never enough, and the text is what turns up
 *    in the log line the app then prints on every boot.
 * 3. It is consulted at exactly one place — an unreadable DACL — so even a
 *    correctly-set waiver cannot admit a path the probe read and refused.
 *
 * The house pattern for this is `release.yml`'s `allow_unconfigured_*` inputs:
 * the hatch exists, it is manual and named, and pulling it is *disclosed* in
 * the artifact it produces (cave-yp21x). The disclosure here is the warning the
 * caller prints, once per waived path, plus the boot banner in server.ts.
 */
export function resolveUnverifiedOwnershipWaiver(
  env: Record<string, string | undefined>,
): UnverifiedOwnershipWaiver {
  const requested = env[UNVERIFIED_OWNERSHIP_ENV]?.trim() ?? "";
  if (!requested) {
    return {
      granted: false,
      note:
        `If the DACL genuinely cannot be read on this host — PowerShell in `
        + `Constrained Language Mode, or no powershell.exe under %SystemRoot% — `
        + `set ${UNVERIFIED_OWNERSHIP_ENV}=${UNVERIFIED_OWNERSHIP_TOKEN} and `
        + `${UNVERIFIED_OWNERSHIP_REASON_ENV} to a sentence naming who accepted `
        + `that and why. It waives only an unreadable DACL, never one that was `
        + `read and found shared.`,
    };
  }
  if (requested !== UNVERIFIED_OWNERSHIP_TOKEN) {
    return {
      granted: false,
      note:
        `${UNVERIFIED_OWNERSHIP_ENV} is set, but not to the waiver: the only `
        + `accepted value is the exact string ${UNVERIFIED_OWNERSHIP_TOKEN}. A `
        + `boolean-shaped value ("1", "true", "yes") never waives this check.`,
    };
  }
  const reason = env[UNVERIFIED_OWNERSHIP_REASON_ENV]?.trim() ?? "";
  if (reason.length < UNVERIFIED_OWNERSHIP_MIN_REASON) {
    return {
      granted: false,
      note:
        `${UNVERIFIED_OWNERSHIP_ENV} is set, but ${UNVERIFIED_OWNERSHIP_REASON_ENV} `
        + `must carry at least ${UNVERIFIED_OWNERSHIP_MIN_REASON} characters naming `
        + `who accepted an unverified path and why. The waiver stays closed `
        + `without that attribution.`,
    };
  }
  return { granted: true, reason };
}

/** The refusal an unreadable DACL earns when no waiver is in force. */
function unverifiableOwnershipRefusal(
  subject: string,
  path: string,
  cause: Error,
  note: string,
): string {
  return `${subject} ownership could not be verified on Windows: ${cause.message}. `
    + `Refusing ${path}; inspect it with: icacls "${path}". ${note}`;
}

/** The disclosure a waived path earns — once per path, never suppressed. */
function unverifiedOwnershipDisclosure(
  subject: string,
  path: string,
  cause: Error,
  reason: string,
): string {
  return `SECURITY WAIVER — ${subject} is being used UNVERIFIED. Its DACL could not `
    + `be read on this host (${cause.message}), and ${UNVERIFIED_OWNERSHIP_ENV} is `
    + `set, so ${path} is trusted on the operator's word alone: reason given — `
    + `${reason}. Any principal that can write ${path} can mint credentials or `
    + `point a paired client at another server. Unset ${UNVERIFIED_OWNERSHIP_ENV} `
    + `to restore the check.`;
}

/**
 * The refusal a DACL that WAS read and found shared earns.
 *
 * Never waivable, which is why the waiver appears here only to say it does not
 * apply: this path has a remedy the operator can run, and admitting it would
 * be the unconditional pass #4842 was filed about wearing an env var.
 */
function sharedOwnershipRefusal(
  subject: string,
  path: string,
  findings: string[],
  waiver: UnverifiedOwnershipWaiver,
): string {
  return `${subject} is not exclusive to the current user: ${findings.join("; ")}. `
    + `Refusing ${path}; inspect it with: icacls "${path}"`
    + (waiver.granted
      ? `. ${UNVERIFIED_OWNERSHIP_ENV} does not cover a DACL that was read: this `
        + `one was, and it is shared. Repair it with: icacls "${path}" /reset`
      : "");
}

/** Result of one `windows-acl` probe: the state of the path after any repair. */
export interface ClientV1WindowsAclReport {
  /** SID of the identity this process runs as. */
  self: string;
  /** SID that owns the path. */
  owner: string;
  /** Whether the DACL is protected from inheritance. */
  protected: boolean;
  /** Whether the probe had to rewrite the DACL to reach the exclusive state. */
  repaired: boolean;
  /** SIDs the repair stripped, empty when nothing had to change. */
  removed: string[];
  /** The DACL as it stands now. */
  aces: { sid: string; type: string; rights?: number }[];
}

export type ClientV1WindowsAclProbe = (path: string) => Promise<ClientV1WindowsAclReport>;
export type ClientV1WindowsAclExecutor = (
  file: string,
  args: string[],
  options: {
    env: NodeJS.ProcessEnv;
    encoding: "utf8";
    windowsHide: true;
    timeout: number;
    maxBuffer: number;
  },
) => Promise<{ stdout: string }>;

export interface ClientV1PathOwnershipOptions {
  /**
   * Seams for tests. `platform`/`getuid` select the branch and
   * `probeWindowsAcl` stands in for the PowerShell subprocess, so the Windows
   * branch is exercised on the Linux runners too — the branch is otherwise
   * dead on every machine CI owns, which is how it stayed inert.
   */
  platform?: NodeJS.Platform;
  getuid?: (() => number) | null;
  probeWindowsAcl?: ClientV1WindowsAclProbe;
  warn?: (message: string) => void;
  /**
   * Where the unverified-ownership waiver is read from. Injectable for the
   * same reason as everything above it: the waiver only matters on Windows, so
   * reading `process.env` directly would leave every assertion about it
   * unreachable on the Linux runners.
   */
  env?: Record<string, string | undefined>;
  /**
   * Clock for the negative-refusal cache. Injectable for the same reason as
   * everything else here: the refusal TTL is the cave-okfb2 change, and a
   * test that cannot advance the clock cannot assert expiry without sleeping.
   */
  now?: () => number;
}

/**
 * Windows PowerShell reads and repairs the DACL; `stat` cannot.
 *
 * Node reports `uid: 0` for every path on win32 and `chmod` there sets nothing
 * but the read-only bit, so neither half of the POSIX contract this module
 * enforces has a native equivalent. The repair takes ownership as the current
 * SID only when ownership differs, then writes the DACL. Avoiding a redundant
 * owner write lets an ordinary owner restrict an inherited DACL without
 * requiring `WRITE_OWNER`; `Set-Acl`, which also carries the audit section,
 * fails with `PrivilegeNotHeldException` (SeSecurityPrivilege) against an
 * already-protected path.
 *
 * The resulting owner and DACL are re-read below. A repair that cannot make
 * both exclusive remains a finding and is refused rather than trusted.
 */
const WINDOWS_ACL_SCRIPT = `
$ErrorActionPreference = 'Stop'
[Console]::Error.WriteLine('acl-probe:start')
# Cmdlets are off limits in this script. Whichever cmdlet came first (the
# provider item lookup in one release, the object constructor in the next)
# never returned in the stripped probe environment: command discovery is what
# stalls, not the work. Direct .NET member calls, language keywords and
# operators do not wait on it.
$path = $env:COVEN_CAVE_CLIENT_V1_ACL_PATH
$isDirectory = [System.IO.Directory]::Exists($path)
if ($isDirectory) {
  $item = [System.IO.DirectoryInfo]::new($path)
} elseif ([System.IO.File]::Exists($path)) {
  $item = [System.IO.FileInfo]::new($path)
} else {
  throw 'ACL path does not exist.'
}
[Console]::Error.WriteLine('acl-probe:item')
$me = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$system = [System.Security.Principal.SecurityIdentifier]::new('${WINDOWS_SYSTEM_SID}')
$admins = [System.Security.Principal.SecurityIdentifier]::new('${WINDOWS_ADMINISTRATORS_SID}')
$ownerRights = [System.Security.Principal.SecurityIdentifier]::new('${WINDOWS_OWNER_RIGHTS_SID}')
$writableRights = [uint32]${WINDOWS_WRITABLE_RIGHTS_MASK}
$trusted = @($me.Value, $system.Value, $admins.Value)
[Console]::Error.WriteLine('acl-probe:identity')

function Read-State {
  param($target)
  [Console]::Error.WriteLine('acl-probe:read-state')
  $acl = $target.GetAccessControl('Access,Owner')
  [Console]::Error.WriteLine('acl-probe:acl')
  # Keep account-name lookup out of the security boundary: orphaned or remote
  # principals can make IdentityReference.Translate block on Windows.
  $aces = @()
  foreach ($entry in @($acl.GetAccessRules(
    $true,
    $true,
    [System.Security.Principal.SecurityIdentifier]
  ))) {
    $aces += [pscustomobject]@{
      sid = $entry.IdentityReference.Value
      type = [string]$entry.AccessControlType
      # FileSystemRights is signed; generic rights can set its sign bit.
      # Reinterpret the bits rather than using a checked numeric conversion.
      rights = [BitConverter]::ToUInt32([BitConverter]::GetBytes([int]$entry.FileSystemRights), 0)
    }
  }
  [Console]::Error.WriteLine('acl-probe:rules')
  return [pscustomobject]@{
    owner = $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
    protected = [bool]$acl.AreAccessRulesProtected
    aces = $aces
  }
}

function Test-Exclusive {
  param($state)
  if (-not $state.protected) { return $false }
  if ($state.owner -ne $me.Value) { return $false }
  foreach ($ace in $state.aces) {
    if ($ace.type -ne 'Allow') { return $false }
    if ($trusted -contains $ace.sid) { continue }
    if ($ace.sid -eq $ownerRights.Value -and
        (([uint32]$ace.rights -band $writableRights) -eq 0)) { continue }
    return $false
  }
  return $true
}

function Format-JsonString {
  param([string]$value)
  $builder = [System.Text.StringBuilder]::new()
  [void]$builder.Append('"')
  foreach ($char in $value.ToCharArray()) {
    $code = [int]$char
    if ($char -eq '"') { [void]$builder.Append('\\"') }
    elseif ($char -eq '\\') { [void]$builder.Append('\\\\') }
    elseif ($code -lt 32) { [void]$builder.Append(('\\u{0:x4}' -f $code)) }
    else { [void]$builder.Append($char) }
  }
  [void]$builder.Append('"')
  return $builder.ToString()
}

function Format-JsonBool {
  param([bool]$value)
  if ($value) { return 'true' } else { return 'false' }
}

$state = Read-State $item
[Console]::Error.WriteLine('acl-probe:initial-state')
$repaired = $false
$removed = @()
if (-not (Test-Exclusive $state)) {
[Console]::Error.WriteLine('acl-probe:repair')
  foreach ($ace in $state.aces) {
    if ($trusted -contains $ace.sid) { continue }
    if ($ace.sid -eq $ownerRights.Value -and
        (([uint32]$ace.rights -band $writableRights) -eq 0)) { continue }
    if ($removed -notcontains $ace.sid) { $removed += $ace.sid }
  }
  $acl = $item.GetAccessControl('Access')
  if ($state.owner -ne $me.Value) {
    $acl.SetOwner($me)
  }
  $acl.SetAccessRuleProtection($true, $false)
  # Enumerate the explicit post-protection rules in the same SID-native form.
  foreach ($rule in @($acl.GetAccessRules(
    $true,
    $false,
    [System.Security.Principal.SecurityIdentifier]
  ))) {
    if (
      $rule.IdentityReference.Value -eq $ownerRights.Value -and
      [string]$rule.AccessControlType -eq 'Allow' -and
      (([BitConverter]::ToUInt32([BitConverter]::GetBytes([int]$rule.FileSystemRights), 0) -band $writableRights) -eq 0)
    ) {
      continue
    }
    [void]$acl.RemoveAccessRuleSpecific($rule)
  }
  $inheritance = if ($isDirectory) { 'ContainerInherit, ObjectInherit' } else { 'None' }
  foreach ($sid in @($me, $system, $admins)) {
    $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new(
      $sid, 'FullControl', $inheritance, 'None', 'Allow'))
  }
  $item.SetAccessControl($acl)
[Console]::Error.WriteLine('acl-probe:repair-written')
  $repaired = $true
  $state = Read-State $item
}

[Console]::Error.WriteLine('acl-probe:complete')
$aceJson = @()
foreach ($ace in $state.aces) {
  $aceJson += ('{"sid":' + (Format-JsonString $ace.sid) +
    ',"type":' + (Format-JsonString $ace.type) +
    ',"rights":' + ([uint32]$ace.rights).ToString([System.Globalization.CultureInfo]::InvariantCulture) + '}')
}
$removedJson = @()
foreach ($sid in $removed) { $removedJson += (Format-JsonString $sid) }
# Written straight to stdout so nothing travels the output pipeline at all.
[Console]::Out.WriteLine('{"self":' + (Format-JsonString $me.Value) +
  ',"owner":' + (Format-JsonString $state.owner) +
  ',"protected":' + (Format-JsonBool $state.protected) +
  ',"repaired":' + (Format-JsonBool $repaired) +
  ',"removed":[' + ($removedJson -join ',') + ']' +
  ',"aces":[' + ($aceJson -join ',') + ']}')
`;

function windowsSystemRoot(): string {
  return process.env.SystemRoot || process.env.windir || "C:\\Windows";
}

function windowsPowerShellPath(): string {
  // Absolute, never PATH: an attacker who can prepend a directory to PATH could
  // otherwise answer the ownership question with their own `powershell.exe`,
  // which is the one spoof a guard like this must not accept.
  return join(windowsSystemRoot(), "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

const WINDOWS_ACL_PROBE_TIMEOUT_MS = 12_000;
const WINDOWS_ACL_PROBE_MAX_ATTEMPTS = 2;

function windowsAclProbeTimedOut(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const failure = error as { code?: unknown; killed?: unknown; signal?: unknown };
  return failure.code === "ETIMEDOUT"
    || (failure.killed === true && failure.signal === "SIGTERM");
}

const WINDOWS_ACL_PROBE_STAGES = new Set([
  "start",
  "item",
  "identity",
  "read-state",
  "acl",
  "rules",
  "initial-state",
  "repair",
  "repair-written",
  "complete",
]);
const windowsAclProbeTimeoutStages = new WeakMap<object, string>();

function sanitizedWindowsAclProbeTimeout(error: unknown): NodeJS.ErrnoException {
  const stderr =
    error && typeof error === "object" && "stderr" in error
      ? Buffer.isBuffer(error.stderr)
        ? error.stderr.toString("utf8")
        : typeof error.stderr === "string"
          ? error.stderr
          : ""
      : "";
  let stage = "launch";
  for (const match of stderr.matchAll(/^acl-probe:([a-z-]+)\r?$/gmu)) {
    if (WINDOWS_ACL_PROBE_STAGES.has(match[1]!)) stage = match[1]!;
  }
  const sanitized = Object.assign(new Error(`Windows ACL probe timed out at ${stage}.`), {
    code: "ETIMEDOUT",
    killed: true,
    signal: "SIGTERM",
  });
  windowsAclProbeTimeoutStages.set(sanitized, stage);
  return sanitized;
}

/** Preserve process facts in the message: deferred initialization only logs
 * Error.message. Never echo PowerShell's command, target path or raw output. */
function sanitizedWindowsAclProbeFailure(error: unknown): Error {
  const failure = (error && typeof error === "object" ? error : {}) as Record<string, unknown>;
  const code = typeof failure.code === "number" && Number.isSafeInteger(failure.code)
    ? failure.code
    : typeof failure.code === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(failure.code)
      ? failure.code : undefined;
  const status = typeof failure.status === "number" && Number.isSafeInteger(failure.status)
    ? failure.status : undefined;
  const signal = failure.signal === null ? null
    : typeof failure.signal === "string" && /^SIG[A-Z0-9]{1,20}$/.test(failure.signal)
      ? failure.signal : undefined;
  const killed = typeof failure.killed === "boolean" ? failure.killed : undefined;
  const bytes = (value: unknown) => typeof value === "string" ? Buffer.byteLength(value)
    : Buffer.isBuffer(value) ? value.length : "unknown";
  const stderr = typeof failure.stderr === "string" ? failure.stderr
    : Buffer.isBuffer(failure.stderr) ? failure.stderr.toString("utf8") : "";
  let stage = "launch";
  for (const match of stderr.matchAll(/^acl-probe:([a-z-]+)\r?$/gmu)) {
    if (WINDOWS_ACL_PROBE_STAGES.has(match[1]!)) stage = match[1]!;
  }
  return Object.assign(new Error(
    `Windows ACL probe failed (code=${code ?? "unknown"}, status=${status ?? "unknown"}, `
      + `signal=${signal === null ? "null" : signal ?? "unknown"}, killed=${killed ?? "unknown"}, `
      + `stage=${stage}, stdoutBytes=${bytes(failure.stdout)}, stderrBytes=${bytes(failure.stderr)}).`,
  ), { code, status, signal, killed });
}

/**
 * The smallest environment PowerShell needs, never the server's own.
 *
 * This process holds `COVEN_CAVE_ACCESS_TOKEN` and `COVEN_CAVE_AUTH_TOKEN`;
 * a subprocess that only has to read a DACL has no business receiving them.
 * `SystemRoot`/`windir` locate the runtime, `PATHEXT` and a System32-only
 * `PATH` keep command resolution inside the system directory, and `TEMP`/`TMP`
 * give the host somewhere to write. The path under test travels here too, so
 * no quoting rule stands between a path containing a quote or a `$` and the
 * identity being checked.
 */
function windowsProbeEnv(path: string): NodeJS.ProcessEnv {
  const systemRoot = windowsSystemRoot();
  const system32 = join(systemRoot, "System32");
  return {
    COVEN_CAVE_CLIENT_V1_ACL_PATH: path,
    // Next augments ProcessEnv to require this. It carries no secret.
    NODE_ENV: process.env.NODE_ENV,
    SystemRoot: systemRoot,
    windir: systemRoot,
    PATH: system32,
    PATHEXT: process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD",
    TEMP: process.env.TEMP || process.env.TMP || join(systemRoot, "Temp"),
    TMP: process.env.TMP || process.env.TEMP || join(systemRoot, "Temp"),
  };
}

/**
 * Parse one probe's stdout, refusing anything that is not the whole report.
 *
 * `aces` carries the entire access decision, so a shape this cannot read has to
 * be an error rather than a default. Coercing a malformed `aces` to `[]` — which
 * is what an earlier revision did — reads as "no principal has access" and
 * therefore *admits* the path: the one field worth being strict about was the
 * one field being forgiven. Nothing exercises that on a POSIX runner either,
 * because the only test that drives the real subprocess is win32-only.
 *
 * Exported for the parser tests, which are the platform-independent coverage
 * the subprocess itself cannot have.
 */
export function parseClientV1WindowsAclReport(raw: string): ClientV1WindowsAclReport {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("the ACL probe returned a malformed report");
  }
  const { aces, removed } = parsed;
  if (
    typeof parsed.self !== "string"
    || !parsed.self
    || typeof parsed.owner !== "string"
    || !parsed.owner
    || typeof parsed.protected !== "boolean"
    || typeof parsed.repaired !== "boolean"
    || !Array.isArray(aces)
    || !Array.isArray(removed)
  ) {
    throw new Error("the ACL probe returned a malformed report");
  }
  return {
    self: parsed.self,
    owner: parsed.owner,
    protected: parsed.protected,
    repaired: parsed.repaired,
    removed: removed.map((sid) => String(sid)),
    aces: aces.map((ace) => {
      const entry = (ace ?? {}) as Record<string, unknown>;
      if (
        !Number.isInteger(entry.rights)
        || (entry.rights as number) < 0
        || (entry.rights as number) > 0xffff_ffff
      ) {
        throw new Error("the ACL probe returned a malformed report");
      }
      return {
        sid: String(entry.sid ?? ""),
        type: String(entry.type ?? ""),
        rights: entry.rights as number,
      };
    }),
  };
}

export function createClientV1WindowsAclProbe(
  execute: ClientV1WindowsAclExecutor = execFileAsync as ClientV1WindowsAclExecutor,
): ClientV1WindowsAclProbe {
  return async (path) => {
    for (let attempt = 0; attempt < WINDOWS_ACL_PROBE_MAX_ATTEMPTS; attempt += 1) {
      let stdout: string;
      try {
        ({ stdout } = await execute(
          windowsPowerShellPath(),
          [
            "-NoProfile",
            "-NonInteractive",
            "-NoLogo",
            "-InputFormat",
            "None",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            WINDOWS_ACL_SCRIPT,
          ],
          {
            env: windowsProbeEnv(path),
            encoding: "utf8",
            windowsHide: true,
            timeout: WINDOWS_ACL_PROBE_TIMEOUT_MS,
            maxBuffer: 1024 * 1024,
          },
        ));
      } catch (error) {
        const timedOut = windowsAclProbeTimedOut(error);
        if (attempt + 1 >= WINDOWS_ACL_PROBE_MAX_ATTEMPTS || !timedOut) {
          if (timedOut) throw sanitizedWindowsAclProbeTimeout(error);
          throw sanitizedWindowsAclProbeFailure(error);
        }
        continue;
      }
      return parseClientV1WindowsAclReport(stdout);
    }
    throw new Error("the ACL probe attempt bound was exhausted");
  };
}

export const probeWindowsAcl = createClientV1WindowsAclProbe();

/**
 * Findings that make a path unusable, or an empty list when it is exclusive.
 */
function exclusivityFindings(report: ClientV1WindowsAclReport): string[] {
  const findings: string[] = [];
  const trusted = new Set([report.self, WINDOWS_SYSTEM_SID, WINDOWS_ADMINISTRATORS_SID]);
  if (report.owner !== report.self) {
    findings.push(`owned by ${report.owner}, not ${report.self}`);
  }
  if (!report.protected) findings.push("its DACL still inherits from the parent");
  const foreign = report.aces
    .filter((ace) =>
      ace.type !== "Allow"
      || (
        !trusted.has(ace.sid)
        && !(
          ace.sid === WINDOWS_OWNER_RIGHTS_SID
          && Number.isInteger(ace.rights)
          && ((ace.rights as number) & WINDOWS_WRITABLE_RIGHTS_MASK) === 0
        )
      )
    )
    .map((ace) => `${ace.type}:${ace.sid}`);
  if (foreign.length > 0) {
    findings.push(`access granted to ${[...new Set(foreign)].join(", ")}`);
  }
  return findings;
}

/**
 * The refusal a client v1 ownership check answers with.
 *
 * Distinct from the plain `Error` the guard used to throw so the auth
 * boundary can tell "this host cannot verify its own store" apart from every
 * other failure, and answer the normalized `ownership_refused` envelope
 * instead of letting the throw escape into a bare non-envelope 500
 * (cave-e7xwk). The message stays the operator-facing text this module
 * always built — path, finding, and the `icacls` remedy — but that text is
 * logged, not shipped to a paired client.
 */
export class ClientV1PathOwnershipError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ClientV1PathOwnershipError";
  }
}

/**
 * How long a refused path stays refused before the probe runs again.
 *
 * Failures used to be uncached BY DESIGN (cave-okfb2 R6): a refused path was
 * re-probed on every authenticated request so an out-of-band repair took
 * effect without a restart. That made a host where the check cannot pass
 * fork a doomed ~290 ms PowerShell per request. The negative TTL is the
 * deliberate trade: refusals are now cached, so the probe runs at most once
 * per path per window — a degraded host answers every request from the cache
 * and re-drives the probe only after the window lapses, which is also when an
 * out-of-band `icacls /reset` takes effect.
 */
export const CLIENT_V1_OWNERSHIP_REFUSAL_TTL_MS = 30_000;

/**
 * Successful verifications, keyed by path.
 *
 * A probe costs ~290 ms, and `verify`/`findByBearer` run it once per
 * authenticated request, so caching is what keeps the Windows branch off the
 * hot path. Failures are cached separately, with a short negative TTL
 * (`refusedWindowsPaths`), so a path that fails is re-probed only after the
 * window lapses and an out-of-band repair needs no restart. Cached success is
 * per process, so unlike the POSIX branch this does not re-detect a DACL
 * loosened mid-run — the symlink and realpath guards at the same call sites
 * still do run every time.
 */
const verifiedWindowsPaths = new Map<string, ClientV1WindowsAclReport>();

/**
 * Paths admitted UNVERIFIED under the operator's waiver, keyed by path.
 *
 * Separate from the success cache above because nothing here was verified. It
 * exists for two reasons and both are about the host where it applies: on such
 * a host the probe can *never* succeed, so re-driving it per authenticated
 * request would fork a doomed ~290 ms subprocess every time (cave-okfb2 R6 in
 * its worst form), and a disclosure repeated on every request is one nobody
 * reads. Like the success cache this is per process, so installing PowerShell
 * out of band takes effect at the next restart.
 */
const waivedWindowsPaths = new Map<string, string>();

/**
 * Refusals, keyed by path, until their negative TTL lapses.
 *
 * The cave-okfb2 half: a path that failed is re-probed only after
 * `CLIENT_V1_OWNERSHIP_REFUSAL_TTL_MS` expires, so a host whose probe cannot
 * pass stops forking a ~290 ms subprocess per request and starts answering
 * from the cache. The stored `Error` is re-thrown on a hit, so a cache hit
 * refuses exactly as the miss that populated it did. An out-of-band repair is
 * picked up at the first probe after the window lapses.
 */
const refusedWindowsPaths = new Map<
  string,
  { expiresAt: number; error: ClientV1PathOwnershipError }
>();

/**
 * Test seam: drop cached verifications, waivers, and refusals so a suite can
 * re-drive the probe from a clean slate.
 */
export function resetClientV1PathOwnershipCache(): void {
  verifiedWindowsPaths.clear();
  waivedWindowsPaths.clear();
  refusedWindowsPaths.clear();
}

/**
 * Refuse a client v1 path that another principal could write.
 *
 * Writing `client-v1-credentials.json` mints authority — the parser validates
 * shape and nothing else — and writing `client-v1-discovery.json` points a
 * client at an attacker's port, so "some other principal can write here" is
 * the whole of the threat and the only question worth asking of the path.
 *
 * The POSIX branch is the uid comparison this has always made. The Windows
 * branch replaces a `typeof process.getuid === "function"` guard that was
 * false on win32 and therefore passed unconditionally. Anything else — a
 * platform with neither `getuid` nor a Windows ACL — is refused rather than
 * waved through, because being unable to answer the question is not an answer.
 */
export async function assertClientV1PathOwnership(
  path: string,
  // `lstat` widens to `Stats | BigIntStats`, so accept both rather than make
  // every call site narrow a union it never actually produces.
  metadata: { uid: number | bigint },
  label: string,
  options: ClientV1PathOwnershipOptions = {},
): Promise<void> {
  return assertExclusivePathOwnership(path, metadata, `Client v1 ${label}`, options);
}

/**
 * The same guard for a path that is not a client v1 path.
 *
 * `subject` is the whole noun phrase every message opens with, because the
 * caller knows what the path is for and this module does not. The mobile
 * pairing secret goes through here: it is a PLAINTEXT credential, not the
 * SHA-256 hashes `client-v1-credentials.json` holds, and its `chmod(0o600)`
 * was the same no-op on win32 that #4842 was filed about (cave-fawvh).
 */
export async function assertExclusivePathOwnership(
  path: string,
  metadata: { uid: number | bigint },
  subject: string,
  options: ClientV1PathOwnershipOptions = {},
): Promise<void> {
  const platform = options.platform ?? process.platform;
  const getuid = options.getuid === undefined ? process.getuid : options.getuid;

  if (typeof getuid === "function") {
    if (metadata.uid !== getuid()) {
      throw new Error(`${subject} must be owned by the current user.`);
    }
    return;
  }

  if (platform !== "win32") {
    throw new Error(
      `${subject} ownership cannot be verified on ${platform}: `
      + `this platform exposes neither a uid nor a Windows ACL, so ${path} is refused.`,
    );
  }

  if (verifiedWindowsPaths.has(path) || waivedWindowsPaths.has(path)) return;

  const now = options.now ?? Date.now;
  const cachedRefusal = refusedWindowsPaths.get(path);
  if (cachedRefusal !== undefined) {
    if (cachedRefusal.expiresAt > now()) throw cachedRefusal.error;
    // Expired: an out-of-band repair may have landed. Re-probe once.
    refusedWindowsPaths.delete(path);
  }

  const warn = options.warn ?? console.warn;
  const waiver = resolveUnverifiedOwnershipWaiver(options.env ?? process.env);
  const probe = options.probeWindowsAcl ?? probeWindowsAcl;
  let report: ClientV1WindowsAclReport;
  try {
    report = await probe(path);
  } catch (cause) {
    // The ONE condition the waiver covers: the host cannot answer the
    // question. Everything below this point had an answer.
    if (!waiver.granted) {
      const error = new ClientV1PathOwnershipError(
        unverifiableOwnershipRefusal(subject, path, cause as Error, waiver.note),
        { cause },
      );
      refusedWindowsPaths.set(path, {
        expiresAt: now() + CLIENT_V1_OWNERSHIP_REFUSAL_TTL_MS,
        error,
      });
      // Logged once per refusal, then suppressed while the negative cache
      // holds: the probe failure is what an operator needs to see, and a
      // request storm re-reading the same sentence is the noise cave-okfb2
      // exists to bound.
      warn(error.message);
      throw error;
    }
    waivedWindowsPaths.set(path, waiver.reason);
    warn(unverifiedOwnershipDisclosure(subject, path, cause as Error, waiver.reason));
    return;
  }

  const findings = exclusivityFindings(report);
  if (findings.length > 0) {
    const error = new ClientV1PathOwnershipError(
      sharedOwnershipRefusal(subject, path, findings, waiver),
    );
    refusedWindowsPaths.set(path, {
      expiresAt: now() + CLIENT_V1_OWNERSHIP_REFUSAL_TTL_MS,
      error,
    });
    warn(error.message);
    throw error;
  }

  if (report.repaired) {
    // Expected on first run for every existing install — `%USERPROFILE%`
    // inherits group ACEs by default and `chmod(0o700)` never stripped them —
    // so this is a notice, not an incident. It still has to be said: until this
    // repair the store carried no enforced access control at all.
    const removed = report.removed.length > 0
      ? report.removed.join(", ")
      : "inherited entries";
    warn(
      `${subject} had no enforced access control on Windows; `
      + `restricted ${path} to the current user and revoked ${removed}.`,
    );
  }

  verifiedWindowsPaths.set(path, report);
}

/**
 * Synchronous ownership check for boot-time readers that cannot await the
 * Windows DACL probe (cave-8pd39).
 *
 * POSIX answers completely: the owner uid must be the current user, the group
 * and other write bits must be clear, and the path must not be a symlink
 * (metadata must therefore come from lstat, never stat). Windows cannot
 * answer synchronously — chmod is a no-op there and the DACL needs a
 * subprocess probe — so the Windows branch REFUSES; a caller that cannot take
 * the async path must treat the refusal as "unreadable" and stay tokenless
 * rather than trust silently.
 */
export function assertExclusivePathOwnershipSync(
  path: string,
  metadata: { uid: number | bigint; mode?: number; isSymbolicLink?: boolean },
  subject: string,
  options: ClientV1PathOwnershipOptions = {},
): void {
  const platform = options.platform ?? process.platform;
  const getuid = options.getuid === undefined ? process.getuid : options.getuid;

  if (metadata.isSymbolicLink) {
    throw new Error(`${subject} must not be a symbolic link.`);
  }

  if (typeof getuid === "function") {
    if (metadata.uid !== getuid()) {
      throw new Error(`${subject} must be owned by the current user.`);
    }
    if (metadata.mode !== undefined && (metadata.mode & 0o022) !== 0) {
      throw new Error(
        `${subject} must not be writable by group or others `
        + `(mode ${(metadata.mode & 0o7777).toString(8)}).`,
      );
    }
    return;
  }

  throw new Error(
    `${subject} ownership cannot be verified synchronously on ${platform}: `
    + `${path} is refused. Use the async guard where the platform probe can run.`,
  );
}
