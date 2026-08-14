import { lstatSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import {
  heartbeatMaintenanceGate,
  MAX_FENCED_MUTATION_TIMEOUT_MS,
  verifyMaintenanceGateOwnership,
} from "./maintenance-gate.mjs";
import { normalizeAbsoluteWorktreePath } from "../src/lib/worktree-lifecycle.ts";
import {
  sanitizedGitEnvironment,
  validateStructuredLifecycleRecord,
  type OrphanedWorktreeMetadataRecord,
} from "./worktree-lifecycle-inventory.ts";

type JsonRecord = Record<string, unknown>;

type OperationResult = { ok: true } | { ok: false; reason: string };
type PresenceResult =
  | { ok: true; present: boolean }
  | { ok: false; reason: string };

export type MetadataRepairGateHandle = object;

export type ExactMetadataBead = {
  id: string;
  status: BeadStatus;
  metadata: JsonRecord;
};

export type MetadataRepairReport = {
  repaired: OrphanedWorktreeMetadataRecord[];
  blocked: Array<{
    beadId: string;
    location: OrphanedWorktreeMetadataRecord["location"];
    reason: string;
  }>;
  partial: Array<{
    beadId: string;
    location: OrphanedWorktreeMetadataRecord["location"];
    reason: string;
  }>;
  pending: OrphanedWorktreeMetadataRecord[];
};

export interface MetadataRepairOperations {
  heartbeatAndVerifyGate(handle: MetadataRepairGateHandle): OperationResult;
  readBead(
    beadId: string,
  ): { ok: true; bead: ExactMetadataBead } | { ok: false; reason: string };
  probeLocalBranch(branch: string): PresenceResult;
  probeRegisteredPath(recordedPath: string): PresenceResult;
  probeFilesystemPath(recordedPath: string): PresenceResult;
  persistCoven(beadId: string, nextCoven: JsonRecord): OperationResult;
}

type CommandResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  error: string;
};

type GateFunctionResult = { ok: true } | { ok: false; reason?: string };
type RepairOneResult =
  | { kind: "repaired" }
  | { kind: "blocked"; reason: string; halt: boolean }
  | { kind: "partial"; reason: string; halt: true };

const COMMAND_TIMEOUT_MS = 120_000;
const BEAD_STATUSES = [
  "open",
  "in_progress",
  "blocked",
  "deferred",
  "closed",
] as const;
type BeadStatus = (typeof BEAD_STATUSES)[number];
const BEAD_STATUS_SET = new Set<string>(BEAD_STATUSES);

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseBeadStatus(value: unknown): BeadStatus {
  if (typeof value !== "string" || !BEAD_STATUS_SET.has(value)) {
    throw new Error(
      `exact Bead status is malformed or unknown: ${JSON.stringify(value)}`,
    );
  }
  return value as BeadStatus;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown operation failure";
}

function cloneRecord(record: JsonRecord): JsonRecord {
  return structuredClone(record) as JsonRecord;
}

function exactRecordAt(
  coven: JsonRecord,
  location: OrphanedWorktreeMetadataRecord["location"],
): unknown {
  if (location === "primary") return coven.worktree;
  const index = Number(location.slice("additional:".length));
  return Array.isArray(coven.worktrees) ? coven.worktrees[index] : undefined;
}

function matchingLocations(coven: JsonRecord, expected: JsonRecord): string[] {
  const matches: string[] = [];
  if (isDeepStrictEqual(coven.worktree, expected)) matches.push("primary");
  if (Array.isArray(coven.worktrees)) {
    for (const [index, record] of coven.worktrees.entries()) {
      if (isDeepStrictEqual(record, expected)) matches.push(`additional:${index}`);
    }
  }
  return matches;
}

function currentLifecycleRecords(
  coven: JsonRecord,
  root: string,
): Array<{
  location: OrphanedWorktreeMetadataRecord["location"];
  record: JsonRecord;
  branch: string;
  path: string;
}> {
  const records: Array<{
    location: OrphanedWorktreeMetadataRecord["location"];
    record: JsonRecord;
    branch: string;
    path: string;
  }> = [];
  const primaryPresent =
    coven.worktree !== undefined && coven.worktree !== null;
  const addRecord = (
    location: OrphanedWorktreeMetadataRecord["location"],
    record: unknown,
  ) => {
    const validation = validateStructuredLifecycleRecord(
      record,
      `fresh ${location}`,
      root,
    );
    if (
      validation.errors.length > 0 ||
      !isRecord(record) ||
      validation.path === null
    ) {
      throw new Error(
        `fresh ${location} lifecycle metadata is malformed: ${validation.errors.join("; ")}`,
      );
    }
    records.push({
      location,
      record,
      branch: validation.branch,
      path: validation.path,
    });
  };
  if (primaryPresent) {
    addRecord("primary", coven.worktree);
  }
  if (coven.worktrees !== undefined && coven.worktrees !== null) {
    if (!Array.isArray(coven.worktrees)) {
      throw new Error("fresh additional lifecycle metadata is malformed");
    }
    if (!primaryPresent && coven.worktrees.length > 0) {
      throw new Error(
        "fresh additional lifecycle metadata is malformed: additional records require a primary",
      );
    }
    for (const [index, record] of coven.worktrees.entries()) {
      addRecord(`additional:${index}`, record);
    }
  }
  const branches = new Map<string, string>();
  const paths = new Map<string, string>();
  for (const record of records) {
    const branchOwner = branches.get(record.branch);
    if (branchOwner !== undefined) {
      throw new Error(
        `fresh lifecycle metadata is ambiguous: duplicate branch ${record.branch} at ${branchOwner} and ${record.location}`,
      );
    }
    const pathOwner = paths.get(record.path);
    if (pathOwner !== undefined) {
      throw new Error(
        `fresh lifecycle metadata is ambiguous: duplicate normalized path ${record.path} at ${pathOwner} and ${record.location}`,
      );
    }
    branches.set(record.branch, record.location);
    paths.set(record.path, record.location);
  }
  return records;
}

export function removeLifecycleRecord(
  coven: JsonRecord,
  location: OrphanedWorktreeMetadataRecord["location"],
  expected: JsonRecord,
  root = process.cwd(),
): JsonRecord {
  currentLifecycleRecords(coven, root);
  const current = exactRecordAt(coven, location);
  if (current === undefined) {
    const moved = matchingLocations(coven, expected);
    if (moved.length > 0) {
      throw new Error(
        `orphaned lifecycle record moved from ${location} to ${moved.join(", ")}`,
      );
    }
    throw new Error(`orphaned lifecycle record is missing at ${location}`);
  }
  if (!isDeepStrictEqual(current, expected)) {
    const moved = matchingLocations(coven, expected).filter(
      (candidate) => candidate !== location,
    );
    if (moved.length > 0) {
      throw new Error(
        `orphaned lifecycle record moved from ${location} to ${moved.join(", ")}`,
      );
    }
    throw new Error(`orphaned lifecycle record changed at ${location}`);
  }

  const next = cloneRecord(coven);
  if (location === "primary") {
    if (
      next.worktrees !== undefined &&
      next.worktrees !== null &&
      !Array.isArray(next.worktrees)
    ) {
      throw new Error("orphaned lifecycle additional records changed before repair");
    }
    const additional = Array.isArray(next.worktrees)
      ? [...next.worktrees]
      : [];
    if (additional.length > 0) {
      next.worktree = additional.shift();
      if (additional.length > 0) next.worktrees = additional;
      else delete next.worktrees;
    } else {
      delete next.worktree;
      delete next.worktrees;
    }
    return next;
  }

  const index = Number(location.slice("additional:".length));
  if (!Number.isSafeInteger(index) || index < 0 || !Array.isArray(next.worktrees)) {
    throw new Error(`orphaned lifecycle record is missing at ${location}`);
  }
  const additional = [...next.worktrees];
  additional.splice(index, 1);
  if (additional.length > 0) next.worktrees = additional;
  else delete next.worktrees;
  return next;
}

function safeOperation(
  label: string,
  operation: () => OperationResult,
): OperationResult {
  try {
    const result = operation();
    if (result.ok) return result;
    return { ok: false, reason: `${label}: ${result.reason}` };
  } catch (error) {
    return { ok: false, reason: `${label}: ${errorMessage(error)}` };
  }
}

function checkpoint(
  operations: MetadataRepairOperations,
  gateHandle: MetadataRepairGateHandle,
  phase: string,
): OperationResult {
  return safeOperation(`maintenance gate check failed ${phase}`, () =>
    operations.heartbeatAndVerifyGate(gateHandle),
  );
}

function blockedReason(
  report: MetadataRepairReport,
  candidate: OrphanedWorktreeMetadataRecord,
  reason: string,
): void {
  report.blocked.push({
    beadId: candidate.beadId,
    location: candidate.location,
    reason,
  });
}

function partialReason(
  report: MetadataRepairReport,
  candidate: OrphanedWorktreeMetadataRecord,
  reason: string,
): void {
  report.partial.push({
    beadId: candidate.beadId,
    location: candidate.location,
    reason,
  });
}

function readFreshBead(
  operations: MetadataRepairOperations,
  candidate: OrphanedWorktreeMetadataRecord,
):
  | { ok: true; bead: ExactMetadataBead; coven: JsonRecord }
  | { ok: false; reason: string } {
  let result: ReturnType<MetadataRepairOperations["readBead"]>;
  try {
    result = operations.readBead(candidate.beadId);
  } catch (error) {
    return { ok: false, reason: `exact Bead reread failed: ${errorMessage(error)}` };
  }
  if (!result.ok) {
    return { ok: false, reason: `exact Bead reread failed: ${result.reason}` };
  }
  if (result.bead.id !== candidate.beadId) {
    return {
      ok: false,
      reason: `exact Bead reread returned ${result.bead.id} instead of ${candidate.beadId}`,
    };
  }
  let status: BeadStatus;
  try {
    status = parseBeadStatus(result.bead.status);
  } catch (error) {
    return { ok: false, reason: errorMessage(error) };
  }
  if (!isRecord(result.bead.metadata)) {
    return { ok: false, reason: "exact Bead reread returned malformed metadata" };
  }
  if (!isRecord(result.bead.metadata.coven)) {
    return { ok: false, reason: "exact Bead reread is missing coven metadata" };
  }
  return {
    ok: true,
    bead: { ...result.bead, status },
    coven: result.bead.metadata.coven,
  };
}

function probeAbsent(
  label: string,
  probe: () => PresenceResult,
  presentReason: string,
): OperationResult {
  try {
    const result = probe();
    if (!result.ok) return { ok: false, reason: `${label} failed: ${result.reason}` };
    return result.present ? { ok: false, reason: presentReason } : { ok: true };
  } catch (error) {
    return { ok: false, reason: `${label} failed: ${errorMessage(error)}` };
  }
}

function repairOne(
  candidate: OrphanedWorktreeMetadataRecord,
  gateHandle: MetadataRepairGateHandle,
  repositoryRoot: string,
  operations: MetadataRepairOperations,
): RepairOneResult {
  const beforeRead = checkpoint(
    operations,
    gateHandle,
    "before exact Bead reread",
  );
  if (!beforeRead.ok) {
    return { kind: "blocked", reason: beforeRead.reason, halt: true };
  }

  const fresh = readFreshBead(operations, candidate);
  if (!fresh.ok) {
    return { kind: "blocked", reason: fresh.reason, halt: false };
  }
  if (fresh.bead.status === "closed") {
    return {
      kind: "blocked",
      reason: `exact Bead reread found ${candidate.beadId} closed before metadata persistence`,
      halt: false,
    };
  }

  let nextCoven: JsonRecord;
  try {
    nextCoven = removeLifecycleRecord(
      fresh.coven,
      candidate.location,
      candidate.rawRecord,
      repositoryRoot,
    );
  } catch (error) {
    return { kind: "blocked", reason: errorMessage(error), halt: false };
  }

  const branch = probeAbsent(
    "exact local branch probe",
    () => operations.probeLocalBranch(candidate.branch),
    `exact local branch still exists: ${candidate.branch}`,
  );
  if (!branch.ok) {
    return { kind: "blocked", reason: branch.reason, halt: false };
  }

  const registered = probeAbsent(
    "registered worktree path probe",
    () => operations.probeRegisteredPath(candidate.path),
    `registered path still exists: ${candidate.path}`,
  );
  if (!registered.ok) {
    return { kind: "blocked", reason: registered.reason, halt: false };
  }

  const filesystem = probeAbsent(
    "filesystem path probe",
    () => operations.probeFilesystemPath(candidate.path),
    `recorded path exists on disk: ${candidate.path}`,
  );
  if (!filesystem.ok) {
    return { kind: "blocked", reason: filesystem.reason, halt: false };
  }

  const beforePersistence = checkpoint(
    operations,
    gateHandle,
    "before metadata persistence",
  );
  if (!beforePersistence.ok) {
    return {
      kind: "blocked",
      reason: beforePersistence.reason,
      halt: true,
    };
  }

  const expectedMetadata = {
    ...fresh.bead.metadata,
    coven: nextCoven,
  };
  const persistence = safeOperation("metadata persistence failed", () =>
    operations.persistCoven(candidate.beadId, nextCoven),
  );
  if (!persistence.ok) {
    const afterFailure = checkpoint(
      operations,
      gateHandle,
      "before failed-persistence verification",
    );
    if (!afterFailure.ok) {
      return {
        kind: "partial",
        reason: `${persistence.reason}; ${afterFailure.reason}; persistence outcome is unverifiable`,
        halt: true,
      };
    }
    const verification = readFreshBead(operations, candidate);
    if (!verification.ok) {
      return {
        kind: "partial",
        reason: `${persistence.reason}; persistence outcome is unverifiable: ${verification.reason}`,
        halt: true,
      };
    }
    if (verification.bead.status === "closed") {
      return {
        kind: "partial",
        reason: `${persistence.reason}; ${candidate.beadId} closed after persistence was attempted; persistence outcome is unverifiable`,
        halt: true,
      };
    }
    if (isDeepStrictEqual(verification.bead.metadata, expectedMetadata)) {
      return {
        kind: "partial",
        reason: `${persistence.reason}; exact reread confirmed the intended metadata landed`,
        halt: true,
      };
    }
    if (isDeepStrictEqual(verification.bead.metadata, fresh.bead.metadata)) {
      return {
        kind: "blocked",
        reason: `${persistence.reason}; exact reread confirmed metadata remained unchanged`,
        halt: false,
      };
    }
    return {
      kind: "partial",
      reason: `${persistence.reason}; exact reread found an unexpected metadata snapshot, so persistence is unverifiable`,
      halt: true,
    };
  }

  const beforeVerification = checkpoint(
    operations,
    gateHandle,
    "before post-persistence verification",
  );
  if (!beforeVerification.ok) {
    return {
      kind: "partial",
      reason: `${beforeVerification.reason}; metadata persistence completed but verification did not`,
      halt: true,
    };
  }

  const verification = readFreshBead(operations, candidate);
  if (!verification.ok) {
    return {
      kind: "partial",
      reason: `metadata persistence verification failed: ${verification.reason}`,
      halt: true,
    };
  }
  if (verification.bead.status === "closed") {
    return {
      kind: "partial",
      reason: `metadata persistence verification failed: ${candidate.beadId} closed after persistence; repair is partial`,
      halt: true,
    };
  }
  if (!isDeepStrictEqual(verification.bead.metadata, expectedMetadata)) {
    return {
      kind: "partial",
      reason:
        "metadata persistence verification failed: fresh metadata does not exactly match the intended snapshot",
      halt: true,
    };
  }
  return { kind: "repaired" };
}

function compareRepairOrder(
  left: {
    candidate: OrphanedWorktreeMetadataRecord;
  },
  right: {
    candidate: OrphanedWorktreeMetadataRecord;
  },
): number {
  if (
    left.candidate.location === "primary" &&
    right.candidate.location === "primary"
  ) {
    return 0;
  }
  if (left.candidate.location === "primary") return 1;
  if (right.candidate.location === "primary") return -1;
  const leftIndex = Number(left.candidate.location.slice("additional:".length));
  const rightIndex = Number(right.candidate.location.slice("additional:".length));
  return rightIndex - leftIndex;
}

export function repairOrphanedWorktreeMetadata({
  candidates,
  maxRepairs,
  gateHandle,
  repositoryRoot = process.cwd(),
  operations,
}: {
  candidates: OrphanedWorktreeMetadataRecord[];
  maxRepairs: number;
  gateHandle: MetadataRepairGateHandle;
  repositoryRoot?: string;
  operations: MetadataRepairOperations;
}): MetadataRepairReport {
  if (!Number.isSafeInteger(maxRepairs) || maxRepairs < 0) {
    throw new Error("maxRepairs must be a non-negative safe integer");
  }
  const repairable = candidates.filter((candidate) => candidate.repairable);
  const selected = repairable.slice(0, maxRepairs);
  const report: MetadataRepairReport = {
    repaired: [],
    blocked: [],
    partial: [],
    pending: [],
  };
  const work = selected.map((candidate, index) => ({ candidate, index }));
  const byBead = new Map<string, typeof work>();
  for (const item of work) {
    const grouped = byBead.get(item.candidate.beadId) ?? [];
    grouped.push(item);
    byBead.set(item.candidate.beadId, grouped);
  }
  const results = new Map<number, RepairOneResult>();
  let halted = false;
  for (const group of byBead.values()) {
    group.sort(compareRepairOrder);
    for (const item of group) {
      if (halted) break;
      const result = repairOne(
        item.candidate,
        gateHandle,
        repositoryRoot,
        operations,
      );
      results.set(item.index, result);
      if (result.kind !== "repaired" && result.halt) halted = true;
    }
    if (halted) break;
  }
  for (const [index, candidate] of selected.entries()) {
    const result = results.get(index);
    if (result === undefined) {
      report.pending.push(candidate);
    } else if (result.kind === "repaired") {
      report.repaired.push(candidate);
    } else if (result.kind === "partial") {
      partialReason(report, candidate, result.reason);
    } else {
      blockedReason(report, candidate, result.reason);
    }
  }
  report.pending.push(...repairable.slice(maxRepairs));
  return report;
}

function command(
  executable: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
  timeout = COMMAND_TIMEOUT_MS,
): CommandResult {
  const result = spawnSync(executable, args, {
    cwd,
    env,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    status: result.status,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr: typeof result.stderr === "string" ? result.stderr : "",
    error: result.error instanceof Error ? result.error.message : "",
  };
}

function strictInput(value: string, label: string): string {
  if (value.length === 0 || value.includes("\0")) {
    throw new Error(`${label} must be nonblank and contain no NUL bytes`);
  }
  return value;
}

export function probeMetadataRepairPathPresence(
  recordedPath: string,
  probe: (candidate: string) => unknown = lstatSync,
): PresenceResult {
  try {
    strictInput(recordedPath, "recorded path");
    const normalized = normalizeAbsoluteWorktreePath(recordedPath);
    if (normalized === null) throw new Error("recorded path must be absolute");
    try {
      probe(normalized);
      return { ok: true, present: true };
    } catch (error) {
      const code =
        isRecord(error) && typeof error.code === "string"
          ? error.code
          : "UNKNOWN";
      if (code === "ENOENT" || code === "ENOTDIR") {
        return { ok: true, present: false };
      }
      throw new Error(
        `could not establish path absence (${code}): ${errorMessage(error)}`,
      );
    }
  } catch (error) {
    return { ok: false, reason: errorMessage(error) };
  }
}

function parseJsonCommand(
  result: CommandResult,
  label: string,
): unknown {
  if (result.status !== 0 || result.error) {
    throw new Error(
      result.stderr || result.error || `${label} exited with status ${result.status}`,
    );
  }
  if (result.stderr.length > 0) {
    throw new Error(`${label} wrote to stderr despite reporting success: ${result.stderr}`);
  }
  if (result.stdout.includes("\0")) {
    throw new Error(`${label} returned a NUL byte`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`${label} returned malformed JSON`);
  }
}

function candidateFromWrapper(value: JsonRecord): unknown {
  const wrapperKeys = ["issue", "issues"].filter((key) =>
    Object.prototype.hasOwnProperty.call(value, key),
  );
  const looksLikeIssue =
    Object.prototype.hasOwnProperty.call(value, "id") ||
    Object.prototype.hasOwnProperty.call(value, "status") ||
    Object.prototype.hasOwnProperty.call(value, "metadata");
  if (looksLikeIssue && wrapperKeys.length > 0) {
    throw new Error("exact Bead response is ambiguous");
  }
  if (looksLikeIssue) return value;
  if (wrapperKeys.length !== 1) {
    throw new Error("exact Bead response is malformed");
  }
  return value[wrapperKeys[0]!];
}

function exactSingleCandidate(value: unknown): unknown {
  if (Array.isArray(value)) {
    if (value.length !== 1) {
      throw new Error("exact Bead response must contain one issue");
    }
    return value[0];
  }
  if (!isRecord(value)) {
    throw new Error("exact Bead response is malformed");
  }
  const candidate = candidateFromWrapper(value);
  if (Array.isArray(candidate)) {
    if (candidate.length !== 1) {
      throw new Error("exact Bead response must contain one issue");
    }
    return candidate[0];
  }
  return candidate;
}

function parseExactBead(value: unknown, beadId: string): ExactMetadataBead {
  const candidate = exactSingleCandidate(value);
  if (!isRecord(candidate)) {
    throw new Error("exact Bead response is malformed");
  }
  if (candidate.id !== beadId) {
    throw new Error(`bd response did not return exact Bead ${beadId}`);
  }
  if (
    candidate.metadata !== undefined &&
    candidate.metadata !== null &&
    !isRecord(candidate.metadata)
  ) {
    throw new Error("exact Bead metadata must be an object or null");
  }
  return {
    id: beadId,
    status: parseBeadStatus(candidate.status),
    metadata: isRecord(candidate.metadata) ? candidate.metadata : {},
  };
}

function parseRegisteredWorktreePaths(raw: string): string[] {
  if (raw.length === 0) return [];
  if (!raw.endsWith("\0\0")) {
    throw new Error("git worktree inventory is not double-NUL terminated");
  }
  return raw
    .split("\0\0")
    .filter((record) => record.length > 0)
    .map((record) => {
      const fields = record.split("\0").filter((field) => field.length > 0);
      const worktreeFields = fields.filter((field) => field.startsWith("worktree "));
      if (worktreeFields.length !== 1) {
        throw new Error("git worktree inventory has an ambiguous worktree field");
      }
      const normalized = normalizeAbsoluteWorktreePath(
        worktreeFields[0]!.slice("worktree ".length),
      );
      if (normalized === null) {
        throw new Error("git worktree inventory contains a non-absolute path");
      }
      return normalized;
    });
}

export function createMetadataRepairOperations({
  root,
}: {
  root: string;
}): MetadataRepairOperations {
  const normalizedRoot = realpathSync(root);
  const heartbeatGate = heartbeatMaintenanceGate as unknown as (
    handle: MetadataRepairGateHandle,
  ) => GateFunctionResult;
  const verifyGate = verifyMaintenanceGateOwnership as unknown as (
    handle: MetadataRepairGateHandle,
  ) => GateFunctionResult;

  return {
    heartbeatAndVerifyGate(handle) {
      const heartbeated = heartbeatGate(handle);
      if (!heartbeated.ok) {
        return {
          ok: false,
          reason: `heartbeat failed: ${heartbeated.reason ?? "unknown error"}`,
        };
      }
      const verified = verifyGate(handle);
      return verified.ok
        ? { ok: true }
        : {
            ok: false,
            reason: `ownership verification failed: ${verified.reason ?? "unknown error"}`,
          };
    },
    readBead(beadId) {
      try {
        strictInput(beadId, "Bead id");
        const result = command("bd", ["show", beadId, "--json"], normalizedRoot);
        return {
          ok: true,
          bead: parseExactBead(parseJsonCommand(result, `bd show ${beadId}`), beadId),
        };
      } catch (error) {
        return { ok: false, reason: errorMessage(error) };
      }
    },
    probeLocalBranch(branch) {
      try {
        strictInput(branch, "local branch");
        if (branch.startsWith("refs/")) {
          throw new Error("local branch must not be a full ref");
        }
        const checked = command(
          "git",
          ["-C", normalizedRoot, "check-ref-format", "--branch", branch],
          normalizedRoot,
          sanitizedGitEnvironment(),
        );
        if (
          checked.status !== 0 ||
          checked.error ||
          checked.stderr.length > 0 ||
          checked.stdout.trim() !== branch
        ) {
          throw new Error(
            checked.stderr || checked.error || `invalid exact local branch: ${branch}`,
          );
        }
        const fullRef = `refs/heads/${branch}`;
        const result = command(
          "git",
          ["-C", normalizedRoot, "show-ref", "--verify", "--quiet", fullRef],
          normalizedRoot,
          sanitizedGitEnvironment(),
        );
        if (result.error || result.stdout.length > 0 || result.stderr.length > 0) {
          throw new Error(
            result.stderr || result.error || `unexpected output probing ${fullRef}`,
          );
        }
        if (result.status === 0) return { ok: true, present: true };
        if (result.status === 1) return { ok: true, present: false };
        throw new Error(`git show-ref exited with status ${result.status}`);
      } catch (error) {
        return { ok: false, reason: errorMessage(error) };
      }
    },
    probeRegisteredPath(recordedPath) {
      try {
        strictInput(recordedPath, "recorded path");
        const normalized = normalizeAbsoluteWorktreePath(recordedPath);
        if (normalized === null) throw new Error("recorded path must be absolute");
        const result = command(
          "git",
          ["-C", normalizedRoot, "worktree", "list", "--porcelain", "-z"],
          normalizedRoot,
          sanitizedGitEnvironment(),
        );
        if (result.status !== 0 || result.error) {
          throw new Error(
            result.stderr ||
              result.error ||
              `git worktree list exited with status ${result.status}`,
          );
        }
        if (result.stderr.length > 0) {
          throw new Error(`git worktree list wrote to stderr: ${result.stderr}`);
        }
        const paths = parseRegisteredWorktreePaths(result.stdout);
        return {
          ok: true,
          present: paths.some((candidate) => candidate === normalized),
        };
      } catch (error) {
        return { ok: false, reason: errorMessage(error) };
      }
    },
    probeFilesystemPath(recordedPath) {
      return probeMetadataRepairPathPresence(recordedPath);
    },
    persistCoven(beadId, nextCoven) {
      try {
        strictInput(beadId, "Bead id");
        const result = command(
          "bd",
          [
            "update",
            beadId,
            "--metadata",
            JSON.stringify({ coven: nextCoven }),
            "--json",
          ],
          normalizedRoot,
          process.env,
          MAX_FENCED_MUTATION_TIMEOUT_MS,
        );
        parseExactBead(
          parseJsonCommand(result, `bd update ${beadId}`),
          beadId,
        );
        return { ok: true };
      } catch (error) {
        return { ok: false, reason: errorMessage(error) };
      }
    },
  };
}
