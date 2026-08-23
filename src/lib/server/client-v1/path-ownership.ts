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

type UnverifiedOwnershipWaiver =
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
function resolveUnverifiedOwnershipWaiver(
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
  aces: { sid: string; type: string }[];
}

export type ClientV1WindowsAclProbe = (path: string) => Promise<ClientV1WindowsAclReport>;

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
}

/**
 * Windows PowerShell reads and repairs the DACL; `stat` cannot.
 *
 * Node reports `uid: 0` for every path on win32 and `chmod` there sets nothing
 * but the read-only bit, so neither half of the POSIX contract this module
 * enforces has a native equivalent. `GetAccessControl("Access")` writes only
 * the DACL section — `Set-Acl`, which also carries owner and audit sections,
 * fails with `PrivilegeNotHeldException` (SeSecurityPrivilege) against an
 * already-protected path.
 *
 * Ownership is verified, never taken: a path owned by somebody else is a
 * finding to report, not a race to win.
 */
const WINDOWS_ACL_SCRIPT = `
$ErrorActionPreference = 'Stop'
$item = Get-Item -LiteralPath $env:COVEN_CAVE_CLIENT_V1_ACL_PATH -Force
$me = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$system = New-Object System.Security.Principal.SecurityIdentifier('${WINDOWS_SYSTEM_SID}')
$admins = New-Object System.Security.Principal.SecurityIdentifier('${WINDOWS_ADMINISTRATORS_SID}')
$trusted = @($me.Value, $system.Value, $admins.Value)

function Read-State {
  param($target)
  $acl = $target.GetAccessControl('Access,Owner')
  $aces = @($acl.Access | ForEach-Object {
    [pscustomobject]@{
      sid = $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
      type = [string]$_.AccessControlType
    }
  })
  [pscustomobject]@{
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
    if ($trusted -notcontains $ace.sid) { return $false }
  }
  return $true
}

$state = Read-State $item
$repaired = $false
$removed = @()
if (-not (Test-Exclusive $state)) {
  $removed = @($state.aces | Where-Object { $trusted -notcontains $_.sid } |
    ForEach-Object { $_.sid } | Select-Object -Unique)
  $acl = $item.GetAccessControl('Access')
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($rule in @($acl.Access)) { [void]$acl.RemoveAccessRule($rule) }
  $inheritance = if ($item.PSIsContainer) { 'ContainerInherit, ObjectInherit' } else { 'None' }
  foreach ($sid in @($me, $system, $admins)) {
    $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
      $sid, 'FullControl', $inheritance, 'None', 'Allow')))
  }
  $item.SetAccessControl($acl)
  $repaired = $true
  $state = Read-State $item
}

[pscustomobject]@{
  self = $me.Value
  owner = $state.owner
  protected = $state.protected
  repaired = $repaired
  removed = @($removed)
  aces = $state.aces
} | ConvertTo-Json -Compress -Depth 4
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
      return { sid: String(entry.sid ?? ""), type: String(entry.type ?? "") };
    }),
  };
}

export const probeWindowsAcl: ClientV1WindowsAclProbe = async (path) => {
  const { stdout } = await execFileAsync(
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
      timeout: 15_000,
      maxBuffer: 1024 * 1024,
    },
  );
  return parseClientV1WindowsAclReport(stdout);
};

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
    .filter((ace) => ace.type !== "Allow" || !trusted.has(ace.sid))
    .map((ace) => `${ace.type}:${ace.sid}`);
  if (foreign.length > 0) {
    findings.push(`access granted to ${[...new Set(foreign)].join(", ")}`);
  }
  return findings;
}

/**
 * Successful verifications, keyed by path.
 *
 * A probe costs ~290 ms, and `verify`/`findByBearer` run it once per
 * authenticated request, so caching is what keeps the Windows branch off the
 * hot path. Only successes are cached: a path that fails is re-probed, so
 * repairing the ACL out of band does not require a restart. Cached success is
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

/** Test seam: drop cached verifications so a suite can re-drive the probe. */
export function resetClientV1PathOwnershipCache(): void {
  verifiedWindowsPaths.clear();
  waivedWindowsPaths.clear();
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
      throw new Error(
        unverifiableOwnershipRefusal(subject, path, cause as Error, waiver.note),
        { cause },
      );
    }
    waivedWindowsPaths.set(path, waiver.reason);
    warn(unverifiedOwnershipDisclosure(subject, path, cause as Error, waiver.reason));
    return;
  }

  const findings = exclusivityFindings(report);
  if (findings.length > 0) {
    throw new Error(sharedOwnershipRefusal(subject, path, findings, waiver));
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
