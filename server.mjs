import { execFile, execFileSync } from "node:child_process";
import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID
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
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { getHeapStatistics, writeHeapSnapshot } from "node:v8";
import next from "next";
import { WebSocket, WebSocketServer } from "ws";
const require2 = createRequire(import.meta.url);
const pty = require2("node-pty");
const execFileAsync = promisify(execFile);
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
const CAVE_DEV_PORT = 3e3;
const CAVE_PRODUCTION_PORT = 3020;
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
  const stateRoot = process.env.COVEN_CAVE_MOBILE_STATE_ROOT?.trim() || join(
    process.env.XDG_STATE_HOME?.trim() || join(homedir(), ".local", "state"),
    "coven-cave"
  );
  const stateDir = process.env.COVEN_CAVE_MOBILE_STATE_DIR?.trim() || join(stateRoot, `mobile-tailscale-${port2}`);
  return join(stateDir, "access-token");
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
const SIDECAR_TOKEN = process.env.COVEN_CAVE_AUTH_TOKEN ?? "";
const CLIENT_V1_DISCOVERY_FILE = "client-v1-discovery.json";
const CLIENT_V1_DISCOVERY_STARTED_AT = (/* @__PURE__ */ new Date()).toISOString();
const CLIENT_V1_AUTHORITY_MODE_ENV = "COVEN_CAVE_CLIENT_V1_AUTHORITY_MODE";
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
    createHash("sha256").update("OpenCoven/client-v1/hpke-bound-v1/key-id\0", "utf8").update(publicKey).digest()
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
    runtimeNonce: randomBytes(32)
  };
}
const CLIENT_V1_AUTHORITY_MODE = parseStandaloneClientV1AuthorityMode(
  process.env.COVEN_CAVE_CLIENT_V1_AUTHORITY_MODE
);
let clientV1AuthorityInitializationError = null;
let CLIENT_V1_AUTHORITY_BOOTSTRAP;
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
const CLIENT_V1_DISCOVERY_NONCE = CLIENT_V1_AUTHORITY_BOOTSTRAP && !("unavailable" in CLIENT_V1_AUTHORITY_BOOTSTRAP) ? Buffer.from(
  CLIENT_V1_AUTHORITY_BOOTSTRAP.runtimeNonce
).toString("base64url") : randomUUID();
let clientV1DiscoveryPublished = false;
function standaloneCaveHome() {
  const covenHome = process.env.COVEN_HOME || join(homedir(), ".coven");
  return resolve(process.env.COVEN_CAVE_HOME || join(covenHome, "cave"));
}
function clientV1DiscoveryFile() {
  return join(standaloneCaveHome(), CLIENT_V1_DISCOVERY_FILE);
}
const WINDOWS_SYSTEM_SID = "S-1-5-18";
const WINDOWS_ADMINISTRATORS_SID = "S-1-5-32-544";
const UNVERIFIED_OWNERSHIP_ENV = "COVEN_CAVE_UNVERIFIED_PATH_OWNERSHIP";
const UNVERIFIED_OWNERSHIP_REASON_ENV = "COVEN_CAVE_UNVERIFIED_PATH_OWNERSHIP_REASON";
const UNVERIFIED_OWNERSHIP_TOKEN = "i-accept-unverified-path-ownership";
const UNVERIFIED_OWNERSHIP_MIN_REASON = 12;
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
function unverifiableOwnershipRefusal(subject, path, cause, note) {
  return `${subject} ownership could not be verified on Windows: ${cause.message}. Refusing ${path}; inspect it with: icacls "${path}". ${note}`;
}
function unverifiedOwnershipDisclosure(subject, path, cause, reason) {
  return `SECURITY WAIVER \u2014 ${subject} is being used UNVERIFIED. Its DACL could not be read on this host (${cause.message}), and ${UNVERIFIED_OWNERSHIP_ENV} is set, so ${path} is trusted on the operator's word alone: reason given \u2014 ${reason}. Any principal that can write ${path} can mint credentials or point a paired client at another server. Unset ${UNVERIFIED_OWNERSHIP_ENV} to restore the check.`;
}
function sharedOwnershipRefusal(subject, path, findings, waiver) {
  return `${subject} is not exclusive to the current user: ${findings.join("; ")}. Refusing ${path}; inspect it with: icacls "${path}"` + (waiver.granted ? `. ${UNVERIFIED_OWNERSHIP_ENV} does not cover a DACL that was read: this one was, and it is shared. Repair it with: icacls "${path}" /reset` : "");
}
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
  $acl.SetOwner($me)
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
const standaloneVerifiedWindowsPaths = /* @__PURE__ */ new Set();
const standaloneWaivedWindowsPaths = /* @__PURE__ */ new Set();
function assertStandaloneWindowsExclusive(path, label) {
  if (standaloneVerifiedWindowsPaths.has(path)) return;
  if (standaloneWaivedWindowsPaths.has(path)) return;
  const subject = `Client v1 discovery ${label}`;
  const waiver = resolveUnverifiedOwnershipWaiver(process.env);
  const systemRoot = process.env.SystemRoot || process.env.windir || "C:\\Windows";
  const probeEnv = {
    COVEN_CAVE_CLIENT_V1_ACL_PATH: path,
    // Next augments ProcessEnv to require this. It carries no secret.
    NODE_ENV: process.env.NODE_ENV,
    SystemRoot: systemRoot,
    windir: systemRoot,
    PATH: join(systemRoot, "System32"),
    PATHEXT: process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD",
    TEMP: process.env.TEMP || process.env.TMP || join(systemRoot, "Temp"),
    TMP: process.env.TMP || process.env.TEMP || join(systemRoot, "Temp")
  };
  let report;
  try {
    report = JSON.parse(execFileSync(
      join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
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
      throw new Error(
        unverifiableOwnershipRefusal(subject, path, cause, waiver.note),
        { cause }
      );
    }
    standaloneWaivedWindowsPaths.add(path);
    console.warn(
      unverifiedOwnershipDisclosure(subject, path, cause, waiver.reason)
    );
    return;
  }
  const trusted = /* @__PURE__ */ new Set([report.self, WINDOWS_SYSTEM_SID, WINDOWS_ADMINISTRATORS_SID]);
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
    throw new Error(sharedOwnershipRefusal(subject, path, findings, waiver));
  }
  if (report.repaired) {
    console.warn(
      `${subject} had no enforced access control on Windows; restricted ${path} to the current user and revoked ${report.removed.length > 0 ? report.removed.join(", ") : "inherited entries"}.`
    );
  }
  standaloneVerifiedWindowsPaths.add(path);
}
function requireStandaloneOwner(path, metadata, label) {
  if (typeof process.getuid === "function") {
    if (metadata.uid !== process.getuid()) {
      throw new Error(`Client v1 discovery ${label} must be owned by the current user.`);
    }
    return;
  }
  if (process.platform !== "win32") {
    throw new Error(
      `Client v1 discovery ${label} ownership cannot be verified on ${process.platform}: this platform exposes neither a uid nor a Windows ACL, so ${path} is refused.`
    );
  }
  assertStandaloneWindowsExclusive(path, label);
}
function assertStandaloneDiscoveryTarget(path) {
  try {
    const metadata = lstatSync(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error(`Client v1 discovery target must be a regular file: ${path}.`);
    }
    requireStandaloneOwner(path, metadata, "target");
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
}
function publishStandaloneClientV1DiscoveryRecord(endpoint) {
  const root = join(clientV1DiscoveryFile(), "..");
  mkdirSync(root, { recursive: true, mode: 448 });
  const rootMetadata = lstatSync(root);
  if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) {
    throw new Error("Client v1 discovery root must be a real directory.");
  }
  requireStandaloneOwner(root, rootMetadata, "root");
  const physicalRoot = realpathSync(root);
  if (physicalRoot !== root) {
    throw new Error("Client v1 discovery root must not resolve through a symlink.");
  }
  chmodSync(root, 448);
  const url = new URL(endpoint);
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
  if (url.protocol !== "http:" || !loopback || !url.port || url.username || url.password || url.pathname !== "/" || url.search || url.hash || /%(?:2f|5c)/i.test(endpoint)) {
    throw new Error("Client v1 discovery endpoint must be a path-free loopback HTTP URL.");
  }
  const path = clientV1DiscoveryFile();
  assertStandaloneDiscoveryTarget(path);
  let record;
  if (CLIENT_V1_AUTHORITY_MODE === "off") {
    record = {
      version: 1,
      endpoint,
      pid: process.pid,
      nonce: CLIENT_V1_DISCOVERY_NONCE,
      startedAt: CLIENT_V1_DISCOVERY_STARTED_AT
    };
  } else {
    if (CLIENT_V1_AUTHORITY_BOOTSTRAP === void 0) {
      throw new Error("Client v1 HPKE authority initialization failed.");
    }
    if ("unavailable" in CLIENT_V1_AUTHORITY_BOOTSTRAP) {
      throw clientV1AuthorityInitializationError ?? new Error("Client v1 HPKE authority initialization failed.");
    }
    const bootstrap = CLIENT_V1_AUTHORITY_BOOTSTRAP;
    record = {
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
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let fd = null;
  let ownsTemporaryPath = false;
  try {
    fd = openSync(temporaryPath, "wx", 384);
    ownsTemporaryPath = true;
    writeFileSync(fd, `${JSON.stringify(record, null, 2)}
`, "utf8");
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    assertStandaloneDiscoveryTarget(path);
    renameSync(temporaryPath, path);
    ownsTemporaryPath = false;
    chmodSync(path, 384);
    clientV1DiscoveryPublished = true;
  } catch (error) {
    if (fd !== null) closeSync(fd);
    if (ownsTemporaryPath) rmSync(temporaryPath, { force: true });
    throw error;
  }
}
function removeStandaloneClientV1DiscoveryRecord(nonce) {
  const path = clientV1DiscoveryFile();
  let before;
  let parsed;
  try {
    before = lstatSync(path);
    if (!before.isFile() || before.isSymbolicLink()) return false;
    requireStandaloneOwner(path, before, "target");
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return false;
    if (error instanceof SyntaxError) return false;
    throw error;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || parsed.nonce !== nonce) {
    return false;
  }
  const current = lstatSync(path);
  if (!current.isFile() || current.isSymbolicLink() || current.dev !== before.dev || current.ino !== before.ino) {
    return false;
  }
  unlinkSync(path);
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
const LOCAL_PEER_HEADER = "x-coven-cave-local-peer";
const LOCAL_PEER_SECRET = randomUUID();
process.env.COVEN_CAVE_LOCAL_PEER_SECRET = LOCAL_PEER_SECRET;
const FORWARDING_HEADERS = [
  "forwarded",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "via"
];
const ACCESS_COOKIE = "coven_cave_access";
const LEGACY_ACCESS_COOKIE = "coven_access_token";
const PRESENCE_COOKIE = "coven_passkey_presence";
const ACCESS_QUERY_PARAM = "coven_access_token";
const SIDECAR_QUERY_PARAM = "covenCaveToken";
const sessions = /* @__PURE__ */ new Map();
const PACKAGED_CHILD_SHUTDOWN_BUDGET_MS = 1200;
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
const SCROLLBACK_LIMIT_BYTES = 256 * 1024;
const PTY_FRAME_COALESCE_MS = 8;
const PTY_FRAME_MAX_BYTES = 16 * 1024;
const PTY_WS_BUFFERED_AMOUNT_LIMIT = 512 * 1024;
const PTY_SLOW_CONSUMER_CLOSE_CODE = 1013;
const PTY_SLOW_CONSUMER_CLOSE_REASON = "slow terminal consumer; reconnect";
const DETACH_GRACE_MS = (() => {
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
function timingSafeEqualString(a, b) {
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
  if (timingSafeEqualString(value, secret)) return true;
  return isValidSignedAccessToken(value, secret);
}
function isExpectedSidecarToken(value) {
  return Boolean(SIDECAR_TOKEN && value && timingSafeEqualString(value, SIDECAR_TOKEN));
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
  return timingSafeEqualString(parts[3], expected);
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
  const body = parts.slice(0, 5).join(".");
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  return timingSafeEqualString(parts[5], expected) && expiresAt > Date.now() && parts[2] === tailnetNodeId;
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
const TAILNET_PEER_HEADER = "x-coven-cave-tailnet-peer";
const TAILNET_PEER_SECRET = randomUUID();
process.env.COVEN_CAVE_TAILNET_PEER_SECRET = TAILNET_PEER_SECRET;
const TAILNET_STATUS_REFRESH_MS = 3e4;
process.env.COVEN_CAVE_PASSKEY_SESSION_SECRET = randomUUID();
function allowedTailnetNodeIds() {
  const raw = process.env.COVEN_CAVE_TAILNET_ALLOWED_NODES ?? "";
  return new Set(
    raw.split(",").map((entry) => entry.trim()).filter((entry) => entry.length > 0)
  );
}
let tailnetPeerAddresses = /* @__PURE__ */ new Map();
let tailnetRefreshInFlight = false;
async function refreshTailnetPeers() {
  const allowed = allowedTailnetNodeIds();
  if (allowed.size === 0) {
    tailnetPeerAddresses = /* @__PURE__ */ new Map();
    return;
  }
  if (tailnetRefreshInFlight) return;
  tailnetRefreshInFlight = true;
  try {
    const { stdout } = await execFileAsync(
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
const UPGRADE_URL_BASE = "http://localhost";
const MAX_UPGRADE_QUERY_SEGMENTS = 1e3;
const ABSOLUTE_FORM_RE = /^[a-z][a-z\d+.-]*:\/\//i;
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
  const stat = statSync(raw);
  if (!stat.isDirectory()) {
    throw new Error("projectRoot must be a directory");
  }
  return raw;
}
const PTY_ENV_DROPPED = /* @__PURE__ */ new Set(["NODE_ENV", "INIT_CWD", "PNPM_SCRIPT_SRC_DIR"]);
const PTY_ENV_DROPPED_PREFIXES = ["COVEN_CAVE_", "__NEXT_PRIVATE_"];
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
const dev = process.env.NODE_ENV !== "production";
const hostname = loopbackHostname();
const port = cavePort();
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();
const wss = new WebSocketServer({ noServer: true });
await app.prepare();
const nextUpgradeHandler = app.getUpgradeHandler();
const server = createServer((req, res) => {
  delete req.headers[LOCAL_PEER_HEADER];
  delete req.headers[TAILNET_PEER_HEADER];
  if (isDirectLoopbackRequest(req)) {
    req.headers[LOCAL_PEER_HEADER] = LOCAL_PEER_SECRET;
  }
  const tailnetNodeId = resolveTailnetPeer(req);
  if (tailnetNodeId) {
    req.headers[TAILNET_PEER_HEADER] = `${TAILNET_PEER_SECRET}:${tailnetNodeId}`;
  }
  void handle(req, res);
});
server.on("upgrade", (req, socket, head) => {
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
    handlePtyConnection(ws, threadId, cols, rows, cwd, replayCursor);
  });
});
server.keepAliveTimeout = 75e3;
server.headersTimeout = 8e4;
function reportClientV1DiscoveryUnavailable(error) {
  clientV1DiscoveryPublished = false;
  const detail = error instanceof Error ? error.message : String(error);
  console.error("[cave] \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 CLIENT V1 DISABLED \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
  console.error(`[cave] ${detail}`);
  console.error(
    "[cave] The client v1 discovery record was NOT published, so paired clients cannot find this server and every client v1 request stays refused. Everything else on this server is running normally."
  );
  console.error(
    `[cave] Repair the path and restart. If \u2014 and only if \u2014 this host cannot read a DACL at all, ${UNVERIFIED_OWNERSHIP_ENV}=${UNVERIFIED_OWNERSHIP_TOKEN} with ${UNVERIFIED_OWNERSHIP_REASON_ENV} set admits an unreadable one; it never admits a DACL that was read and found shared.`
  );
  console.error("[cave] \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
}
server.listen(port, hostname, () => {
  try {
    publishStandaloneClientV1DiscoveryRecord(loopbackHttpEndpoint(hostname, port));
  } catch (error) {
    reportClientV1DiscoveryUnavailable(error);
  }
  console.log(`> Ready on ${loopbackHttpEndpoint(hostname, port)}`);
});
let httpShutdownStarted = false;
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
const HEAP_MONITOR_ENABLED = process.env.COVEN_CAVE_HEAP_MONITOR !== "0";
const HEAP_MONITOR_INTERVAL_MS = (() => {
  const env = Number.parseInt(process.env.COVEN_CAVE_HEAP_MONITOR_INTERVAL_MS ?? "", 10);
  return Number.isFinite(env) && env > 0 ? env : 3e5;
})();
const HEAP_WARN_RATIO = 0.85;
const HEAP_DEV_RECYCLE_RATIO = 0.9;
const HEAP_SNAPSHOT_RATIO = 0.95;
const DEV_RECYCLE_EXIT_CODE = 75;
const HEAP_SNAPSHOT_KEEP = 2;
let heapSnapshotSeq = 0;
function heapDiagnosticsDir() {
  const covenHome = process.env.COVEN_HOME || join(homedir(), ".coven");
  const caveHome = process.env.COVEN_CAVE_HOME || join(covenHome, "cave");
  return join(caveHome, "diagnostics");
}
const mb = (bytes) => `${Math.round(bytes / (1024 * 1024))}MB`;
function pruneHeapSnapshots(dir) {
  const snapshots = readdirSync(dir).filter((name) => name.startsWith("cave-heap-") && name.endsWith(".heapsnapshot")).sort();
  while (snapshots.length > HEAP_SNAPSHOT_KEEP) {
    const oldest = snapshots.shift();
    try {
      unlinkSync(join(dir, oldest));
    } catch {
    }
  }
}
function startHeapMonitor() {
  if (!HEAP_MONITOR_ENABLED) return;
  let snapshotWritten = false;
  let recycleRequested = false;
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
    if (ratio >= HEAP_DEV_RECYCLE_RATIO && !recycleRequested && process.env.NODE_ENV !== "production" && process.env.COVEN_CAVE_DEV_SUPERVISED === "1" && sessions.size === 0) {
      recycleRequested = true;
      console.warn("[heap-monitor] requesting supervised development restart");
      cleanupStandaloneClientV1Discovery();
      server.close(() => process.exit(DEV_RECYCLE_EXIT_CODE));
      return;
    }
    if (ratio < HEAP_SNAPSHOT_RATIO || snapshotWritten) return;
    try {
      const dir = heapDiagnosticsDir();
      mkdirSync(dir, { recursive: true });
      const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
      const seq = String(heapSnapshotSeq += 1).padStart(3, "0");
      const file = join(dir, `cave-heap-${stamp}-pid${process.pid}-${seq}.heapsnapshot`);
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
