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
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/** Mirrors scripts/mobile-tailscale.sh STATE_ROOT/STATE_DIR/TOKEN_FILE. */
export function mobileAccessSecretFile(
  env: Record<string, string | undefined> = process.env,
): string {
  const port = (env.PORT || "3000").trim() || "3000";
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
    const secret = readFileSync(mobileAccessSecretFile(env), "utf8").trim();
    return secret.length > 0 ? secret : null;
  } catch {
    return null;
  }
}

/**
 * Load the persisted pairing secret, minting and persisting a fresh one when
 * missing. Returns null when provisioning is not allowed here (packaged
 * bundle, e2e) or persistence fails — callers fall back to the existing
 * "unavailable" response. Does NOT arm the process env; callers arm
 * explicitly (armMobileAccessSecret) right before the serve route goes live
 * so the gate and the exposure switch on together.
 */
export function provisionMobileAccessSecret(
  env: Record<string, string | undefined> = process.env,
): string | null {
  if (!provisioningAllowed(env)) return null;
  const existing = loadPersistedMobileAccessSecret(env);
  if (existing) return existing;
  const file = mobileAccessSecretFile(env);
  try {
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const secret = randomBytes(32).toString("base64url");
    writeFileSync(file, secret, { encoding: "utf8", mode: 0o600 });
    chmodSync(file, 0o600);
    return secret;
  } catch {
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
