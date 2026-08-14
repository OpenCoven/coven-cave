// GET /api/client/v1/health — the first request any standalone OpenCoven Chat
// client makes, before pairing. It is unauthenticated by SCOPE (there is no
// credential yet), but still requires the internal loopback marker proxy.ts
// stamps only for a verified direct, unforwarded loopback peer — a caller
// that reaches this handler any other way gets the same generic 403 every
// other client-v1 route uses, never a raw 200 with real instance data.
//
// The response identifies THIS Cave install with a UUID persisted once at
// `path.join(caveHome(), "instance-id")` (or the
// `COVEN_CAVE_CLIENT_INSTANCE_ID_PATH` test override) — minted atomically the
// first time anything asks, and thereafter stable for the life of this Cave
// install. A present-but-corrupt file (not a valid UUID) fails closed with a
// 503 rather than silently minting a fresh identity or trusting garbage.

import { randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, rm } from "node:fs/promises";
import path from "node:path";

import { caveHome } from "@/lib/coven-paths";
import { CLIENT_V1_LOCAL_HEADER, isTrustedLocalPeer } from "@/proxy-helpers";

import { isUuid } from "@/lib/server/client-v1/contract.ts";
import { clientV1Error, clientV1Ok } from "@/lib/server/client-v1/responses.ts";

export const dynamic = "force-dynamic";

const CLIENT_V1_API_VERSION = "1.0";
const CLIENT_V1_MIN_CLIENT_VERSION = "0.1.0";

// Order matters only for readability — the response array is rebuilt fresh
// on every request so a caller can never mutate this shared constant.
const CLIENT_V1_CAPABILITIES = [
  "canonical-conversations",
  "resumable-sse",
  "attachments",
  "attention",
  "task-handoff",
  "github-actions",
] as const;

export function clientInstanceIdFilePath(): string {
  const override = process.env.COVEN_CAVE_CLIENT_INSTANCE_ID_PATH?.trim();
  return override || path.join(/* turbopackIgnore: true */ caveHome(), "instance-id");
}

/**
 * Reads the persisted instance id. Returns `null` when the file is absent
 * (first boot); throws when the file exists but its contents are not a
 * valid UUID — an explicit, safe failure rather than silently trusting or
 * discarding a tampered/corrupted identity file.
 */
async function readPersistedInstanceId(file: string): Promise<string | null> {
  let raw: string;
  try {
    raw = (await readFile(file, "utf8")).trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (!isUuid(raw)) {
    throw new Error(`corrupt client-v1 instance id file: ${file}`);
  }
  return raw;
}

/**
 * Creates the instance id file exactly once, racing safely against any other
 * process or concurrent request doing the same.
 *
 * Writes the FULL value to a same-directory temp file first (created
 * exclusively, mode 0600, closed only after every byte is flushed), then
 * publishes it at the real path with `link()` — a single directory-entry
 * operation that fails `EEXIST` if a concurrent writer already won, rather
 * than ever creating the final path itself before its content exists. An
 * `open(file, "wx")` + `writeFile` straight against the FINAL path (or a
 * bare `writeFile(file, value, { flag: "wx" })`) creates a real, empty
 * directory entry at `file` the instant it's opened — a concurrent reader
 * that opens `file` in the gap before the write lands would see an empty
 * (or partial) file and could misread it as corrupt. Publishing via `link`
 * from an already-fully-written temp file means no reader can ever observe
 * `file` in a partial state: it either doesn't exist yet, or it exists
 * complete. The temp file is always removed in `finally`, whether this
 * process won the race or lost it.
 */
async function createInstanceIdExclusive(file: string, value: string): Promise<boolean> {
  const dir = path.dirname(file);
  const tempFile = path.join(dir, `.instance-id.${process.pid}.${randomUUID()}.tmp`);
  const handle = await open(tempFile, "wx", 0o600);
  try {
    await handle.writeFile(value, "utf8");
  } finally {
    await handle.close();
  }
  try {
    await link(tempFile, file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  } finally {
    await rm(tempFile, { force: true });
  }
}

/** Reads (or, on first boot, atomically mints and persists) this Cave install's stable instance id. */
export async function readOrCreateClientInstanceId(): Promise<string> {
  const file = clientInstanceIdFilePath();
  const existing = await readPersistedInstanceId(file);
  if (existing) return existing;

  await mkdir(path.dirname(file), { recursive: true });
  const candidate = randomUUID();
  if (await createInstanceIdExclusive(file, candidate)) return candidate;

  // Lost the create race to a concurrent request/process — its value is
  // authoritative, not this candidate, which is discarded unused.
  const winner = await readPersistedInstanceId(file);
  if (winner) return winner;
  throw new Error(`failed to establish client-v1 instance id at ${file}`);
}

export async function GET(req: Request): Promise<Response> {
  const marker = isTrustedLocalPeer(
    req.headers.get(CLIENT_V1_LOCAL_HEADER),
    process.env.COVEN_CAVE_LOCAL_PEER_SECRET,
  );
  if (!marker) {
    return clientV1Error(403, "unauthorized", "Not authorized.", false);
  }

  let instanceId: string;
  try {
    instanceId = await readOrCreateClientInstanceId();
  } catch {
    // Corrupt or unwritable instance-id file: fail closed rather than mint a
    // second identity or crash the request. Not transient — an operator
    // needs to inspect/repair the file — so this is not retryable.
    return clientV1Error(503, "service_unavailable", "Cave instance identity is unavailable.", false);
  }

  return clientV1Ok({
    ok: true,
    service: "coven-cave",
    apiVersion: CLIENT_V1_API_VERSION,
    minimumClientVersion: CLIENT_V1_MIN_CLIENT_VERSION,
    instanceId,
    pairingRequired: true,
    capabilities: [...CLIENT_V1_CAPABILITIES],
  });
}
