/**
 * Who may change permissions when the server has no sidecar token.
 *
 * The packaged app and `dev:app` start the server with a per-launch
 * COVEN_CAVE_AUTH_TOKEN that children Cave spawns never inherit, so a local
 * request that presents it is the desktop. Plain `pnpm dev` sets no token, and
 * then `isLocalOrigin` passes any loopback caller, including a familiar's
 * `curl`. In that mode permission changes are refused unless the server
 * process itself was started with the escape hatch below.
 *
 * Kept free of Next.js imports so server.ts can log the startup warning.
 */

export const DEV_PERMISSION_MUTATIONS_ENV = "CAVE_DEV_ALLOW_PERMISSION_MUTATIONS";

type Env = Record<string, string | undefined>;

export type PermissionMutationMode =
  /** A sidecar token is configured; local requests had to present it. */
  | "token"
  /** No token, but the server was started with the dev escape hatch. */
  | "dev-allowed"
  /** No token and no escape hatch: permission changes are refused. */
  | "refused";

export function permissionMutationMode(env: Env = process.env): PermissionMutationMode {
  if (env.COVEN_CAVE_AUTH_TOKEN?.trim()) return "token";
  return env[DEV_PERMISSION_MUTATIONS_ENV] === "1" ? "dev-allowed" : "refused";
}

export const TOKENLESS_PERMISSION_MUTATION_ERROR =
  "Permission changes are turned off in tokenless dev (COVEN_CAVE_AUTH_TOKEN is not set), "
  + "because any local process could make them. Use `bash scripts/dev-app.sh`, or restart "
  + `the server with ${DEV_PERMISSION_MUTATIONS_ENV}=1 if you accept that risk.`;

/** The warning server.ts logs at startup, or null when there is nothing to say. */
export function permissionMutationStartupWarning(env: Env = process.env): string | null {
  if (env[DEV_PERMISSION_MUTATIONS_ENV] !== "1") return null;
  if (env.COVEN_CAVE_AUTH_TOKEN?.trim()) {
    return `[permissions] ${DEV_PERMISSION_MUTATIONS_ENV}=1 is set but ignored: a sidecar token is configured.`;
  }
  return `[permissions] WARNING: ${DEV_PERMISSION_MUTATIONS_ENV}=1 — any local process, `
    + "including a familiar, can change project grants, access groups, proposals, phone "
    + "permissions and restore backups. Audit entries record these as dev-unverified.";
}
