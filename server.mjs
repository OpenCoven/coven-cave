// server.ts
import { execFile as execFile4, execFileSync as execFileSync2 } from "node:child_process";
import {
  createHash as createHash2,
  createHmac,
  randomBytes as randomBytes2,
  randomUUID as randomUUID3
} from "node:crypto";
import {
  chmodSync,
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync as statSync2,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { homedir as homedir3 } from "node:os";
import { join as join3, resolve as resolve2 } from "node:path";
import { promisify as promisify4 } from "node:util";
import { getHeapStatistics, writeHeapSnapshot } from "node:v8";
import next from "next";
import { WebSocket, WebSocketServer } from "ws";

// src/lib/server/device-access/store.ts
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { chmod, lstat, mkdir, open, realpath } from "node:fs/promises";
import { join as join2, resolve } from "node:path";

// src/lib/coven-paths.ts
import { homedir as homedir2 } from "node:os";
import path2 from "node:path";

// src/lib/coven-home.ts
import { homedir } from "node:os";
import path from "node:path";

// src/lib/windows-local-path.ts
var WINDOWS_LOCAL_DEVICE_ROOT = /^\\\\[?.]\\(?:pipe\\|[a-z]:\\)/i;
var WINDOWS_PARENT_SEGMENT = /(?:^|\\)\.\.(?:\\|$)/;
var WINDOWS_EDGE_WHITESPACE = /^[\s\x85]+|[\s\x85]+$/g;
function failsToProveLocal(candidate, localRoot) {
  const normalized = candidate.replace(WINDOWS_EDGE_WHITESPACE, "").replaceAll("/", "\\");
  if (!normalized.startsWith("\\\\")) return false;
  if (WINDOWS_PARENT_SEGMENT.test(normalized)) return true;
  return !localRoot.test(normalized);
}
function isRemoteWindowsPath(candidate) {
  return failsToProveLocal(candidate, WINDOWS_LOCAL_DEVICE_ROOT);
}

// src/lib/coven-home.ts
function covenHomePath(env = process.env, homeDir = homedir(), platform = process.platform, onRemoteRefused) {
  const configured = env.COVEN_HOME;
  if (configured) {
    if (!(platform === "win32" && isRemoteWindowsPath(configured))) return configured;
    try {
      onRemoteRefused?.(configured);
    } catch {
    }
  }
  return path.join(homeDir, ".coven");
}

// src/lib/coven-paths.ts
function covenHome() {
  return covenHomePath(process.env, homedir2(), process.platform);
}
function caveHome() {
  return process.env.COVEN_CAVE_HOME || path2.join(
    /* turbopackIgnore: true */
    covenHome(),
    "cave"
  );
}

// src/lib/server/client-v1/path-ownership.ts
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
var execFileAsync = promisify(execFile);
var WINDOWS_SYSTEM_SID = "S-1-5-18";
var WINDOWS_ADMINISTRATORS_SID = "S-1-5-32-544";
var UNVERIFIED_OWNERSHIP_ENV = "COVEN_CAVE_UNVERIFIED_PATH_OWNERSHIP";
var UNVERIFIED_OWNERSHIP_REASON_ENV = "COVEN_CAVE_UNVERIFIED_PATH_OWNERSHIP_REASON";
var UNVERIFIED_OWNERSHIP_TOKEN = "i-accept-unverified-path-ownership";
var UNVERIFIED_OWNERSHIP_MIN_REASON = 12;
function resolveUnverifiedOwnershipWaiver(env) {
  const requested = env[UNVERIFIED_OWNERSHIP_ENV]?.trim() ?? "";
  if (!requested) {
    return {
      granted: false,
      note: `If the DACL genuinely cannot be read on this host \u2014 PowerShell in Constrained Language Mode, or no powershell.exe under %SystemRoot% \u2014 set ${UNVERIFIED_OWNERSHIP_ENV}=${UNVERIFIED_OWNERSHIP_TOKEN} and ${UNVERIFIED_OWNERSHIP_REASON_ENV} to a sentence naming who accepted that and why. It waives only an unreadable DACL, never one that was read and found shared.`
    };
  }
  if (requested !== UNVERIFIED_OWNERSHIP_TOKEN) {
    return {
      granted: false,
      note: `${UNVERIFIED_OWNERSHIP_ENV} is set, but not to the waiver: the only accepted value is the exact string ${UNVERIFIED_OWNERSHIP_TOKEN}. A boolean-shaped value ("1", "true", "yes") never waives this check.`
    };
  }
  const reason = env[UNVERIFIED_OWNERSHIP_REASON_ENV]?.trim() ?? "";
  if (reason.length < UNVERIFIED_OWNERSHIP_MIN_REASON) {
    return {
      granted: false,
      note: `${UNVERIFIED_OWNERSHIP_ENV} is set, but ${UNVERIFIED_OWNERSHIP_REASON_ENV} must carry at least ${UNVERIFIED_OWNERSHIP_MIN_REASON} characters naming who accepted an unverified path and why. The waiver stays closed without that attribution.`
    };
  }
  return { granted: true, reason };
}
function unverifiableOwnershipRefusal(subject, path4, cause, note) {
  return `${subject} ownership could not be verified on Windows: ${cause.message}. Refusing ${path4}; inspect it with: icacls "${path4}". ${note}`;
}
function unverifiedOwnershipDisclosure(subject, path4, cause, reason) {
  return `SECURITY WAIVER \u2014 ${subject} is being used UNVERIFIED. Its DACL could not be read on this host (${cause.message}), and ${UNVERIFIED_OWNERSHIP_ENV} is set, so ${path4} is trusted on the operator's word alone: reason given \u2014 ${reason}. Any principal that can write ${path4} can mint credentials or point a paired client at another server. Unset ${UNVERIFIED_OWNERSHIP_ENV} to restore the check.`;
}
function sharedOwnershipRefusal(subject, path4, findings, waiver) {
  return `${subject} is not exclusive to the current user: ${findings.join("; ")}. Refusing ${path4}; inspect it with: icacls "${path4}"` + (waiver.granted ? `. ${UNVERIFIED_OWNERSHIP_ENV} does not cover a DACL that was read: this one was, and it is shared. Repair it with: icacls "${path4}" /reset` : "");
}
var WINDOWS_ACL_SCRIPT = `
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
  if ($state.owner -ne $me.Value) {
    $acl.SetOwner($me)
  }
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
function windowsSystemRoot() {
  return process.env.SystemRoot || process.env.windir || "C:\\Windows";
}
function windowsPowerShellPath() {
  return join(windowsSystemRoot(), "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}
function windowsProbeEnv(path4) {
  const systemRoot = windowsSystemRoot();
  const system32 = join(systemRoot, "System32");
  return {
    COVEN_CAVE_CLIENT_V1_ACL_PATH: path4,
    // Next augments ProcessEnv to require this. It carries no secret.
    NODE_ENV: process.env.NODE_ENV,
    SystemRoot: systemRoot,
    windir: systemRoot,
    PATH: system32,
    PATHEXT: process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD",
    TEMP: process.env.TEMP || process.env.TMP || join(systemRoot, "Temp"),
    TMP: process.env.TMP || process.env.TEMP || join(systemRoot, "Temp")
  };
}
function parseClientV1WindowsAclReport(raw) {
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("the ACL probe returned a malformed report");
  }
  const { aces, removed } = parsed;
  if (typeof parsed.self !== "string" || !parsed.self || typeof parsed.owner !== "string" || !parsed.owner || typeof parsed.protected !== "boolean" || typeof parsed.repaired !== "boolean" || !Array.isArray(aces) || !Array.isArray(removed)) {
    throw new Error("the ACL probe returned a malformed report");
  }
  return {
    self: parsed.self,
    owner: parsed.owner,
    protected: parsed.protected,
    repaired: parsed.repaired,
    removed: removed.map((sid) => String(sid)),
    aces: aces.map((ace) => {
      const entry = ace ?? {};
      return { sid: String(entry.sid ?? ""), type: String(entry.type ?? "") };
    })
  };
}
var probeWindowsAcl = async (path4) => {
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
      WINDOWS_ACL_SCRIPT
    ],
    {
      env: windowsProbeEnv(path4),
      encoding: "utf8",
      windowsHide: true,
      timeout: 6e4,
      maxBuffer: 1024 * 1024
    }
  );
  return parseClientV1WindowsAclReport(stdout);
};
function exclusivityFindings(report) {
  const findings = [];
  const trusted = /* @__PURE__ */ new Set([report.self, WINDOWS_SYSTEM_SID, WINDOWS_ADMINISTRATORS_SID]);
  if (report.owner !== report.self) {
    findings.push(`owned by ${report.owner}, not ${report.self}`);
  }
  if (!report.protected) findings.push("its DACL still inherits from the parent");
  const foreign = report.aces.filter((ace) => ace.type !== "Allow" || !trusted.has(ace.sid)).map((ace) => `${ace.type}:${ace.sid}`);
  if (foreign.length > 0) {
    findings.push(`access granted to ${[...new Set(foreign)].join(", ")}`);
  }
  return findings;
}
var ClientV1PathOwnershipError = class extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "ClientV1PathOwnershipError";
  }
};
var CLIENT_V1_OWNERSHIP_REFUSAL_TTL_MS = 3e4;
var verifiedWindowsPaths = /* @__PURE__ */ new Map();
var waivedWindowsPaths = /* @__PURE__ */ new Map();
var refusedWindowsPaths = /* @__PURE__ */ new Map();
async function assertExclusivePathOwnership(path4, metadata, subject, options = {}) {
  const platform = options.platform ?? process.platform;
  const getuid = options.getuid === void 0 ? process.getuid : options.getuid;
  if (typeof getuid === "function") {
    if (metadata.uid !== getuid()) {
      throw new Error(`${subject} must be owned by the current user.`);
    }
    return;
  }
  if (platform !== "win32") {
    throw new Error(
      `${subject} ownership cannot be verified on ${platform}: this platform exposes neither a uid nor a Windows ACL, so ${path4} is refused.`
    );
  }
  if (verifiedWindowsPaths.has(path4) || waivedWindowsPaths.has(path4)) return;
  const now = options.now ?? Date.now;
  const cachedRefusal = refusedWindowsPaths.get(path4);
  if (cachedRefusal !== void 0) {
    if (cachedRefusal.expiresAt > now()) throw cachedRefusal.error;
    refusedWindowsPaths.delete(path4);
  }
  const warn = options.warn ?? console.warn;
  const waiver = resolveUnverifiedOwnershipWaiver(options.env ?? process.env);
  const probe = options.probeWindowsAcl ?? probeWindowsAcl;
  let report;
  try {
    report = await probe(path4);
  } catch (cause) {
    if (!waiver.granted) {
      const error = new ClientV1PathOwnershipError(
        unverifiableOwnershipRefusal(subject, path4, cause, waiver.note),
        { cause }
      );
      refusedWindowsPaths.set(path4, {
        expiresAt: now() + CLIENT_V1_OWNERSHIP_REFUSAL_TTL_MS,
        error
      });
      warn(error.message);
      throw error;
    }
    waivedWindowsPaths.set(path4, waiver.reason);
    warn(unverifiedOwnershipDisclosure(subject, path4, cause, waiver.reason));
    return;
  }
  const findings = exclusivityFindings(report);
  if (findings.length > 0) {
    const error = new ClientV1PathOwnershipError(
      sharedOwnershipRefusal(subject, path4, findings, waiver)
    );
    refusedWindowsPaths.set(path4, {
      expiresAt: now() + CLIENT_V1_OWNERSHIP_REFUSAL_TTL_MS,
      error
    });
    warn(error.message);
    throw error;
  }
  if (report.repaired) {
    const removed = report.removed.length > 0 ? report.removed.join(", ") : "inherited entries";
    warn(
      `${subject} had no enforced access control on Windows; restricted ${path4} to the current user and revoked ${removed}.`
    );
  }
  verifiedWindowsPaths.set(path4, report);
}

// src/lib/server/device-access/contract.ts
var DEVICE_ACCESS_COOKIE = "cave_device_access";
var DEVICE_ACCESS_HEADER = "x-coven-cave-device-access";
var DEVICE_CREDENTIAL_PREFIX = "cave-device-v1.";

// src/lib/server/device-access/store.ts
var PAIRING_TTL_MS = 5 * 6e4;
var REQUEST_WINDOW_MS = 10 * 6e4;
var LAST_SEEN_INTERVAL_MS = 6e4;
var DATABASE_FILE = "device-access.sqlite";
var CREDENTIAL_RE = /^cave-device-v1\.([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/;
var ERROR_STATUS = {
  invalid_request: 400,
  forbidden: 403,
  conflict: 409,
  not_found: 404,
  rate_limited: 429
};
var DeviceAccessError = class extends Error {
  constructor(code, message, status = ERROR_STATUS[code]) {
    super(message);
    this.name = "DeviceAccessError";
    this.code = code;
    this.status = status;
  }
};
function text(value, field, max = 256) {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value) || value.includes(DEVICE_CREDENTIAL_PREFIX)) {
    throw new DeviceAccessError("invalid_request", `Invalid ${field}.`);
  }
  return value.trim();
}
function tailnet(value) {
  const normalized = text(value, "tailnet", 253).toLowerCase();
  const labels = normalized.split(".");
  if (labels.length < 3 || !normalized.endsWith(".ts.net") || labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
    throw new DeviceAccessError("invalid_request", "Tailnets must be exact DNS names ending in .ts.net.");
  }
  return normalized;
}
function normalizePeer(peer) {
  return {
    tailnet: tailnet(peer?.tailnet),
    nodeId: text(peer?.nodeId, "node ID"),
    userId: text(peer?.userId, "user ID"),
    loginName: text(peer?.loginName, "login name"),
    deviceName: text(peer?.deviceName, "device name")
  };
}
function hashCredential(credential) {
  return createHash("sha256").update(credential).digest();
}
function policyEnabled(value) {
  if (value !== 0 && value !== 1) {
    throw new Error("Device access policy mode is missing or invalid.");
  }
  return value === 1;
}
function deviceRecord(row) {
  return {
    id: row.id,
    installationId: row.installationId,
    label: row.label,
    peer: {
      tailnet: row.tailnet,
      nodeId: row.nodeId,
      userId: row.userId,
      loginName: row.loginName,
      deviceName: row.deviceName
    },
    status: row.status,
    createdAt: row.createdAt,
    pairingExpiresAt: row.pairingExpiresAt,
    decidedAt: row.decidedAt,
    decidedBy: row.decidedBy,
    lastSeenAt: row.lastSeenAt,
    revokedAt: row.revokedAt
  };
}
var POLICY_SCHEMA = `
  CREATE TABLE policy (
    singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
    enabled INTEGER NOT NULL CHECK(enabled IN (0, 1))
  ) STRICT;
  INSERT INTO policy (singleton, enabled)
    SELECT 1, CASE WHEN
      EXISTS(SELECT 1 FROM audit WHERE event = 'policy.updated')
      OR EXISTS(SELECT 1 FROM allowed_tailnets)
      OR EXISTS(SELECT 1 FROM devices)
    THEN 1 ELSE 0 END;
  PRAGMA user_version = 2;
`;
var SCHEMA = `
  CREATE TABLE allowed_tailnets (tailnet TEXT PRIMARY KEY NOT NULL) STRICT;
  CREATE TABLE devices (
    id TEXT PRIMARY KEY NOT NULL,
    installationId TEXT NOT NULL,
    label TEXT NOT NULL,
    tailnet TEXT NOT NULL,
    nodeId TEXT NOT NULL,
    userId TEXT NOT NULL,
    loginName TEXT NOT NULL,
    deviceName TEXT NOT NULL,
    credentialHash TEXT NOT NULL CHECK(length(credentialHash) = 64),
    status TEXT NOT NULL CHECK(status IN ('pending', 'allowed', 'denied', 'revoked', 'expired')),
    createdAt INTEGER NOT NULL,
    pairingExpiresAt INTEGER NOT NULL,
    decidedAt INTEGER,
    decidedBy TEXT,
    lastSeenAt INTEGER,
    revokedAt INTEGER
  ) STRICT;
  CREATE INDEX device_requests ON devices(tailnet, nodeId, createdAt);
  CREATE INDEX device_expiry ON devices(status, pairingExpiresAt);
  CREATE TABLE audit (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    at INTEGER NOT NULL,
    deviceId TEXT REFERENCES devices(id),
    actor TEXT NOT NULL,
    event TEXT NOT NULL,
    requestId TEXT,
    method TEXT,
    path TEXT,
    status INTEGER
  ) STRICT;
  ${POLICY_SCHEMA}
`;
async function secureFile(path4, required = false) {
  let metadata;
  try {
    metadata = await lstat(path4);
  } catch (error) {
    if (!required && error.code === "ENOENT") return;
    throw error;
  }
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) {
    throw new Error(`Device access database files must be regular files without symlinks or hardlinks: ${path4}.`);
  }
  await assertExclusivePathOwnership(path4, metadata, "Device access database file");
  await chmod(path4, 384);
}
async function initializeLocation(root) {
  const configuredRoot = resolve(root);
  await mkdir(configuredRoot, { recursive: true, mode: 448 });
  const metadata = await lstat(configuredRoot);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error("Device access root must be a real directory, not a symlink.");
  }
  const physicalRoot = await realpath(configuredRoot);
  await assertExclusivePathOwnership(physicalRoot, metadata, "Device access root");
  await chmod(physicalRoot, 448);
  const file = join2(physicalRoot, DATABASE_FILE);
  for (const suffix of ["", "-wal", "-shm", "-journal"]) await secureFile(file + suffix);
  try {
    const handle2 = await open(file, "wx", 384);
    await handle2.close();
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  await secureFile(file, true);
  return file;
}
var SqliteDeviceAccessStore = class {
  constructor(db, now) {
    this.db = db;
    this.now = now;
  }
  timestamp() {
    const at = this.now();
    if (!Number.isSafeInteger(at) || at < 0 || at > Number.MAX_SAFE_INTEGER - REQUEST_WINDOW_MS) {
      throw new Error("Device access timestamps must be non-negative safe integer milliseconds.");
    }
    return at;
  }
  transaction(operation) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  audit(at, deviceId, actor, event, access) {
    this.db.prepare(`
      INSERT INTO audit (id, at, deviceId, actor, event, requestId, method, path, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      at,
      deviceId,
      actor,
      event,
      access?.requestId ?? null,
      access?.method ?? null,
      access?.path ?? null,
      access?.status ?? null
    );
  }
  find(id) {
    return this.db.prepare("SELECT * FROM devices WHERE id = ?").get(id);
  }
  isEnabled() {
    return policyEnabled(this.db.prepare("SELECT enabled FROM policy WHERE singleton = 1").get()?.enabled);
  }
  isTailnetAllowed(value) {
    return this.isEnabled() && this.db.prepare("SELECT 1 FROM allowed_tailnets WHERE tailnet = ?").get(value) !== void 0;
  }
  transition(row, status, actor, at) {
    this.db.prepare(`
      UPDATE devices SET status = ?, decidedAt = ?, decidedBy = ?, revokedAt = ? WHERE id = ?
    `).run(status, at, actor, status === "revoked" ? at : null, row.id);
    this.audit(at, row.id, actor, `device.${status}`);
  }
  expirePending(at) {
    const expired = this.db.prepare(`
      SELECT * FROM devices WHERE status = 'pending' AND pairingExpiresAt <= ? ORDER BY rowid
    `).all(at);
    for (const row of expired) this.transition(row, "expired", "system:expiry", at);
  }
  readPolicy() {
    const rows = this.db.prepare(`
      SELECT policy.enabled, allowed_tailnets.tailnet FROM policy
      LEFT JOIN allowed_tailnets ON 1 = 1
      WHERE policy.singleton = 1 ORDER BY allowed_tailnets.tailnet
    `).all();
    return {
      enabled: policyEnabled(rows[0]?.enabled),
      allowedTailnets: rows.filter((row) => row.tailnet !== null).map((row) => row.tailnet)
    };
  }
  async policy() {
    return this.readPolicy();
  }
  async snapshot() {
    return this.transaction(() => {
      this.expirePending(this.timestamp());
      return {
        ...this.readPolicy(),
        devices: this.db.prepare("SELECT * FROM devices ORDER BY rowid DESC").all().map(deviceRecord),
        events: this.db.prepare(`
          SELECT id, at, deviceId, actor, event, requestId, method, path, status
          FROM audit ORDER BY sequence DESC LIMIT 200
        `).all()
      };
    });
  }
  async setAllowedTailnets(tailnets, actor) {
    if (!Array.isArray(tailnets) || tailnets.length > 100) {
      throw new DeviceAccessError("invalid_request", "Provide at most 100 exact tailnets.");
    }
    const normalized = [...new Set(tailnets.map(tailnet))].sort();
    const by = text(actor, "actor");
    this.transaction(() => {
      const at = this.timestamp();
      const wasEnabled = this.isEnabled();
      this.expirePending(at);
      const previous = this.db.prepare("SELECT tailnet FROM allowed_tailnets ORDER BY tailnet").all().map((row) => row.tailnet);
      this.db.exec("DELETE FROM allowed_tailnets");
      for (const value of normalized) {
        this.db.prepare("INSERT INTO allowed_tailnets (tailnet) VALUES (?)").run(value);
      }
      this.db.exec("UPDATE policy SET enabled = 1 WHERE singleton = 1");
      if (!wasEnabled) this.audit(at, null, by, "policy.enabled");
      this.audit(at, null, by, "policy.updated");
      for (const value of previous.filter((value2) => !normalized.includes(value2))) {
        this.audit(at, null, by, `policy.tailnet_removed:${value}`);
      }
      for (const value of normalized.filter((value2) => !previous.includes(value2))) {
        this.audit(at, null, by, `policy.tailnet_allowed:${value}`);
      }
      const removed = this.db.prepare(`
        SELECT * FROM devices WHERE status IN ('allowed', 'pending')
        AND tailnet NOT IN (SELECT tailnet FROM allowed_tailnets) ORDER BY rowid
      `).all();
      for (const row of removed) {
        this.transition(row, row.status === "allowed" ? "revoked" : "denied", by, at);
      }
    });
  }
  async request(peer, input) {
    const normalized = normalizePeer(peer);
    const installationId = text(input?.installationId, "installation ID");
    const label = text(input?.label, "device label");
    return this.transaction(() => {
      const at = this.timestamp();
      if (!this.isTailnetAllowed(normalized.tailnet)) {
        throw new DeviceAccessError("forbidden", "This tailnet is not allowed to request access.");
      }
      this.expirePending(at);
      const requests = this.db.prepare(`
        SELECT count(*) AS count FROM devices WHERE tailnet = ? AND nodeId = ? AND createdAt > ?
      `).get(normalized.tailnet, normalized.nodeId, at - REQUEST_WINDOW_MS);
      if (requests.count >= 5) {
        throw new DeviceAccessError("rate_limited", "This device has made too many pairing requests.");
      }
      const pending = this.db.prepare("SELECT count(*) AS count FROM devices WHERE status = 'pending'").get();
      if (pending.count >= 64) {
        throw new DeviceAccessError("rate_limited", "Too many devices are awaiting approval.");
      }
      const id = randomUUID();
      const credential = `${DEVICE_CREDENTIAL_PREFIX}${id}.${randomBytes(32).toString("base64url")}`;
      this.db.prepare(`
        INSERT INTO devices (
          id, installationId, label, tailnet, nodeId, userId, loginName, deviceName,
          credentialHash, status, createdAt, pairingExpiresAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
      `).run(
        id,
        installationId,
        label,
        normalized.tailnet,
        normalized.nodeId,
        normalized.userId,
        normalized.loginName,
        normalized.deviceName,
        hashCredential(credential).toString("hex"),
        at,
        at + PAIRING_TTL_MS
      );
      this.audit(at, id, `peer:${normalized.tailnet}/${normalized.nodeId}/${normalized.userId}`, "request.created");
      return { device: deviceRecord(this.find(id)), credential };
    });
  }
  authenticate(credential, peer, allowedOnly) {
    if (typeof credential !== "string") return null;
    const match = CREDENTIAL_RE.exec(credential);
    if (!match) return null;
    let normalized;
    try {
      normalized = normalizePeer(peer);
    } catch (error) {
      if (error instanceof DeviceAccessError) return null;
      throw error;
    }
    return this.transaction(() => {
      const row = this.find(match[1]);
      const expected = row ? Buffer.from(row.credentialHash, "hex") : Buffer.alloc(32);
      if (!timingSafeEqual(hashCredential(credential), expected) || !row || row.tailnet !== normalized.tailnet || row.nodeId !== normalized.nodeId || row.userId !== normalized.userId) {
        return null;
      }
      const at = this.timestamp();
      if (row.status === "pending" && row.pairingExpiresAt <= at) {
        this.transition(row, "expired", "system:expiry", at);
      }
      const device = deviceRecord(this.find(match[1]));
      if (!allowedOnly) return device;
      if (device.status !== "allowed" || !this.isTailnetAllowed(device.peer.tailnet)) return null;
      if (device.lastSeenAt === null || at - device.lastSeenAt >= LAST_SEEN_INTERVAL_MS) {
        this.db.prepare("UPDATE devices SET lastSeenAt = ? WHERE id = ?").run(at, device.id);
        device.lastSeenAt = at;
      }
      return device;
    });
  }
  async inspect(credential, peer) {
    return this.authenticate(credential, peer, false);
  }
  async verify(credential, peer) {
    return this.authenticate(credential, peer, true);
  }
  async decide(id, decision, actor) {
    const deviceId = text(id, "device ID");
    const by = text(actor, "actor");
    if (!["allowed", "denied", "revoked"].includes(decision)) {
      throw new DeviceAccessError("invalid_request", "Unknown device decision.");
    }
    const result = this.transaction(() => {
      const at = this.timestamp();
      this.expirePending(at);
      const row = this.find(deviceId);
      if (!row) return new DeviceAccessError("not_found", "Device request not found.");
      if (decision === "revoked" && row.status !== "allowed" || decision !== "revoked" && row.status !== "pending") {
        return new DeviceAccessError("conflict", "This device cannot make that transition.");
      }
      if (decision === "allowed" && !this.isTailnetAllowed(row.tailnet)) {
        return new DeviceAccessError("forbidden", "This tailnet is no longer allowed.");
      }
      this.transition(row, decision, by, at);
      return deviceRecord(this.find(deviceId));
    });
    if (result instanceof DeviceAccessError) throw result;
    return result;
  }
  async recordAccess(deviceId, input) {
    const id = text(deviceId, "device ID");
    const requestId = text(input?.requestId, "request ID", 128);
    const method = text(input?.method, "HTTP method", 16);
    if (!/^[A-Z]+$/.test(method) || !Number.isInteger(input?.status) || input.status !== 0 && (input.status < 100 || input.status > 599)) {
      throw new DeviceAccessError("invalid_request", "Invalid HTTP access metadata.");
    }
    if (typeof input.path !== "string" || input.path.length > 16384 || !input.path.startsWith("/") || input.path.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(input.path)) {
      throw new DeviceAccessError("invalid_request", "Access paths must be origin-relative request paths.");
    }
    const path4 = text(input.path.split(/[?#]/, 1)[0], "access path", 2048);
    let decodedPath;
    try {
      decodedPath = decodeURIComponent(path4);
    } catch {
      throw new DeviceAccessError("invalid_request", "Invalid access path encoding.");
    }
    if (/[\u0000-\u001f\u007f]/.test(decodedPath) || decodedPath.includes(DEVICE_CREDENTIAL_PREFIX)) {
      throw new DeviceAccessError("invalid_request", "Invalid access path.");
    }
    this.transaction(() => {
      const device = this.find(id);
      if (!device) throw new DeviceAccessError("not_found", "Device request not found.");
      if (input.status === 0 && (device.status !== "allowed" || !this.isTailnetAllowed(device.tailnet))) {
        throw new DeviceAccessError("forbidden", "This device is no longer allowed to access the app.");
      }
      this.audit(this.timestamp(), id, `device:${id}`, "access", { requestId, method, path: path4, status: input.status });
    });
  }
  close() {
    this.db.close();
  }
};
async function createDeviceAccessStore({ root = join2(caveHome(), "device-access"), now = Date.now } = {}) {
  const file = await initializeLocation(root);
  const { DatabaseSync: DatabaseSync2 } = await import("node:sqlite");
  const db = new DatabaseSync2(file);
  try {
    db.exec("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; PRAGMA trusted_schema = OFF;");
    const journal = db.prepare("PRAGMA journal_mode = WAL").get();
    if (journal?.journal_mode !== "wal") throw new Error("Device access database requires WAL journaling.");
    db.exec("PRAGMA synchronous = FULL; BEGIN IMMEDIATE");
    try {
      const version = db.prepare("PRAGMA user_version").get()?.user_version;
      if (version === 0) db.exec(SCHEMA);
      else if (version === 1) db.exec(POLICY_SCHEMA);
      else if (version !== 2) throw new Error("Unsupported device access database schema.");
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    for (const suffix of ["", "-wal", "-shm", "-journal"]) await secureFile(file + suffix, suffix === "");
    return new SqliteDeviceAccessStore(db, now);
  } catch (error) {
    db.close();
    throw error;
  }
}

// src/lib/server/device-access/gateway.ts
import { randomUUID as randomUUID2, timingSafeEqual as timingSafeEqual2 } from "node:crypto";
import { userInfo } from "node:os";

// src/lib/server/device-access/peers.ts
import { execFile as execFile3 } from "node:child_process";
import { isIP } from "node:net";
import { promisify as promisify3 } from "node:util";

// src/lib/mobile-handoff.ts
import { execFileSync, spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path3 from "node:path";

// scripts/ports.mjs
var CAVE_PORTS = Object.freeze({
  dev: 3e3,
  production: 3020,
  e2e: 3100
});

// src/lib/server/client-v1/authority-contract.ts
var CLIENT_V1_HPKE_MECHANISM = "hpke-bound-v1";
var CLIENT_V1_HPKE_AUTHORITY_MODES = Object.freeze([
  "off",
  "advertise",
  "enforce"
]);
var CLIENT_V1_HPKE_PROTECTED_OPERATIONS = Object.freeze([
  "pairing.poll",
  "pairing.exchange",
  "familiars.list",
  "familiars.contract.read",
  "familiars.analytics.read",
  "projects.list",
  "conversations.list",
  "conversations.read",
  "messages.list"
]);
var CLIENT_V1_HPKE_SUITE = Object.freeze({
  kem: "DHKEM(X25519, HKDF-SHA256)",
  kemId: 32,
  kdf: "HKDF-SHA256",
  kdfId: 1,
  aead: "AES-256-GCM",
  aeadId: 2
});
var CLIENT_V1_HPKE_HEADERS = Object.freeze({
  mechanism: "x-coven-client-v1-authority",
  keyId: "x-coven-client-v1-authority-key-id",
  instanceId: "x-coven-client-v1-authority-instance",
  runtimeNonce: "x-coven-client-v1-authority-runtime-nonce",
  requestNonce: "x-coven-client-v1-authority-request-nonce",
  issuedAt: "x-coven-client-v1-authority-issued-at",
  enc: "x-coven-client-v1-authority-enc",
  ciphertext: "x-coven-client-v1-authority-ciphertext"
});
var CLIENT_V1_HPKE_RESPONSE_MEDIA_TYPE = "application/vnd.opencoven.client-v1.hpke-bound-v1+json";
var CLIENT_V1_HPKE_LIMITS = Object.freeze({
  rawKeyBytes: 32,
  encodedKeyCharacters: 43,
  requestPlaintextBytes: 1024,
  requestCiphertextBytes: 2048,
  requestBodyBytes: 65536,
  responsePlaintextBytes: 8 * 1024 * 1024,
  responseCiphertextBytes: 8388624,
  responseEnvelopeBytes: 11185056,
  canonicalRouteBytes: 2048,
  instanceIdBytes: 256
});
var CLIENT_V1_HPKE_FRESHNESS = Object.freeze({
  maximumAgeMs: 6e4,
  maximumFutureSkewMs: 1e4,
  replayTtlMs: 12e4,
  replayCapacity: 4096
});
var CLIENT_V1_AUTHORITY_CONTRACT = Object.freeze({
  defaultMode: "off",
  modes: CLIENT_V1_HPKE_AUTHORITY_MODES,
  mechanism: Object.freeze({
    id: CLIENT_V1_HPKE_MECHANISM,
    discoveryVersion: 2,
    suite: CLIENT_V1_HPKE_SUITE,
    requestHeaders: CLIENT_V1_HPKE_HEADERS,
    responseMediaType: CLIENT_V1_HPKE_RESPONSE_MEDIA_TYPE,
    requestHpkeMode: "base",
    responseHpkeMode: "auth",
    requestEncoding: "headers-plus-rfc8785-json",
    aadEncoding: "u32be-length-prefixed-v1",
    canonicalRoute: "rfc3986-sorted-query-v1",
    keyIdDerivation: "sha256-domain-separated-public-key-v1",
    requestInfo: "OpenCoven/client-v1/hpke-bound-v1/request",
    responseInfo: "OpenCoven/client-v1/hpke-bound-v1/response",
    limits: CLIENT_V1_HPKE_LIMITS,
    freshness: CLIENT_V1_HPKE_FRESHNESS,
    protectedOperations: CLIENT_V1_HPKE_PROTECTED_OPERATIONS,
    vectorFixture: Object.freeze({
      fileName: "hpke-bound-v1-vectors.json",
      sha256FileName: "hpke-bound-v1-vectors.sha256"
    })
  })
});

// src/lib/server/client-v1/operations.ts
var freezeDefinition = (definition) => Object.freeze({ ...definition, families: Object.freeze([...definition.families]) });
var CLIENT_V1_OPERATION_DEFINITIONS = Object.freeze([
  freezeDefinition({
    id: "health.read",
    method: "GET",
    path: "/api/client/v1/health",
    ingress: "public",
    scope: null,
    credential: "none",
    binding: "none",
    families: ["health"]
  }),
  freezeDefinition({
    id: "pairing.create",
    method: "POST",
    path: "/api/client/v1/pairing/requests",
    ingress: "public",
    scope: null,
    credential: "none",
    binding: "none",
    families: ["pairing"]
  }),
  freezeDefinition({
    id: "pairing.poll",
    method: "GET",
    path: "/api/client/v1/pairing/requests/:id",
    ingress: "public",
    scope: null,
    credential: "pairing-secret",
    binding: "hpke-bound-v1",
    families: ["pairing"]
  }),
  freezeDefinition({
    id: "pairing.exchange",
    method: "POST",
    path: "/api/client/v1/pairing/requests/:id/exchange",
    ingress: "public",
    scope: null,
    credential: "pairing-secret",
    binding: "hpke-bound-v1",
    families: ["pairing"]
  }),
  freezeDefinition({
    id: "pairing.admin.list",
    method: "GET",
    path: "/api/client/v1/admin/pairing-requests",
    ingress: "admin",
    scope: null,
    credential: "admin",
    binding: "none",
    families: ["pairing"]
  }),
  freezeDefinition({
    id: "pairing.admin.decide",
    method: "POST",
    path: "/api/client/v1/admin/pairing-requests/:id/decision",
    ingress: "admin",
    scope: null,
    credential: "admin",
    binding: "none",
    families: ["pairing"]
  }),
  freezeDefinition({
    id: "credentials.admin.list",
    method: "GET",
    path: "/api/client/v1/admin/credentials",
    ingress: "admin",
    scope: null,
    credential: "admin",
    binding: "none",
    families: ["credentials"]
  }),
  freezeDefinition({
    id: "credentials.admin.revoke",
    method: "DELETE",
    path: "/api/client/v1/admin/credentials/:id",
    ingress: "admin",
    scope: null,
    credential: "admin",
    binding: "none",
    families: ["credentials"]
  }),
  freezeDefinition({
    id: "status.admin.read",
    method: "GET",
    path: "/api/client/v1/admin/status",
    ingress: "admin",
    scope: null,
    credential: "admin",
    binding: "none",
    // The operational-state family: like health.read, this answers what
    // state the surface is in, never user data. It is administrator-only —
    // the discovery record and the ownership waiver are host configuration —
    // so a paired bearer can never read it.
    families: ["health"]
  }),
  freezeDefinition({
    id: "familiars.list",
    method: "GET",
    path: "/api/client/v1/familiars",
    ingress: "authenticated",
    scope: "chat:read",
    credential: "bearer",
    binding: "hpke-bound-v1",
    families: ["familiars", "cursors"]
  }),
  freezeDefinition({
    id: "familiars.contract.read",
    method: "GET",
    path: "/api/client/v1/familiars/:id/contract",
    ingress: "authenticated",
    scope: "chat:read",
    credential: "bearer",
    binding: "hpke-bound-v1",
    // One record, no paging: like conversations.read it refuses `limit` and
    // `cursor`, so it claims no `cursors`. Its own family rather than
    // `familiars`, because a Cave that lists familiars need not serve their
    // wards, and a client gates its Access tab on exactly this claim.
    families: ["familiar-contract"]
  }),
  freezeDefinition({
    id: "familiars.analytics.read",
    method: "GET",
    path: "/api/client/v1/familiars/:id/analytics",
    ingress: "authenticated",
    scope: "chat:read",
    credential: "bearer",
    binding: "hpke-bound-v1",
    // `window` and `recent` are narrowing parameters, not a cursor: the
    // response is one record however it is narrowed.
    families: ["familiar-analytics"]
  }),
  freezeDefinition({
    id: "projects.list",
    method: "GET",
    path: "/api/client/v1/projects",
    ingress: "authenticated",
    scope: "chat:read",
    credential: "bearer",
    binding: "hpke-bound-v1",
    families: ["projects", "cursors"]
  }),
  freezeDefinition({
    id: "conversations.list",
    method: "GET",
    path: "/api/client/v1/conversations",
    ingress: "authenticated",
    scope: "chat:read",
    credential: "bearer",
    binding: "hpke-bound-v1",
    families: ["conversations", "cursors"]
  }),
  freezeDefinition({
    id: "conversations.read",
    method: "GET",
    path: "/api/client/v1/conversations/:id",
    ingress: "authenticated",
    scope: "chat:read",
    credential: "bearer",
    binding: "hpke-bound-v1",
    // No `cursors`: this route serves one transcript header and refuses
    // `limit` and `cursor` outright. Listing it here would make the family
    // summary claim paging on a route that answers invalid_request for it.
    families: ["conversations"]
  }),
  freezeDefinition({
    id: "messages.list",
    method: "GET",
    path: "/api/client/v1/conversations/:id/messages",
    ingress: "authenticated",
    scope: "chat:read",
    credential: "bearer",
    binding: "hpke-bound-v1",
    families: ["conversation-messages", "cursors"]
  })
]);
var CLIENT_V1_CAPABILITY_FAMILY_ORDER = Object.freeze([
  "health",
  "pairing",
  "credentials",
  "familiars",
  "familiar-contract",
  "familiar-analytics",
  "projects",
  "conversations",
  "conversation-messages",
  "cursors"
]);

// src/lib/server/client-v1/contract.ts
var freezeReadonlyArray = (value) => Object.freeze([...value]);
var freezeReadonlyObject = (value) => Object.freeze({ ...value });
var CLIENT_V1_SCOPES = freezeReadonlyArray([
  "chat:read",
  "chat:write",
  "conversations:write",
  "attachments:write",
  "tasks:write",
  "github:write"
]);
var CLIENT_V1_CAPABILITIES = freezeReadonlyArray([
  "health",
  "pairing",
  "credentials",
  "familiars",
  "familiar-contract",
  "familiar-analytics",
  "projects",
  "conversations",
  "conversation-messages",
  "cursors"
]);
var CLIENT_V1_OPERATIONS = freezeReadonlyArray([
  "health.read",
  "pairing.create",
  "pairing.poll",
  "pairing.exchange",
  "pairing.admin.list",
  "pairing.admin.decide",
  "credentials.admin.list",
  "credentials.admin.revoke",
  "status.admin.read",
  "familiars.list",
  "familiars.contract.read",
  "familiars.analytics.read",
  "projects.list",
  "conversations.list",
  "conversations.read",
  "messages.list"
]);
var CLIENT_V1_ERROR_CODES = freezeReadonlyArray([
  "invalid_request",
  "unauthorized",
  "scope_denied",
  "ownership_refused",
  "not_found",
  "conflict",
  "rate_limited",
  "pairing_pending",
  "pairing_denied",
  "pairing_expired",
  "incompatible_version",
  "service_unavailable",
  "reconcile_required",
  "internal_error"
]);
var CLIENT_V1_IDENTITY_KINDS = freezeReadonlyArray([
  "client",
  "credential",
  "familiar",
  "project",
  "conversation",
  "message",
  "event"
]);
var CLIENT_V1_LIMITS = freezeReadonlyObject({
  idempotencyKeyCharacters: 36,
  requestIdCharacters: 64,
  revisionTokenCharacters: 128,
  cursorCharacters: 512,
  errorMessageCharacters: 256,
  errorDetailEntries: 16,
  errorDetailValueCharacters: 256,
  defaultPageSize: 50,
  maxPageSize: 100,
  instanceIdCharacters: 64,
  releaseVersionCharacters: 64,
  /**
   * The ceiling a consumer parser applies to one advertised capability or
   * operation id. Consumers must tolerate ids they do not know (see
   * parseClientV1AdvertisedCapabilities), so "unknown" cannot mean "unbounded"
   * — without a limit, tolerance is an invitation to allocate.
   */
  declarationIdCharacters: 64
});
var CLIENT_V1_PUBLIC_ROUTES = Object.freeze([
  Object.freeze({ method: "GET", path: "/api/client/v1/health" }),
  Object.freeze({ method: "POST", path: "/api/client/v1/pairing/requests" }),
  Object.freeze({ method: "GET", path: "/api/client/v1/pairing/requests/:id" }),
  Object.freeze({
    method: "POST",
    path: "/api/client/v1/pairing/requests/:id/exchange"
  })
]);
var CLIENT_V1_DISCOVERY_CONTRACT = freezeReadonlyObject({
  fileName: "client-v1-discovery.json",
  mode: "0600",
  version: 1,
  hpkeBoundVersion: 2
});
var CLIENT_V1_SCOPE_SET = new Set(CLIENT_V1_SCOPES);
var CLIENT_V1_CAPABILITY_SET = new Set(CLIENT_V1_CAPABILITIES);
var CLIENT_V1_OPERATION_SET = new Set(CLIENT_V1_OPERATIONS);
var CLIENT_V1_ERROR_CODE_SET = new Set(CLIENT_V1_ERROR_CODES);
var CLIENT_V1_IDENTITY_KIND_SET = new Set(CLIENT_V1_IDENTITY_KINDS);

// src/proxy-helpers.ts
var CLIENT_V1_PATH_PARAMETER = /^:[A-Za-z0-9_]+$/;
function clientV1PathPattern(path4) {
  const segments = path4.split("/").map(
    (segment) => CLIENT_V1_PATH_PARAMETER.test(segment) ? "[^/]+" : segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  );
  return new RegExp(`^${segments.join("/")}$`);
}
var CLIENT_V1_PUBLIC_PATHS = CLIENT_V1_PUBLIC_ROUTES.map(
  (route) => clientV1PathPattern(route.path)
);
var CLIENT_V1_AUTHENTICATED_PATHS = [
  "/api/client/v1/familiars",
  "/api/client/v1/familiars/:id/contract",
  "/api/client/v1/familiars/:id/analytics",
  "/api/client/v1/projects",
  "/api/client/v1/conversations",
  "/api/client/v1/conversations/:id",
  "/api/client/v1/conversations/:id/messages"
].map(clientV1PathPattern);

// src/lib/coven-bin.ts
import os from "node:os";

// src/lib/child-spawn-env.ts
var FORBIDDEN_SPAWN_ENV_KEYS = [
  "GITHUB_PAT",
  "GITHUB_TOKEN",
  "COVEN_GITHUB_TOKEN",
  "GH_TOKEN",
  "GITHUB_PERSONAL_ACCESS_TOKEN",
  "NODE_OPTIONS",
  "NPM_CONFIG_NODE_OPTIONS",
  "COVEN_BIN",
  "COVEN_VAULT_FILE"
];
var SIDECAR_INTERNAL_ENV_PREFIXES = ["COVEN_CAVE_", "__NEXT_PRIVATE_"];
function comparableEnvKey(key, platform) {
  return platform === "win32" ? key.toUpperCase() : key;
}
function isForbiddenSpawnEnvKey(key, platform = process.platform) {
  const comparableKey = comparableEnvKey(key, platform);
  return isSidecarInternalEnvKey(key, platform) || FORBIDDEN_SPAWN_ENV_KEYS.some((forbidden) => comparableKey === forbidden);
}
function isSidecarInternalEnvKey(key, platform = process.platform) {
  const comparableKey = comparableEnvKey(key, platform);
  return SIDECAR_INTERNAL_ENV_PREFIXES.some((prefix) => comparableKey.startsWith(prefix));
}
function scrubSidecarInternalEnv(env, platform = process.platform) {
  for (const key of Object.keys(env)) {
    if (isForbiddenSpawnEnvKey(key, platform)) delete env[key];
  }
  return env;
}

// src/lib/server/managed-node-toolchain.ts
import { execFile as execFile2 } from "node:child_process";
import { promisify as promisify2 } from "node:util";

// src/lib/onboarding-prerequisites.ts
var MANAGED_NODE_VERSION = "24.18.0";
var NODE_BASE = `https://nodejs.org/dist/v${MANAGED_NODE_VERSION}`;
var NODE_MAX_BYTES = 128e6;
var managedNodeArtifacts = {
  "win32-x64": {
    url: `${NODE_BASE}/node-v${MANAGED_NODE_VERSION}-win-x64.zip`,
    sha256: "0ae68406b42d7725661da979b1403ec9926da205c6770827f33aac9d8f26e821",
    maxBytes: NODE_MAX_BYTES,
    format: "zip"
  },
  "win32-arm64": {
    url: `${NODE_BASE}/node-v${MANAGED_NODE_VERSION}-win-arm64.zip`,
    sha256: "f274669adb93b1fd0fbf8f21fd078609e9dcc84333d4f2718d2dde3f9a161a01",
    maxBytes: NODE_MAX_BYTES,
    format: "zip"
  },
  "darwin-x64": {
    url: `${NODE_BASE}/node-v${MANAGED_NODE_VERSION}-darwin-x64.tar.gz`,
    sha256: "dfd0dbd3e721503434df7b7205e719f61b3a3a31b2bcf9729b8b91fea240f080",
    maxBytes: NODE_MAX_BYTES,
    format: "tar.gz"
  },
  "darwin-arm64": {
    url: `${NODE_BASE}/node-v${MANAGED_NODE_VERSION}-darwin-arm64.tar.gz`,
    sha256: "e1a97e14c99c803e96c7339403282ea05a499c32f8d83defe9ef5ec66f979ed1",
    maxBytes: NODE_MAX_BYTES,
    format: "tar.gz"
  },
  "linux-x64": {
    url: `${NODE_BASE}/node-v${MANAGED_NODE_VERSION}-linux-x64.tar.gz`,
    sha256: "783130984963db7ba9cbd01089eaf2c2efb055c7c1693c943174b967b3050cb8",
    maxBytes: NODE_MAX_BYTES,
    format: "tar.gz"
  },
  "linux-arm64": {
    url: `${NODE_BASE}/node-v${MANAGED_NODE_VERSION}-linux-arm64.tar.gz`,
    sha256: "6b4484c2190274175df9aa8f28e2d758a819cb1c1fe6ab481e2f95b463ab8508",
    maxBytes: NODE_MAX_BYTES,
    format: "tar.gz"
  }
};
var npmPackage = (packageName, version, integrity, binary) => ({ packageName, version, integrity, binary });
var PREREQUISITES = [
  {
    id: "windows-webview2",
    label: "Microsoft Edge WebView2 Runtime",
    tier: "native-launch",
    capabilities: ["desktop"],
    platforms: ["win32"],
    probe: "native",
    install: { kind: "native", manualRecovery: "Re-run the signed CovenCave MSI while connected to the internet." },
    requiresPrivilege: false,
    restart: "app",
    manualRecovery: "Re-run the signed CovenCave MSI while connected to the internet."
  },
  {
    id: "macos-app-runtime",
    label: "Signed and notarized macOS app runtime",
    tier: "native-launch",
    capabilities: ["desktop"],
    platforms: ["darwin"],
    probe: "native",
    install: { kind: "native", manualRecovery: "Move CovenCave to Applications and follow Gatekeeper recovery guidance." },
    requiresPrivilege: false,
    restart: "app",
    manualRecovery: "Move CovenCave to Applications and follow Gatekeeper recovery guidance."
  },
  {
    id: "linux-desktop-runtime",
    label: "Linux desktop runtime",
    tier: "native-launch",
    capabilities: ["desktop"],
    platforms: ["linux"],
    probe: "native",
    install: { kind: "native", manualRecovery: "Install the documented GTK/WebKit/FUSE runtime package for this distribution, then relaunch CovenCave." },
    requiresPrivilege: true,
    restart: "app",
    manualRecovery: "Install the documented GTK/WebKit/FUSE runtime package for this distribution, then relaunch CovenCave."
  },
  {
    id: "mobile-remote-daemon",
    label: "Remote Coven daemon",
    tier: "native-launch",
    capabilities: ["desktop"],
    platforms: ["ios", "android"],
    probe: "service",
    install: { kind: "manual", manualRecovery: "Pair this device with a reachable daemon through the guided Tailscale flow." },
    requiresPrivilege: false,
    restart: "none",
    manualRecovery: "Pair this device with a reachable daemon through the guided Tailscale flow."
  },
  {
    id: "managed-node",
    label: "Coven-managed Node.js and npm",
    tier: "local-runtime",
    capabilities: ["local-familiar", "runtime"],
    platforms: ["win32", "darwin", "linux"],
    architectures: ["x64", "arm64"],
    minimumVersion: MANAGED_NODE_VERSION,
    probe: "managed-node",
    install: { kind: "managed-node", artifacts: managedNodeArtifacts },
    requiresPrivilege: false,
    restart: "none",
    manualRecovery: "Download the matching Node.js 24 archive from nodejs.org and contact support with the verification result."
  },
  {
    id: "coven-cli",
    label: "Coven CLI",
    tier: "local-runtime",
    capabilities: ["local-familiar"],
    platforms: ["win32", "darwin", "linux"],
    architectures: ["x64", "arm64"],
    dependsOn: ["managed-node"],
    minimumVersion: "0.4.0",
    probe: "npm-package",
    install: { kind: "managed-npm", package: npmPackage("@opencoven/cli", "0.4.0", "sha512-pqC5xE5KbF6zUDUh1IorzbNdtFEokXN3QYrEbeenETh4XwTxLVIOq8gFsEhdUwXLYFOb+X09LSbLUUTyiJen2g==", "coven") },
    requiresPrivilege: false,
    restart: "none",
    manualRecovery: "Run the exact documented package version with the Cave-managed Node/npm lane, then re-check."
  },
  {
    id: "runtime-codex",
    label: "Codex",
    tier: "feature",
    capabilities: ["runtime"],
    platforms: ["win32", "darwin", "linux"],
    architectures: ["x64", "arm64"],
    dependsOn: ["managed-node", "coven-cli"],
    probe: "npm-package",
    install: { kind: "managed-npm", package: npmPackage("@openai/codex", "0.145.0", "sha512-/PSPSFujjjmiyVFvG2yu/grOFhsWdokTH8t2KGWhXSo/M5n/dIDsnbsnO82/7bLtIoDuzQf7ATBUMWqPWQINlQ==", "codex") },
    requiresPrivilege: false,
    restart: "none",
    manualRecovery: "Install Codex manually and run codex login, then re-check."
  },
  {
    id: "runtime-claude",
    label: "Claude Code",
    tier: "feature",
    capabilities: ["runtime"],
    platforms: ["win32", "darwin", "linux"],
    architectures: ["x64", "arm64"],
    dependsOn: ["managed-node", "coven-cli"],
    probe: "npm-package",
    install: { kind: "managed-npm", package: npmPackage("@anthropic-ai/claude-code", "2.1.220", "sha512-ogBrvwkqF9f8okmnXKxmRNHuvtFxFEffe5pWdqOV3iQDxlUOKirFqnyWC7NGXXnDA4WkkbPH8pvSbwyCR2Auyw==", "claude") },
    requiresPrivilege: false,
    restart: "none",
    manualRecovery: "Install Claude Code manually and complete claude doctor, then re-check."
  },
  {
    id: "runtime-copilot",
    label: "GitHub Copilot CLI",
    tier: "feature",
    capabilities: ["runtime"],
    platforms: ["win32", "darwin", "linux"],
    architectures: ["x64", "arm64"],
    dependsOn: ["managed-node", "coven-cli"],
    probe: "npm-package",
    install: { kind: "managed-npm", package: npmPackage("@github/copilot", "1.0.75", "sha512-rn7ZQmhydCZ9XRdG6V78QEhXIdYlChlUvOVAtyJ6KHJGt2O9/71si7PCt84amfmg0N7IXBT2UGRYF4GQDQBt+g==", "copilot") },
    requiresPrivilege: false,
    restart: "none",
    manualRecovery: "Install Copilot manually and sign in, then re-check."
  },
  {
    id: "runtime-openclaw",
    label: "OpenClaw",
    tier: "feature",
    capabilities: ["runtime"],
    platforms: ["win32", "darwin", "linux"],
    architectures: ["x64", "arm64"],
    dependsOn: ["managed-node", "coven-cli"],
    probe: "npm-package",
    install: { kind: "managed-npm", package: npmPackage("openclaw", "2026.7.1-2", "sha512-ycF3yPcbjN6bUPeaUx6Mh6vze1hQWoD3CT/wWcmD7a8xaHHHRUaAlaq+lFxMHf1ssEgODVAwjlzYqp2twkYZ7g==", "openclaw") },
    requiresPrivilege: false,
    restart: "none",
    manualRecovery: "Install OpenClaw manually and connect or create an agent, then re-check."
  },
  {
    id: "git",
    label: "Git",
    tier: "feature",
    capabilities: ["queue"],
    platforms: ["win32", "darwin", "linux"],
    probe: "command",
    install: { kind: "manual", manualRecovery: "Install Git through the documented platform flow." },
    requiresPrivilege: false,
    restart: "none",
    manualRecovery: "Install Git through the documented platform flow."
  },
  {
    id: "beads",
    label: "Beads CLI",
    tier: "feature",
    capabilities: ["queue"],
    platforms: ["win32", "darwin", "linux"],
    probe: "command",
    install: { kind: "manual", manualRecovery: "Install Beads for the selected Queue project." },
    requiresPrivilege: false,
    restart: "none",
    manualRecovery: "Install Beads for the selected Queue project."
  },
  {
    id: "ripgrep",
    label: "ripgrep",
    tier: "feature",
    capabilities: ["project-search"],
    platforms: ["win32", "darwin", "linux"],
    probe: "command",
    install: { kind: "manual", manualRecovery: "Install ripgrep with the documented platform package." },
    requiresPrivilege: false,
    restart: "none",
    manualRecovery: "Install ripgrep with the documented platform package."
  },
  {
    id: "github-cli",
    label: "GitHub CLI",
    tier: "feature",
    capabilities: ["github"],
    platforms: ["win32", "darwin", "linux"],
    probe: "command",
    install: { kind: "manual", manualRecovery: "Install GitHub CLI and sign in when GitHub operations are enabled." },
    requiresPrivilege: false,
    restart: "none",
    manualRecovery: "Install GitHub CLI and sign in when GitHub operations are enabled."
  },
  {
    id: "openssh",
    label: "OpenSSH client",
    tier: "feature",
    capabilities: ["remote-familiar"],
    platforms: ["win32", "darwin", "linux"],
    probe: "command",
    install: { kind: "manual", manualRecovery: "Install or enable the OpenSSH client, then configure key-based access." },
    requiresPrivilege: false,
    restart: "none",
    manualRecovery: "Install or enable the OpenSSH client, then configure key-based access."
  },
  {
    id: "tailscale",
    label: "Tailscale",
    tier: "feature",
    capabilities: ["phone-handoff"],
    platforms: ["win32", "darwin", "linux", "ios", "android"],
    probe: "service",
    install: { kind: "manual", manualRecovery: "Install Tailscale and sign in to the required tailnet." },
    requiresPrivilege: false,
    restart: "none",
    manualRecovery: "Install Tailscale and sign in to the required tailnet."
  },
  {
    id: "developer-mobile-tools",
    label: "Mobile developer tools",
    tier: "feature",
    capabilities: ["developer-mobile"],
    platforms: ["win32", "darwin", "linux"],
    probe: "manual",
    install: { kind: "manual", manualRecovery: "Install the documented Xcode, Android SDK, JDK, or platform build tools for the selected development workflow." },
    requiresPrivilege: true,
    restart: "none",
    manualRecovery: "Install the documented Xcode, Android SDK, JDK, or platform build tools for the selected development workflow."
  }
];

// src/lib/server/managed-node-toolchain.ts
var execFileAsync2 = promisify2(execFile2);
var INSTALL_TIMEOUT_MS = 5 * 6e4;

// src/lib/vault.ts
import { parse as parseYaml } from "yaml";

// src/lib/local-encrypted-vault.ts
import { DatabaseSync } from "node:sqlite";

// src/lib/coven-bin.ts
var HOME = os.homedir();

// src/lib/mobile-token-refresh.ts
var MOBILE_APP_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1e3;

// src/lib/secret-redaction.ts
var MAX_REDACTION_STRING_BYTES = 256 * 1024;

// src/lib/process-execution.ts
var TRUNCATION_MARKER = "[earlier output truncated]\n";
var TRUNCATION_MARKER_BYTES = Buffer.byteLength(TRUNCATION_MARKER);
var REDACTION_CONTEXT_BYTES = 4 * 1024;

// src/lib/mobile-handoff.ts
var MOBILE_INVITE_TTL_MS = 8 * 60 * 60 * 1e3;
var TAILSCALE_APP_DIR = "/Applications/Tailscale.app/Contents/MacOS";
var DEFAULT_TAILSCALE_PATHS = [
  path3.join(TAILSCALE_APP_DIR, "tailscale"),
  path3.join(TAILSCALE_APP_DIR, "Tailscale"),
  "/opt/homebrew/bin/tailscale",
  "/usr/local/bin/tailscale",
  "/usr/bin/tailscale",
  "/bin/tailscale"
];
var cachedTailscaleBin = null;
var cachedTailscalePath = null;
function executableExists(candidate) {
  try {
    const st = statSync(candidate);
    return st.isFile() || st.isSymbolicLink();
  } catch {
    return false;
  }
}
function loginShellPath() {
  if (process.platform === "win32") return null;
  const env = process.env;
  const shell = env["SHELL"] ?? ["/bin", "zsh"].join("/");
  try {
    const out = execFileSync(shell, ["-ilc", "echo $PATH"], {
      windowsHide: true,
      encoding: "utf-8",
      timeout: 4e3
    });
    const lastLine = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).at(-1);
    return lastLine || null;
  } catch {
    return null;
  }
}
function pathCandidates(pathEnv) {
  if (!pathEnv) return [];
  return pathEnv.split(path3.delimiter).filter(Boolean).map((dir) => path3.join(dir, "tailscale"));
}
function resolveTailscaleBin({
  envBin = process.env.TAILSCALE_BIN,
  pathEnv = process.env.PATH,
  exists = executableExists,
  candidatePaths = DEFAULT_TAILSCALE_PATHS
} = {}) {
  if (envBin && exists(envBin)) return envBin;
  for (const candidate of [...candidatePaths, ...pathCandidates(pathEnv)]) {
    if (exists(candidate)) return candidate;
  }
  return "tailscale";
}
function tailscaleBin() {
  if (!cachedTailscaleBin) cachedTailscaleBin = resolveTailscaleBin();
  return cachedTailscaleBin;
}
function tailscaleSpawnEnv() {
  if (cachedTailscalePath === null) {
    const delimiter = path3.delimiter;
    const fromShell = loginShellPath();
    const parts = [
      TAILSCALE_APP_DIR,
      "/opt/homebrew/bin",
      "/usr/local/bin",
      ...fromShell ? fromShell.split(delimiter) : [],
      ...process.env.PATH ? process.env.PATH.split(delimiter) : []
    ];
    const seen = /* @__PURE__ */ new Set();
    const dedup = [];
    for (const p of parts) {
      if (!p || seen.has(p) || !existsSync(p)) continue;
      seen.add(p);
      dedup.push(p);
    }
    const joined = dedup.join(delimiter);
    cachedTailscalePath = joined || process.env.PATH || "";
  }
  return scrubSidecarInternalEnv({ ...process.env, PATH: cachedTailscalePath });
}

// src/lib/server/device-access/peers.ts
var exec = promisify3(execFile3);
var DEVICE_PEER_REFRESH_MS = 1e4;
function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
}
function text2(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function identifier(value) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
  return text2(value);
}
function tailnetFromDnsName(value) {
  const name = text2(value)?.toLowerCase().replace(/\.$/, "");
  if (!name || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.ts\.net$/.test(name)) {
    return null;
  }
  return name.slice(name.indexOf(".") + 1);
}
function parseDevicePeerInventory(value, now = Date.now()) {
  const status = record(value);
  const self = record(status?.Self);
  const host = text2(self?.DNSName)?.toLowerCase().replace(/\.$/, "");
  const tailnet2 = tailnetFromDnsName(host);
  if (status?.BackendState !== "Running" || !host || !tailnet2) {
    throw new Error("Tailscale must be running with a verified MagicDNS identity.");
  }
  const users = record(status.User);
  const peers = /* @__PURE__ */ new Map();
  for (const raw of Object.values(record(status.Peer) ?? {})) {
    const peer = record(raw);
    const nodeId = text2(peer?.ID);
    const userId = identifier(peer?.UserID);
    const loginName = userId ? text2(record(users?.[userId])?.LoginName) : null;
    const peerTailnet = tailnetFromDnsName(peer?.DNSName);
    const expiry = text2(peer?.KeyExpiry);
    if (!peer || !nodeId || !userId || !loginName || !peerTailnet || peer.Expired === true || Array.isArray(peer.Tags) && peer.Tags.length > 0 || expiry && (!Number.isFinite(Date.parse(expiry)) || Date.parse(expiry) <= now)) continue;
    const identity = {
      nodeId,
      userId,
      loginName,
      tailnet: peerTailnet,
      deviceName: text2(peer.HostName) ?? text2(peer.DNSName) ?? nodeId
    };
    for (const ip of Array.isArray(peer.TailscaleIPs) ? peer.TailscaleIPs : []) {
      if (typeof ip !== "string" || !isIP(ip)) continue;
      if (peers.has(ip)) throw new Error("Tailscale reported an ambiguous device address.");
      peers.set(ip, identity);
    }
  }
  return { host, tailnet: tailnet2, peers };
}
function resolveDevicePeer(req, inventory) {
  const remote = req.socket.remoteAddress;
  if (remote !== "127.0.0.1" && remote !== "::1" && remote !== "::ffff:127.0.0.1") return null;
  if (req.headers["tailscale-funnel-request"] !== void 0 || req.headers["x-forwarded-proto"] !== "https") return null;
  const address = req.headers["x-forwarded-for"];
  if (typeof address !== "string" || !isIP(address)) return null;
  const host = req.headers["x-forwarded-host"];
  if (typeof host !== "string") return null;
  let url;
  try {
    url = new URL(`https://${host}`);
  } catch {
    return null;
  }
  if (url.hostname !== inventory.host || url.username || url.password || url.pathname !== "/") return null;
  const peer = inventory.peers.get(address);
  if (!peer || req.headers["tailscale-user-login"] !== peer.loginName) return null;
  return peer;
}
function createDevicePeerResolver(load = async () => {
  const { stdout } = await exec(tailscaleBin(), ["status", "--json"], {
    encoding: "utf8",
    timeout: 5e3,
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true,
    env: tailscaleSpawnEnv()
  });
  return JSON.parse(stdout);
}, now = Date.now) {
  let cached = null;
  let validUntil = 0;
  let loading = null;
  return async () => {
    if (cached && now() < validUntil) return cached;
    if (loading) return loading;
    cached = null;
    validUntil = 0;
    loading = load().then((raw) => {
      const parsed = parseDevicePeerInventory(raw, now());
      cached = parsed;
      validUntil = now() + DEVICE_PEER_REFRESH_MS;
      return parsed;
    });
    try {
      return await loading;
    } finally {
      loading = null;
    }
  };
}

// src/lib/device-access-markers.ts
var DEVICE_GRANT_HEADER = "x-coven-cave-device-grant";
var DEVICE_PAIRING_PAGE_HEADER = "x-coven-cave-device-pairing-page";
var DEVICE_MANAGED_HEADER = "x-coven-cave-device-managed";

// src/lib/server/device-access/gateway.ts
var API = "/api/device-access";
var BODY_LIMIT = 4096;
var COOKIE_AGE = 3456e4;
function credentialCookie(res, credential) {
  res.setHeader("set-cookie", `${DEVICE_ACCESS_COOKIE}=${credential}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${COOKIE_AGE}`);
}
function single(req, name) {
  const value = req.headers[name];
  return typeof value === "string" ? value : null;
}
function equal(left, right) {
  if (!left || !right) return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual2(a, b);
}
function suppliedCredential(req) {
  const explicit = single(req, DEVICE_ACCESS_HEADER);
  if (explicit) return explicit;
  const authorization = single(req, "authorization");
  if (authorization?.startsWith(`Bearer ${DEVICE_CREDENTIAL_PREFIX}`)) return authorization.slice(7);
  const cookie = single(req, "cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${DEVICE_ACCESS_COOKIE}=`));
  return cookie ? cookie.slice(DEVICE_ACCESS_COOKIE.length + 1) : null;
}
function json(res, status, body2) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body2));
}
function requireOrigin(req, direct) {
  const expected = `${direct ? "http" : "https"}://${single(req, direct ? "host" : "x-forwarded-host") ?? ""}`;
  const origin = single(req, "origin");
  const referer = single(req, "referer");
  if (origin && origin !== expected) throw new DeviceAccessError("forbidden", "Request origin does not match this desktop.", 403);
  if (referer) {
    let source;
    try {
      source = new URL(referer);
    } catch {
      throw new DeviceAccessError("forbidden", "Invalid request source.", 403);
    }
    if (source.origin !== expected) throw new DeviceAccessError("forbidden", "Request source does not match this desktop.", 403);
  }
  if (req.method !== "GET" && req.method !== "HEAD" && !origin && !referer) {
    throw new DeviceAccessError("forbidden", "A same-origin request source is required.", 403);
  }
}
async function body(req) {
  if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(single(req, "content-type") ?? "")) {
    throw new DeviceAccessError("invalid_request", "Expected application/json.", 415);
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > BODY_LIMIT) {
      req.resume();
      throw new DeviceAccessError("invalid_request", "Request is too large.", 413);
    }
    chunks.push(bytes);
  }
  let result;
  try {
    result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new DeviceAccessError("invalid_request", "Invalid JSON.", 400);
  }
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new DeviceAccessError("invalid_request", "Expected an object.", 400);
  }
  return result;
}
function stringField(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 200) {
    throw new DeviceAccessError("invalid_request", "A valid device identity is required.", 400);
  }
  return value.trim();
}
function createDeviceAccessGateway(options) {
  const { store } = options;
  const inventory = options.inventory ?? createDevicePeerResolver();
  const active = /* @__PURE__ */ new Map();
  const legacy = /* @__PURE__ */ new Set();
  const completionWrites = /* @__PURE__ */ new Set();
  let revalidating = false;
  let managedObserved = false;
  const actor = `desktop:${userInfo().username}`;
  function closeLegacy() {
    for (const response of legacy) response.destroy();
    legacy.clear();
    options.onPolicyChanged?.();
  }
  async function currentPolicy() {
    const policy = await store.policy();
    if (policy.enabled && !managedObserved) {
      managedObserved = true;
      closeLegacy();
    }
    return policy;
  }
  async function eligible(req) {
    const peer = resolveDevicePeer(req, await inventory());
    if (!peer) throw new DeviceAccessError("forbidden", "A verified Tailscale device is required.", 403);
    return peer;
  }
  function closeDevice(id) {
    for (const [res, session] of active) {
      if (session.device.id === id) {
        res.destroy();
      }
    }
  }
  async function revalidateActive() {
    if (revalidating) return;
    revalidating = true;
    try {
      await currentPolicy();
      for (const [res, session] of active) {
        try {
          if (await store.verify(session.credential, await eligible(session.req))) continue;
        } catch (error) {
          console.warn("[device-access] Active connection revalidation failed:", error instanceof Error ? error.message : "unavailable");
        }
        res.destroy();
      }
    } catch (error) {
      console.warn("[device-access] Policy revalidation failed:", error instanceof Error ? error.message : "unavailable");
      closeLegacy();
      for (const res of active.keys()) res.destroy();
    } finally {
      revalidating = false;
    }
  }
  const timer = setInterval(() => {
    void revalidateActive();
  }, 1e3);
  timer.unref();
  async function handle2(req, res) {
    delete req.headers[DEVICE_GRANT_HEADER];
    delete req.headers[DEVICE_PAIRING_PAGE_HEADER];
    delete req.headers[DEVICE_MANAGED_HEADER];
    const direct = options.isDirectLoopback(req);
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    const isApi = pathname === API || pathname.startsWith(`${API}/`);
    try {
      const policy = await currentPolicy();
      if (policy.enabled) req.headers[DEVICE_MANAGED_HEADER] = options.stampSecret;
      if (isApi) {
        requireOrigin(req, direct);
        if (pathname === `${API}/admin` || pathname.startsWith(`${API}/admin/`)) {
          if (!direct || (options.sidecarToken ? !equal(single(req, "x-coven-cave-token"), options.sidecarToken) : options.packaged)) {
            throw new DeviceAccessError("forbidden", "Device access is managed only by this desktop.", 403);
          }
          if (pathname === `${API}/admin` && req.method === "GET") {
            const snapshot = await store.snapshot();
            let network = null;
            let networkError = null;
            try {
              const current = await inventory();
              network = { host: current.host, tailnet: current.tailnet };
            } catch (error) {
              networkError = error instanceof Error ? error.message : "Tailscale is unavailable.";
            }
            json(res, 200, { ok: true, ...snapshot, network, networkError });
            return true;
          }
          if (pathname === `${API}/admin/tailnets` && req.method === "PUT") {
            const input = await body(req);
            if (!Array.isArray(input.tailnets) || !input.tailnets.every((entry) => typeof entry === "string")) {
              throw new DeviceAccessError("invalid_request", "Expected a list of tailnets.", 400);
            }
            await store.setAllowedTailnets(input.tailnets, actor);
            await currentPolicy();
            await revalidateActive();
            json(res, 200, { ok: true });
            return true;
          }
          if (pathname === `${API}/admin/decision` && req.method === "POST") {
            const input = await body(req);
            if (input.decision !== "allowed" && input.decision !== "denied" && input.decision !== "revoked") {
              throw new DeviceAccessError("invalid_request", "Invalid device decision.", 400);
            }
            const device2 = await store.decide(stringField(input.id), input.decision, actor);
            if (device2.status !== "allowed") closeDevice(device2.id);
            json(res, 200, { ok: true, device: device2 });
            return true;
          }
          throw new DeviceAccessError("not_found", "Unknown device management operation.", 404);
        }
        const peer2 = await eligible(req);
        if (pathname === `${API}/requests` && req.method === "POST") {
          if (!policy.enabled) {
            json(res, 409, {
              ok: false,
              error: "disabled",
              message: "Desktop device approval is not enabled. Use the current desktop pairing invite."
            });
            return true;
          }
          const input = await body(req);
          const issued = await store.request(peer2, {
            installationId: stringField(input.installationId),
            label: stringField(input.label)
          });
          credentialCookie(res, issued.credential);
          json(res, 201, { ok: true, ...issued });
          return true;
        }
        if (pathname === `${API}/status` && req.method === "GET") {
          const credential2 = suppliedCredential(req);
          const device2 = credential2 ? await store.inspect(credential2, peer2) : null;
          if (!device2) throw new DeviceAccessError("forbidden", "Device pairing is required.", 403);
          json(res, 200, { ok: true, device: device2 });
          return true;
        }
        throw new DeviceAccessError("not_found", "Unknown device pairing operation.", 404);
      }
      if (direct) return false;
      if (!policy.enabled) {
        legacy.add(res);
        res.once("close", () => {
          legacy.delete(res);
        });
        return false;
      }
      res.setHeader("x-coven-device-pairing", "1");
      const peer = await eligible(req);
      if (!policy.allowedTailnets.includes(peer.tailnet)) {
        throw new DeviceAccessError("forbidden", "This tailnet is not allowed by the desktop.", 403);
      }
      if (pathname === "/connect" || pathname.startsWith("/_next/static/") || pathname === "/favicon.ico") {
        req.headers[DEVICE_PAIRING_PAGE_HEADER] = options.stampSecret;
        return false;
      }
      const credential = suppliedCredential(req);
      const device = credential ? await store.verify(credential, peer) : null;
      if (!device || !credential) {
        if (req.method === "GET" && !pathname.startsWith("/api/") && single(req, "accept")?.includes("text/html")) {
          res.writeHead(303, { location: "/connect", "cache-control": "no-store" });
          res.end();
          return true;
        }
        throw new DeviceAccessError("forbidden", "Device approval is required. Open /connect.", 403);
      }
      if (pathname.startsWith("/api/client/") || pathname.startsWith("/api/pty") || pathname.startsWith("/api/passkey/register") || pathname === "/api/mobile-handoff") {
        throw new DeviceAccessError("forbidden", "This operation requires local desktop authority.", 403);
      }
      requireOrigin(req, false);
      const requestId = randomUUID2();
      await store.recordAccess(device.id, { requestId, method: req.method ?? "GET", path: pathname, status: 0 });
      if (single(req, "cookie")?.includes(`${DEVICE_ACCESS_COOKIE}=${credential}`)) {
        credentialCookie(res, credential);
      }
      res.setHeader("x-coven-request-id", requestId);
      req.headers[DEVICE_GRANT_HEADER] = options.stampSecret;
      options.onAuthenticated?.(req, device);
      active.set(res, { req, credential, device });
      const finish = () => {
        active.delete(res);
        const write = store.recordAccess(device.id, {
          requestId,
          method: req.method ?? "GET",
          path: pathname,
          status: res.writableFinished ? res.statusCode : 499
        }).catch((error) => {
          console.error("[device-access] Could not persist request completion:", error instanceof Error ? error.message : "unavailable");
        });
        completionWrites.add(write);
        void write.finally(() => {
          completionWrites.delete(write);
        });
      };
      res.once("close", finish);
      return false;
    } catch (error) {
      if (res.headersSent) {
        res.destroy(error instanceof Error ? error : void 0);
      } else if (error instanceof DeviceAccessError) {
        json(res, error.status, { ok: false, error: error.code, message: error.message });
      } else {
        console.error("[device-access] Request refused:", error instanceof Error ? error.message : "unavailable");
        json(res, 503, { ok: false, error: "unavailable", message: "Device access could not be verified." });
      }
      return true;
    }
  }
  return {
    handle: handle2,
    async blocksUpgrade(req) {
      return !options.isDirectLoopback(req) && (await currentPolicy()).enabled;
    },
    async close() {
      clearInterval(timer);
      const closing = [...active.keys()].map((res) => new Promise((resolve3) => {
        res.once("close", resolve3);
        res.destroy();
      }));
      for (const res of legacy) res.destroy();
      await Promise.all(closing);
      await Promise.all(completionWrites);
      active.clear();
      legacy.clear();
    }
  };
}

// server.ts
var require2 = createRequire(import.meta.url);
var pty = require2("node-pty");
var execFileAsync3 = promisify4(execFile4);
if (process.env.COVEN_CAVE_BUNDLE === "1" && !process.env.__NEXT_PRIVATE_STANDALONE_CONFIG) {
  try {
    const requiredServerFiles = JSON.parse(
      readFileSync(new URL(".next/required-server-files.json", import.meta.url), "utf8")
    );
    if (requiredServerFiles.config) {
      process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(requiredServerFiles.config);
    }
  } catch {
  }
}
var CAVE_DEV_PORT = 3e3;
var CAVE_PRODUCTION_PORT = 3020;
function parseCavePort(raw) {
  const trimmed = (raw ?? "").trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535 ? parsed : null;
}
function cavePort() {
  const channelDefault = process.env.COVEN_CAVE_BUNDLE === "1" ? CAVE_PRODUCTION_PORT : CAVE_DEV_PORT;
  return parseCavePort(process.env.COVEN_CAVE_PORT) ?? parseCavePort(process.env.PORT) ?? channelDefault;
}
function persistedMobileAccessSecretFile() {
  const port2 = String(cavePort());
  const stateRoot = process.env.COVEN_CAVE_MOBILE_STATE_ROOT?.trim() || join3(
    process.env.XDG_STATE_HOME?.trim() || join3(homedir3(), ".local", "state"),
    "coven-cave"
  );
  const stateDir = process.env.COVEN_CAVE_MOBILE_STATE_DIR?.trim() || join3(stateRoot, `mobile-tailscale-${port2}`);
  return join3(stateDir, "access-token");
}
if (process.env.COVEN_CAVE_BUNDLE !== "1" && process.env.COVEN_CAVE_E2E !== "1" && !process.env.COVEN_CAVE_ACCESS_TOKEN?.trim()) {
  try {
    const file = persistedMobileAccessSecretFile();
    const stats = lstatSync(file);
    if (stats.isSymbolicLink()) throw new Error("the persisted mobile access secret must not be a symbolic link");
    if (typeof process.getuid === "function") {
      if (stats.uid !== process.getuid()) throw new Error("the persisted mobile access secret must be owned by the current user");
      if ((stats.mode & 18) !== 0) throw new Error("the persisted mobile access secret must not be writable by group or others");
    } else {
      console.warn(
        "[cave] boot re-arm reads the persisted mobile access secret without an ownership check on " + process.platform + "; the pairing route re-verifies it with the async guard (cave-8pd39)."
      );
    }
    const persisted = readFileSync(file, "utf8").trim();
    if (persisted) process.env.COVEN_CAVE_ACCESS_TOKEN = persisted;
  } catch {
  }
}
function accessToken() {
  return process.env.COVEN_CAVE_ACCESS_TOKEN ?? "";
}
var SIDECAR_TOKEN = process.env.COVEN_CAVE_AUTH_TOKEN ?? "";
var CLIENT_V1_DISCOVERY_FILE = "client-v1-discovery.json";
var CLIENT_V1_DISCOVERY_STARTED_AT = (/* @__PURE__ */ new Date()).toISOString();
var CLIENT_V1_AUTHORITY_MODE_ENV = "COVEN_CAVE_CLIENT_V1_AUTHORITY_MODE";
function parseStandaloneClientV1AuthorityMode(raw) {
  const value = raw?.trim() || "off";
  if (value === "off" || value === "advertise" || value === "enforce") {
    return value;
  }
  throw new Error(
    `${CLIENT_V1_AUTHORITY_MODE_ENV} must be off, advertise, or enforce.`
  );
}
function standaloneClientV1HpkeKeyId(publicKey) {
  if (publicKey.byteLength !== 32) {
    throw new Error("Client v1 authority public key length is invalid.");
  }
  return new Uint8Array(
    createHash2("sha256").update("OpenCoven/client-v1/hpke-bound-v1/key-id\0", "utf8").update(publicKey).digest()
  );
}
async function createStandaloneClientV1AuthorityBootstrap(mode) {
  const [
    { Aes256Gcm, CipherSuite, HkdfSha256 },
    { DhkemX25519HkdfSha256 }
  ] = await Promise.all([
    import("@hpke/core"),
    import("@hpke/dhkem-x25519")
  ]);
  const suite = new CipherSuite({
    kem: new DhkemX25519HkdfSha256(),
    kdf: new HkdfSha256(),
    aead: new Aes256Gcm()
  });
  const keyPair = await suite.kem.generateKeyPair();
  const publicKey = new Uint8Array(
    await suite.kem.serializePublicKey(keyPair.publicKey)
  );
  return {
    mode,
    suite,
    keyPair,
    publicKey,
    keyId: standaloneClientV1HpkeKeyId(publicKey),
    runtimeNonce: randomBytes2(32)
  };
}
var CLIENT_V1_AUTHORITY_MODE = parseStandaloneClientV1AuthorityMode(
  process.env.COVEN_CAVE_CLIENT_V1_AUTHORITY_MODE
);
var clientV1AuthorityInitializationError = null;
var CLIENT_V1_AUTHORITY_BOOTSTRAP;
if (CLIENT_V1_AUTHORITY_MODE !== "off") {
  try {
    CLIENT_V1_AUTHORITY_BOOTSTRAP = await createStandaloneClientV1AuthorityBootstrap(
      CLIENT_V1_AUTHORITY_MODE
    );
  } catch {
    clientV1AuthorityInitializationError = new Error(
      "Client v1 HPKE authority initialization failed."
    );
    CLIENT_V1_AUTHORITY_BOOTSTRAP = {
      mode: CLIENT_V1_AUTHORITY_MODE,
      unavailable: true
    };
  }
}
globalThis.__covenCaveClientV1AuthorityBootstrap = CLIENT_V1_AUTHORITY_BOOTSTRAP;
var CLIENT_V1_DISCOVERY_NONCE = CLIENT_V1_AUTHORITY_BOOTSTRAP && !("unavailable" in CLIENT_V1_AUTHORITY_BOOTSTRAP) ? Buffer.from(
  CLIENT_V1_AUTHORITY_BOOTSTRAP.runtimeNonce
).toString("base64url") : randomUUID3();
var clientV1DiscoveryPublished = false;
function standaloneCaveHome() {
  const covenHome2 = process.env.COVEN_HOME || join3(homedir3(), ".coven");
  return resolve2(process.env.COVEN_CAVE_HOME || join3(covenHome2, "cave"));
}
function clientV1DiscoveryFile() {
  return join3(standaloneCaveHome(), CLIENT_V1_DISCOVERY_FILE);
}
var WINDOWS_SYSTEM_SID2 = "S-1-5-18";
var WINDOWS_ADMINISTRATORS_SID2 = "S-1-5-32-544";
var UNVERIFIED_OWNERSHIP_ENV2 = "COVEN_CAVE_UNVERIFIED_PATH_OWNERSHIP";
var UNVERIFIED_OWNERSHIP_REASON_ENV2 = "COVEN_CAVE_UNVERIFIED_PATH_OWNERSHIP_REASON";
var UNVERIFIED_OWNERSHIP_TOKEN2 = "i-accept-unverified-path-ownership";
var UNVERIFIED_OWNERSHIP_MIN_REASON2 = 12;
function resolveUnverifiedOwnershipWaiver2(env) {
  const requested = env[UNVERIFIED_OWNERSHIP_ENV2]?.trim() ?? "";
  if (!requested) {
    return {
      granted: false,
      note: `If the DACL genuinely cannot be read on this host \u2014 PowerShell in Constrained Language Mode, or no powershell.exe under %SystemRoot% \u2014 set ${UNVERIFIED_OWNERSHIP_ENV2}=${UNVERIFIED_OWNERSHIP_TOKEN2} and ${UNVERIFIED_OWNERSHIP_REASON_ENV2} to a sentence naming who accepted that and why. It waives only an unreadable DACL, never one that was read and found shared.`
    };
  }
  if (requested !== UNVERIFIED_OWNERSHIP_TOKEN2) {
    return {
      granted: false,
      note: `${UNVERIFIED_OWNERSHIP_ENV2} is set, but not to the waiver: the only accepted value is the exact string ${UNVERIFIED_OWNERSHIP_TOKEN2}. A boolean-shaped value ("1", "true", "yes") never waives this check.`
    };
  }
  const reason = env[UNVERIFIED_OWNERSHIP_REASON_ENV2]?.trim() ?? "";
  if (reason.length < UNVERIFIED_OWNERSHIP_MIN_REASON2) {
    return {
      granted: false,
      note: `${UNVERIFIED_OWNERSHIP_ENV2} is set, but ${UNVERIFIED_OWNERSHIP_REASON_ENV2} must carry at least ${UNVERIFIED_OWNERSHIP_MIN_REASON2} characters naming who accepted an unverified path and why. The waiver stays closed without that attribution.`
    };
  }
  return { granted: true, reason };
}
function unverifiableOwnershipRefusal2(subject, path4, cause, note) {
  return `${subject} ownership could not be verified on Windows: ${cause.message}. Refusing ${path4}; inspect it with: icacls "${path4}". ${note}`;
}
function unverifiedOwnershipDisclosure2(subject, path4, cause, reason) {
  return `SECURITY WAIVER \u2014 ${subject} is being used UNVERIFIED. Its DACL could not be read on this host (${cause.message}), and ${UNVERIFIED_OWNERSHIP_ENV2} is set, so ${path4} is trusted on the operator's word alone: reason given \u2014 ${reason}. Any principal that can write ${path4} can mint credentials or point a paired client at another server. Unset ${UNVERIFIED_OWNERSHIP_ENV2} to restore the check.`;
}
function sharedOwnershipRefusal2(subject, path4, findings, waiver) {
  return `${subject} is not exclusive to the current user: ${findings.join("; ")}. Refusing ${path4}; inspect it with: icacls "${path4}"` + (waiver.granted ? `. ${UNVERIFIED_OWNERSHIP_ENV2} does not cover a DACL that was read: this one was, and it is shared. Repair it with: icacls "${path4}" /reset` : "");
}
var WINDOWS_ACL_SCRIPT2 = `
$ErrorActionPreference = 'Stop'
$item = Get-Item -LiteralPath $env:COVEN_CAVE_CLIENT_V1_ACL_PATH -Force
$me = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$system = New-Object System.Security.Principal.SecurityIdentifier('${WINDOWS_SYSTEM_SID2}')
$admins = New-Object System.Security.Principal.SecurityIdentifier('${WINDOWS_ADMINISTRATORS_SID2}')
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
  if ($state.owner -ne $me.Value) {
    $acl.SetOwner($me)
  }
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
var standaloneVerifiedWindowsPaths = /* @__PURE__ */ new Set();
var standaloneWaivedWindowsPaths = /* @__PURE__ */ new Set();
var standaloneDiscoveryPublicationFailures = /* @__PURE__ */ new WeakMap();
function discoveryPublicationFailure(category, error) {
  standaloneDiscoveryPublicationFailures.set(error, category);
  return error;
}
function assertStandaloneWindowsExclusive(path4, label) {
  if (standaloneVerifiedWindowsPaths.has(path4)) return;
  if (standaloneWaivedWindowsPaths.has(path4)) return;
  const subject = `Client v1 discovery ${label}`;
  const waiver = resolveUnverifiedOwnershipWaiver2(process.env);
  const systemRoot = process.env.SystemRoot || process.env.windir || "C:\\Windows";
  const probeEnv = {
    COVEN_CAVE_CLIENT_V1_ACL_PATH: path4,
    // Next augments ProcessEnv to require this. It carries no secret.
    NODE_ENV: process.env.NODE_ENV,
    SystemRoot: systemRoot,
    windir: systemRoot,
    PATH: join3(systemRoot, "System32"),
    PATHEXT: process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD",
    TEMP: process.env.TEMP || process.env.TMP || join3(systemRoot, "Temp"),
    TMP: process.env.TMP || process.env.TEMP || join3(systemRoot, "Temp")
  };
  let report;
  try {
    report = JSON.parse(execFileSync2(
      join3(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
      [
        "-NoProfile",
        "-NonInteractive",
        "-NoLogo",
        "-InputFormat",
        "None",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        WINDOWS_ACL_SCRIPT2
      ],
      {
        env: probeEnv,
        encoding: "utf8",
        windowsHide: true,
        timeout: 6e4,
        maxBuffer: 1024 * 1024
      }
    ));
    if (!report || typeof report !== "object" || typeof report.self !== "string" || !report.self || typeof report.owner !== "string" || !report.owner || typeof report.protected !== "boolean" || typeof report.repaired !== "boolean" || !Array.isArray(report.aces) || !Array.isArray(report.removed)) {
      throw new Error("the ACL probe returned a malformed report");
    }
  } catch (cause) {
    if (!waiver.granted) {
      throw discoveryPublicationFailure(`${label}-owner-unverified`, new Error(
        unverifiableOwnershipRefusal2(subject, path4, cause, waiver.note),
        { cause }
      ));
    }
    standaloneWaivedWindowsPaths.add(path4);
    console.warn(
      unverifiedOwnershipDisclosure2(subject, path4, cause, waiver.reason)
    );
    return;
  }
  const trusted = /* @__PURE__ */ new Set([report.self, WINDOWS_SYSTEM_SID2, WINDOWS_ADMINISTRATORS_SID2]);
  const findings = [];
  if (report.owner !== report.self) {
    findings.push(`owned by ${report.owner}, not ${report.self}`);
  }
  if (!report.protected) findings.push("its DACL still inherits from the parent");
  const foreign = report.aces.filter((ace) => ace.type !== "Allow" || !trusted.has(ace.sid)).map((ace) => `${ace.type}:${ace.sid}`);
  if (foreign.length > 0) {
    findings.push(`access granted to ${[...new Set(foreign)].join(", ")}`);
  }
  if (findings.length > 0) {
    throw discoveryPublicationFailure(
      `${label}-owner-shared`,
      new Error(sharedOwnershipRefusal2(subject, path4, findings, waiver))
    );
  }
  if (report.repaired) {
    console.warn(
      `${subject} had no enforced access control on Windows; restricted ${path4} to the current user and revoked ${report.removed.length > 0 ? report.removed.join(", ") : "inherited entries"}.`
    );
  }
  standaloneVerifiedWindowsPaths.add(path4);
}
function requireStandaloneOwner(path4, metadata, label) {
  if (typeof process.getuid === "function") {
    if (metadata.uid !== process.getuid()) {
      throw discoveryPublicationFailure(
        `${label}-owner-shared`,
        new Error(`Client v1 discovery ${label} must be owned by the current user.`)
      );
    }
    return;
  }
  if (process.platform !== "win32") {
    throw discoveryPublicationFailure(`${label}-owner-unverified`, new Error(
      `Client v1 discovery ${label} ownership cannot be verified on ${process.platform}: this platform exposes neither a uid nor a Windows ACL, so ${path4} is refused.`
    ));
  }
  assertStandaloneWindowsExclusive(path4, label);
}
function assertStandaloneDiscoveryTarget(path4) {
  try {
    const metadata = lstatSync(path4);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw discoveryPublicationFailure(
        "target-not-file",
        new Error(`Client v1 discovery target must be a regular file: ${path4}.`)
      );
    }
    requireStandaloneOwner(path4, metadata, "target");
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
}
function publishStandaloneClientV1DiscoveryRecord(endpoint) {
  const root = join3(clientV1DiscoveryFile(), "..");
  mkdirSync(root, { recursive: true, mode: 448 });
  const rootMetadata = lstatSync(root);
  if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) {
    throw discoveryPublicationFailure(
      rootMetadata.isSymbolicLink() ? "root-symlink" : "root-not-directory",
      new Error("Client v1 discovery root must be a real directory.")
    );
  }
  requireStandaloneOwner(root, rootMetadata, "root");
  const physicalRoot = realpathSync(root);
  if (physicalRoot !== root) {
    throw discoveryPublicationFailure(
      "root-symlink",
      new Error("Client v1 discovery root must not resolve through a symlink.")
    );
  }
  chmodSync(root, 448);
  let url;
  try {
    url = new URL(endpoint);
  } catch (cause) {
    throw discoveryPublicationFailure(
      "endpoint-invalid",
      new Error("Client v1 discovery endpoint must be a path-free loopback HTTP URL.", { cause })
    );
  }
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
  if (url.protocol !== "http:" || !loopback || !url.port || url.username || url.password || url.pathname !== "/" || url.search || url.hash || /%(?:2f|5c)/i.test(endpoint)) {
    throw discoveryPublicationFailure(
      "endpoint-invalid",
      new Error("Client v1 discovery endpoint must be a path-free loopback HTTP URL.")
    );
  }
  const path4 = clientV1DiscoveryFile();
  assertStandaloneDiscoveryTarget(path4);
  let record2;
  if (CLIENT_V1_AUTHORITY_MODE === "off") {
    record2 = {
      version: 1,
      endpoint,
      pid: process.pid,
      nonce: CLIENT_V1_DISCOVERY_NONCE,
      startedAt: CLIENT_V1_DISCOVERY_STARTED_AT
    };
  } else {
    if (CLIENT_V1_AUTHORITY_BOOTSTRAP === void 0) {
      throw discoveryPublicationFailure(
        "authority-init",
        new Error("Client v1 HPKE authority initialization failed.")
      );
    }
    if ("unavailable" in CLIENT_V1_AUTHORITY_BOOTSTRAP) {
      throw discoveryPublicationFailure(
        "authority-init",
        clientV1AuthorityInitializationError ?? new Error("Client v1 HPKE authority initialization failed.")
      );
    }
    const bootstrap = CLIENT_V1_AUTHORITY_BOOTSTRAP;
    record2 = {
      version: 2,
      endpoint,
      pid: process.pid,
      nonce: CLIENT_V1_DISCOVERY_NONCE,
      startedAt: CLIENT_V1_DISCOVERY_STARTED_AT,
      authority: {
        mechanism: "hpke-bound-v1",
        mode: bootstrap.mode,
        keyId: Buffer.from(bootstrap.keyId).toString("base64url"),
        publicKey: Buffer.from(bootstrap.publicKey).toString("base64url"),
        suite: { kemId: 32, kdfId: 1, aeadId: 2 }
      }
    };
  }
  const temporaryPath = `${path4}.${process.pid}.${randomUUID3()}.tmp`;
  let fd = null;
  let ownsTemporaryPath = false;
  try {
    fd = openSync(temporaryPath, "wx", 384);
    ownsTemporaryPath = true;
    writeFileSync(fd, `${JSON.stringify(record2, null, 2)}
`, "utf8");
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    assertStandaloneDiscoveryTarget(path4);
    renameSync(temporaryPath, path4);
    ownsTemporaryPath = false;
    chmodSync(path4, 384);
    clientV1DiscoveryPublished = true;
  } catch (error) {
    if (fd !== null) closeSync(fd);
    if (ownsTemporaryPath) rmSync(temporaryPath, { force: true });
    throw error;
  }
}
function removeStandaloneClientV1DiscoveryRecord(nonce) {
  const path4 = clientV1DiscoveryFile();
  let before;
  let parsed;
  try {
    before = lstatSync(path4);
    if (!before.isFile() || before.isSymbolicLink()) return false;
    requireStandaloneOwner(path4, before, "target");
    parsed = JSON.parse(readFileSync(path4, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return false;
    if (error instanceof SyntaxError) return false;
    throw error;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || parsed.nonce !== nonce) {
    return false;
  }
  const current = lstatSync(path4);
  if (!current.isFile() || current.isSymbolicLink() || current.dev !== before.dev || current.ino !== before.ino) {
    return false;
  }
  unlinkSync(path4);
  clientV1DiscoveryPublished = false;
  return true;
}
function cleanupStandaloneClientV1Discovery() {
  if (!clientV1DiscoveryPublished) return;
  try {
    removeStandaloneClientV1DiscoveryRecord(CLIENT_V1_DISCOVERY_NONCE);
  } catch (error) {
    console.error("[cave] failed to remove client-v1 discovery record", error);
  }
}
var LOCAL_PEER_HEADER = "x-coven-cave-local-peer";
var LOCAL_PEER_SECRET = randomUUID3();
process.env.COVEN_CAVE_LOCAL_PEER_SECRET = LOCAL_PEER_SECRET;
var FORWARDING_HEADERS = [
  "forwarded",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "via"
];
var ACCESS_COOKIE = "coven_cave_access";
var LEGACY_ACCESS_COOKIE = "coven_access_token";
var PRESENCE_COOKIE = "coven_passkey_presence";
var ACCESS_QUERY_PARAM = "coven_access_token";
var SIDECAR_QUERY_PARAM = "covenCaveToken";
var sessions = /* @__PURE__ */ new Map();
var PACKAGED_CHILD_SHUTDOWN_BUDGET_MS = 1200;
function terminatePtySessions() {
  for (const session of sessions.values()) {
    try {
      session.pty.kill();
    } catch {
    }
  }
  sessions.clear();
}
async function terminatePackagedUnixSidecarTree() {
  terminatePtySessions();
  try {
    const terminateDirectRuns = globalThis.__covenCaveTerminateCopilotFlowRuns;
    if (terminateDirectRuns) {
      await Promise.race([
        terminateDirectRuns(),
        new Promise((_resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error("direct Copilot shutdown exceeded its native parent lease")),
            PACKAGED_CHILD_SHUTDOWN_BUDGET_MS
          );
          timer.unref?.();
        })
      ]);
    }
  } catch (error) {
    console.error("[cave] direct Copilot process-tree shutdown could not be proved", error);
  } finally {
    cleanupStandaloneClientV1Discovery();
    terminatePtySessions();
    try {
      process.kill(-process.pid, "SIGKILL");
    } catch {
      process.exit(1);
    }
  }
}
if (process.platform !== "win32" && process.env.COVEN_CAVE_PARENT_WATCHDOG === "stdin-eof") {
  let parentShutdownStarted = false;
  const onParentShutdown = () => {
    if (parentShutdownStarted) return;
    parentShutdownStarted = true;
    void terminatePackagedUnixSidecarTree();
  };
  process.stdin.once("end", onParentShutdown);
  process.stdin.once("error", onParentShutdown);
  process.stdin.resume();
}
var SCROLLBACK_LIMIT_BYTES = 256 * 1024;
var PTY_FRAME_COALESCE_MS = 8;
var PTY_FRAME_MAX_BYTES = 16 * 1024;
var PTY_WS_BUFFERED_AMOUNT_LIMIT = 512 * 1024;
var PTY_SLOW_CONSUMER_CLOSE_CODE = 1013;
var PTY_SLOW_CONSUMER_CLOSE_REASON = "slow terminal consumer; reconnect";
var DETACH_GRACE_MS = (() => {
  const env = Number.parseInt(process.env.COVEN_CAVE_PTY_DETACH_GRACE_MS ?? "", 10);
  return Number.isFinite(env) && env > 0 ? env : 3e5;
})();
function appendScrollback(session, data) {
  const nextEnd = session.streamEnd + data.length;
  if (data.length >= SCROLLBACK_LIMIT_BYTES) {
    session.scrollback = [Buffer.from(data.subarray(data.length - SCROLLBACK_LIMIT_BYTES))];
    session.scrollbackBytes = SCROLLBACK_LIMIT_BYTES;
    session.scrollbackStart = nextEnd - SCROLLBACK_LIMIT_BYTES;
    session.streamEnd = nextEnd;
    return;
  }
  session.scrollback.push(data);
  session.scrollbackBytes += data.length;
  session.streamEnd = nextEnd;
  while (session.scrollbackBytes > SCROLLBACK_LIMIT_BYTES && session.scrollback.length > 1) {
    const dropped = session.scrollback.shift();
    if (dropped) {
      session.scrollbackBytes -= dropped.length;
      session.scrollbackStart += dropped.length;
    }
  }
}
function scrollbackFrom(session, cursor) {
  const output = [];
  let remaining = cursor - session.scrollbackStart;
  for (const chunk of session.scrollback) {
    if (remaining >= chunk.length) {
      remaining -= chunk.length;
      continue;
    }
    output.push(remaining > 0 ? chunk.subarray(remaining) : chunk);
    remaining = 0;
  }
  return output;
}
function parseCookies(header) {
  const map = /* @__PURE__ */ new Map();
  if (!header) return map;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (!key) continue;
    try {
      map.set(key, decodeURIComponent(rest.join("=")));
    } catch {
    }
  }
  return map;
}
function getTokensFromCookie(header) {
  const cookies = parseCookies(header);
  const tokens = [];
  for (const name of [ACCESS_COOKIE, LEGACY_ACCESS_COOKIE]) {
    const value = cookies.get(name);
    if (value !== void 0) tokens.push(value);
  }
  return tokens;
}
function getCookie(header, name) {
  return parseCookies(header).get(name) ?? null;
}
function timingSafeEqualString2(a, b) {
  const aBytes = Buffer.from(a);
  const bBytes = Buffer.from(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i += 1) {
    diff |= aBytes[i] ^ bBytes[i];
  }
  return diff === 0;
}
function isExpectedAccessToken(value) {
  const secret = accessToken();
  if (!secret || !value) return false;
  if (timingSafeEqualString2(value, secret)) return true;
  return isValidSignedAccessToken(value, secret);
}
function isExpectedSidecarToken(value) {
  return Boolean(SIDECAR_TOKEN && value && timingSafeEqualString2(value, SIDECAR_TOKEN));
}
function isExpectedPtyToken(value) {
  return isExpectedAccessToken(value) || isExpectedSidecarToken(value);
}
function isValidSignedAccessToken(value, secret) {
  const parts = value.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return false;
  const expiresAt = Number(parts[1]);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false;
  if (!parts[2] || !parts[3]) return false;
  const expected = createHmac("sha256", secret).update(`v1.${parts[1]}.${parts[2]}`).digest("base64url");
  return timingSafeEqualString2(parts[3], expected);
}
function hasValidPasskeyPresence(req, tailnetNodeId) {
  if (!tailnetNodeId) return false;
  const secret = process.env.COVEN_CAVE_PASSKEY_SESSION_SECRET;
  const token = getCookie(req.headers.cookie, PRESENCE_COOKIE);
  if (!secret || !token) return false;
  const parts = token.split(".");
  if (parts.length !== 6 || parts[0] !== "v1") return false;
  const expiresAt = Number(parts[1]);
  const field = /^[A-Za-z0-9_-]+$/;
  if (!Number.isFinite(expiresAt) || expiresAt <= 0 || !field.test(parts[2]) || !field.test(parts[3]) || !parts[4] || !parts[5]) {
    return false;
  }
  const body2 = parts.slice(0, 5).join(".");
  const expected = createHmac("sha256", secret).update(body2).digest("base64url");
  return timingSafeEqualString2(parts[5], expected) && expiresAt > Date.now() && parts[2] === tailnetNodeId;
}
function bearerToken(req) {
  const auth = req.headers.authorization ?? "";
  return auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : null;
}
function isLoopbackHost(host) {
  if (!host) return false;
  const hostname2 = host.startsWith("[") ? host.slice(1, host.indexOf("]")) : host.split(":")[0];
  return hostname2 === "127.0.0.1" || hostname2 === "localhost" || hostname2 === "::1";
}
function isLoopbackAddress(value) {
  if (!value) return false;
  if (value === "::1" || value === "127.0.0.1") return true;
  if (value.startsWith("::ffff:")) return value.slice("::ffff:".length) === "127.0.0.1";
  return false;
}
function isTailscaleAddress(value) {
  const address = value.startsWith("::ffff:") ? value.slice("::ffff:".length) : value;
  if (address.includes(".")) {
    const parts = address.split(".").map((part) => Number(part));
    return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) && parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127;
  }
  return address.toLowerCase().startsWith("fd7a:115c:a1e0:");
}
function normalizeForwardedAddress(value) {
  let address = value.trim();
  if (address.startsWith("[")) {
    const close = address.indexOf("]");
    if (close > 0) return address.slice(1, close).toLowerCase();
  }
  if ((address.match(/:/g) ?? []).length === 1) address = address.split(":")[0];
  if (address.startsWith("::ffff:")) address = address.slice("::ffff:".length);
  return address.toLowerCase();
}
var TAILNET_PEER_HEADER = "x-coven-cave-tailnet-peer";
var TAILNET_PEER_SECRET = randomUUID3();
process.env.COVEN_CAVE_TAILNET_PEER_SECRET = TAILNET_PEER_SECRET;
var TAILNET_STATUS_REFRESH_MS = 3e4;
process.env.COVEN_CAVE_PASSKEY_SESSION_SECRET = randomUUID3();
function allowedTailnetNodeIds() {
  const raw = process.env.COVEN_CAVE_TAILNET_ALLOWED_NODES ?? "";
  return new Set(
    raw.split(",").map((entry) => entry.trim()).filter((entry) => entry.length > 0)
  );
}
var tailnetPeerAddresses = /* @__PURE__ */ new Map();
var tailnetRefreshInFlight = false;
async function refreshTailnetPeers() {
  const allowed = allowedTailnetNodeIds();
  if (allowed.size === 0) {
    tailnetPeerAddresses = /* @__PURE__ */ new Map();
    return;
  }
  if (tailnetRefreshInFlight) return;
  tailnetRefreshInFlight = true;
  try {
    const { stdout } = await execFileAsync3(
      process.env.COVEN_CAVE_TAILSCALE_BIN ?? "tailscale",
      ["status", "--json"],
      { timeout: 1e4, maxBuffer: 16 * 1024 * 1024, windowsHide: true }
    );
    const status = JSON.parse(stdout);
    const next2 = /* @__PURE__ */ new Map();
    for (const peer of Object.values(status.Peer ?? {})) {
      const nodeId = peer.ID;
      if (!nodeId || !allowed.has(nodeId)) continue;
      for (const ip of peer.TailscaleIPs ?? []) {
        next2.set(normalizeForwardedAddress(ip), nodeId);
      }
    }
    tailnetPeerAddresses = next2;
  } catch (err) {
    tailnetPeerAddresses = /* @__PURE__ */ new Map();
    console.warn("[cave] tailnet peer refresh failed:", err?.message ?? err);
  } finally {
    tailnetRefreshInFlight = false;
  }
}
function resolveTailnetPeer(req) {
  if (tailnetPeerAddresses.size === 0) return null;
  if (!isLoopbackAddress(req.socket.remoteAddress)) return null;
  const forwarded = req.headers["x-forwarded-for"];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0];
  if (!first) return null;
  const address = normalizeForwardedAddress(first);
  if (!isTailscaleAddress(address)) return null;
  return tailnetPeerAddresses.get(address) ?? null;
}
function isDirectLoopbackRequest(req) {
  if (!isLoopbackAddress(req.socket.remoteAddress)) return false;
  for (const header of FORWARDING_HEADERS) {
    if (req.headers[header] !== void 0) return false;
  }
  return isLoopbackHost(req.headers.host);
}
function sameOrigin(value, expectedOrigin) {
  if (!value) return true;
  try {
    const url = new URL(value);
    if (url.origin === expectedOrigin) return true;
    const expected = new URL(expectedOrigin);
    if (url.host === expected.host) return true;
    return url.protocol === expected.protocol && url.port === expected.port && isLoopbackHost(url.host) && isLoopbackHost(expected.host);
  } catch {
    return false;
  }
}
function isAllowedUpgradeSource(req, tokenAuthenticated = false) {
  const host = req.headers.host;
  if (!isLoopbackAddress(req.socket.remoteAddress)) return false;
  if (!isLoopbackHost(host)) {
    if (!host) return false;
    if (tokenAuthenticated) return sameOrigin(req.headers.origin, `http://${host}`);
    return false;
  }
  return sameOrigin(req.headers.origin, `http://${host}`);
}
function firstQueryValue(value) {
  return Array.isArray(value) ? value[0] : value;
}
function parsePtyReplayCursor(value) {
  const raw = firstQueryValue(value);
  if (raw === void 0) return void 0;
  if (raw === "-1") return -1;
  if (!/^(?:0|[1-9]\d*)$/.test(raw)) return null;
  const cursor = Number(raw);
  return Number.isSafeInteger(cursor) ? cursor : null;
}
var UPGRADE_URL_BASE = "http://localhost";
var MAX_UPGRADE_QUERY_SEGMENTS = 1e3;
var ABSOLUTE_FORM_RE = /^[a-z][a-z\d+.-]*:\/\//i;
function boundedUpgradeQuery(suffix) {
  if (!suffix.startsWith("?")) return "";
  const fragmentStart = suffix.indexOf("#", 1);
  const rawQuery = suffix.slice(1, fragmentStart === -1 ? void 0 : fragmentStart);
  let segmentCount = 1;
  for (let index = 0; index < rawQuery.length; index += 1) {
    if (rawQuery[index] !== "&") continue;
    if (segmentCount >= MAX_UPGRADE_QUERY_SEGMENTS) return rawQuery.slice(0, index);
    segmentCount += 1;
  }
  return rawQuery;
}
function parseUpgradeTarget(rawUrl) {
  const pathEnd = rawUrl.search(/[?#]/);
  const rawPath = pathEnd === -1 ? rawUrl : rawUrl.slice(0, pathEnd);
  const suffix = pathEnd === -1 ? "" : rawUrl.slice(pathEnd);
  const normalizedPath = rawPath.replaceAll("\\", "/");
  const absoluteForm = ABSOLUTE_FORM_RE.exec(normalizedPath);
  const rootedPath = normalizedPath.startsWith("/") ? normalizedPath : `/${normalizedPath}`;
  const parsedUrl = absoluteForm ? new URL(normalizedPath) : new URL(`/.${rootedPath}`, UPGRADE_URL_BASE);
  parsedUrl.search = `?${boundedUpgradeQuery(suffix)}`;
  let pathname = normalizedPath;
  if (absoluteForm) {
    const pathStart = normalizedPath.indexOf("/", absoluteForm[0].length);
    pathname = pathStart === -1 ? "/" : normalizedPath.slice(pathStart);
  }
  const query = /* @__PURE__ */ Object.create(null);
  for (const [key, value] of parsedUrl.searchParams) {
    const current = query[key];
    if (current === void 0) query[key] = value;
    else if (Array.isArray(current)) current.push(value);
    else query[key] = [current, value];
  }
  return { pathname, query };
}
function isPtyAuthRequired() {
  return Boolean(accessToken() || SIDECAR_TOKEN);
}
function shouldRejectUnauthenticatedPtyUpgrade({
  sidecarTokenConfigured = false,
  accessTokenConfigured = false,
  tokenAuthenticated = false,
  directLoopback = false
} = {}) {
  if (tokenAuthenticated || directLoopback) return false;
  return sidecarTokenConfigured || accessTokenConfigured;
}
function isAuthorized(req, query) {
  if (!isPtyAuthRequired()) return false;
  const queryToken = firstQueryValue(query[ACCESS_QUERY_PARAM]);
  const sidecarQueryToken = firstQueryValue(query[SIDECAR_QUERY_PARAM]);
  const candidates = [bearerToken(req), queryToken, sidecarQueryToken, ...getTokensFromCookie(req.headers.cookie)];
  return candidates.some(isExpectedPtyToken);
}
function defaultShell() {
  if (process.platform === "darwin") return "/bin/zsh";
  if (process.platform === "win32") {
    return "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
  }
  return process.env.SHELL ?? "/bin/bash";
}
function defaultShellArgs() {
  if (process.platform === "win32") return ["-NoLogo"];
  return ["-l"];
}
function augmentedPath() {
  const inherited = process.env.PATH ?? "";
  const sep = process.platform === "win32" ? ";" : ":";
  const extras = process.platform === "win32" ? [
    "C:\\Windows\\System32",
    "C:\\Windows",
    "C:\\Program Files\\Git\\cmd",
    "C:\\Program Files\\nodejs"
  ] : [
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
    "/usr/local/sbin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin"
  ];
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const part of inherited.split(sep).concat(extras)) {
    if (!part || seen.has(part)) continue;
    seen.add(part);
    out.push(part);
  }
  return out.join(sep);
}
function validateCwd(raw) {
  if (!raw) return void 0;
  const stat = statSync2(raw);
  if (!stat.isDirectory()) {
    throw new Error("projectRoot must be a directory");
  }
  return raw;
}
var PTY_ENV_DROPPED = /* @__PURE__ */ new Set(["NODE_ENV", "INIT_CWD", "PNPM_SCRIPT_SRC_DIR"]);
var PTY_ENV_DROPPED_PREFIXES = ["COVEN_CAVE_", "__NEXT_PRIVATE_"];
function sanitizedEnv() {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === void 0) continue;
    if (/^npm_/i.test(key)) continue;
    if (PTY_ENV_DROPPED.has(key)) continue;
    if (PTY_ENV_DROPPED_PREFIXES.some((prefix) => key.startsWith(prefix))) continue;
    env[key] = value;
  }
  return env;
}
function sendPtyData(ws, data) {
  if (ws.readyState !== WebSocket.OPEN) return false;
  const frame = Buffer.allocUnsafe(1 + data.length);
  frame[0] = 1;
  data.copy(frame, 1);
  try {
    ws.send(frame);
    return true;
  } catch {
    return false;
  }
}
function sendPtyReplayCursor(ws, cursor, reset) {
  if (ws.readyState !== WebSocket.OPEN) return false;
  const frame = Buffer.allocUnsafe(10);
  frame[0] = 6;
  frame.writeDoubleLE(cursor, 1);
  frame[9] = reset ? 1 : 0;
  try {
    ws.send(frame);
    return true;
  } catch {
    return false;
  }
}
function clearPendingPtyOutput(session) {
  if (session.flushTimer) {
    clearTimeout(session.flushTimer);
    session.flushTimer = null;
  }
  session.pendingOutput = [];
  session.pendingOutputBytes = 0;
}
function armPtyDetach(threadId, session) {
  if (session.detachTimer) clearTimeout(session.detachTimer);
  session.detachTimer = setTimeout(() => {
    const current = sessions.get(threadId);
    if (current !== session || current.ws) return;
    sessions.delete(threadId);
    try {
      session.pty.kill();
    } catch {
    }
  }, DETACH_GRACE_MS);
}
function detachPtyConsumer(threadId, session, ws) {
  if (session.ws !== ws) return;
  session.ws = null;
  clearPendingPtyOutput(session);
  armPtyDetach(threadId, session);
}
function evictSlowPtyConsumer(threadId, session, ws) {
  if (session.ws !== ws) return;
  detachPtyConsumer(threadId, session, ws);
  try {
    ws.close(PTY_SLOW_CONSUMER_CLOSE_CODE, PTY_SLOW_CONSUMER_CLOSE_REASON);
  } catch {
  }
}
function flushPtyOutput(threadId, session) {
  session.flushTimer = null;
  const ws = session.ws;
  if (!ws || session.pendingOutputBytes === 0) return;
  const chunks = session.pendingOutput;
  clearPendingPtyOutput(session);
  const payload = Buffer.concat(chunks);
  if (ws.readyState !== WebSocket.OPEN || session.ws !== ws) return;
  if (ws.bufferedAmount + payload.length + 1 > PTY_WS_BUFFERED_AMOUNT_LIMIT) {
    evictSlowPtyConsumer(threadId, session, ws);
    return;
  }
  if (!sendPtyData(ws, payload)) {
    detachPtyConsumer(threadId, session, ws);
  }
}
function queuePtyOutput(threadId, session, data) {
  if (!session.ws || data.length === 0) return;
  let offset = 0;
  while (offset < data.length && session.ws) {
    const room = PTY_FRAME_MAX_BYTES - session.pendingOutputBytes;
    const take = Math.min(room, data.length - offset);
    const chunk = data.subarray(offset, offset + take);
    if (session.pendingOutputBytes + take === PTY_FRAME_MAX_BYTES) {
      session.pendingOutput.push(chunk);
    } else {
      const boundedChunk = Buffer.allocUnsafeSlow(chunk.length);
      chunk.copy(boundedChunk);
      session.pendingOutput.push(boundedChunk);
    }
    session.pendingOutputBytes += take;
    offset += take;
    if (session.pendingOutputBytes === PTY_FRAME_MAX_BYTES) {
      flushPtyOutput(threadId, session);
    }
  }
  if (session.ws && session.pendingOutputBytes > 0 && !session.flushTimer) {
    session.flushTimer = setTimeout(
      () => flushPtyOutput(threadId, session),
      PTY_FRAME_COALESCE_MS
    );
  }
}
function replayPtyOutput(threadId, session, replayCursor) {
  if (!session.ws || session.scrollbackBytes === 0) {
    if (session.ws && replayCursor !== void 0) {
      sendPtyReplayCursor(
        session.ws,
        session.streamEnd,
        replayCursor !== -1 && replayCursor !== session.streamEnd
      );
    }
    return;
  }
  if (replayCursor === void 0) {
    for (const chunk of session.scrollback) queuePtyOutput(threadId, session, chunk);
    return;
  }
  const validCursor = replayCursor >= session.scrollbackStart && replayCursor <= session.streamEnd;
  const start = validCursor && replayCursor !== -1 ? replayCursor : session.scrollbackStart;
  const reset = replayCursor !== -1 && !validCursor;
  const ws = session.ws;
  if (!ws || ws.bufferedAmount + 10 > PTY_WS_BUFFERED_AMOUNT_LIMIT || !sendPtyReplayCursor(ws, start, reset)) {
    if (ws) evictSlowPtyConsumer(threadId, session, ws);
    return;
  }
  for (const chunk of scrollbackFrom(session, start)) queuePtyOutput(threadId, session, chunk);
}
function sendPtyExit(ws, exitCode) {
  if (ws.readyState !== WebSocket.OPEN) return;
  const frame = Buffer.allocUnsafe(5);
  frame[0] = 2;
  frame.writeInt32LE(exitCode, 1);
  ws.send(frame);
}
function spawnPty(threadId, ws, cols, rows, cwd, replayCursor) {
  const shell = pty.spawn(defaultShell(), defaultShellArgs(), {
    name: "xterm-256color",
    cols: cols > 0 ? cols : 120,
    rows: rows > 0 ? rows : 40,
    cwd: cwd ?? process.env.HOME ?? process.cwd(),
    env: {
      ...sanitizedEnv(),
      PATH: augmentedPath(),
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      COVENCAVE: "1",
      LANG: process.env.LANG ?? "en_US.UTF-8",
      LC_ALL: process.env.LC_ALL ?? "en_US.UTF-8"
    }
  });
  const session = {
    pty: shell,
    ws: null,
    scrollback: [],
    scrollbackBytes: 0,
    scrollbackStart: 0,
    streamEnd: 0,
    pendingOutput: [],
    pendingOutputBytes: 0,
    flushTimer: null,
    detachTimer: null
  };
  sessions.set(threadId, session);
  shell.onData((data) => {
    const bytes = Buffer.from(data, "utf8");
    appendScrollback(session, bytes);
    queuePtyOutput(threadId, session, bytes);
  });
  shell.onExit(({ exitCode }) => {
    const current = sessions.get(threadId);
    if (session.ws) flushPtyOutput(threadId, session);
    if (current?.pty === shell) {
      if (current.detachTimer) clearTimeout(current.detachTimer);
      clearPendingPtyOutput(current);
      sessions.delete(threadId);
    }
    if (session.ws) {
      sendPtyExit(session.ws, exitCode ?? 0);
      session.ws.close(1e3, "pty exit");
    }
  });
  adoptSession(threadId, session, ws, cols, rows, replayCursor);
}
function rawDataToBuffer(data) {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}
function onWsMessage(threadId, data) {
  const session = sessions.get(threadId);
  if (!session) return;
  const frame = rawDataToBuffer(data);
  const tag = frame[0];
  if (tag === 3) {
    session.pty.write(frame.subarray(1).toString("utf8"));
  } else if (tag === 4 && frame.length >= 5) {
    const cols = frame.readUInt16LE(1);
    const rows = frame.readUInt16LE(3);
    if (cols > 0 && rows > 0) {
      session.pty.resize(cols, rows);
    }
  } else if (tag === 5) {
    if (session.detachTimer) clearTimeout(session.detachTimer);
    clearPendingPtyOutput(session);
    sessions.delete(threadId);
    try {
      session.pty.kill();
    } catch {
    }
  }
}
function adoptSession(threadId, session, ws, cols, rows, replayCursor) {
  if (session.detachTimer) {
    clearTimeout(session.detachTimer);
    session.detachTimer = null;
  }
  const previous = session.ws;
  clearPendingPtyOutput(session);
  session.ws = ws;
  if (previous && previous !== ws) {
    try {
      previous.close(1e3, "replaced");
    } catch {
    }
  }
  if (cols > 0 && rows > 0) {
    try {
      session.pty.resize(cols, rows);
    } catch {
    }
  }
  replayPtyOutput(threadId, session, replayCursor);
}
function handlePtyConnection(ws, threadId, cols, rows, cwd, replayCursor) {
  const existing = sessions.get(threadId);
  if (existing) {
    adoptSession(threadId, existing, ws, cols, rows, replayCursor);
  } else {
    spawnPty(threadId, ws, cols, rows, cwd, replayCursor);
  }
  ws.on("message", (data) => onWsMessage(threadId, data));
  ws.on("close", () => {
    const session = sessions.get(threadId);
    if (!session || session.ws !== ws) return;
    detachPtyConsumer(threadId, session, ws);
  });
}
function loopbackHostname(raw = process.env.HOSTNAME) {
  if (raw === "127.0.0.1" || raw === "localhost" || raw === "::1") {
    return raw;
  }
  return "127.0.0.1";
}
function loopbackHttpEndpoint(hostname2, port2) {
  const urlHostname = hostname2 === "::1" ? `[${hostname2}]` : hostname2;
  return `http://${urlHostname}:${port2}`;
}
var dev = process.env.NODE_ENV !== "production";
var hostname = loopbackHostname();
var port = cavePort();
var app = next({ dev, hostname, port });
var handle = app.getRequestHandler();
var wss = new WebSocketServer({ noServer: true });
var remotePtyClients = /* @__PURE__ */ new Set();
var deviceAccessSecret = randomUUID3();
process.env.COVEN_CAVE_DEVICE_ACCESS_SECRET = deviceAccessSecret;
var deviceAccessStore = await createDeviceAccessStore();
var deviceAccess = createDeviceAccessGateway({
  store: deviceAccessStore,
  isDirectLoopback: isDirectLoopbackRequest,
  sidecarToken: SIDECAR_TOKEN,
  packaged: process.env.COVEN_CAVE_BUNDLE === "1",
  stampSecret: deviceAccessSecret,
  onAuthenticated(req, device) {
    req.headers[TAILNET_PEER_HEADER] = `${TAILNET_PEER_SECRET}:${device.peer.nodeId}`;
  },
  onPolicyChanged() {
    for (const client of remotePtyClients) client.terminate();
  }
});
await app.prepare();
var nextUpgradeHandler = app.getUpgradeHandler();
var server = createServer((req, res) => {
  delete req.headers[LOCAL_PEER_HEADER];
  delete req.headers[TAILNET_PEER_HEADER];
  if (isDirectLoopbackRequest(req)) {
    req.headers[LOCAL_PEER_HEADER] = LOCAL_PEER_SECRET;
  }
  const tailnetNodeId = resolveTailnetPeer(req);
  if (tailnetNodeId) {
    req.headers[TAILNET_PEER_HEADER] = `${TAILNET_PEER_SECRET}:${tailnetNodeId}`;
  }
  void deviceAccess.handle(req, res).then((handled) => {
    if (!handled) return handle(req, res);
  }).catch((error) => {
    console.error("[device-access] Request handling failed:", error);
    res.destroy(error instanceof Error ? error : void 0);
  });
});
server.on("close", () => {
  void deviceAccess.close().then(() => deviceAccessStore.close()).catch((error) => {
    console.error("[device-access] Shutdown failed:", error);
  });
});
server.on("upgrade", async (req, socket, head) => {
  try {
    if (await deviceAccess.blocksUpgrade(req)) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      socket.destroy();
      return;
    }
  } catch (error) {
    console.error("[device-access] Upgrade refused:", error);
    socket.destroy();
    return;
  }
  let pathname;
  let query;
  try {
    ({ pathname, query } = parseUpgradeTarget(req.url ?? "/"));
  } catch {
    socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    socket.destroy();
    return;
  }
  if (pathname !== "/api/pty-ws") {
    void nextUpgradeHandler(req, socket, head).catch((err) => {
      console.error(`Failed to handle websocket upgrade for ${req.url ?? "unknown url"}`, err);
      socket.destroy();
    });
    return;
  }
  const tailnetNodeId = resolveTailnetPeer(req);
  const tokenAuthenticated = isPtyAuthRequired() ? isAuthorized(req, query) : false;
  if (!isAllowedUpgradeSource(req, tokenAuthenticated)) {
    socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    socket.destroy();
    return;
  }
  if (shouldRejectUnauthenticatedPtyUpgrade({
    sidecarTokenConfigured: Boolean(SIDECAR_TOKEN),
    accessTokenConfigured: Boolean(accessToken()),
    tokenAuthenticated,
    directLoopback: isDirectLoopbackRequest(req)
  })) {
    socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    socket.destroy();
    return;
  }
  if (process.env.COVEN_CAVE_PASSKEY_REQUIRED === "1" && !isDirectLoopbackRequest(req) && !hasValidPasskeyPresence(req, tailnetNodeId)) {
    socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    socket.destroy();
    return;
  }
  const threadId = String(query.threadId ?? "");
  if (!threadId) {
    socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    socket.destroy();
    return;
  }
  const replayCursor = parsePtyReplayCursor(query.ptyReplayCursor);
  if (replayCursor === null) {
    socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    socket.destroy();
    return;
  }
  let cwd;
  try {
    cwd = validateCwd(query.projectRoot ? String(query.projectRoot) : void 0);
  } catch {
    socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    socket.destroy();
    return;
  }
  const cols = Number.parseInt(String(query.cols ?? "120"), 10);
  const rows = Number.parseInt(String(query.rows ?? "40"), 10);
  wss.handleUpgrade(req, socket, head, (ws) => {
    if (!isDirectLoopbackRequest(req)) {
      remotePtyClients.add(ws);
      ws.once("close", () => {
        remotePtyClients.delete(ws);
      });
    }
    handlePtyConnection(ws, threadId, cols, rows, cwd, replayCursor);
  });
});
server.keepAliveTimeout = 75e3;
server.headersTimeout = 8e4;
function reportClientV1DiscoveryUnavailable(error) {
  clientV1DiscoveryPublished = false;
  const category = typeof error === "object" && error !== null ? standaloneDiscoveryPublicationFailures.get(error) ?? "disabled-other" : "disabled-other";
  console.error("[cave] \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 CLIENT V1 DISABLED \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
  console.error(`[cave] client-v1 discovery publication refused: ${category}`);
  console.error(
    "[cave] The client v1 discovery record was NOT published, so paired clients cannot find this server and every client v1 request stays refused. Everything else on this server is running normally."
  );
  console.error(
    `[cave] Repair the path and restart. If \u2014 and only if \u2014 this host cannot read a DACL at all, ${UNVERIFIED_OWNERSHIP_ENV2}=${UNVERIFIED_OWNERSHIP_TOKEN2} with ${UNVERIFIED_OWNERSHIP_REASON_ENV2} set admits an unreadable one; it never admits a DACL that was read and found shared.`
  );
  console.error("[cave] \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
}
server.listen(port, hostname, () => {
  try {
    publishStandaloneClientV1DiscoveryRecord(loopbackHttpEndpoint(hostname, port));
  } catch (error) {
    reportClientV1DiscoveryUnavailable(error);
  }
  logStartupHeapCeiling();
  console.log(`> Ready on ${loopbackHttpEndpoint(hostname, port)}`);
});
var httpShutdownStarted = false;
function shutdownHttpServer() {
  if (httpShutdownStarted) return;
  httpShutdownStarted = true;
  cleanupStandaloneClientV1Discovery();
  terminatePtySessions();
  const timer = setTimeout(() => process.exit(1), 2e3);
  timer.unref?.();
  server.close(() => {
    clearTimeout(timer);
    process.exit(0);
  });
}
process.once("SIGINT", shutdownHttpServer);
process.once("SIGTERM", shutdownHttpServer);
if (allowedTailnetNodeIds().size > 0) {
  void refreshTailnetPeers();
  setInterval(() => void refreshTailnetPeers(), TAILNET_STATUS_REFRESH_MS).unref();
}
server.once("error", (err) => {
  cleanupStandaloneClientV1Discovery();
  if (err.code === "EADDRINUSE") {
    console.error(
      `> Port ${port} on ${hostname} is already in use (EADDRINUSE); CovenCave cannot serve here.`
    );
  }
  console.error(err);
  process.exit(1);
});
var HEAP_MONITOR_ENABLED = process.env.COVEN_CAVE_HEAP_MONITOR !== "0";
var HEAP_MONITOR_INTERVAL_MS = (() => {
  const env = Number.parseInt(process.env.COVEN_CAVE_HEAP_MONITOR_INTERVAL_MS ?? "", 10);
  return Number.isFinite(env) && env > 0 ? env : 3e5;
})();
var HEAP_WARN_RATIO = 0.85;
var HEAP_SNAPSHOT_RATIO = 0.95;
var HEAP_SNAPSHOT_KEEP = 2;
var heapSnapshotSeq = 0;
function heapDiagnosticsDir() {
  const covenHome2 = process.env.COVEN_HOME || join3(homedir3(), ".coven");
  const caveHome2 = process.env.COVEN_CAVE_HOME || join3(covenHome2, "cave");
  return join3(caveHome2, "diagnostics");
}
var mb = (bytes) => `${Math.round(bytes / (1024 * 1024))}MB`;
function logStartupHeapCeiling() {
  console.log(`[heap-ceiling] heapLimit=${mb(getHeapStatistics().heap_size_limit)}`);
}
function pruneHeapSnapshots(dir) {
  const snapshots = readdirSync(dir).filter((name) => name.startsWith("cave-heap-") && name.endsWith(".heapsnapshot")).sort();
  while (snapshots.length > HEAP_SNAPSHOT_KEEP) {
    const oldest = snapshots.shift();
    try {
      unlinkSync(join3(dir, oldest));
    } catch {
    }
  }
}
function startHeapMonitor() {
  if (!HEAP_MONITOR_ENABLED) return;
  let snapshotWritten = false;
  const tick = () => {
    const heap = getHeapStatistics();
    const ratio = heap.used_heap_size / heap.heap_size_limit;
    if (ratio < HEAP_WARN_RATIO) {
      snapshotWritten = false;
      return;
    }
    const usage = process.memoryUsage();
    console.warn(
      `[heap-monitor] heapUsed=${mb(heap.used_heap_size)} heapLimit=${mb(heap.heap_size_limit)} (${Math.round(ratio * 100)}%) rss=${mb(usage.rss)} external=${mb(usage.external)} ptySessions=${sessions.size} uptimeMin=${Math.round(process.uptime() / 60)}`
    );
    if (ratio < HEAP_SNAPSHOT_RATIO || snapshotWritten) return;
    try {
      const dir = heapDiagnosticsDir();
      mkdirSync(dir, { recursive: true });
      const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
      const seq = String(heapSnapshotSeq += 1).padStart(3, "0");
      const file = join3(dir, `cave-heap-${stamp}-pid${process.pid}-${seq}.heapsnapshot`);
      writeHeapSnapshot(file);
      snapshotWritten = true;
      pruneHeapSnapshots(dir);
      console.warn(`[heap-monitor] wrote heap snapshot ${file}`);
    } catch (err) {
      snapshotWritten = true;
      console.warn(`[heap-monitor] failed to write heap snapshot`, err);
    }
  };
  setInterval(tick, HEAP_MONITOR_INTERVAL_MS).unref();
}
startHeapMonitor();
