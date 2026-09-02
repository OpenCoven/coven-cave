// Hardened Topic Discovery store (Unit 2, cave-6sles.11).
//
// Persists portable TopicDiscoveryJobV1 and TopicProposalV1 records plus the
// Cave-private lease sidecar, under two directories that hang off the Unit 1
// pack store root: topic-jobs/ and topic-proposals/. It mirrors the Unit 1
// pack store's discipline — no-clobber link publication, symlink/ownership/
// mode checks, and a cross-process intent lock — but its write authority is
// confined to those two directories (asserted by
// research-topic-discovery-authority.test.ts).

import { constants } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  rm,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import path from "node:path";

import { caveHome } from "../coven-paths.ts";
import {
  parseTopicDiscoveryJobV1,
  parseTopicProposalV1,
  type TopicDiscoveryJobV1,
  type TopicProposalV1,
} from "../research-protocol/topic-discovery.ts";
import {
  parseTopicDiscoveryJobStateV1,
  type TopicDiscoveryJobStateV1,
} from "../research-topic-discovery.ts";
import { assertExclusivePathOwnershipSync } from "./client-v1/path-ownership.ts";
import { withProcessIntentLock } from "./process-intent-lock.ts";

export const TOPIC_DISCOVERY_LEASE_TTL_MS = 30 * 60 * 1000;
export const TOPIC_DISCOVERY_MAX_ATTEMPTS = 3;
export const MAX_TOPIC_JOBS = 10_000;
export const MAX_TOPIC_PROPOSALS = 10_000;

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const JOB_ID_GRAMMAR = /^topicjob_[A-Za-z0-9_-]{1,127}$/;
const PROPOSAL_ID_GRAMMAR = /^proposal_[A-Za-z0-9_-]{1,127}$/;
const WINDOWS_DEVICE_IDS = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const MAX_RECORD_BYTES = 2 * 1024 * 1024;

export type TopicDiscoveryStore = {
  createJob(job: TopicDiscoveryJobV1): Promise<{ created: boolean; job: TopicDiscoveryJobV1 }>;
  getJob(jobId: string): Promise<TopicDiscoveryJobV1 | null>;
  listJobs(): Promise<TopicDiscoveryJobV1[]>;
  updateJob(
    jobId: string,
    expectedStatus: TopicDiscoveryJobV1["status"],
    patch: (job: TopicDiscoveryJobV1) => TopicDiscoveryJobV1,
  ): Promise<{ updated: boolean; job: TopicDiscoveryJobV1 }>;
  putLease(jobId: string, state: TopicDiscoveryJobStateV1): Promise<void>;
  getLease(jobId: string): Promise<TopicDiscoveryJobStateV1 | null>;
  deleteLease(jobId: string): Promise<void>;
  putProposal(proposal: TopicProposalV1): Promise<void>;
  getProposal(proposalId: string): Promise<TopicProposalV1 | null>;
  listProposals(jobId?: string): Promise<TopicProposalV1[]>;
  listJobIds(): Promise<string[]>;
};

export class TopicDiscoveryStoreError extends Error {
  readonly code:
    | "invalid-id"
    | "invalid-job"
    | "invalid-proposal"
    | "immutable-conflict"
    | "missing"
    | "too-large"
    | "symlink"
    | "unsafe-path"
    | "corrupt";

  constructor(code: TopicDiscoveryStoreError["code"], message: string) {
    super(message);
    this.name = "TopicDiscoveryStoreError";
    this.code = code;
  }
}

type PathIdentity = {
  dev: bigint;
  ino: bigint;
  isDirectory: boolean;
  mode: number;
  nlink: number;
  size: number;
  isSymbolicLink: boolean;
};

async function pathMetadata(target: string, label: string): Promise<PathIdentity> {
  let info;
  try {
    info = await lstat(target);
  } catch {
    throw new TopicDiscoveryStoreError("missing", `${label} is missing`);
  }
  const isSymbolicLink = info.isSymbolicLink();
  const isDirectory = info.isDirectory();
  if (!isDirectory && !info.isFile()) {
    throw new TopicDiscoveryStoreError("unsafe-path", `${label} is neither a file nor a directory`);
  }
  return {
    dev: BigInt(info.dev),
    ino: BigInt(info.ino),
    isDirectory,
    mode: info.mode,
    nlink: info.nlink,
    size: info.size,
    isSymbolicLink,
  };
}

function sameIdentity(a: PathIdentity, b: PathIdentity): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.isDirectory === b.isDirectory;
}

function assertPrivateMode(mode: number, expected: number, label: string): void {
  if ((mode & 0o777) !== expected) {
    throw new TopicDiscoveryStoreError(
      "unsafe-path",
      `${label} mode ${(mode & 0o777).toString(8)} is not ${expected.toString(8)}`,
    );
  }
}

function assertSafeOwnership(target: string, metadata: PathIdentity, label: string): void {
  try {
    assertExclusivePathOwnershipSync(
      target,
      {
        uid: process.getuid?.() ?? -1,
        mode: metadata.mode,
        isSymbolicLink: metadata.isSymbolicLink,
      },
      label,
    );
  } catch (error) {
    throw new TopicDiscoveryStoreError("unsafe-path", `${label}: ${(error as Error).message}`);
  }
}

function isContained(rootRealPath: string, candidate: string): boolean {
  const relative = path.relative(rootRealPath, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function noFollowFlag(): number {
  return process.platform === "win32" || typeof constants.O_NOFOLLOW !== "number"
    ? 0
    : constants.O_NOFOLLOW;
}

function readFlags(): number {
  return constants.O_RDONLY | noFollowFlag();
}

function exclusiveWriteFlags(): number {
  return constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollowFlag();
}

async function syncDirectory(directory: string): Promise<void> {
  let handle: FileHandle | null = null;
  try {
    handle = await open(directory, constants.O_RDONLY);
    await handle.sync();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? "";
    if (!["EINVAL", "EISDIR", "ENOTSUP"].includes(code)) throw error;
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function ensureRealDirectory(
  candidate: string,
  rootRealPath: string | null,
  label: string,
): Promise<PathIdentity> {
  let created = false;
  try {
    await mkdir(candidate, { mode: DIRECTORY_MODE });
    created = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const before = await pathMetadata(candidate, `${label} directory is missing`);
  if (before.isSymbolicLink) {
    throw new TopicDiscoveryStoreError("symlink", `${label} directory is a symlink`);
  }
  if (!before.isDirectory) {
    throw new TopicDiscoveryStoreError("unsafe-path", `${label} path is not a directory`);
  }
  await assertSafeOwnership(candidate, before, `Topic Discovery ${label} directory`);
  const resolved = await realpath(candidate);
  if (rootRealPath !== null && !isContained(rootRealPath, resolved)) {
    throw new TopicDiscoveryStoreError("symlink", `${label} directory escapes the store root`);
  }
  const after = await pathMetadata(candidate, label);
  if (!sameIdentity(before, after)) {
    throw new TopicDiscoveryStoreError("symlink", `${label} directory identity changed`);
  }
  assertPrivateMode(after.mode, DIRECTORY_MODE, `${label} directory`);
  if (created) await syncDirectory(path.dirname(candidate));
  return after;
}

async function writeAll(handle: FileHandle, bytes: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < bytes.length) {
    const written = await handle.write(bytes, offset, bytes.length - offset);
    offset += written.bytesWritten;
  }
}

async function publishNoReplace(target: string, bytes: Uint8Array): Promise<boolean> {
  const directory = path.dirname(target);
  const temporary = path.join(directory, `.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`);
  let handle: FileHandle | null = null;
  try {
    handle = await open(temporary, exclusiveWriteFlags(), FILE_MODE);
    await writeAll(handle, bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    try {
      await link(temporary, target);
      await unlink(temporary);
      await syncDirectory(directory);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        await rm(temporary, { force: true });
        return false;
      }
      throw error;
    }
  } finally {
    await handle?.close().catch(() => {});
  }
}

// Atomic replacement for the compare-and-set update path. The caller holds the
// intent lock, so this is safe from cross-process races; rename(2) replaces the
// target in one step.
async function writeReplace(target: string, bytes: Uint8Array): Promise<void> {
  const directory = path.dirname(target);
  const temporary = path.join(directory, `.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`);
  let handle: FileHandle | null = null;
  try {
    handle = await open(temporary, exclusiveWriteFlags(), FILE_MODE);
    await writeAll(handle, bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporary, target);
    await syncDirectory(directory);
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function readSafeFileWithIdentity(
  target: string,
  label: string,
  maxBytes: number,
): Promise<{ bytes: Uint8Array; identity: PathIdentity }> {
  const before = await pathMetadata(target, `${label} is missing`);
  if (before.isSymbolicLink) {
    throw new TopicDiscoveryStoreError("symlink", `${label} is a symlink`);
  }
  if (before.isDirectory) {
    throw new TopicDiscoveryStoreError("unsafe-path", `${label} is not a regular file`);
  }
  if (before.nlink !== 1) {
    throw new TopicDiscoveryStoreError("unsafe-path", `${label} must have exactly one link`);
  }
  if (before.size > maxBytes) {
    throw new TopicDiscoveryStoreError("too-large", `${label} exceeds its size limit`);
  }
  await assertSafeOwnership(target, before, `Topic Discovery ${label}`);
  let handle: FileHandle | null = null;
  try {
    handle = await open(target, readFlags());
    const handleStat = await handle.stat();
    if (!sameIdentity(before, { ...before, size: handleStat.size })) {
      throw new TopicDiscoveryStoreError("symlink", `${label} identity changed during open`);
    }
    const bytes = new Uint8Array(handleStat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const read = await handle.read(bytes, offset, bytes.length - offset);
      if (read.bytesRead === 0) break;
      offset += read.bytesRead;
    }
    return { bytes: bytes.slice(0, offset), identity: before };
  } finally {
    await handle?.close().catch(() => {});
  }
}

function validateJobId(id: unknown, label: string): string {
  if (typeof id !== "string" || !JOB_ID_GRAMMAR.test(id) || WINDOWS_DEVICE_IDS.test(id)) {
    throw new TopicDiscoveryStoreError("invalid-id", `${label} must match topicjob_[A-Za-z0-9_-]{1,127}`);
  }
  return id;
}

function validateProposalId(id: unknown, label: string): string {
  if (typeof id !== "string" || !PROPOSAL_ID_GRAMMAR.test(id) || WINDOWS_DEVICE_IDS.test(id)) {
    throw new TopicDiscoveryStoreError("invalid-id", `${label} must match proposal_[A-Za-z0-9_-]{1,127}`);
  }
  return id;
}

type StoreLayout = {
  root: string;
  rootRealPath: string;
  jobsDir: string;
  proposalsDir: string;
  locksDir: string;
};

async function openLayout(rootInput: string): Promise<StoreLayout> {
  const root = path.resolve(rootInput);
  await mkdir(root, { mode: DIRECTORY_MODE, recursive: true });
  await ensureRealDirectory(root, null, "root");
  const rootRealPath = await realpath(root);
  const jobsDir = path.join(root, "topic-jobs");
  const proposalsDir = path.join(root, "topic-proposals");
  const locksDir = path.join(root, "locks", "intents");
  await ensureRealDirectory(jobsDir, rootRealPath, "topic-jobs");
  await ensureRealDirectory(proposalsDir, rootRealPath, "topic-proposals");
  return { root, rootRealPath, jobsDir, proposalsDir, locksDir };
}

function jobFilePath(layout: StoreLayout, jobId: string): string {
  return path.join(layout.jobsDir, `${jobId}.json`);
}

function leaseFilePath(layout: StoreLayout, jobId: string): string {
  return path.join(layout.jobsDir, `${jobId}.state.json`);
}

function proposalFilePath(layout: StoreLayout, proposalId: string): string {
  return path.join(layout.proposalsDir, `${proposalId}.json`);
}

async function parseJobFile(layout: StoreLayout, jobId: string): Promise<TopicDiscoveryJobV1> {
  const { bytes } = await readSafeFileWithIdentity(jobFilePath(layout, jobId), `job ${jobId}`, MAX_RECORD_BYTES);
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new TopicDiscoveryStoreError("corrupt", `job ${jobId} is not valid JSON`);
  }
  const parsed = parseTopicDiscoveryJobV1(raw);
  if (!parsed.ok) {
    throw new TopicDiscoveryStoreError("invalid-job", `job ${jobId}: ${parsed.error.code}`);
  }
  if (parsed.value.id !== jobId) {
    throw new TopicDiscoveryStoreError("invalid-job", `job ${jobId} claims id ${parsed.value.id}`);
  }
  return parsed.value;
}

async function parseProposalFile(layout: StoreLayout, proposalId: string): Promise<TopicProposalV1> {
  const { bytes } = await readSafeFileWithIdentity(
    proposalFilePath(layout, proposalId),
    `proposal ${proposalId}`,
    MAX_RECORD_BYTES,
  );
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new TopicDiscoveryStoreError("corrupt", `proposal ${proposalId} is not valid JSON`);
  }
  const parsed = parseTopicProposalV1(raw);
  if (!parsed.ok) {
    throw new TopicDiscoveryStoreError("invalid-proposal", `proposal ${proposalId}: ${parsed.error.code}`);
  }
  if (parsed.value.id !== proposalId) {
    throw new TopicDiscoveryStoreError("invalid-proposal", `proposal ${proposalId} claims id ${parsed.value.id}`);
  }
  return parsed.value;
}

async function parseLeaseFile(layout: StoreLayout, jobId: string): Promise<TopicDiscoveryJobStateV1> {
  const { bytes } = await readSafeFileWithIdentity(leaseFilePath(layout, jobId), `lease ${jobId}`, MAX_RECORD_BYTES);
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new TopicDiscoveryStoreError("corrupt", `lease ${jobId} is not valid JSON`);
  }
  const parsed = parseTopicDiscoveryJobStateV1(raw);
  if (!parsed.ok) {
    throw new TopicDiscoveryStoreError("corrupt", `lease ${jobId}: ${parsed.error.code}`);
  }
  return parsed.value;
}

export function createTopicDiscoveryStore(options: { root?: string } = {}): TopicDiscoveryStore {
  const root = options.root ?? path.join(caveHome(), "research-context-packs");

  return {
    async createJob(job) {
      const parsed = parseTopicDiscoveryJobV1(job);
      if (!parsed.ok) throw new TopicDiscoveryStoreError("invalid-job", `job failed validation: ${parsed.error.code}`);
      const parsedJob = parsed.value;
      const id = validateJobId(parsedJob.id, "job id");
      const layout = await openLayout(root);
      const bytes = new TextEncoder().encode(`${JSON.stringify(parsedJob)}\n`);
      return withProcessIntentLock({ intentsDirectory: layout.locksDir, label: "topic-discovery-store" }, async () => {
        const created = await publishNoReplace(jobFilePath(layout, id), bytes);
        if (!created) {
          const existing = await readSafeFileWithIdentity(jobFilePath(layout, id), `job ${id}`, MAX_RECORD_BYTES);
          const same = Buffer.from(existing.bytes).equals(Buffer.from(bytes));
          if (!same) {
            throw new TopicDiscoveryStoreError("immutable-conflict", `job ${id} already exists with different bytes`);
          }
        }
        return { created, job: parsedJob };
      });
    },

    async getJob(jobId) {
      const id = validateJobId(jobId, "job id");
      const layout = await openLayout(root);
      try {
        return await parseJobFile(layout, id);
      } catch (error) {
        if (error instanceof TopicDiscoveryStoreError && error.code === "missing") return null;
        throw error;
      }
    },

    async listJobs() {
      const layout = await openLayout(root);
      let entries: string[];
      try {
        entries = await readdir(/* turbopackIgnore: true */ layout.jobsDir);
      } catch {
        return [];
      }
      const jobs: TopicDiscoveryJobV1[] = [];
      for (const entry of entries) {
        if (!entry.endsWith(".json") || entry.endsWith(".state.json")) continue;
        const id = entry.slice(0, -".json".length);
        jobs.push(await parseJobFile(layout, id));
      }
      if (jobs.length > MAX_TOPIC_JOBS) {
        throw new TopicDiscoveryStoreError("too-large", "topic job store exceeds the record cap");
      }
      jobs.sort((a, b) =>
        a.requestedAt === b.requestedAt ? a.id.localeCompare(b.id) : b.requestedAt.localeCompare(a.requestedAt),
      );
      return jobs;
    },

    async updateJob(jobId, expectedStatus, patch) {
      const id = validateJobId(jobId, "job id");
      const layout = await openLayout(root);
      return withProcessIntentLock({ intentsDirectory: layout.locksDir, label: "topic-discovery-store" }, async () => {
        const current = await parseJobFile(layout, id);
        if (current.status !== expectedStatus) {
          return { updated: false, job: current };
        }
        const next = patch(current);
        const parsed = parseTopicDiscoveryJobV1(next);
        if (!parsed.ok) {
          throw new TopicDiscoveryStoreError("invalid-job", `patched job failed validation: ${parsed.error.code}`);
        }
        if (parsed.value.id !== id) {
          throw new TopicDiscoveryStoreError("invalid-job", `patched job changed id to ${parsed.value.id}`);
        }
        const bytes = new TextEncoder().encode(`${JSON.stringify(parsed.value)}\n`);
        await writeReplace(jobFilePath(layout, id), bytes);
        return { updated: true, job: parsed.value };
      });
    },

    async putLease(jobId, state) {
      const id = validateJobId(jobId, "job id");
      const parsed = parseTopicDiscoveryJobStateV1(state);
      if (!parsed.ok) throw new TopicDiscoveryStoreError("corrupt", `lease failed validation: ${parsed.error.code}`);
      const layout = await openLayout(root);
      const bytes = new TextEncoder().encode(`${JSON.stringify(parsed.value)}\n`);
      await withProcessIntentLock({ intentsDirectory: layout.locksDir, label: "topic-discovery-store" }, async () => {
        await writeReplace(leaseFilePath(layout, id), bytes);
      });
    },

    async getLease(jobId) {
      const id = validateJobId(jobId, "job id");
      const layout = await openLayout(root);
      try {
        return await parseLeaseFile(layout, id);
      } catch (error) {
        if (error instanceof TopicDiscoveryStoreError && error.code === "missing") return null;
        throw error;
      }
    },

    async deleteLease(jobId) {
      const id = validateJobId(jobId, "job id");
      const layout = await openLayout(root);
      await withProcessIntentLock({ intentsDirectory: layout.locksDir, label: "topic-discovery-store" }, async () => {
        await unlink(leaseFilePath(layout, id)).catch((error: unknown) => {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        });
        await syncDirectory(layout.jobsDir);
      });
    },

    async putProposal(proposal) {
      const parsed = parseTopicProposalV1(proposal);
      if (!parsed.ok) throw new TopicDiscoveryStoreError("invalid-proposal", `proposal failed validation: ${parsed.error.code}`);
      const parsedProposal = parsed.value;
      const id = validateProposalId(parsedProposal.id, "proposal id");
      const layout = await openLayout(root);
      const bytes = new TextEncoder().encode(`${JSON.stringify(parsedProposal)}\n`);
      await withProcessIntentLock({ intentsDirectory: layout.locksDir, label: "topic-discovery-store" }, async () => {
        const created = await publishNoReplace(proposalFilePath(layout, id), bytes);
        if (!created) {
          const existing = await readSafeFileWithIdentity(proposalFilePath(layout, id), `proposal ${id}`, MAX_RECORD_BYTES);
          const same = Buffer.from(existing.bytes).equals(Buffer.from(bytes));
          if (!same) {
            throw new TopicDiscoveryStoreError("immutable-conflict", `proposal ${id} already exists with different bytes`);
          }
        }
      });
    },

    async getProposal(proposalId) {
      const id = validateProposalId(proposalId, "proposal id");
      const layout = await openLayout(root);
      try {
        return await parseProposalFile(layout, id);
      } catch (error) {
        if (error instanceof TopicDiscoveryStoreError && error.code === "missing") return null;
        throw error;
      }
    },

    async listProposals(jobId) {
      const layout = await openLayout(root);
      let entries: string[];
      try {
        entries = await readdir(/* turbopackIgnore: true */ layout.proposalsDir);
      } catch {
        return [];
      }
      const proposals: TopicProposalV1[] = [];
      for (const entry of entries) {
        if (!entry.endsWith(".json")) continue;
        const id = entry.slice(0, -".json".length);
        const proposal = await parseProposalFile(layout, id);
        if (jobId !== undefined && proposal.discoveryJobId !== jobId) continue;
        proposals.push(proposal);
      }
      if (proposals.length > MAX_TOPIC_PROPOSALS) {
        throw new TopicDiscoveryStoreError("too-large", "topic proposal store exceeds the record cap");
      }
      proposals.sort((a, b) =>
        a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : b.createdAt.localeCompare(a.createdAt),
      );
      return proposals;
    },

    async listJobIds() {
      const layout = await openLayout(root);
      let entries: string[];
      try {
        entries = await readdir(/* turbopackIgnore: true */ layout.jobsDir);
      } catch {
        return [];
      }
      return entries
        .filter((entry) => entry.endsWith(".json") && !entry.endsWith(".state.json"))
        .map((entry) => entry.slice(0, -".json".length))
        .sort();
    },
  };
}
