// Tests for mobile-access-provision (cave-os73): Settings · Phone self-
// provisions the pairing secret in dev instead of dead-ending on
// "run `pnpm mobile:tailscale`".
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  armMobileAccessSecret,
  loadPersistedMobileAccessSecret,
  mobileAccessSecretFile,
  provisionMobileAccessSecret,
  rearmPersistedMobileAccessSecret,
  retireMobileAccessSecret,
} from "./mobile-access-provision.ts";

function devEnv(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    COVEN_CAVE_MOBILE_STATE_ROOT: mkdtempSync(path.join(tmpdir(), "cave-mobile-")),
    PORT: "3000",
    ...overrides,
  };
}

test("state file mirrors scripts/mobile-tailscale.sh layout (root/port scoped)", () => {
  const file = mobileAccessSecretFile({
    COVEN_CAVE_MOBILE_STATE_ROOT: "/tmp/state-root",
    PORT: "3007",
  });
  assert.equal(file, "/tmp/state-root/mobile-tailscale-3007/access-token");

  const explicitDir = mobileAccessSecretFile({
    COVEN_CAVE_MOBILE_STATE_DIR: "/tmp/custom-dir",
  });
  assert.equal(explicitDir, "/tmp/custom-dir/access-token");

  const xdg = mobileAccessSecretFile({ XDG_STATE_HOME: "/tmp/xdg-state" });
  assert.equal(xdg, "/tmp/xdg-state/coven-cave/mobile-tailscale-3000/access-token");
});

test("provision mints, persists (0600), and is idempotent", () => {
  const env = devEnv();
  const first = provisionMobileAccessSecret(env);
  assert.ok(first && first.length >= 32, "mints a strong secret");

  const file = mobileAccessSecretFile(env);
  assert.equal(readFileSync(file, "utf8").trim(), first);
  assert.equal(statSync(file).mode & 0o777, 0o600, "secret file is 0600");
  assert.equal(statSync(path.dirname(file)).mode & 0o777, 0o700, "state dir is 0700");

  assert.equal(provisionMobileAccessSecret(env), first, "reuses the persisted secret");
  assert.equal(loadPersistedMobileAccessSecret(env), first);
});

test("provision reuses a secret the mobile:tailscale script already persisted", () => {
  const env = devEnv();
  const file = mobileAccessSecretFile(env);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, "script-minted-secret\n", "utf8");
  assert.equal(provisionMobileAccessSecret(env), "script-minted-secret");
});

test("provision refuses the packaged bundle and e2e runs", () => {
  assert.equal(provisionMobileAccessSecret(devEnv({ COVEN_CAVE_BUNDLE: "1" })), null);
  assert.equal(provisionMobileAccessSecret(devEnv({ COVEN_CAVE_E2E: "1" })), null);
});

test("arm sets the request-time gate env", () => {
  const env = devEnv();
  armMobileAccessSecret("s3cret", env);
  assert.equal(env.COVEN_CAVE_ACCESS_TOKEN, "s3cret");
});

test("rearm arms from disk only when tokenless outside the bundle", () => {
  const env = devEnv();
  const secret = provisionMobileAccessSecret(env);
  assert.ok(secret);

  assert.equal(rearmPersistedMobileAccessSecret(env), secret, "boot re-arm loads the persisted secret");
  assert.equal(env.COVEN_CAVE_ACCESS_TOKEN, secret);

  const alreadyArmed = devEnv({ COVEN_CAVE_ACCESS_TOKEN: "existing" });
  assert.equal(rearmPersistedMobileAccessSecret(alreadyArmed), null, "existing token wins");
  assert.equal(alreadyArmed.COVEN_CAVE_ACCESS_TOKEN, "existing");

  assert.equal(rearmPersistedMobileAccessSecret(devEnv()), null, "nothing persisted → stays tokenless");

  const bundle = devEnv({ COVEN_CAVE_BUNDLE: "1" });
  assert.equal(rearmPersistedMobileAccessSecret(bundle), null, "bundle never re-arms from dev state");
});

test("retire disarms and removes the persisted secret", () => {
  const env = devEnv();
  const secret = provisionMobileAccessSecret(env);
  assert.ok(secret);
  armMobileAccessSecret(secret, env);

  retireMobileAccessSecret(env);
  assert.equal(env.COVEN_CAVE_ACCESS_TOKEN, undefined);
  assert.equal(existsSync(mobileAccessSecretFile(env)), false);
  assert.equal(rearmPersistedMobileAccessSecret(env), null, "next boot stays tokenless");
});

// ── Wiring pins ──────────────────────────────────────────────────────────────
// Behavioral seams live above; these pin the route and server wiring so the
// self-provisioning path can't silently detach (repo convention).

test("mobile-handoff route provisions, arms, cookies the session, and retires on stop", () => {
  const route = readFileSync(
    path.join(process.cwd(), "src/app/api/mobile-handoff/route.ts"),
    "utf8",
  );
  assert.match(route, /provisionMobileAccessSecret\(\)/, "route provisions when tokenless");
  assert.match(route, /armMobileAccessSecret\(provisioned\)/, "route arms the gate before the serve route goes live");
  assert.match(route, /withBrowserAccessCookie\(res, req, access\.secret\)/, "provisioning responses carry the signed browser cookie");
  assert.match(route, /ACCESS_TOKEN_COOKIE/, "cookie uses the canonical access-cookie name");
  assert.match(
    route,
    /app-stop[\s\S]{0,400}retireMobileAccessSecret\(\)/,
    "Mobile mode Off retires the self-provisioned secret",
  );
});

test("custom server re-arms at boot and reads the token lazily", () => {
  const server = readFileSync(path.join(process.cwd(), "server.ts"), "utf8");
  assert.match(server, /persistedMobileAccessSecretFile/, "boot re-arm reads the persisted state file");
  assert.match(
    server,
    /COVEN_CAVE_BUNDLE !== "1"[\s\S]{0,200}COVEN_CAVE_E2E !== "1"/,
    "re-arm is guarded off in the packaged bundle and e2e",
  );
  assert.match(server, /function accessToken\(\)/, "PTY gate reads the access token lazily");
  assert.doesNotMatch(
    server,
    /const ACCESS_TOKEN = process\.env\.COVEN_CAVE_ACCESS_TOKEN/,
    "no boot-time snapshot — mid-session arming must reach the PTY gate",
  );
});
