import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import { caveHome } from "./coven-paths.ts";
import { writeJsonAtomic } from "./server/atomic-write.ts";

export const HOST_CAPABILITY_CATALOG = [
  {
    id: "windows.hyperv.audit.read",
    platform: "win32",
    label: "Hyper-V audit",
    description: "Read VM, switch, checkpoint, VHD-chain, and integration-service inventory.",
    // The broker ships in the follow-on platform PR. This foundation must not
    // allow a capability merely because its future adapter has a name.
    adapter: null,
  },
  {
    id: "linux.system.audit.read",
    platform: "linux",
    label: "System audit",
    description: "Read system-service and host-health inventory through a constrained adapter.",
    adapter: null,
  },
  {
    id: "linux.containers.audit.read",
    platform: "linux",
    label: "Containers audit",
    description: "Read container-runtime inventory through a constrained adapter.",
    adapter: null,
  },
  {
    id: "macos.system.audit.read",
    platform: "darwin",
    label: "System audit",
    description: "Read macOS system inventory through a constrained adapter.",
    adapter: null,
  },
  {
    id: "macos.virtualization.audit.read",
    platform: "darwin",
    label: "Virtualization audit",
    description: "Read virtualization inventory through a constrained adapter.",
    adapter: null,
  },
] as const;

export type HostCapabilityId = (typeof HOST_CAPABILITY_CATALOG)[number]["id"];
export type HostPlatform = (typeof HOST_CAPABILITY_CATALOG)[number]["platform"];
export type HostCapabilityGrant = {
  id: string;
  familiarId: string;
  sessionId: string;
  capability: HostCapabilityId;
  grantedAt: string;
  expiresAt: string;
  actor: "loopback" | "mobile";
};
export type HostCapabilityAudit = {
  id: string;
  at: string;
  kind: "granted" | "revoked" | "expired";
  familiarId: string;
  sessionId: string;
  capability: HostCapabilityId;
  actor?: "loopback" | "mobile";
};
type Store = { version: 1; grants: HostCapabilityGrant[]; audit: HostCapabilityAudit[] };
export class HostCapabilityStoreError extends Error {
  constructor(message: string) { super(message); this.name = "HostCapabilityStoreError"; }
}

const DEFAULT_GRANT_MS = 30 * 60 * 1000;
const MAX_GRANT_MS = 8 * 60 * 60 * 1000;
let tail: Promise<unknown> = Promise.resolve();

function storePath() {
  return process.env.CAVE_HOST_CAPABILITY_GRANTS_PATH_OVERRIDE ?? path.join(caveHome(), "host-capability-grants.json");
}
function empty(): Store { return { version: 1, grants: [], audit: [] }; }
async function readStore(): Promise<Store> {
  try {
    const parsed = JSON.parse(await readFile(storePath(), "utf8")) as Partial<Store>;
    if (!Array.isArray(parsed.grants) || !Array.isArray(parsed.audit)) throw new HostCapabilityStoreError("host capability store is corrupt; refusing to change authority");
    return {
      version: 1,
      grants: parsed.grants.filter(validGrant),
      audit: parsed.audit.filter(validAudit),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return empty();
    if (error instanceof HostCapabilityStoreError) throw error;
    throw new HostCapabilityStoreError("host capability store is unreadable; refusing to change authority");
  }
}
async function writeStore(store: Store) {
  await mkdir(path.dirname(storePath()), { recursive: true });
  await writeJsonAtomic(storePath(), store);
}
function locked<T>(action: () => Promise<T>): Promise<T> {
  const next = tail.then(action, action);
  tail = next.then(() => undefined, () => undefined);
  return next;
}
function validCapability(value: unknown): value is HostCapabilityId {
  return typeof value === "string" && HOST_CAPABILITY_CATALOG.some((entry) => entry.id === value);
}
function validGrant(value: unknown): value is HostCapabilityGrant {
  const grant = value as Partial<HostCapabilityGrant>;
  return Boolean(grant && typeof grant.id === "string" && typeof grant.familiarId === "string" && typeof grant.sessionId === "string" && validCapability(grant.capability) && typeof grant.grantedAt === "string" && typeof grant.expiresAt === "string" && (grant.actor === "loopback" || grant.actor === "mobile"));
}
function validAudit(value: unknown): value is HostCapabilityAudit {
  const audit = value as Partial<HostCapabilityAudit>;
  return Boolean(audit && typeof audit.id === "string" && typeof audit.at === "string" && typeof audit.familiarId === "string" && typeof audit.sessionId === "string" && validCapability(audit.capability) && (audit.kind === "granted" || audit.kind === "revoked" || audit.kind === "expired"));
}
export function hostCapabilitiesForPlatform(platform: NodeJS.Platform = process.platform) {
  return HOST_CAPABILITY_CATALOG.filter((entry) => entry.platform === platform);
}
export function hostCapabilityById(value: unknown) {
  return HOST_CAPABILITY_CATALOG.find((entry) => entry.id === value) ?? null;
}
export function hostCapabilityHasAdapter(value: HostCapabilityId): boolean {
  return Boolean(hostCapabilityById(value)?.adapter);
}
function isLive(grant: HostCapabilityGrant, now = Date.now()) { return Date.parse(grant.expiresAt) > now; }
async function pruneExpired(store: Store, now = Date.now()) {
  const expired = store.grants.filter((grant) => !isLive(grant, now));
  if (!expired.length) return false;
  store.grants = store.grants.filter((grant) => isLive(grant, now));
  for (const grant of expired) store.audit.unshift({ id: randomUUID(), at: new Date(now).toISOString(), kind: "expired", familiarId: grant.familiarId, sessionId: grant.sessionId, capability: grant.capability });
  store.audit = store.audit.slice(0, 500);
  return true;
}
export async function listHostCapabilityGrants() {
  return locked(async () => {
    const store = await readStore();
    if (await pruneExpired(store)) await writeStore(store);
    return store.grants;
  });
}
export async function listHostCapabilityAudit() {
  return locked(async () => {
    const store = await readStore();
    if (await pruneExpired(store)) await writeStore(store);
    return store.audit;
  });
}
export async function activeHostCapabilities(input: { familiarId: string; sessionId: string; platform?: NodeJS.Platform }) {
  const platform = input.platform ?? process.platform;
  const grants = await listHostCapabilityGrants();
  return grants.filter((grant) => grant.familiarId === input.familiarId && grant.sessionId === input.sessionId && hostCapabilityById(grant.capability)?.platform === platform).map((grant) => grant.capability).sort();
}
export async function grantHostCapability(input: { familiarId: string; sessionId: string; capability: HostCapabilityId; expiresAt?: string; actor: "loopback" | "mobile"; now?: number; platform?: NodeJS.Platform; adapterAvailable?: boolean }) {
  const definition = hostCapabilityById(input.capability);
  if (!definition || definition.platform !== (input.platform ?? process.platform)) throw new Error("host capability is unavailable on this platform");
  if (!(input.adapterAvailable ?? Boolean(definition.adapter))) throw new Error("host capability has no registered adapter");
  const now = input.now ?? Date.now();
  const requested = input.expiresAt ? Date.parse(input.expiresAt) : now + DEFAULT_GRANT_MS;
  if (!Number.isFinite(requested) || requested <= now || requested > now + MAX_GRANT_MS) throw new Error("expiry must be in the next eight hours");
  return locked(async () => {
    const store = await readStore();
    await pruneExpired(store, now);
    store.grants = store.grants.filter((grant) => !(grant.familiarId === input.familiarId && grant.sessionId === input.sessionId && grant.capability === input.capability));
    const grant: HostCapabilityGrant = { id: randomUUID(), familiarId: input.familiarId, sessionId: input.sessionId, capability: input.capability, grantedAt: new Date(now).toISOString(), expiresAt: new Date(requested).toISOString(), actor: input.actor };
    store.grants.push(grant);
    store.audit.unshift({ id: randomUUID(), at: grant.grantedAt, kind: "granted", familiarId: grant.familiarId, sessionId: grant.sessionId, capability: grant.capability, actor: grant.actor });
    store.audit = store.audit.slice(0, 500);
    await writeStore(store);
    return grant;
  });
}
export async function revokeHostCapability(input: { familiarId: string; sessionId: string; capability: HostCapabilityId; actor: "loopback" | "mobile" }) {
  return locked(async () => {
    const store = await readStore();
    await pruneExpired(store);
    const before = store.grants.length;
    store.grants = store.grants.filter((grant) => !(grant.familiarId === input.familiarId && grant.sessionId === input.sessionId && grant.capability === input.capability));
    const revoked = before !== store.grants.length;
    if (revoked) store.audit.unshift({ id: randomUUID(), at: new Date().toISOString(), kind: "revoked", familiarId: input.familiarId, sessionId: input.sessionId, capability: input.capability, actor: input.actor });
    if (revoked) { store.audit = store.audit.slice(0, 500); await writeStore(store); }
    return revoked;
  });
}
