import { execFile, execFileSync } from "node:child_process";
import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
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
  writeFileSync,
} from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { getHeapStatistics, writeHeapSnapshot } from "node:v8";

import next from "next";
import { WebSocket, WebSocketServer, type RawData } from "ws";

const require = createRequire(import.meta.url);
const pty: typeof import("node-pty") = require("node-pty");
const execFileAsync = promisify(execFile);

// Packaged desktop builds (the Tauri sidecar) run this server from inside the
// .app bundle, where next.config.ts is not shipped. The standalone build
// serializes the resolved config into .next/required-server-files.json — hand
// it to Next the same way the generated standalone server.js does, before
// next() resolves config.
if (process.env.COVEN_CAVE_BUNDLE === "1" && !process.env.__NEXT_PRIVATE_STANDALONE_CONFIG) {
  try {
    const requiredServerFiles = JSON.parse(
      readFileSync(new URL(".next/required-server-files.json", import.meta.url), "utf8"),
    ) as { config?: unknown };
    if (requiredServerFiles.config) {
      process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(requiredServerFiles.config);
    }
  } catch {
    // Not fatal — fall through to Next's normal config resolution.
  }
}

// Boot re-arm (cave-os73): a tokenless dev boot outside the packaged bundle
// re-arms COVEN_CAVE_ACCESS_TOKEN from the pairing secret that Settings ·
// Phone (or scripts/mobile-tailscale.sh — same state file) provisioned, so
// paired phones survive dev-server restarts and a still-configured Tailscale
// Serve route stays token-gated. Mirrors src/lib/server/mobile-access-
// provision.ts, inlined because the standalone server.mjs cannot import from
// src/.
// The port contract, inlined for the same reason as everything else in this
// block: `build:server` runs esbuild with `--bundle=false`, so any import here
// must still resolve at runtime from wherever server.mjs is unpacked — and the
// packaged bundle ships server.mjs without scripts/. scripts/ports.mjs is the
// source of truth and scripts/port-contract.test.mjs fails if this copy drifts.
const CAVE_DEV_PORT = 3000;
const CAVE_PRODUCTION_PORT = 3020;

function parseCavePort(raw: string | undefined): number | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535 ? parsed : null;
}

/**
 * COVEN_CAVE_PORT wins over PORT so Cave can be pinned without disturbing a
 * PORT that some parent set for its own reasons — pnpm exports its config to
 * children as env vars, and inheriting one by accident is how the port stopped
 * being dependable before. The packaged bundle takes the production port; a
 * `pnpm dev` server takes the dev port, so the two can run side by side.
 */
function cavePort(): number {
  const channelDefault =
    process.env.COVEN_CAVE_BUNDLE === "1" ? CAVE_PRODUCTION_PORT : CAVE_DEV_PORT;
  return (
    parseCavePort(process.env.COVEN_CAVE_PORT) ??
    parseCavePort(process.env.PORT) ??
    channelDefault
  );
}

function persistedMobileAccessSecretFile(): string {
  // Keyed by the port on purpose (it mirrors scripts/mobile-tailscale.sh), which
  // is precisely why the port had to stop moving: a per-launch port meant a
  // per-launch secret directory, so every desktop restart re-paired every phone.
  const port = String(cavePort());
  const stateRoot =
    process.env.COVEN_CAVE_MOBILE_STATE_ROOT?.trim() ||
    join(
      process.env.XDG_STATE_HOME?.trim() || join(homedir(), ".local", "state"),
      "coven-cave",
    );
  const stateDir =
    process.env.COVEN_CAVE_MOBILE_STATE_DIR?.trim() ||
    join(stateRoot, `mobile-tailscale-${port}`);
  return join(stateDir, "access-token");
}

if (
  process.env.COVEN_CAVE_BUNDLE !== "1" &&
  process.env.COVEN_CAVE_E2E !== "1" &&
  !process.env.COVEN_CAVE_ACCESS_TOKEN?.trim()
) {
  try {
    const persisted = readFileSync(persistedMobileAccessSecretFile(), "utf8").trim();
    if (persisted) process.env.COVEN_CAVE_ACCESS_TOKEN = persisted;
  } catch {
    // No provisioned secret — stay tokenless, exactly as before.
  }
}

// Read lazily, not snapshotted: Settings · Phone can provision and arm the
// pairing secret mid-session (cave-os73), and the PTY upgrade gate must honor
// tokens signed with it without a server restart.
function accessToken(): string {
  return process.env.COVEN_CAVE_ACCESS_TOKEN ?? "";
}
const SIDECAR_TOKEN = process.env.COVEN_CAVE_AUTH_TOKEN ?? "";

const CLIENT_V1_DISCOVERY_FILE = "client-v1-discovery.json";
const CLIENT_V1_DISCOVERY_STARTED_AT = new Date().toISOString();
const CLIENT_V1_AUTHORITY_MODE_ENV =
  "COVEN_CAVE_CLIENT_V1_AUTHORITY_MODE";

type StandaloneClientV1AuthorityMode = "off" | "advertise" | "enforce";

type StandaloneClientV1AuthorityBootstrap = {
  mode: "advertise" | "enforce";
  suite: import("@hpke/core").CipherSuite;
  keyPair: CryptoKeyPair;
  publicKey: Uint8Array;
  keyId: Uint8Array;
  runtimeNonce: Uint8Array;
};

type StandaloneClientV1AuthorityBootstrapState =
  | StandaloneClientV1AuthorityBootstrap
  | {
    mode: "advertise" | "enforce";
    unavailable: true;
  };

function parseStandaloneClientV1AuthorityMode(
  raw: string | undefined,
): StandaloneClientV1AuthorityMode {
  const value = raw?.trim() || "off";
  if (value === "off" || value === "advertise" || value === "enforce") {
    return value;
  }
  throw new Error(
    `${CLIENT_V1_AUTHORITY_MODE_ENV} must be off, advertise, or enforce.`,
  );
}

function standaloneClientV1HpkeKeyId(publicKey: Uint8Array): Uint8Array {
  if (publicKey.byteLength !== 32) {
    throw new Error("Client v1 authority public key length is invalid.");
  }
  return new Uint8Array(
    createHash("sha256")
      .update("OpenCoven/client-v1/hpke-bound-v1/key-id\0", "utf8")
      .update(publicKey)
      .digest(),
  );
}

async function createStandaloneClientV1AuthorityBootstrap(
  mode: "advertise" | "enforce",
): Promise<StandaloneClientV1AuthorityBootstrap> {
  const [
    { Aes256Gcm, CipherSuite, HkdfSha256 },
    { DhkemX25519HkdfSha256 },
  ] = await Promise.all([
    import("@hpke/core"),
    import("@hpke/dhkem-x25519"),
  ]);
  const suite = new CipherSuite({
    kem: new DhkemX25519HkdfSha256(),
    kdf: new HkdfSha256(),
    aead: new Aes256Gcm(),
  });
  const keyPair = await suite.kem.generateKeyPair();
  const publicKey = new Uint8Array(
    await suite.kem.serializePublicKey(keyPair.publicKey),
  );
  return {
    mode,
    suite,
    keyPair,
    publicKey,
    keyId: standaloneClientV1HpkeKeyId(publicKey),
    runtimeNonce: randomBytes(32),
  };
}

const CLIENT_V1_AUTHORITY_MODE =
  parseStandaloneClientV1AuthorityMode(
    process.env.COVEN_CAVE_CLIENT_V1_AUTHORITY_MODE,
  );
let clientV1AuthorityInitializationError: Error | null = null;
let CLIENT_V1_AUTHORITY_BOOTSTRAP:
  | StandaloneClientV1AuthorityBootstrapState
  | undefined;

if (CLIENT_V1_AUTHORITY_MODE !== "off") {
  try {
    CLIENT_V1_AUTHORITY_BOOTSTRAP =
      await createStandaloneClientV1AuthorityBootstrap(
        CLIENT_V1_AUTHORITY_MODE,
      );
  } catch {
    clientV1AuthorityInitializationError = new Error(
      "Client v1 HPKE authority initialization failed.",
    );
    CLIENT_V1_AUTHORITY_BOOTSTRAP = {
      mode: CLIENT_V1_AUTHORITY_MODE,
      unavailable: true,
    };
  }
}

globalThis.__covenCaveClientV1AuthorityBootstrap =
  CLIENT_V1_AUTHORITY_BOOTSTRAP;

const CLIENT_V1_DISCOVERY_NONCE =
  CLIENT_V1_AUTHORITY_BOOTSTRAP
  && !("unavailable" in CLIENT_V1_AUTHORITY_BOOTSTRAP)
    ? Buffer.from(
        CLIENT_V1_AUTHORITY_BOOTSTRAP.runtimeNonce,
      ).toString("base64url")
    : randomUUID();
let clientV1DiscoveryPublished = false;

function standaloneCaveHome(): string {
  const covenHome = process.env.COVEN_HOME || join(homedir(), ".coven");
  return resolve(process.env.COVEN_CAVE_HOME || join(covenHome, "cave"));
}

function clientV1DiscoveryFile(): string {
  return join(standaloneCaveHome(), CLIENT_V1_DISCOVERY_FILE);
}

// Windows ownership, inlined for the same reason as everything else in this
// block: `build:server` runs esbuild with `--bundle=false`, so server.mjs
// cannot import src/lib/server/client-v1/path-ownership.ts. That module is the
// authority; the PowerShell below is a verbatim copy of its script and
// discovery.test.ts fails if the two ever drift.
const WINDOWS_SYSTEM_SID = "S-1-5-18";
const WINDOWS_ADMINISTRATORS_SID = "S-1-5-32-544";

// The unverified-ownership waiver, inlined from path-ownership.ts for the same
// reason as the script below. See that module for why it is shaped this way;
// discovery.test.ts pins every part of it byte-for-byte, because a copy that
// drifts is a copy that opts out on terms the module never agreed to.
const UNVERIFIED_OWNERSHIP_ENV = "COVEN_CAVE_UNVERIFIED_PATH_OWNERSHIP";
const UNVERIFIED_OWNERSHIP_REASON_ENV = "COVEN_CAVE_UNVERIFIED_PATH_OWNERSHIP_REASON";
const UNVERIFIED_OWNERSHIP_TOKEN = "i-accept-unverified-path-ownership";
const UNVERIFIED_OWNERSHIP_MIN_REASON = 12;

type UnverifiedOwnershipWaiver =
  | { granted: true; reason: string }
  | { granted: false; note: string };

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

function unverifiableOwnershipRefusal(
  subject: string,
  path: string,
  cause: Error,
  note: string,
): string {
  return `${subject} ownership could not be verified on Windows: ${cause.message}. `
    + `Refusing ${path}; inspect it with: icacls "${path}". ${note}`;
}

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

const standaloneVerifiedWindowsPaths = new Set<string>();
// Paths admitted UNVERIFIED under the operator's waiver. Separate from the set
// above because nothing here was verified — and cached for the same reason the
// module caches it: on a host where the probe can never answer, re-driving it
// would fork a doomed subprocess per request and repeat a disclosure nobody
// would then read.
const standaloneWaivedWindowsPaths = new Set<string>();

function assertStandaloneWindowsExclusive(path: string, label: string): void {
  if (standaloneVerifiedWindowsPaths.has(path)) return;
  if (standaloneWaivedWindowsPaths.has(path)) return;
  const subject = `Client v1 discovery ${label}`;
  const waiver = resolveUnverifiedOwnershipWaiver(process.env);
  const systemRoot = process.env.SystemRoot || process.env.windir || "C:\\Windows";
  // The smallest environment PowerShell needs, never this server's own: it
  // holds COVEN_CAVE_ACCESS_TOKEN and COVEN_CAVE_AUTH_TOKEN, and a subprocess
  // that only has to read a DACL has no business receiving them. Same rule
  // sanitizedEnv() enforces for PTY shells. The path under test travels here
  // too, so no quoting rule stands between a path containing a quote and the
  // identity being checked.
  const probeEnv: NodeJS.ProcessEnv = {
    COVEN_CAVE_CLIENT_V1_ACL_PATH: path,
    // Next augments ProcessEnv to require this. It carries no secret.
    NODE_ENV: process.env.NODE_ENV,
    SystemRoot: systemRoot,
    windir: systemRoot,
    PATH: join(systemRoot, "System32"),
    PATHEXT: process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD",
    TEMP: process.env.TEMP || process.env.TMP || join(systemRoot, "Temp"),
    TMP: process.env.TMP || process.env.TEMP || join(systemRoot, "Temp"),
  };
  let report: {
    self: string;
    owner: string;
    protected: boolean;
    repaired: boolean;
    removed: string[];
    aces: { sid: string; type: string }[];
  };
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
        WINDOWS_ACL_SCRIPT,
      ],
      {
        env: probeEnv,
        encoding: "utf8",
        windowsHide: true,
        timeout: 60_000,
        maxBuffer: 1024 * 1024,
      },
    ));
    // `aces` carries the whole access decision, so a shape this cannot read has
    // to be an error rather than a default: an absent or non-array `aces` reads
    // downstream as "no principal has access" and would therefore admit the
    // path. Same contract as parseClientV1WindowsAclReport in the module.
    if (
      !report
      || typeof report !== "object"
      || typeof report.self !== "string"
      || !report.self
      || typeof report.owner !== "string"
      || !report.owner
      || typeof report.protected !== "boolean"
      || typeof report.repaired !== "boolean"
      || !Array.isArray(report.aces)
      || !Array.isArray(report.removed)
    ) {
      throw new Error("the ACL probe returned a malformed report");
    }
  } catch (cause) {
    // The ONE condition the waiver covers: the host cannot answer the
    // question. Everything below this point had an answer.
    if (!waiver.granted) {
      throw new Error(
        unverifiableOwnershipRefusal(subject, path, cause as Error, waiver.note),
        { cause },
      );
    }
    standaloneWaivedWindowsPaths.add(path);
    console.warn(
      unverifiedOwnershipDisclosure(subject, path, cause as Error, waiver.reason),
    );
    return;
  }

  const trusted = new Set([report.self, WINDOWS_SYSTEM_SID, WINDOWS_ADMINISTRATORS_SID]);
  const findings: string[] = [];
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
  if (findings.length > 0) {
    throw new Error(sharedOwnershipRefusal(subject, path, findings, waiver));
  }
  if (report.repaired) {
    console.warn(
      `${subject} had no enforced access control on Windows; `
      + `restricted ${path} to the current user and revoked `
      + `${report.removed.length > 0 ? report.removed.join(", ") : "inherited entries"}.`,
    );
  }
  standaloneVerifiedWindowsPaths.add(path);
}

function requireStandaloneOwner(
  path: string,
  metadata: NonNullable<ReturnType<typeof lstatSync>>,
  label: string,
): void {
  // The uid comparison alone was inert on win32 — `process.getuid` is undefined
  // there and `lstat` reports uid 0 for every path — so the discovery record
  // that points a client at this server had no enforced owner at all. Anything
  // that can answer neither question is refused rather than waved through.
  if (typeof process.getuid === "function") {
    if (metadata.uid !== process.getuid()) {
      throw new Error(`Client v1 discovery ${label} must be owned by the current user.`);
    }
    return;
  }
  if (process.platform !== "win32") {
    throw new Error(
      `Client v1 discovery ${label} ownership cannot be verified on ${process.platform}: `
      + `this platform exposes neither a uid nor a Windows ACL, so ${path} is refused.`,
    );
  }
  assertStandaloneWindowsExclusive(path, label);
}

function assertStandaloneDiscoveryTarget(path: string): void {
  try {
    const metadata = lstatSync(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error(`Client v1 discovery target must be a regular file: ${path}.`);
    }
    requireStandaloneOwner(path, metadata, "target");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
}

function publishStandaloneClientV1DiscoveryRecord(endpoint: string): void {
  const root = join(clientV1DiscoveryFile(), "..");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const rootMetadata = lstatSync(root);
  if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) {
    throw new Error("Client v1 discovery root must be a real directory.");
  }
  requireStandaloneOwner(root, rootMetadata, "root");
  const physicalRoot = realpathSync(root);
  if (physicalRoot !== root) {
    throw new Error("Client v1 discovery root must not resolve through a symlink.");
  }
  chmodSync(root, 0o700);

  const url = new URL(endpoint);
  const loopback = url.hostname === "127.0.0.1"
    || url.hostname === "localhost"
    || url.hostname === "[::1]";
  if (
    url.protocol !== "http:"
    || !loopback
    || !url.port
    || url.username
    || url.password
    || url.pathname !== "/"
    || url.search
    || url.hash
    || /%(?:2f|5c)/i.test(endpoint)
  ) {
    throw new Error("Client v1 discovery endpoint must be a path-free loopback HTTP URL.");
  }

  const path = clientV1DiscoveryFile();
  assertStandaloneDiscoveryTarget(path);
  let record:
    | {
      version: 1;
      endpoint: string;
      pid: number;
      nonce: string;
      startedAt: string;
    }
    | {
      version: 2;
      endpoint: string;
      pid: number;
      nonce: string;
      startedAt: string;
      authority: {
        mechanism: "hpke-bound-v1";
        mode: "advertise" | "enforce";
        keyId: string;
        publicKey: string;
        suite: { kemId: 32; kdfId: 1; aeadId: 2 };
      };
    };
  if (CLIENT_V1_AUTHORITY_MODE === "off") {
    record = {
      version: 1,
      endpoint,
      pid: process.pid,
      nonce: CLIENT_V1_DISCOVERY_NONCE,
      startedAt: CLIENT_V1_DISCOVERY_STARTED_AT,
    };
  } else {
    if (CLIENT_V1_AUTHORITY_BOOTSTRAP === undefined) {
      throw new Error("Client v1 HPKE authority initialization failed.");
    }
    if ("unavailable" in CLIENT_V1_AUTHORITY_BOOTSTRAP) {
      throw clientV1AuthorityInitializationError
        ?? new Error("Client v1 HPKE authority initialization failed.");
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
        suite: { kemId: 32, kdfId: 1, aeadId: 2 },
      },
    };
  }
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let fd: number | null = null;
  let ownsTemporaryPath = false;
  try {
    fd = openSync(temporaryPath, "wx", 0o600);
    ownsTemporaryPath = true;
    writeFileSync(fd, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    assertStandaloneDiscoveryTarget(path);
    renameSync(temporaryPath, path);
    ownsTemporaryPath = false;
    chmodSync(path, 0o600);
    clientV1DiscoveryPublished = true;
  } catch (error) {
    if (fd !== null) closeSync(fd);
    if (ownsTemporaryPath) rmSync(temporaryPath, { force: true });
    throw error;
  }
}

function removeStandaloneClientV1DiscoveryRecord(nonce: string): boolean {
  const path = clientV1DiscoveryFile();
  let before: ReturnType<typeof lstatSync>;
  let parsed: unknown;
  try {
    before = lstatSync(path);
    if (!before.isFile() || before.isSymbolicLink()) return false;
    requireStandaloneOwner(path, before, "target");
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    if (error instanceof SyntaxError) return false;
    throw error;
  }
  if (
    !parsed
    || typeof parsed !== "object"
    || Array.isArray(parsed)
    || (parsed as { nonce?: unknown }).nonce !== nonce
  ) {
    return false;
  }
  const current = lstatSync(path);
  if (
    !current.isFile()
    || current.isSymbolicLink()
    || current.dev !== before.dev
    || current.ino !== before.ino
  ) {
    return false;
  }
  unlinkSync(path);
  clientV1DiscoveryPublished = false;
  return true;
}

function cleanupStandaloneClientV1Discovery(): void {
  if (!clientV1DiscoveryPublished) return;
  // This runs first inside the SIGINT/SIGTERM handler, so a throw here escapes
  // the signal handler and kills the process before `terminatePtySessions()`
  // and `server.close()` — stranding PTY children and leaving behind the very
  // record this function exists to remove. The owner guard could not throw on
  // win32 before it learned to read a DACL; now it can, and it does so by
  // spawning a subprocess at the exact moment the OS is tearing the session
  // down. Refusing to unlink a record we cannot verify is still correct — but
  // it is a reason to skip the unlink, never a reason to abort the shutdown.
  try {
    removeStandaloneClientV1DiscoveryRecord(CLIENT_V1_DISCOVERY_NONCE);
  } catch (error) {
    console.error("[cave] failed to remove client-v1 discovery record", error);
  }
}

// Local-peer stamp (cave-vn2r): only this file sees the raw TCP socket, so
// only it can prove a request truly came from this machine. Requests whose
// peer is loopback AND that carry no forwarding markers get LOCAL_PEER_HEADER
// stamped with a per-boot random secret; proxy.ts exempts exact matches from
// the mobile access-token gate. The secret is minted fresh every boot and
// deliberately OVERWRITES any inherited env value, so nothing outside this
// process can pre-arrange a passing stamp. Mirrors LOCAL_PEER_HEADER in
// src/proxy-helpers.ts (this file cannot import from src/).
const LOCAL_PEER_HEADER = "x-coven-cave-local-peer";
const LOCAL_PEER_SECRET = randomUUID();
process.env.COVEN_CAVE_LOCAL_PEER_SECRET = LOCAL_PEER_SECRET;
// `tailscale serve` (the paired-phone path) forwards over loopback but always
// adds forwarding headers — their presence means the true peer is remote.
const FORWARDING_HEADERS = [
  "forwarded",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "via",
] as const;

const ACCESS_COOKIE = "coven_cave_access";
const LEGACY_ACCESS_COOKIE = "coven_access_token";
const PRESENCE_COOKIE = "coven_passkey_presence";
const ACCESS_QUERY_PARAM = "coven_access_token";
const SIDECAR_QUERY_PARAM = "covenCaveToken";

type PtySession = {
  pty: import("node-pty").IPty;
  /** Currently-attached socket; null while detached (client dropped). */
  ws: WebSocket | null;
  /** Bounded ring of recent output, replayed on (re)attach so a returning
   *  client repaints the screen instead of staring at a blank pane. */
  scrollback: Buffer[];
  scrollbackBytes: number;
  /** Absolute byte cursor at the front of the retained scrollback ring. */
  scrollbackStart: number;
  /** Absolute cursor immediately after the newest PTY byte. */
  streamEnd: number;
  /** Coalesced output waiting for one bounded WebSocket frame. */
  pendingOutput: Buffer[];
  pendingOutputBytes: number;
  flushTimer: NodeJS.Timeout | null;
  /** Pending kill while detached — cleared when a client reattaches. */
  detachTimer: NodeJS.Timeout | null;
};

const sessions = new Map<string, PtySession>();
const PACKAGED_CHILD_SHUTDOWN_BUDGET_MS = 1_200;

function terminatePtySessions(): void {
  for (const session of sessions.values()) {
    try {
      session.pty.kill();
    } catch {
      // The PTY may already have exited.
    }
  }
  sessions.clear();
}

// Packaged Unix sidecars receive stdin as a private pipe whose write end is
// owned only by the Tauri GUI. EOF therefore identifies the exact parent
// lifetime without polling a reusable PID. The sidecar is also launched as
// its own process-group leader, so one signal removes the root and ordinary
// descendants; node-pty sessions are asked to stop explicitly because a PTY
// may create a separate session/process group.
async function terminatePackagedUnixSidecarTree(): Promise<void> {
  // PTYs may own sessions/groups outside the server group. Stop them before
  // awaiting any JavaScript cleanup, and repeat in finally so an exception or
  // hung persistence path can never skip this OS boundary.
  terminatePtySessions();
  try {
    const terminateDirectRuns = globalThis.__covenCaveTerminateCopilotFlowRuns;
    if (terminateDirectRuns) {
      await Promise.race([
        terminateDirectRuns(),
        new Promise<never>((_resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error("direct Copilot shutdown exceeded its native parent lease")),
            PACKAGED_CHILD_SHUTDOWN_BUDGET_MS,
          );
          timer.unref?.();
        }),
      ]);
    }
  } catch (error) {
    // Direct runs are each owned by a native supervisor whose stdin closes when
    // this server dies. Report the failed graceful proof, then let that exact
    // EOF/Job boundary finish cleanup instead of waiting past Tauri's lease.
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

if (
  process.platform !== "win32" &&
  process.env.COVEN_CAVE_PARENT_WATCHDOG === "stdin-eof"
) {
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

// Recent-output ring replayed to a (re)attaching client so it repaints the
// screen instead of staring at a blank pane. Matches the Rust desktop PTY's
// 256KB ring (src-tauri/src/pty.rs).
const SCROLLBACK_LIMIT_BYTES = 256 * 1024;
// PTYs often emit a write-sized chunk for every line. Coalesce a short burst
// before framing it, but cap the userland queue and every individual frame.
const PTY_FRAME_COALESCE_MS = 8;
const PTY_FRAME_MAX_BYTES = 16 * 1024;
// `ws` otherwise retains arbitrary output for a client whose TCP receive
// window stopped advancing. This is deliberately larger than one legacy
// scrollback replay, so a healthy reattach is never evicted for the replay.
const PTY_WS_BUFFERED_AMOUNT_LIMIT = 512 * 1024;
const PTY_SLOW_CONSUMER_CLOSE_CODE = 1013;
const PTY_SLOW_CONSUMER_CLOSE_REASON = "slow terminal consumer; reconnect";
// How long a shell survives after its socket drops before being reaped. A
// terminal pane remounts whenever the Comux layout restructures (split,
// drag-reorganize, tab switch) or the page reloads; killing the shell the
// instant the old socket closes turned every one of those into a dead/blank
// pane with a brand-new shell. Detach instead of kill, and let the timer reap
// only genuinely-abandoned shells. The default is sized for the iOS app too:
// backgrounding the phone kills its socket, and a 60s window meant stepping
// away for two minutes came back to a dead shell — 5 minutes keeps a quick
// app-switch/lock survivable while still bounding abandoned shells.
const DETACH_GRACE_MS = (() => {
  const env = Number.parseInt(process.env.COVEN_CAVE_PTY_DETACH_GRACE_MS ?? "", 10);
  return Number.isFinite(env) && env > 0 ? env : 300_000;
})();

function appendScrollback(session: PtySession, data: Buffer): void {
  const nextEnd = session.streamEnd + data.length;
  // Retain the tail even if one node-pty callback is larger than the entire
  // ring. The old `length > 1` loop kept that one large callback forever.
  if (data.length >= SCROLLBACK_LIMIT_BYTES) {
    // `subarray` alone would retain the oversized callback's entire backing
    // allocation. Copy the bounded tail so retained memory matches the ring.
    session.scrollback = [Buffer.from(data.subarray(data.length - SCROLLBACK_LIMIT_BYTES))];
    session.scrollbackBytes = SCROLLBACK_LIMIT_BYTES;
    session.scrollbackStart = nextEnd - SCROLLBACK_LIMIT_BYTES;
    session.streamEnd = nextEnd;
    return;
  }

  session.scrollback.push(data);
  session.scrollbackBytes += data.length;
  session.streamEnd = nextEnd;
  while (
    session.scrollbackBytes > SCROLLBACK_LIMIT_BYTES &&
    session.scrollback.length > 1
  ) {
    const dropped = session.scrollback.shift();
    if (dropped) {
      session.scrollbackBytes -= dropped.length;
      session.scrollbackStart += dropped.length;
    }
  }
}

/** Return retained output beginning at an absolute stream cursor. */
function scrollbackFrom(session: PtySession, cursor: number): Buffer[] {
  const output: Buffer[] = [];
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

function parseCookies(header: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!header) return map;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (!key) continue;
    try {
      map.set(key, decodeURIComponent(rest.join("=")));
    } catch {
      // Leave malformed percent-encoded values out of the map.
    }
  }
  return map;
}

function getTokensFromCookie(header: string | undefined): string[] {
  const cookies = parseCookies(header);
  const tokens: string[] = [];
  for (const name of [ACCESS_COOKIE, LEGACY_ACCESS_COOKIE]) {
    const value = cookies.get(name);
    if (value !== undefined) tokens.push(value);
  }
  return tokens;
}

function getCookie(header: string | undefined, name: string): string | null {
  return parseCookies(header).get(name) ?? null;
}

function timingSafeEqualString(a: string, b: string): boolean {
  const aBytes = Buffer.from(a);
  const bBytes = Buffer.from(b);
  if (aBytes.length !== bBytes.length) return false;

  let diff = 0;
  for (let i = 0; i < aBytes.length; i += 1) {
    diff |= aBytes[i] ^ bBytes[i];
  }
  return diff === 0;
}

function isExpectedAccessToken(value: string | undefined | null): boolean {
  const secret = accessToken();
  if (!secret || !value) return false;
  if (timingSafeEqualString(value, secret)) return true;
  return isValidSignedAccessToken(value, secret);
}

function isExpectedSidecarToken(value: string | undefined | null): boolean {
  return Boolean(SIDECAR_TOKEN && value && timingSafeEqualString(value, SIDECAR_TOKEN));
}

function isExpectedPtyToken(value: string | undefined | null): boolean {
  return isExpectedAccessToken(value) || isExpectedSidecarToken(value);
}

// Mirrors src/lib/mobile-access-token.ts (server.mjs is transpiled standalone,
// so it can't import from src/): `v1.<expiresAtMs>.<nonce>.<sig>` where
// sig = base64url(HMAC-SHA256(secret, "v1.<expiresAtMs>.<nonce>")). Paired
// phones and QR-paired browsers hold these SIGNED tokens — not the raw secret
// — so the PTY upgrade must honour them or every paired terminal 401s.
function isValidSignedAccessToken(value: string, secret: string): boolean {
  const parts = value.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return false;
  const expiresAt = Number(parts[1]);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false;
  if (!parts[2] || !parts[3]) return false;
  const expected = createHmac("sha256", secret)
    .update(`v1.${parts[1]}.${parts[2]}`)
    .digest("base64url");
  return timingSafeEqualString(parts[3], expected);
}

// Mirrors src/lib/passkey-presence.ts. server.mjs is emitted without bundling,
// so this entrypoint cannot import from src/ at runtime.
function hasValidPasskeyPresence(req: IncomingMessage, tailnetNodeId: string | null): boolean {
  if (!tailnetNodeId) return false;
  const secret = process.env.COVEN_CAVE_PASSKEY_SESSION_SECRET;
  const token = getCookie(req.headers.cookie, PRESENCE_COOKIE);
  if (!secret || !token) return false;

  const parts = token.split(".");
  if (parts.length !== 6 || parts[0] !== "v1") return false;
  const expiresAt = Number(parts[1]);
  const field = /^[A-Za-z0-9_-]+$/;
  if (
    !Number.isFinite(expiresAt) ||
    expiresAt <= 0 ||
    !field.test(parts[2]) ||
    !field.test(parts[3]) ||
    !parts[4] ||
    !parts[5]
  ) {
    return false;
  }
  const body = parts.slice(0, 5).join(".");
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  return (
    timingSafeEqualString(parts[5], expected) &&
    expiresAt > Date.now() &&
    parts[2] === tailnetNodeId
  );
}

function bearerToken(req: IncomingMessage): string | null {
  const auth = req.headers.authorization ?? "";
  return auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : null;
}

function isLoopbackHost(host: string | null | undefined): boolean {
  if (!host) return false;
  const hostname = host.startsWith("[") ? host.slice(1, host.indexOf("]")) : host.split(":")[0];
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}

function isLoopbackAddress(value: string | undefined): boolean {
  if (!value) return false;
  if (value === "::1" || value === "127.0.0.1") return true;
  if (value.startsWith("::ffff:")) return value.slice("::ffff:".length) === "127.0.0.1";
  return false;
}

/**
 * True for a Tailscale CGNAT address: 100.64.0.0/10 (v4) or the fd7a:115c:a1e0::/48
 * ULA range (v6). Mirrors isTailscaleIpHost in src/proxy-helpers.ts.
 */
function isTailscaleAddress(value: string): boolean {
  const address = value.startsWith("::ffff:") ? value.slice("::ffff:".length) : value;
  if (address.includes(".")) {
    const parts = address.split(".").map((part) => Number(part));
    return (
      parts.length === 4 &&
      parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) &&
      parts[0] === 100 &&
      parts[1] >= 64 &&
      parts[1] <= 127
    );
  }
  return address.toLowerCase().startsWith("fd7a:115c:a1e0:");
}

/**
 * Normalizes an x-forwarded-for hop into a bare address: strips IPv6 brackets
 * and any `:port` suffix, and unwraps IPv4-mapped IPv6.
 */
function normalizeForwardedAddress(value: string): string {
  let address = value.trim();
  if (address.startsWith("[")) {
    const close = address.indexOf("]");
    if (close > 0) return address.slice(1, close).toLowerCase();
  }
  // A bare IPv6 literal contains multiple colons and carries no port here; only
  // strip a trailing :port from IPv4 (or bracket-less host:port) forms.
  if ((address.match(/:/g) ?? []).length === 1) address = address.split(":")[0];
  if (address.startsWith("::ffff:")) address = address.slice("::ffff:".length);
  return address.toLowerCase();
}

// Tailnet identity gate (cave-zm6pn). Remote (phone) access is authorized by
// per-device Tailscale identity rather than a shared bearer secret. Only stable
// node IDs named in COVEN_CAVE_TAILNET_ALLOWED_NODES are admitted; an empty
// allowlist disables the feature entirely (fail closed — no allowlist, no
// tailnet access).
//
// Why x-forwarded-for is trustworthy HERE specifically: the TCP peer must
// already be loopback, because `tailscale serve` terminates TLS and forwards to
// 127.0.0.1. A local process able to forge this header could instead connect
// directly to loopback, which grants strictly MORE authority (full local-peer
// trust via isDirectLoopbackRequest). So reading it adds no new exposure while
// upgrading remote auth from a shared secret to WireGuard-backed device
// identity.
const TAILNET_PEER_HEADER = "x-coven-cave-tailnet-peer";
const TAILNET_PEER_SECRET = randomUUID();
process.env.COVEN_CAVE_TAILNET_PEER_SECRET = TAILNET_PEER_SECRET;
const TAILNET_STATUS_REFRESH_MS = 30_000;

// Passkey presence (cave-brksh). A verified WebAuthn assertion proves a human
// authenticated on the device just now; this per-boot secret is what carries
// that fact from the assert route to the proxy on subsequent requests. Minted
// here for the same reason as the two secrets above — the value never leaves
// the process, and a restart invalidating every outstanding presence token is
// the desired behavior rather than a limitation.
process.env.COVEN_CAVE_PASSKEY_SESSION_SECRET = randomUUID();

function allowedTailnetNodeIds(): Set<string> {
  const raw = process.env.COVEN_CAVE_TAILNET_ALLOWED_NODES ?? "";
  return new Set(
    raw
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  );
}

/**
 * address -> stable node ID, for allowlisted peers only. Refreshed off a
 * `tailscale status --json` poll rather than resolved per request: the request
 * handler below is synchronous and a per-request subprocess would add tens of
 * milliseconds to every request. A stale entry can only ever name a node that
 * was allowlisted anyway, and the refresh interval bounds how long a revoked
 * device keeps working.
 */
let tailnetPeerAddresses = new Map<string, string>();
let tailnetRefreshInFlight = false;

async function refreshTailnetPeers(): Promise<void> {
  const allowed = allowedTailnetNodeIds();
  if (allowed.size === 0) {
    tailnetPeerAddresses = new Map();
    return;
  }
  if (tailnetRefreshInFlight) return;
  tailnetRefreshInFlight = true;
  try {
    const { stdout } = await execFileAsync(
      process.env.COVEN_CAVE_TAILSCALE_BIN ?? "tailscale",
      ["status", "--json"],
      { timeout: 10_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
    );
    const status = JSON.parse(stdout) as {
      Peer?: Record<string, { ID?: string; TailscaleIPs?: string[] }>;
    };
    const next = new Map<string, string>();
    for (const peer of Object.values(status.Peer ?? {})) {
      const nodeId = peer.ID;
      if (!nodeId || !allowed.has(nodeId)) continue;
      for (const ip of peer.TailscaleIPs ?? []) {
        next.set(normalizeForwardedAddress(ip), nodeId);
      }
    }
    tailnetPeerAddresses = next;
  } catch (err) {
    // Fail closed: an unreadable tailnet status must never leave a previously
    // built allowlist standing, or a revoked device would keep its access for
    // as long as `tailscale` stayed broken.
    tailnetPeerAddresses = new Map();
    console.warn("[cave] tailnet peer refresh failed:", (err as Error)?.message ?? err);
  } finally {
    tailnetRefreshInFlight = false;
  }
}

/**
 * The allowlisted stable node ID behind a Tailscale-Serve-forwarded request, or
 * null. Requires a loopback TCP peer (Serve always forwards over loopback) and
 * a forwarded-for hop that is both a Tailscale CGNAT address and currently
 * mapped to an allowlisted node.
 */
function resolveTailnetPeer(req: IncomingMessage): string | null {
  if (tailnetPeerAddresses.size === 0) return null;
  if (!isLoopbackAddress(req.socket.remoteAddress)) return null;
  const forwarded = req.headers["x-forwarded-for"];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0];
  if (!first) return null;
  const address = normalizeForwardedAddress(first);
  if (!isTailscaleAddress(address)) return null;
  return tailnetPeerAddresses.get(address) ?? null;
}

/**
 * A request that provably originated on this machine: the TCP peer is
 * loopback (non-spoofable — read off the socket), no proxy forwarded it
 * (Tailscale Serve delivers remote phones over loopback but always adds
 * forwarding headers the remote client cannot strip), and the Host is a
 * loopback authority (a Serve route that forwards the ts.net Host fails this
 * even if its forwarding headers were ever absent). Deliberately redundant:
 * both the forwarding-marker and Host checks must fail for a forwarded
 * request to be misclassified as local.
 */
function isDirectLoopbackRequest(req: IncomingMessage): boolean {
  if (!isLoopbackAddress(req.socket.remoteAddress)) return false;
  for (const header of FORWARDING_HEADERS) {
    if (req.headers[header] !== undefined) return false;
  }
  return isLoopbackHost(req.headers.host);
}

function sameOrigin(value: string | undefined, expectedOrigin: string): boolean {
  if (!value) return true;
  try {
    const url = new URL(value);
    if (url.origin === expectedOrigin) return true;

    const expected = new URL(expectedOrigin);
    // Scheme-agnostic host match: `tailscale serve` terminates TLS upstream,
    // so a browser page served over https://<host>.ts.net opens its terminal
    // socket with Origin https://… while the expectation string here is built
    // as http://<Host>. The host (incl. port) equality is the actual
    // cross-site defence — a hostile page cannot declare this host as its
    // Origin — so the scheme difference must not 403 the upgrade.
    if (url.host === expected.host) return true;
    return (
      url.protocol === expected.protocol &&
      url.port === expected.port &&
      isLoopbackHost(url.host) &&
      isLoopbackHost(expected.host)
    );
  } catch {
    return false;
  }
}

function isAllowedUpgradeSource(req: IncomingMessage, tokenAuthenticated = false): boolean {
  const host = req.headers.host;
  // The peer must always be loopback: `tailscale serve` terminates TLS and
  // forwards to 127.0.0.1, so a legitimate tailnet client still arrives over
  // loopback. A non-loopback peer is a direct LAN/WAN connection — never trust.
  if (!isLoopbackAddress(req.socket.remoteAddress)) return false;
  if (!isLoopbackHost(host)) {
    // A meaningful same-origin/host gate needs a Host header; fail closed on
    // malformed upgrade requests instead of letting them ride a relaxation.
    if (!host) return false;
    // The only way a non-loopback Host is legitimate is a token-authenticated
    // upgrade (paired iOS app / handoff browser holding a signed access token)
    // arriving via `tailscale serve`, which forwards the request's
    // `<host>.ts.net` Host, NOT 127.0.0.1: the credential proves the caller,
    // exactly like proxy.ts's isAllowedApiHost(mobileAccessAuthenticated)
    // relaxation on REST. Without this, a paired phone's terminal 403s at the
    // host gate while every REST call works (the "terminal tab never
    // connects" bug). The sameOrigin gate below still blocks cross-site
    // browser upgrades. Tailnet membership alone is NOT authorization:
    // credential-less upgrades remain loopback-host only.
    if (tokenAuthenticated) return sameOrigin(req.headers.origin, `http://${host}`);
    return false;
  }
  return sameOrigin(req.headers.origin, `http://${host}`);
}

function firstQueryValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** `-1` is a capability probe: cursor-aware clients use it on their first
 * attach, then send the last delivered absolute byte cursor on reconnect.
 * Absence remains the legacy full-replay protocol. */
function parsePtyReplayCursor(value: string | string[] | undefined): number | undefined | null {
  const raw = firstQueryValue(value);
  if (raw === undefined) return undefined;
  if (raw === "-1") return -1;
  if (!/^(?:0|[1-9]\d*)$/.test(raw)) return null;
  const cursor = Number(raw);
  return Number.isSafeInteger(cursor) ? cursor : null;
}

type UpgradeQuery = Record<string, string | string[] | undefined>;

const UPGRADE_URL_BASE = "http://localhost";
const MAX_UPGRADE_QUERY_SEGMENTS = 1_000;
const ABSOLUTE_FORM_RE = /^[a-z][a-z\d+.-]*:\/\//i;

function boundedUpgradeQuery(suffix: string): string {
  if (!suffix.startsWith("?")) return "";

  const fragmentStart = suffix.indexOf("#", 1);
  const rawQuery = suffix.slice(1, fragmentStart === -1 ? undefined : fragmentStart);
  let segmentCount = 1;
  for (let index = 0; index < rawQuery.length; index += 1) {
    if (rawQuery[index] !== "&") continue;
    if (segmentCount >= MAX_UPGRADE_QUERY_SEGMENTS) return rawQuery.slice(0, index);
    segmentCount += 1;
  }
  return rawQuery;
}

function parseUpgradeTarget(rawUrl: string): { pathname: string; query: UpgradeQuery } {
  const pathEnd = rawUrl.search(/[?#]/);
  const rawPath = pathEnd === -1 ? rawUrl : rawUrl.slice(0, pathEnd);
  const suffix = pathEnd === -1 ? "" : rawUrl.slice(pathEnd);
  const normalizedPath = rawPath.replaceAll("\\", "/");
  const absoluteForm = ABSOLUTE_FORM_RE.exec(normalizedPath);

  // Prefix relative and origin-form targets with `/.` so WHATWG parsing cannot
  // reinterpret a leading `//` as an authority. The raw request remains
  // untouched when a valid non-PTY upgrade is forwarded to Next.
  const rootedPath = normalizedPath.startsWith("/") ? normalizedPath : `/${normalizedPath}`;
  const parsedUrl = absoluteForm
    ? new URL(normalizedPath)
    : new URL(`/.${rootedPath}`, UPGRADE_URL_BASE);

  // Bound the raw `&`-separated segments before URLSearchParams sees them.
  // querystring.parse() counts empty segments toward maxKeys, while iterating
  // URLSearchParams alone would skip them and parse the entire query first.
  parsedUrl.search = `?${boundedUpgradeQuery(suffix)}`;

  // WHATWG URL canonicalizes dot segments. Route against the pre-canonical
  // path so unusual request targets cannot broaden into /api/pty-ws. For a
  // standard absolute-form target, strip only its scheme and authority.
  let pathname = normalizedPath;
  if (absoluteForm) {
    const pathStart = normalizedPath.indexOf("/", absoluteForm[0].length);
    pathname = pathStart === -1 ? "/" : normalizedPath.slice(pathStart);
  }

  // node:querystring, used by url.parse(..., true), returns a null-prototype
  // object and processes at most 1,000 segments by default. Preserve both
  // details while retaining first-value and duplicate ordering semantics.
  const query: UpgradeQuery = Object.create(null);
  for (const [key, value] of parsedUrl.searchParams) {
    const current = query[key];
    if (current === undefined) query[key] = value;
    else if (Array.isArray(current)) current.push(value);
    else query[key] = [current, value];
  }

  return { pathname, query };
}

function isPtyAuthRequired(): boolean {
  return Boolean(accessToken() || SIDECAR_TOKEN);
}

function shouldRejectUnauthenticatedPtyUpgrade({
  sidecarTokenConfigured = false,
  accessTokenConfigured = false,
  tokenAuthenticated = false,
  directLoopback = false,
} = {}) {
  if (tokenAuthenticated || directLoopback) return false;
  return sidecarTokenConfigured || accessTokenConfigured;
}

function isAuthorized(req: IncomingMessage, query: Record<string, string | string[] | undefined>): boolean {
  if (!isPtyAuthRequired()) return false;

  const queryToken = firstQueryValue(query[ACCESS_QUERY_PARAM]);
  const sidecarQueryToken = firstQueryValue(query[SIDECAR_QUERY_PARAM]);
  const candidates = [bearerToken(req), queryToken, sidecarQueryToken, ...getTokensFromCookie(req.headers.cookie)];
  return candidates.some(isExpectedPtyToken);
}

function defaultShell(): string {
  if (process.platform === "darwin") return "/bin/zsh";
  if (process.platform === "win32") {
    return "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
  }
  return process.env.SHELL ?? "/bin/bash";
}

function defaultShellArgs(): string[] {
  if (process.platform === "win32") return ["-NoLogo"];
  return ["-l"];
}

function augmentedPath(): string {
  const inherited = process.env.PATH ?? "";
  const sep = process.platform === "win32" ? ";" : ":";
  const extras =
    process.platform === "win32"
      ? [
          "C:\\Windows\\System32",
          "C:\\Windows",
          "C:\\Program Files\\Git\\cmd",
          "C:\\Program Files\\nodejs",
        ]
      : [
          "/opt/homebrew/bin",
          "/opt/homebrew/sbin",
          "/usr/local/bin",
          "/usr/local/sbin",
          "/usr/bin",
          "/bin",
          "/usr/sbin",
          "/sbin",
        ];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of inherited.split(sep).concat(extras)) {
    if (!part || seen.has(part)) continue;
    seen.add(part);
    out.push(part);
  }
  return out.join(sep);
}

function validateCwd(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const stat = statSync(raw);
  if (!stat.isDirectory()) {
    throw new Error("projectRoot must be a directory");
  }
  return raw;
}

// The server is usually launched by pnpm (dev) or as a bundled sidecar, and
// pnpm exports its whole config to children as npm_config_* env vars. A
// shell that inherits them gets "npm warn Unknown env config …" on every
// npm command, and npm/pnpm/yarn invoked there read pnpm's settings as if
// the user had set them. Strip the package-manager lifecycle namespace —
// and the server's own NODE_ENV — before handing the env to a user shell.
const PTY_ENV_DROPPED = new Set(["NODE_ENV", "INIT_CWD", "PNPM_SCRIPT_SRC_DIR"]);
// Sidecar-internal namespaces (cave-o01k): the packaged app's serialized Next
// config breaks builds run from the terminal, and the sidecar auth tokens are
// secrets that would 401-gate a dev server inheriting them. Mirrors
// scrubSidecarInternalEnv in src/lib/coven-bin.ts (this file stays
// import-free of src/ so the packaged sidecar can run it standalone).
const PTY_ENV_DROPPED_PREFIXES = ["COVEN_CAVE_", "__NEXT_PRIVATE_"];

function sanitizedEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (/^npm_/i.test(key)) continue;
    if (PTY_ENV_DROPPED.has(key)) continue;
    if (PTY_ENV_DROPPED_PREFIXES.some((prefix) => key.startsWith(prefix))) continue;
    env[key] = value;
  }
  return env;
}

function sendPtyData(ws: WebSocket, data: Buffer): boolean {
  if (ws.readyState !== WebSocket.OPEN) return false;
  const frame = Buffer.allocUnsafe(1 + data.length);
  frame[0] = 0x01;
  data.copy(frame, 1);
  try {
    ws.send(frame);
    return true;
  } catch {
    return false;
  }
}

/** Cursor control frames are opt-in (`ptyReplayCursor` query parameter), so
 * legacy clients continue to receive the original 0x01 + terminal bytes wire
 * format unchanged. The cursor is a safe integer stored as Float64 LE; that
 * covers many petabytes while working in every supported WebView. */
function sendPtyReplayCursor(ws: WebSocket, cursor: number, reset: boolean): boolean {
  if (ws.readyState !== WebSocket.OPEN) return false;
  const frame = Buffer.allocUnsafe(10);
  frame[0] = 0x06;
  frame.writeDoubleLE(cursor, 1);
  frame[9] = reset ? 1 : 0;
  try {
    ws.send(frame);
    return true;
  } catch {
    return false;
  }
}

function clearPendingPtyOutput(session: PtySession): void {
  if (session.flushTimer) {
    clearTimeout(session.flushTimer);
    session.flushTimer = null;
  }
  session.pendingOutput = [];
  session.pendingOutputBytes = 0;
}

function armPtyDetach(threadId: string, session: PtySession): void {
  if (session.detachTimer) clearTimeout(session.detachTimer);
  session.detachTimer = setTimeout(() => {
    const current = sessions.get(threadId);
    if (current !== session || current.ws) return;
    sessions.delete(threadId);
    try {
      session.pty.kill();
    } catch {
      // Already gone.
    }
  }, DETACH_GRACE_MS);
}

function detachPtyConsumer(threadId: string, session: PtySession, ws: WebSocket): void {
  if (session.ws !== ws) return;
  session.ws = null;
  clearPendingPtyOutput(session);
  armPtyDetach(threadId, session);
}

function evictSlowPtyConsumer(threadId: string, session: PtySession, ws: WebSocket): void {
  if (session.ws !== ws) return;
  // Closing only the transport is intentional: output remains in the bounded
  // ring and the live PTY gets the normal reconnect grace window.
  detachPtyConsumer(threadId, session, ws);
  try {
    ws.close(PTY_SLOW_CONSUMER_CLOSE_CODE, PTY_SLOW_CONSUMER_CLOSE_REASON);
  } catch {
    // The close handler is only cleanup; the session is already detached.
  }
}

function flushPtyOutput(threadId: string, session: PtySession): void {
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

function queuePtyOutput(threadId: string, session: PtySession, data: Buffer): void {
  if (!session.ws || data.length === 0) return;
  let offset = 0;
  while (offset < data.length && session.ws) {
    const room = PTY_FRAME_MAX_BYTES - session.pendingOutputBytes;
    const take = Math.min(room, data.length - offset);
    const chunk = data.subarray(offset, offset + take);
    // Full frames flush synchronously. A short final slice survives until the
    // coalescing timer, so give it a bounded backing allocation instead of
    // pinning an arbitrarily large node-pty callback through a Buffer view.
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
      PTY_FRAME_COALESCE_MS,
    );
  }
}

/** Queue either the missed suffix (cursor clients) or the bounded complete
 * ring (legacy clients). Sending the cursor control frame first means every
 * following 0x01 payload advances the client cursor byte-for-byte. */
function replayPtyOutput(
  threadId: string,
  session: PtySession,
  replayCursor: number | undefined,
): void {
  if (!session.ws || session.scrollbackBytes === 0) {
    if (session.ws && replayCursor !== undefined) {
      sendPtyReplayCursor(
        session.ws,
        session.streamEnd,
        replayCursor !== -1 && replayCursor !== session.streamEnd,
      );
    }
    return;
  }

  if (replayCursor === undefined) {
    for (const chunk of session.scrollback) queuePtyOutput(threadId, session, chunk);
    return;
  }

  const validCursor =
    replayCursor >= session.scrollbackStart && replayCursor <= session.streamEnd;
  const start = validCursor && replayCursor !== -1 ? replayCursor : session.scrollbackStart;
  const reset = replayCursor !== -1 && !validCursor;
  const ws = session.ws;
  if (
    !ws ||
    ws.bufferedAmount + 10 > PTY_WS_BUFFERED_AMOUNT_LIMIT ||
    !sendPtyReplayCursor(ws, start, reset)
  ) {
    if (ws) evictSlowPtyConsumer(threadId, session, ws);
    return;
  }
  for (const chunk of scrollbackFrom(session, start)) queuePtyOutput(threadId, session, chunk);
}

function sendPtyExit(ws: WebSocket, exitCode: number): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  const frame = Buffer.allocUnsafe(5);
  frame[0] = 0x02;
  frame.writeInt32LE(exitCode, 1);
  ws.send(frame);
}

function spawnPty(
  threadId: string,
  ws: WebSocket,
  cols: number,
  rows: number,
  cwd: string | undefined,
  replayCursor: number | undefined,
): void {
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
      LC_ALL: process.env.LC_ALL ?? "en_US.UTF-8",
    },
  });

  const session: PtySession = {
    pty: shell,
    ws: null,
    scrollback: [],
    scrollbackBytes: 0,
    scrollbackStart: 0,
    streamEnd: 0,
    pendingOutput: [],
    pendingOutputBytes: 0,
    flushTimer: null,
    detachTimer: null,
  };
  sessions.set(threadId, session);

  shell.onData((data: string) => {
    // Keep the ring filling even while detached so a client that reattaches
    // (split/reorg remount, reload, sleep/wake) sees what happened while it
    // was away. Route live output to the CURRENTLY-attached socket, not the
    // spawn-time one — adoptSession swaps session.ws on reattach.
    const bytes = Buffer.from(data, "utf8");
    appendScrollback(session, bytes);
    queuePtyOutput(threadId, session, bytes);
  });
  shell.onExit(({ exitCode }: { exitCode?: number | null }) => {
    const current = sessions.get(threadId);
    // Ensure all bytes observed before onExit stay ahead of the exit frame.
    if (session.ws) flushPtyOutput(threadId, session);
    if (current?.pty === shell) {
      if (current.detachTimer) clearTimeout(current.detachTimer);
      clearPendingPtyOutput(current);
      sessions.delete(threadId);
    }
    if (session.ws) {
      sendPtyExit(session.ws, exitCode ?? 0);
      session.ws.close(1000, "pty exit");
    }
  });

  adoptSession(threadId, session, ws, cols, rows, replayCursor);
}

function rawDataToBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}

function onWsMessage(threadId: string, data: RawData): void {
  const session = sessions.get(threadId);
  if (!session) return;

  const frame = rawDataToBuffer(data);
  const tag = frame[0];
  if (tag === 0x03) {
    session.pty.write(frame.subarray(1).toString("utf8"));
  } else if (tag === 0x04 && frame.length >= 5) {
    const cols = frame.readUInt16LE(1);
    const rows = frame.readUInt16LE(3);
    if (cols > 0 && rows > 0) {
      session.pty.resize(cols, rows);
    }
  } else if (tag === 0x05) {
    // Explicit tab-close (client sent a kill frame): reap the shell NOW rather
    // than detaching with a grace window. Without this, a WS-transport tab close
    // just drops the socket, which the close handler treats as a transient
    // detach — leaking the shell (and its foreground job) for DETACH_GRACE_MS.
    if (session.detachTimer) clearTimeout(session.detachTimer);
    clearPendingPtyOutput(session);
    sessions.delete(threadId);
    try {
      session.pty.kill();
    } catch {
      // Already gone.
    }
  }
}

/** Attach a (re)connecting client to an already-running PTY: the previous
 *  socket (if any) is told it was replaced, the pending detach-kill is
 *  cancelled, and the scrollback ring is replayed so the client repaints. */
function adoptSession(
  threadId: string,
  session: PtySession,
  ws: WebSocket,
  cols: number,
  rows: number,
  replayCursor: number | undefined,
): void {
  if (session.detachTimer) {
    clearTimeout(session.detachTimer);
    session.detachTimer = null;
  }
  const previous = session.ws;
  clearPendingPtyOutput(session);
  session.ws = ws;
  if (previous && previous !== ws) {
    try {
      previous.close(1000, "replaced");
    } catch {
      // Already closed.
    }
  }
  if (cols > 0 && rows > 0) {
    try {
      session.pty.resize(cols, rows);
    } catch {
      // Exited between adopt and resize; onExit handles the rest.
    }
  }
  replayPtyOutput(threadId, session, replayCursor);
}

function handlePtyConnection(
  ws: WebSocket,
  threadId: string,
  cols: number,
  rows: number,
  cwd?: string,
  replayCursor?: number,
): void {
  // Same threadId while the shell is alive (tab switch, page reload, network
  // blip, second window) → adopt the running PTY instead of killing it.
  // Killing here was the old behavior, and it cost the user their shell on
  // every reconnect.
  const existing = sessions.get(threadId);
  if (existing) {
    adoptSession(threadId, existing, ws, cols, rows, replayCursor);
  } else {
    spawnPty(threadId, ws, cols, rows, cwd, replayCursor);
  }

  ws.on("message", (data: RawData) => onWsMessage(threadId, data));
  ws.on("close", () => {
    const session = sessions.get(threadId);
    // A newer socket already adopted this shell (adoptSession swapped ws and
    // closed us as "replaced") — nothing to reap.
    if (!session || session.ws !== ws) return;
    // Detach, don't kill: give the client a grace window to come back
    // (layout restructure remount, reload, sleep/wake). The ring keeps
    // collecting output; the timer reaps only truly-abandoned shells.
    detachPtyConsumer(threadId, session, ws);
  });
}

function loopbackHostname(raw = process.env.HOSTNAME) {
  if (raw === "127.0.0.1" || raw === "localhost" || raw === "::1") {
    return raw;
  }
  return "127.0.0.1";
}

function loopbackHttpEndpoint(hostname: string, port: number): string {
  const urlHostname = hostname === "::1" ? `[${hostname}]` : hostname;
  return `http://${urlHostname}:${port}`;
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
  // Both stamps are trustworthy only because any client-supplied copy dies
  // here, before Next (and proxy.ts) ever see the request.
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
  let pathname: string;
  let query: UpgradeQuery;
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

  // Verify credentials before the host gate: a valid signed access token
  // (paired iOS terminal / handoff browser over `tailscale serve`, which
  // forwards the `<host>.ts.net` Host) legitimately arrives with a
  // non-loopback Host and must pass the source gate on the strength of its
  // token — mirroring proxy.ts's isAllowedApiHost relaxation on REST.
  // Forwarding headers are not credentials at this boundary: a local process
  // can forge them, so allowlisted tailnet identity alone must never authorize
  // spawning or adopting a shell. The resolved tailnet node id is still needed
  // below to verify the passkey presence token's tailnet-device binding.
  const tailnetNodeId = resolveTailnetPeer(req);
  const tokenAuthenticated = isPtyAuthRequired() ? isAuthorized(req, query) : false;

  if (!isAllowedUpgradeSource(req, tokenAuthenticated)) {
    socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    socket.destroy();
    return;
  }

  // Direct, unforwarded loopback is the browser's no-prompt PTY path. Remote
  // and forwarded clients still need a configured credential before they can
  // spawn or adopt a shell.
  if (shouldRejectUnauthenticatedPtyUpgrade({
    sidecarTokenConfigured: Boolean(SIDECAR_TOKEN),
    accessTokenConfigured: Boolean(accessToken()),
    tokenAuthenticated,
    directLoopback: isDirectLoopbackRequest(req),
  })) {
    socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    socket.destroy();
    return;
  }

  // Unlike ordinary API requests, this upgrade is handled here rather than by
  // Next middleware. Apply the same remote passkey gate before granting shell
  // access; direct loopback remains exempt just as it is in proxy.ts.
  if (
    process.env.COVEN_CAVE_PASSKEY_REQUIRED === "1" &&
    !isDirectLoopbackRequest(req) &&
    !hasValidPasskeyPresence(req, tailnetNodeId)
  ) {
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

  let cwd: string | undefined;
  try {
    cwd = validateCwd(query.projectRoot ? String(query.projectRoot) : undefined);
  } catch {
    socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    socket.destroy();
    return;
  }

  const cols = Number.parseInt(String(query.cols ?? "120"), 10);
  const rows = Number.parseInt(String(query.rows ?? "40"), 10);

  wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
    handlePtyConnection(ws, threadId, cols, rows, cwd, replayCursor);
  });
});

// Keep idle HTTP/1.1 connections open longer than clients hold them for
// reuse. Node's 5s default races connection pooling in URLSession (the iOS
// app) and `tailscale serve`'s upstream proxying — the server closes an idle
// socket just as the client reuses it, surfacing as sporadic "network
// connection lost" errors. headersTimeout must exceed keepAliveTimeout so a
// reused socket isn't reaped while request headers are mid-flight.
server.keepAliveTimeout = 75_000;
server.headersTimeout = 80_000;

/**
 * Turn off client v1 — loudly — instead of refusing to boot (cave-37fxr).
 *
 * Publishing was fail-closed to `server.close(() => process.exit(1))`, which
 * is right about the record and wrong about the process. The guard learned to
 * read a Windows DACL in #4852, which made it able to throw on win32 for the
 * first time, and on a host where the DACL cannot be read at all — PowerShell
 * in Constrained Language Mode, or no `powershell.exe` under `%SystemRoot%`,
 * both measured — that throw is permanent and there is no remedy reachable
 * from inside an app that will not start.
 *
 * Withholding the record is the correct fail-closed response and it costs
 * exactly one surface: the discovery file is what a paired client reads to
 * find this server, and the request-side guard refuses every client v1 call on
 * such a host anyway. Nothing else here — the terminal, chat, the board — has
 * anything to do with client v1 or with that path. So the degraded state is
 * "client v1 off, everything else up", and the crash is replaced by a banner
 * loud enough to be the thing that gets noticed. `clientV1DiscoveryPublished`
 * stays false, so shutdown will not try to unlink a record this process does
 * not own.
 */
function reportClientV1DiscoveryUnavailable(error: unknown): void {
  clientV1DiscoveryPublished = false;
  const detail = error instanceof Error ? error.message : String(error);
  console.error("[cave] ─────────────── CLIENT V1 DISABLED ───────────────");
  console.error(`[cave] ${detail}`);
  console.error(
    "[cave] The client v1 discovery record was NOT published, so paired clients"
    + " cannot find this server and every client v1 request stays refused."
    + " Everything else on this server is running normally.",
  );
  console.error(
    `[cave] Repair the path and restart. If — and only if — this host cannot`
    + ` read a DACL at all, ${UNVERIFIED_OWNERSHIP_ENV}=${UNVERIFIED_OWNERSHIP_TOKEN}`
    + ` with ${UNVERIFIED_OWNERSHIP_REASON_ENV} set admits an unreadable one; it`
    + ` never admits a DACL that was read and found shared.`,
  );
  console.error("[cave] ────────────────────────────────────────────────────");
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
function shutdownHttpServer(): void {
  if (httpShutdownStarted) return;
  httpShutdownStarted = true;
  cleanupStandaloneClientV1Discovery();
  terminatePtySessions();
  const timer = setTimeout(() => process.exit(1), 2_000);
  timer.unref?.();
  server.close(() => {
    clearTimeout(timer);
    process.exit(0);
  });
}

process.once("SIGINT", shutdownHttpServer);
process.once("SIGTERM", shutdownHttpServer);

// Prime the tailnet allowlist immediately, then keep it fresh. unref() so the
// poll never holds the process open on its own.
if (allowedTailnetNodeIds().size > 0) {
  void refreshTailnetPeers();
  setInterval(() => void refreshTailnetPeers(), TAILNET_STATUS_REFRESH_MS).unref();
}

server.once("error", (err: NodeJS.ErrnoException) => {
  cleanupStandaloneClientV1Discovery();
  // The launcher keeps a bounded tail of this output and shows it verbatim when
  // the sidecar dies before it is ready (src-tauri/src/sidecar_startup.rs).
  // Printing the Error object alone put a stack and a properties dump —
  // `errno: -4091, syscall: 'listen'` — on the desktop startup screen, in front
  // of someone whose only real problem was that another copy already held the
  // port. Lead with one legible line; the object still follows it for the log.
  if (err.code === "EADDRINUSE") {
    console.error(
      `> Port ${port} on ${hostname} is already in use (EADDRINUSE); CovenCave cannot serve here.`,
    );
  }
  console.error(err);
  process.exit(1);
});

// ── Heap telemetry (cave-ksjt) ────────────────────────────────────────────────
// Long-lived servers (the packaged sidecar and dev runs alike) have died with
// "Ineffective mark-compacts near heap limit" after hours of uptime, leaving
// no evidence of WHAT filled the heap. This monitor makes the next episode
// diagnosable: it logs a structured warning once heap usage crosses a high
// watermark, and writes ONE heap snapshot per episode as the process
// approaches the limit — before the OOM kill destroys the evidence.
//
// Mirrors src/lib/coven-paths.ts covenHome()/caveHome() for the snapshot
// destination (server.ts is transpiled standalone and cannot import src/).

const HEAP_MONITOR_ENABLED = process.env.COVEN_CAVE_HEAP_MONITOR !== "0";
const HEAP_MONITOR_INTERVAL_MS = (() => {
  const env = Number.parseInt(process.env.COVEN_CAVE_HEAP_MONITOR_INTERVAL_MS ?? "", 10);
  return Number.isFinite(env) && env > 0 ? env : 300_000; // 5 minutes
})();
/** Log a structured warning at ≥85% of the V8 heap limit. */
const HEAP_WARN_RATIO = 0.85;
/** Write the per-episode heap snapshot at ≥95% — about to OOM, capture now. */
const HEAP_SNAPSHOT_RATIO = 0.95;
/** Snapshots kept in the diagnostics dir (oldest pruned first). */
const HEAP_SNAPSHOT_KEEP = 2;
/** Disambiguates snapshots written within the same millisecond. */
let heapSnapshotSeq = 0;

function heapDiagnosticsDir(): string {
  const covenHome = process.env.COVEN_HOME || join(homedir(), ".coven");
  const caveHome = process.env.COVEN_CAVE_HOME || join(covenHome, "cave");
  return join(caveHome, "diagnostics");
}

const mb = (bytes: number): string => `${Math.round(bytes / (1024 * 1024))}MB`;

/** Prune oldest heap snapshots so the diagnostics dir never grows unbounded. */
function pruneHeapSnapshots(dir: string): void {
  const snapshots = readdirSync(dir)
    .filter((name) => name.startsWith("cave-heap-") && name.endsWith(".heapsnapshot"))
    .sort(); // names embed an ISO-like timestamp, so lexical order = age order
  while (snapshots.length > HEAP_SNAPSHOT_KEEP) {
    const oldest = snapshots.shift()!;
    try {
      unlinkSync(join(dir, oldest));
    } catch {
      // Already gone — fine.
    }
  }
}

function startHeapMonitor(): void {
  if (!HEAP_MONITOR_ENABLED) return;
  // Latches once per high-heap episode; re-arms after usage recovers below
  // the warn watermark so a later, separate episode captures its own snapshot.
  let snapshotWritten = false;

  const tick = (): void => {
    const heap = getHeapStatistics();
    const ratio = heap.used_heap_size / heap.heap_size_limit;
    if (ratio < HEAP_WARN_RATIO) {
      snapshotWritten = false;
      return;
    }

    const usage = process.memoryUsage();
    console.warn(
      `[heap-monitor] heapUsed=${mb(heap.used_heap_size)} heapLimit=${mb(heap.heap_size_limit)} ` +
        `(${Math.round(ratio * 100)}%) rss=${mb(usage.rss)} external=${mb(usage.external)} ` +
        `ptySessions=${sessions.size} uptimeMin=${Math.round(process.uptime() / 60)}`,
    );

    if (ratio < HEAP_SNAPSHOT_RATIO || snapshotWritten) return;
    // writeHeapSnapshot is synchronous and stop-the-world (seconds at GB
    // scale) — acceptable exactly once, when the alternative is dying with
    // no evidence minutes later.
    try {
      const dir = heapDiagnosticsDir();
      mkdirSync(dir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const seq = String((heapSnapshotSeq += 1)).padStart(3, "0");
      const file = join(dir, `cave-heap-${stamp}-pid${process.pid}-${seq}.heapsnapshot`);
      writeHeapSnapshot(file);
      snapshotWritten = true;
      pruneHeapSnapshots(dir);
      console.warn(`[heap-monitor] wrote heap snapshot ${file}`);
    } catch (err) {
      // Diagnostics must never take the server down with it.
      snapshotWritten = true; // don't retry a failing write every tick
      console.warn(`[heap-monitor] failed to write heap snapshot`, err);
    }
  };

  // unref: telemetry must never keep the process alive on shutdown.
  setInterval(tick, HEAP_MONITOR_INTERVAL_MS).unref();
}

startHeapMonitor();
