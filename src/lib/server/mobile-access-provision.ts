// mobile-access-provision: self-provision the phone-pairing secret in dev.
//
// The mobile access secret (COVEN_CAVE_ACCESS_TOKEN) is what signed pairing
// invites are minted from and what the request gate verifies against. The
// packaged app mints and persists its own (src-tauri load_or_create_mobile_
// access_token), and `pnpm mobile:tailscale` restarts the dev server with one
// — but plain `pnpm dev` had neither, so Settings · Phone dead-ended with
// "run pnpm mobile:tailscale". Pairing should just work: when Mobile mode
// starts in a tokenless dev server, provision the secret here, persist it to
// THE SAME state file the script uses (so both flows share one pairing
// identity), and arm it in-process. server.ts re-arms from the persisted
// secret at boot so a restarted dev server keeps the phone paired — and keeps
// the still-live Tailscale Serve route token-gated (cave-os73).
//
// Never provisions in the packaged bundle (COVEN_CAVE_BUNDLE=1): there a
// missing token is a real misconfiguration the Tauri shell must fix, and
// minting a second secret would fork the pairing identity.

import { randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { CAVE_PORTS, CAVE_PORT_ENV, parsePort } from "../../../scripts/ports.mjs";
import {
  assertExclusivePathOwnership,
  assertExclusivePathOwnershipSync,
  type ClientV1PathOwnershipOptions,
} from "./client-v1/path-ownership.ts";

/**
 * Same resolution order as server.ts `cavePort()` and the Rust
 * `dedicated_port()`: explicit Cave override, then PORT, then the channel
 * default. This module runs inside Next, which bundles the import, so unlike
 * server.ts it can consume the contract directly instead of copying it.
 */
function resolveCavePort(env: Record<string, string | undefined>): string {
  const channelDefault =
    env.COVEN_CAVE_BUNDLE === "1" ? CAVE_PORTS.production : CAVE_PORTS.dev;
  const resolved =
    parsePort(env[CAVE_PORT_ENV]) ?? parsePort(env.PORT) ?? channelDefault;
  return String(resolved);
}

/** Mirrors scripts/mobile-tailscale.sh STATE_ROOT/STATE_DIR/TOKEN_FILE. */
export function mobileAccessSecretFile(
  env: Record<string, string | undefined> = process.env,
): string {
  // Keyed by port to mirror the shell script — which is why the port contract
  // (scripts/ports.mjs) exists: the packaged app used to bind a random port
  // every launch, so this directory moved every launch and every paired phone
  // had to re-pair. Same resolution order as server.ts `cavePort()`.
  const port = resolveCavePort(env);
  const stateRoot =
    env.COVEN_CAVE_MOBILE_STATE_ROOT?.trim() ||
    path.join(
      env.XDG_STATE_HOME?.trim() || path.join(homedir(), ".local", "state"),
      "coven-cave",
    );
  const stateDir =
    env.COVEN_CAVE_MOBILE_STATE_DIR?.trim() ||
    path.join(stateRoot, `mobile-tailscale-${port}`);
  return path.join(stateDir, "access-token");
}

function provisioningAllowed(env: Record<string, string | undefined>): boolean {
  // The packaged bundle owns its secret; e2e runs must stay tokenless so
  // daemon-less specs keep driving the API without credentials.
  return env.COVEN_CAVE_BUNDLE !== "1" && env.COVEN_CAVE_E2E !== "1";
}

/** The persisted pairing secret, or null when none has been provisioned. */
export function loadPersistedMobileAccessSecret(
  env: Record<string, string | undefined> = process.env,
): string | null {
  try {
    const file = mobileAccessSecretFile(env);
    // This reader is sync and cannot run the Windows DACL probe, so it uses
    // the sync guard: POSIX verifies owner/mode/symlink, and a platform that
    // cannot answer synchronously refuses — the secret is treated as
    // unreadable rather than trusted silently (cave-8pd39).
    const stats = lstatSync(file);
    assertExclusivePathOwnershipSync(
      file,
      { uid: stats.uid, mode: stats.mode, isSymbolicLink: stats.isSymbolicLink() },
      "The persisted mobile access secret",
    );
    const secret = readFileSync(file, "utf8").trim();
    return secret.length > 0 ? secret : null;
  } catch {
    return null;
  }
}

export interface MobileAccessProvisionOptions {
  /**
   * Seams for the ownership guard, so the win32 branch below is reachable on
   * the Linux runners. Without this the only assertions covering the platform
   * whose `chmod` does nothing would be the ones that cannot run in CI.
   */
  ownership?: ClientV1PathOwnershipOptions;
  /** Where a refusal is announced. The route only ever sees `null`. */
  warn?: (message: string) => void;
}

/**
 * Restrict a path to the current user, or refuse it (cave-fawvh).
 *
 * `mode: 0o600` and `chmodSync(0o600)` are the whole of the access control
 * this module used to apply, and on win32 they apply nothing — #4852 measured
 * `mode & 0o777 === 0o666` afterwards, not even the read-only bit. That file
 * was about `client-v1-credentials.json`, which holds SHA-256 hashes; THIS
 * file holds the pairing secret in plaintext, so the same defect is worse
 * here. The POSIX modes above stay (they are real on POSIX); this adds the
 * DACL the platform actually enforces, using the guard #4852 already built.
 *
 * Since cave-8p0hn it also refuses a symlink and inspects the real path — the
 * same two moves the sibling credential store makes. A reparse point here
 * would be FOLLOWED by mkdirSync(recursive) and writeFileSync into a directory
 * whose DACL was never the one verified, and the ownership answer is only
 * about the path the guard actually inspected: on macOS mkdtempSync(tmpdir())
 * hands back /var/… that resolves to /private/var/….
 */
async function restrictToCurrentUser(
  target: string,
  subject: string,
  env: Record<string, string | undefined>,
  options: MobileAccessProvisionOptions,
): Promise<void> {
  // lstat the path as handed BEFORE realpath resolves it: a symlink here must
  // be refused, not followed, and realpath would resolve the link away so the
  // guard would then describe a path the secret does not actually live at.
  const handed = lstatSync(target);
  if (handed.isSymbolicLink()) {
    throw new Error(`${subject} must not be a symlink: ${target}.`);
  }
  // The ownership answer is only about the path the guard inspected, so it
  // must inspect the target reads and writes actually land on — and keep the
  // symlink refusal for the race that swaps one in between the two calls
  // (same realpath-then-lstat move as credential-store.ts
  // `initializeCredentialStoreLocation`).
  const physical = realpathSync(target);
  const metadata = lstatSync(physical);
  if (metadata.isSymbolicLink()) {
    throw new Error(`${subject} must not be a symlink: ${target}.`);
  }
  await assertExclusivePathOwnership(physical, metadata, subject, {
    // The waiver is read from the same environment this module was handed, so
    // a test can drive it and a caller cannot accidentally consult a different
    // one than the rest of the module.
    env,
    ...options.ownership,
  });
}

/**
 * Load the persisted pairing secret, minting and persisting a fresh one when
 * missing. Returns null when provisioning is not allowed here (packaged
 * bundle, e2e), when persistence fails, or when the path holding a plaintext
 * secret cannot be restricted to this user — callers fall back to the existing
 * "unavailable" response, and the reason is logged rather than swallowed. Does
 * NOT arm the process env; callers arm explicitly (armMobileAccessSecret) right
 * before the serve route goes live so the gate and the exposure switch on
 * together.
 *
 * Async since cave-fawvh: restricting the path on Windows means reading a DACL
 * out of a subprocess, because `chmod` there sets nothing.
 */
export async function provisionMobileAccessSecret(
  env: Record<string, string | undefined> = process.env,
  options: MobileAccessProvisionOptions = {},
): Promise<string | null> {
  if (!provisioningAllowed(env)) return null;
  const file = mobileAccessSecretFile(env);
  const warn = options.warn ?? console.warn;
  try {
    // Directory first, and before anything is written into it. The repair
    // marks the directory's DACL inheritable, so the secret file created below
    // is born exclusive rather than restricted a moment after it exists.
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    await restrictToCurrentUser(
      path.dirname(file),
      "Mobile access token directory",
      env,
      options,
    );

    // Re-verified on the reuse path too, not trusted because it is already
    // there: an install that ran the version whose chmod did nothing has a
    // readable secret on disk right now.
    //
    // ⚠️ This does NOT reach every such install, and it would be worth more if
    // it did. server.ts arms COVEN_CAVE_ACCESS_TOKEN from that same file at
    // boot with no ownership check at all, and `resolveMobileAccessSecret`
    // returns that armed value before it ever calls this function — so on any
    // install whose token file already exists, provisioning is never entered
    // and this repair never runs. What it does reach is a fresh mint, and a
    // secret the `mobile:tailscale` script persisted after this server booted.
    // Closing the gap means guarding the two sync readers; that is cave-8pd39.
    const existing = loadPersistedMobileAccessSecret(env);
    if (existing) {
      await restrictToCurrentUser(file, "Mobile access token file", env, options);
      return existing;
    }

    const secret = randomBytes(32).toString("base64url");
    writeFileSync(file, secret, { encoding: "utf8", mode: 0o600 });
    chmodSync(file, 0o600);
    try {
      await restrictToCurrentUser(file, "Mobile access token file", env, options);
    } catch (error) {
      // Never leave a plaintext credential on a path we could not restrict.
      rmSync(file, { force: true });
      throw error;
    }
    return secret;
  } catch (error) {
    // The route answers `null` with a terse "couldn't set up pairing", so
    // without this line the operator sees a broken Settings pane and no reason
    // for it — and an access-control refusal is the last thing that should be
    // indistinguishable from a full disk.
    warn(
      `Mobile access token could not be provisioned; phone pairing stays off. `
      + `${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

/** Arm the in-process gate: every credential path reads this env at request
 *  time (src/proxy.ts, mobile-token/refresh, mobile-handoff). */
export function armMobileAccessSecret(
  secret: string,
  env: Record<string, string | undefined> = process.env,
): void {
  env.COVEN_CAVE_ACCESS_TOKEN = secret;
}

/**
 * Boot-time re-arm: when the server starts tokenless outside the packaged
 * bundle but a provisioned secret exists on disk, arm it. Keeps paired
 * phones working across dev-server restarts and keeps a still-configured
 * Tailscale Serve route token-gated instead of silently open. Returns the
 * armed secret, or null when nothing was armed.
 */
export function rearmPersistedMobileAccessSecret(
  env: Record<string, string | undefined> = process.env,
): string | null {
  if (!provisioningAllowed(env)) return null;
  if (env.COVEN_CAVE_ACCESS_TOKEN?.trim()) return null;
  const secret = loadPersistedMobileAccessSecret(env);
  if (!secret) return null;
  armMobileAccessSecret(secret, env);
  return secret;
}

/**
 * Turn Mobile mode off: disarm the in-process gate and remove the persisted
 * secret so the next boot stays tokenless. Only removes the secret this
 * module (or the mobile:tailscale script) persisted — never touches the
 * packaged bundle's env-supplied token file.
 */
export function retireMobileAccessSecret(
  env: Record<string, string | undefined> = process.env,
): void {
  if (!provisioningAllowed(env)) return;
  delete env.COVEN_CAVE_ACCESS_TOKEN;
  const file = mobileAccessSecretFile(env);
  try {
    if (existsSync(file)) rmSync(file);
  } catch {
    // Best-effort — a stale file only means the next boot re-arms.
  }
}
