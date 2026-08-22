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

function parseAclReport(raw: string): ClientV1WindowsAclReport {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const aces = Array.isArray(parsed.aces) ? parsed.aces : [];
  const removed = Array.isArray(parsed.removed) ? parsed.removed : [];
  if (
    typeof parsed.self !== "string"
    || !parsed.self
    || typeof parsed.owner !== "string"
    || !parsed.owner
    || typeof parsed.protected !== "boolean"
    || typeof parsed.repaired !== "boolean"
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
  return parseAclReport(stdout);
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

/** Test seam: drop cached verifications so a suite can re-drive the probe. */
export function resetClientV1PathOwnershipCache(): void {
  verifiedWindowsPaths.clear();
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
  const platform = options.platform ?? process.platform;
  const getuid = options.getuid === undefined ? process.getuid : options.getuid;

  if (typeof getuid === "function") {
    if (metadata.uid !== getuid()) {
      throw new Error(`Client v1 ${label} must be owned by the current user.`);
    }
    return;
  }

  if (platform !== "win32") {
    throw new Error(
      `Client v1 ${label} ownership cannot be verified on ${platform}: `
      + `this platform exposes neither a uid nor a Windows ACL, so ${path} is refused.`,
    );
  }

  if (verifiedWindowsPaths.has(path)) return;

  const probe = options.probeWindowsAcl ?? probeWindowsAcl;
  let report: ClientV1WindowsAclReport;
  try {
    report = await probe(path);
  } catch (cause) {
    throw new Error(
      `Client v1 ${label} ownership could not be verified on Windows: `
      + `${(cause as Error).message}. Refusing ${path}; inspect it with: icacls "${path}"`,
      { cause },
    );
  }

  const findings = exclusivityFindings(report);
  if (findings.length > 0) {
    throw new Error(
      `Client v1 ${label} is not exclusive to the current user: ${findings.join("; ")}. `
      + `Refusing ${path}; inspect it with: icacls "${path}"`,
    );
  }

  if (report.repaired) {
    // Expected on first run for every existing install — `%USERPROFILE%`
    // inherits group ACEs by default and `chmod(0o700)` never stripped them —
    // so this is a notice, not an incident. It still has to be said: until this
    // repair the store carried no enforced access control at all.
    const removed = report.removed.length > 0
      ? report.removed.join(", ")
      : "inherited entries";
    (options.warn ?? console.warn)(
      `Client v1 ${label} had no enforced access control on Windows; `
      + `restricted ${path} to the current user and revoked ${removed}.`,
    );
  }

  verifiedWindowsPaths.set(path, report);
}
