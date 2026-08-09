import { lstatSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import {
  heartbeatMaintenanceGate,
  verifyMaintenanceGateOwnership,
} from "./maintenance-gate.mjs";
import { normalizeAbsoluteWorktreePath } from "../src/lib/worktree-lifecycle.ts";
import type { OrphanedWorktreeMetadataRecord } from "./worktree-lifecycle-inventory.ts";

type JsonRecord = Record<string, unknown>;

type OperationResult = { ok: true } | { ok: false; reason: string };
type PresenceResult =
  | { ok: true; present: boolean }
  | { ok: false; reason: string };

export type MetadataRepairGateHandle = {
  root?: string;
  ownerId?: string;
  generation: number;
  token: string;
};

export type ExactMetadataBead = {
  id: string;
  metadata: JsonRecord;
};

export type MetadataRepairReport = {
  repaired: OrphanedWorktreeMetadataRecord[];
  blocked: Array<{
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

const COMMAND_TIMEOUT_MS = 120_000;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
): Array<{
  location: OrphanedWorktreeMetadataRecord["location"];
  record: JsonRecord;
}> {
  const records: Array<{
    location: OrphanedWorktreeMetadataRecord["location"];
    record: JsonRecord;
  }> = [];
  if (coven.worktree !== undefined && coven.worktree !== null) {
    if (!isRecord(coven.worktree)) {
      throw new Error("fresh primary lifecycle metadata is malformed");
    }
    records.push({ location: "primary", record: coven.worktree });
  }
  if (coven.worktrees !== undefined && coven.worktrees !== null) {
    if (!Array.isArray(coven.worktrees)) {
      throw new Error("fresh additional lifecycle metadata is malformed");
    }
    for (const [index, record] of coven.worktrees.entries()) {
      if (!isRecord(record)) {
        throw new Error(`fresh additional lifecycle metadata ${index} is malformed`);
      }
      records.push({ location: `additional:${index}`, record });
    }
  }
  return records;
}

function assertUnambiguousLifecycleIdentity(
  records: ReturnType<typeof currentLifecycleRecords>,
  location: OrphanedWorktreeMetadataRecord["location"],
  expected: JsonRecord,
): void {
  const expectedBranch =
    typeof expected.branch === "string" ? expected.branch : null;
  const expectedPath =
    typeof expected.path === "string"
      ? normalizeAbsoluteWorktreePath(expected.path)
      : null;
  const conflicts = records
    .filter((candidate) => candidate.location !== location)
    .filter((candidate) => {
      const candidateBranch =
        typeof candidate.record.branch === "string"
          ? candidate.record.branch
          : null;
      const candidatePath =
        typeof candidate.record.path === "string"
          ? normalizeAbsoluteWorktreePath(candidate.record.path)
          : null;
      return (
        (expectedBranch !== null && candidateBranch === expectedBranch) ||
        (expectedPath !== null && candidatePath === expectedPath)
      );
    })
    .map((candidate) => candidate.location);
  if (conflicts.length > 0) {
    throw new Error(
      `fresh lifecycle metadata is ambiguous with ${conflicts.join(", ")}`,
    );
  }
}

export function removeLifecycleRecord(
  coven: JsonRecord,
  location: OrphanedWorktreeMetadataRecord["location"],
  expected: JsonRecord,
): JsonRecord {
  const records = currentLifecycleRecords(coven);
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
  assertUnambiguousLifecycleIdentity(records, location, expected);

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
  if (!isRecord(result.bead.metadata)) {
    return { ok: false, reason: "exact Bead reread returned malformed metadata" };
  }
  if (!isRecord(result.bead.metadata.coven)) {
    return { ok: false, reason: "exact Bead reread is missing coven metadata" };
  }
  return {
    ok: true,
    bead: result.bead,
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
  operations: MetadataRepairOperations,
): OperationResult {
  let result = checkpoint(
    operations,
    gateHandle,
    "before exact Bead reread",
  );

  let fresh:
    | { ok: true; bead: ExactMetadataBead; coven: JsonRecord }
    | { ok: false; reason: string }
    | null = null;
  let nextCoven: JsonRecord | null = null;
  if (result.ok) {
    fresh = readFreshBead(operations, candidate);
    if (!fresh.ok) result = fresh;
  }
  if (result.ok && fresh?.ok) {
    try {
      nextCoven = removeLifecycleRecord(
        fresh.coven,
        candidate.location,
        candidate.record,
      );
    } catch (error) {
      result = { ok: false, reason: errorMessage(error) };
    }
  }

  if (result.ok) {
    result = probeAbsent(
      "exact local branch probe",
      () => operations.probeLocalBranch(candidate.branch),
      `exact local branch still exists: ${candidate.branch}`,
    );
  }
  if (result.ok) {
    result = probeAbsent(
      "registered worktree path probe",
      () => operations.probeRegisteredPath(candidate.path),
      `registered path still exists: ${candidate.path}`,
    );
  }
  if (result.ok) {
    result = probeAbsent(
      "filesystem path probe",
      () => operations.probeFilesystemPath(candidate.path),
      `recorded path exists on disk: ${candidate.path}`,
    );
  }
  if (result.ok) {
    result = checkpoint(
      operations,
      gateHandle,
      "before metadata persistence",
    );
  }
  if (result.ok && nextCoven !== null) {
    result = safeOperation("metadata persistence failed", () =>
      operations.persistCoven(candidate.beadId, nextCoven),
    );
  }
  if (result.ok) {
    result = checkpoint(
      operations,
      gateHandle,
      "before post-persistence verification",
    );
  }
  if (result.ok && fresh?.ok && nextCoven !== null) {
    const verification = readFreshBead(operations, candidate);
    if (!verification.ok) {
      result = {
        ok: false,
        reason: `metadata persistence verification failed: ${verification.reason}`,
      };
    } else {
      const expectedMetadata = {
        ...fresh.bead.metadata,
        coven: nextCoven,
      };
      if (!isDeepStrictEqual(verification.bead.metadata, expectedMetadata)) {
        result = {
          ok: false,
          reason:
            "metadata persistence verification failed: fresh metadata does not exactly match the intended snapshot",
        };
      }
    }
  }
  return result;
}

export function repairOrphanedWorktreeMetadata({
  candidates,
  maxRepairs,
  gateHandle,
  operations,
}: {
  candidates: OrphanedWorktreeMetadataRecord[];
  maxRepairs: number;
  gateHandle: MetadataRepairGateHandle;
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
    pending: repairable.slice(maxRepairs),
  };

  for (const candidate of selected) {
    const result = repairOne(candidate, gateHandle, operations);
    if (result.ok) report.repaired.push(candidate);
    else blockedReason(report, candidate, result.reason);
  }
  return report;
}

function command(
  executable: string,
  args: string[],
  cwd: string,
): CommandResult {
  const result = spawnSync(executable, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: COMMAND_TIMEOUT_MS,
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
