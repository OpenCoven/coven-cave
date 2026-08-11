import { spawnSync } from "node:child_process";
import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";
import {
  isDisposableIgnoredPath,
  normalizeAbsoluteWorktreePath,
  type WorktreeLifecycleItem,
  type WorktreeRemoteRef,
} from "../src/lib/worktree-lifecycle.ts";
import { collectWorktreeLifecycleInventory } from "./worktree-lifecycle-inventory.ts";
import {
  createFenceRenewal,
  heartbeatMaintenanceGate,
  MAX_FENCED_MUTATION_TIMEOUT_MS,
  verifyMaintenanceGateOwnership,
} from "./maintenance-gate.mjs";

const DEFAULT_MAX_RETIRE = 3;
const MAX_RETIRE_LIMIT = 10;
const ZERO_OID_40 = "0000000000000000000000000000000000000000";
const ZERO_OID_64 =
  "0000000000000000000000000000000000000000000000000000000000000000";
const OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const UNSAFE_GIT_ENVIRONMENT = new Set([
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_COMMON_DIR",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_NAMESPACE",
  "GIT_CEILING_DIRECTORIES",
  "GIT_DISCOVERY_ACROSS_FILESYSTEM",
  "GIT_IMPLICIT_WORK_TREE",
  "GIT_PREFIX",
  "GIT_EXEC_PATH",
  "GIT_OPTIONAL_LOCKS",
  "GIT_NO_REPLACE_OBJECTS",
  "GIT_REPLACE_REF_BASE",
  "GIT_GRAFT_FILE",
  "GIT_SHALLOW_FILE",
  "GIT_QUARANTINE_PATH",
  "GIT_LITERAL_PATHSPECS",
  "GIT_GLOB_PATHSPECS",
  "GIT_NOGLOB_PATHSPECS",
  "GIT_ICASE_PATHSPECS",
  "GIT_ATTR_NOSYSTEM",
  "GIT_EXTERNAL_DIFF",
  "GIT_DIFF_OPTS",
  "GIT_REF_PARANOIA",
  "GIT_CONFIG",
  "GIT_CONFIG_PARAMETERS",
  "GIT_CONFIG_GLOBAL",
  "GIT_CONFIG_SYSTEM",
  "GIT_CONFIG_NOSYSTEM",
]);

export type RetirementGateHandle = object;

export type RetirementBlock = {
  branch: string | null;
  ref: string | null;
  oid: string;
  reason: string;
  partial: boolean;
};

export type RemoteDeletionProposal = {
  ref: string;
  oid: string;
  localRetirementOid: string;
  mergedPr: number | null;
  reason: "remote-deletion-requires-separate-authorization";
};

export type RetirementAttempt = {
  ref: string;
  oid: string;
  action: "remove-worktree-and-local-ref" | "remove-local-ref";
  worktreePostcondition: "not-applicable" | "verified" | "failed";
  localRefPostcondition: "verified" | "failed" | "not-attempted";
  outcome: "retired" | "blocked" | "partial";
  reason: string | null;
};

export type RetirementReport = {
  retired: WorktreeLifecycleItem[];
  blocked: RetirementBlock[];
  cleanupReady: WorktreeLifecycleItem[];
  attempts: RetirementAttempt[];
  remoteDeletionProposals: RemoteDeletionProposal[];
};

type OperationSuccess = { ok: true };
type OperationFailure = { ok: false; reason: string };
type OperationResult = OperationSuccess | OperationFailure;
type ReprobeResult = OperationFailure | { ok: true; item: WorktreeLifecycleItem };
type RemoteReadResult = OperationFailure | { ok: true; remoteRef: WorktreeRemoteRef | null };

/**
 * Retention for a unit whose remote branch is gone: the tag ref on the remote
 * that resolves to the unit's exact head, or null when nothing retains it.
 */
type RetentionReadResult = OperationFailure | { ok: true; retainedBy: string | null };

export interface RetirementOperations {
  verifyGate(handle: RetirementGateHandle): OperationResult;
  heartbeatGate(handle: RetirementGateHandle): OperationResult;
  reprobe(item: WorktreeLifecycleItem): ReprobeResult;
  removeDisposableIgnored(item: WorktreeLifecycleItem): OperationResult;
  removeWorktree(item: WorktreeLifecycleItem): OperationResult;
  deleteLocalRef(item: WorktreeLifecycleItem): OperationResult;
  restoreLocalRef(item: WorktreeLifecycleItem): OperationResult;
  verifyAbsent(item: WorktreeLifecycleItem): OperationResult;
  readRemoteRef(ref: string): RemoteReadResult;
  readRemoteTagRetention(head: string): RetentionReadResult;
}

type RetirementState = {
  destructiveMutation: boolean;
  worktreeRemoved: boolean;
  localRefAbsent: boolean;
};

type GitRetirementHandle = RetirementGateHandle;

type CommandResult = {
  ok: boolean;
  status: number | null;
  stdout: string;
  stderr: string;
};

export function parseMaxRetire(value: string | undefined): number {
  if (value === undefined) return DEFAULT_MAX_RETIRE;
  if (typeof value === "string" && new RegExp(`^(?:[1-9]|${MAX_RETIRE_LIMIT})$`).test(value)) {
    return Number(value);
  }
  throw new Error("--max-retire must be an integer from 1 through 10");
}

export function retireLifecycleUnits({
  items,
  gateHandle,
  operations,
  maxRetire,
}: {
  items: WorktreeLifecycleItem[];
  gateHandle: RetirementGateHandle;
  operations: RetirementOperations;
  maxRetire?: string;
}): RetirementReport {
  const report: RetirementReport = {
    retired: [],
    blocked: [],
    cleanupReady: [],
    attempts: [],
    remoteDeletionProposals: [],
  };
  const batchSize = parseMaxRetire(maxRetire);
  const eligible = [...items]
    .filter((item) => item.lane === "retire-after-gate")
    .sort(compareRetirementCandidates);
  const selected = eligible.slice(0, batchSize);
  report.cleanupReady = eligible.slice(batchSize);

  for (let index = 0; index < selected.length; index += 1) {
    const item = selected[index]!;
    const attempt = beginAttempt(item);
    const state: RetirementState = {
      destructiveMutation: false,
      worktreeRemoved: false,
      localRefAbsent: false,
    };
    let currentItem = item;
    const expectedRemoteRef = item.remoteRef;

    const initialGate = heartbeatThenVerify(operations, gateHandle, "before retirement");
    if (!initialGate.ok) {
      reportFailure(report, item, attempt, state, initialGate.reason);
      cascadeRemainingBlocked(report, selected, index + 1, initialGate.reason);
      break;
    }

    const reprobed = safeInvoke("reprobe", () => operations.reprobe(item));
    if (!reprobed.ok) {
      reportFailure(report, item, attempt, state, reprobed.reason);
      continue;
    }
    const reprobeIdentityError = retirementIdentityError(item, reprobed.item);
    if (reprobeIdentityError !== null) {
      reportFailure(report, item, attempt, state, reprobeIdentityError);
      continue;
    }
    currentItem = reprobed.item;
    if (!stillRetireReady(currentItem)) {
      reportFailure(
        report,
        item,
        attempt,
        state,
        "retirement candidate is no longer clean enough to retire",
      );
      continue;
    }

    // `remoteRef` is deliberately NOT part of retirementIdentityError, so a
    // transient remote-read failure at inventory time can report null for a
    // branch that still exists. Prefer the reprobed observation so that stale
    // null does not force the tag-retention path and refuse a unit that is
    // plainly retained; fall back to the inventory value so a branch that
    // disappeared BETWEEN the two observations still fails the live
    // revalidation below rather than quietly taking the tag path. Neither
    // observation is trusted on its own -- whichever is used is revalidated
    // against the live remote before anything is destroyed.
    const remoteRefForCheck = currentItem.remoteRef ?? expectedRemoteRef;

    if (remoteRefForCheck !== null) {
      const remotePrecheck = readRemoteRefStrict(
        operations,
        remoteRefForCheck,
        "before local retirement started",
      );
      if (!remotePrecheck.ok) {
        reportFailure(report, item, attempt, state, remotePrecheck.reason);
        continue;
      }
    } else {
      // The remote branch is gone -- the DEFAULT here, because merging deletes
      // it. Landing proof says the CONTENT is on the default branch, squashed;
      // it says nothing about the branch's own pre-squash commits, which after
      // branch deletion survive only in the provider's PR record. Retiring on
      // landing alone therefore drops them, so require the same proof the
      // manual route requires: a tag on the remote resolving to this exact
      // head. Fail closed -- an unreadable remote is not evidence of retention.
      const retention = safeInvoke("readRemoteTagRetention", () =>
        operations.readRemoteTagRetention(currentItem.head),
      );
      if (!retention.ok) {
        reportFailure(report, item, attempt, state, retention.reason);
        continue;
      }
      if (retention.retainedBy === null) {
        reportFailure(
          report,
          item,
          attempt,
          state,
          `remote branch is absent and no remote tag resolves to ${currentItem.head}; ` +
            "archive the head to a pushed tag before retiring",
        );
        continue;
      }
    }

    if (currentItem.path !== null && currentItem.ignoredPaths.length > 0) {
      const preCleanupGate = heartbeatThenVerify(operations, gateHandle, "before ignored cleanup");
      if (!preCleanupGate.ok) {
        reportFailure(report, item, attempt, state, preCleanupGate.reason);
        cascadeRemainingBlocked(report, selected, index + 1, preCleanupGate.reason);
        break;
      }

      const cleaned = safeInvoke("removeDisposableIgnored", () =>
        operations.removeDisposableIgnored(currentItem),
      );
      if (!cleaned.ok) {
        reportFailure(report, item, attempt, state, cleaned.reason);
        continue;
      }
      state.destructiveMutation = true;
      const postCleanupProbe = safeInvoke("reprobe", () => operations.reprobe(currentItem));
      if (!postCleanupProbe.ok) {
        reportFailure(report, item, attempt, state, postCleanupProbe.reason);
        continue;
      }
      const postCleanupIdentityError = retirementIdentityError(item, postCleanupProbe.item);
      if (postCleanupIdentityError !== null) {
        reportFailure(report, item, attempt, state, postCleanupIdentityError);
        continue;
      }
      if (!stillRetireReady(postCleanupProbe.item)) {
        reportFailure(
          report,
          item,
          attempt,
          state,
          "retirement candidate is no longer clean enough to retire",
        );
        continue;
      }
      currentItem = postCleanupProbe.item;
    }

    if (currentItem.path !== null) {
      const preWorktreeGate = heartbeatThenVerify(
        operations,
        gateHandle,
        "before worktree removal",
      );
      if (!preWorktreeGate.ok) {
        reportFailure(report, item, attempt, state, preWorktreeGate.reason);
        cascadeRemainingBlocked(report, selected, index + 1, preWorktreeGate.reason);
        break;
      }

      const removed = safeInvoke("removeWorktree", () => operations.removeWorktree(currentItem));
      if (!removed.ok) {
        reportFailure(report, item, attempt, state, removed.reason);
        continue;
      }
      state.destructiveMutation = true;
      state.worktreeRemoved = true;
    }

    const midGate = heartbeatThenVerify(operations, gateHandle, "before local ref retirement");
    if (!midGate.ok) {
      reportFailure(
        report,
        item,
        attempt,
        state,
        midGate.reason,
      );
      cascadeRemainingBlocked(report, selected, index + 1, midGate.reason);
      break;
    }

    const deleted = safeInvoke("deleteLocalRef", () => operations.deleteLocalRef(currentItem));
    if (!deleted.ok) {
      attempt.localRefPostcondition = "failed";
      const absentAfterDeleteFailure = safeInvoke("verifyAbsent", () =>
        operations.verifyAbsent(currentItem),
      );
      if (absentAfterDeleteFailure.ok) {
        state.destructiveMutation = true;
        state.localRefAbsent = true;
        attempt.worktreePostcondition =
          currentItem.path === null ? "not-applicable" : "verified";
        attempt.localRefPostcondition = "verified";
      }
      reportFailure(report, item, attempt, state, deleted.reason);
      continue;
    }
    state.destructiveMutation = true;
    state.localRefAbsent = true;

    const absent = safeInvoke("verifyAbsent", () => operations.verifyAbsent(currentItem));
    if (!absent.ok) {
      const handled = restoreWhenPermitted(
        operations,
        gateHandle,
        currentItem,
        attempt,
        state,
        absent.reason,
      );
      reportFailure(report, item, attempt, handled.state, handled.reason);
      if (handled.lostGate) {
        cascadeRemainingBlocked(report, selected, index + 1, handled.reason);
        break;
      }
      continue;
    }
    attempt.worktreePostcondition = currentItem.path === null ? "not-applicable" : "verified";
    attempt.localRefPostcondition = "verified";

    if (remoteRefForCheck !== null) {
      const remote = readRemoteRefStrict(
        operations,
        remoteRefForCheck,
        "before local retirement completed",
      );
      if (!remote.ok) {
        const handled = restoreWhenPermitted(
          operations,
          gateHandle,
          currentItem,
          attempt,
          state,
          remote.reason,
        );
        reportFailure(report, item, attempt, handled.state, handled.reason);
        if (handled.lostGate) {
          cascadeRemainingBlocked(report, selected, index + 1, handled.reason);
          break;
        }
        continue;
      }
    }

    const finalGate = heartbeatThenVerify(operations, gateHandle, "after local retirement");
    if (!finalGate.ok) {
      reportFailure(report, item, attempt, state, finalGate.reason);
      cascadeRemainingBlocked(report, selected, index + 1, finalGate.reason);
      break;
    }

    attempt.outcome = "retired";
    attempt.reason = null;
    report.attempts.push({ ...attempt });
    report.retired.push(currentItem);
    if (remoteRefForCheck !== null) {
      report.remoteDeletionProposals.push({
        ref: remoteRefForCheck.ref,
        oid: remoteRefForCheck.oid,
        localRetirementOid: currentItem.head,
        mergedPr: currentItem.mergedPr?.number ?? null,
        reason: "remote-deletion-requires-separate-authorization",
      });
    }
  }

  return report;
}

export function createGitRetirementOperations({
  root,
  repo,
  gateHandle,
  nowMs,
  // Injected so a test can observe renewal without waiting out the throttle.
  // The real factory skips its first call and then renews at most every
  // FENCE_RENEWAL_INTERVAL_MS, so against a small fixture inventory every call
  // is throttled and a missing hook looks exactly like a working one.
  createFenceRenewal: makeFenceRenewal = createFenceRenewal,
}: {
  root: string;
  repo: string;
  gateHandle: GitRetirementHandle;
  nowMs?: number | (() => number);
  createFenceRenewal?: typeof createFenceRenewal;
}): RetirementOperations {
  const normalizedRoot = realpathSync(root);
  const maintenanceHandle = gateHandle;

  const readNowMs = (): number =>
    typeof nowMs === "function" ? nowMs() : (nowMs ?? Date.now());

  // Renew the fence while reprobe's inventory runs.
  //
  // reprobe() below rebuilds the WHOLE lifecycle inventory to re-verify one
  // unit, and that is not a quick read: 134s for 47 units when measured on the
  // checkout this was found on, against a COVEN_OWNER_LEASE_MS of 120s. It runs
  // inside the fence, between the "before retirement" and "before ignored
  // cleanup" checkpoints, so without renewal the lease is always dead by the
  // time retirement takes its next step — every retirement blocked with
  // "maintenance lease expired", and no worktree on that checkout had ever been
  // retired. Traced by pointing COVEN_BIN at a logging shim: 129 seconds passed
  // between two heartbeats with no coven call of any kind in between.
  //
  // One renewal is shared by both reprobe call sites (the pre-retirement probe
  // and the post-cleanup one) so the 30s throttle is applied across the whole
  // retirement rather than reset per probe.
  //
  // Progress-anchored rather than timed, because the inventory is synchronous
  // throughout and never yields — see createFenceRenewal. A failed heartbeat
  // throws, which is its documented fail-closed contract; reprobe's own
  // try/catch turns that into a probe failure, so the unit is reported as
  // blocked instead of being retired behind a fence nobody holds.
  const renewFenceDuringProbe = makeFenceRenewal(() => {
    const renewed = heartbeatMaintenanceGate(maintenanceHandle);
    if (!renewed.ok) {
      throw new Error(
        `failed to heartbeat maintenance gate during retirement probe: ${
          renewed.reason ?? "unknown heartbeat error"
        }`,
      );
    }
  });

  return {
    verifyGate() {
      const verified = verifyMaintenanceGateOwnership(maintenanceHandle);
      return verified.ok
        ? { ok: true }
        : {
            ok: false,
            reason: verified.reason ?? "maintenance gate ownership check failed",
          };
    },
    heartbeatGate() {
      const heartbeated = heartbeatMaintenanceGate(maintenanceHandle);
      return heartbeated.ok
        ? { ok: true }
        : {
            ok: false,
            reason: heartbeated.reason ?? "maintenance gate heartbeat failed",
          };
    },
    reprobe(item) {
      if (item.ref === null) {
        return {
          ok: false,
          reason: "retirement candidate is missing an exact full local ref",
        };
      }
      let inventory;
      try {
        inventory = collectWorktreeLifecycleInventory({
          repo,
          root: normalizedRoot,
          nowMs: readNowMs(),
          onProgress: renewFenceDuringProbe,
        });
      } catch (error) {
        return {
          ok: false,
          reason: `final retirement probe failed: ${errorMessage(error)}`,
        };
      }
      const matches = inventory.items.filter((candidate) => candidate.ref === item.ref);
      if (matches.length === 0) {
        return {
          ok: false,
          reason: "candidate disappeared during final retirement probe",
        };
      }
      if (matches.length > 1) {
        return {
          ok: false,
          reason: "retirement candidate ref became ambiguous during final retirement probe",
        };
      }
      const reprobed = matches[0]!;
      const identityError = retirementIdentityError(item, reprobed);
      if (identityError !== null) return { ok: false, reason: identityError };
      if (!stillRetireReady(reprobed)) {
        return {
          ok: false,
          reason: "retirement candidate is no longer clean enough to retire",
        };
      }
      return { ok: true, item: reprobed };
    },
    removeDisposableIgnored(item) {
      const worktreePath = normalizeAbsoluteWorktreePath(item.path);
      if (worktreePath === null) return { ok: true };
      for (const rawCandidate of [...new Set(item.ignoredPaths)]) {
        const resolved = resolveDisposableIgnoredTarget(worktreePath, rawCandidate);
        if (!resolved.ok) return resolved;
        const heartbeated = heartbeatMaintenanceGate(maintenanceHandle);
        if (!heartbeated.ok) {
          return {
            ok: false,
            reason:
              heartbeated.reason ??
              "maintenance gate heartbeat failed before disposable cleanup",
          };
        }
        const verified = verifyMaintenanceGateOwnership(maintenanceHandle);
        if (!verified.ok) {
          return {
            ok: false,
            reason:
              verified.reason ??
              "maintenance gate ownership check failed before disposable cleanup",
          };
        }
        const removed = command(
          process.execPath,
          [
            "-e",
            "try { require('node:fs').rmSync(process.argv[1], { recursive: true, force: false, maxRetries: 8, retryDelay: 100 }) } catch (error) { if (error?.code !== 'ENOENT') throw error }",
            resolved.target,
          ],
          normalizedRoot,
          MAX_FENCED_MUTATION_TIMEOUT_MS,
        );
        if (!removed.ok) {
          return {
            ok: false,
            reason: `disposable ignored cleanup failed for ${rawCandidate}: ${
              removed.stderr || "bounded cleanup command failed"
            }`,
          };
        }
      }
      return { ok: true };
    },
    removeWorktree(item) {
      const worktreePath = normalizeAbsoluteWorktreePath(item.path);
      if (worktreePath === null) return { ok: true };
      const removed = git(
        normalizedRoot,
        ["worktree", "remove", worktreePath],
        MAX_FENCED_MUTATION_TIMEOUT_MS,
      );
      return removed.ok
        ? { ok: true }
        : {
            ok: false,
            reason: removed.stderr || "git worktree remove failed",
          };
    },
    deleteLocalRef(item) {
      if (item.ref === null) {
        return { ok: false, reason: "retirement candidate is missing an exact full local ref" };
      }
      const validated = validateExactLocalRef(normalizedRoot, item.ref);
      if (!validated.ok) return validated;
      const currentRef = git(normalizedRoot, ["show-ref", "--verify", "--hash", item.ref]);
      const currentLine = strictSingleLine(currentRef.stdout);
      if (!currentRef.ok || currentLine === null || !OID.test(currentLine)) {
        return {
          ok: false,
          reason: `local ref OID probe failed before compare-delete: ${item.ref}`,
        };
      }
      if (currentLine !== item.head) {
        return { ok: false, reason: "local ref moved before compare-delete" };
      }
      const directness = git(normalizedRoot, ["symbolic-ref", "-q", item.ref]);
      if (directness.status === 0) {
        return {
          ok: false,
          reason: `local ref became symbolic before compare-delete: ${item.ref}`,
        };
      }
      if (directness.status !== 1) {
        return {
          ok: false,
          reason: directness.stderr || `local ref directness probe failed for ${item.ref}`,
        };
      }
      const deleted = git(normalizedRoot, [
        "update-ref",
        "--no-deref",
        "-d",
        item.ref,
        item.head,
      ]);
      return deleted.ok
        ? { ok: true }
        : {
            ok: false,
            reason:
              deleted.stderr ||
              `git update-ref --no-deref compare-delete failed for ${item.ref}`,
          };
    },
    restoreLocalRef(item) {
      if (item.ref === null) {
        return { ok: false, reason: "retirement candidate is missing an exact full local ref" };
      }
      const validated = validateExactLocalRef(normalizedRoot, item.ref);
      if (!validated.ok) return validated;
      const restored = git(normalizedRoot, [
        "update-ref",
        "--no-deref",
        item.ref,
        item.head,
        zeroOidFor(item.head),
      ]);
      return restored.ok
        ? { ok: true }
        : {
            ok: false,
            reason:
              restored.stderr || `git update-ref --no-deref restore failed for ${item.ref}`,
          };
    },
    verifyAbsent(item) {
      if (item.path !== null) {
        const normalizedPath = normalizeAbsoluteWorktreePath(item.path);
        if (normalizedPath === null) {
          return { ok: false, reason: "invalid retirement candidate worktree path" };
        }
        const listed = git(
          normalizedRoot,
          ["worktree", "list", "--porcelain", "-z"],
          120_000,
        );
        if (!listed.ok) {
          return {
            ok: false,
            reason: listed.stderr || "git worktree list failed during absence verification",
          };
        }
        const registeredPaths = parseWorktreeListPaths(listed.stdout);
        if (registeredPaths === null) {
          return {
            ok: false,
            reason: "git worktree list returned malformed data during absence verification",
          };
        }
        if (registeredPaths.includes(normalizedPath)) {
          return {
            ok: false,
            reason: "worktree or local ref still present after retirement",
          };
        }
      }
      if (item.ref === null) {
        return { ok: false, reason: "retirement candidate is missing an exact full local ref" };
      }
      const validated = validateExactLocalRef(normalizedRoot, item.ref);
      if (!validated.ok) return validated;
      const refPresence = git(normalizedRoot, ["show-ref", "--verify", "--quiet", item.ref]);
      if (refPresence.status === 0) {
        return {
          ok: false,
          reason: "worktree or local ref still present after retirement",
        };
      }
      if (refPresence.status !== 1) {
        return {
          ok: false,
          reason: refPresence.stderr || `local ref absence probe failed for ${item.ref}`,
        };
      }
      return { ok: true };
    },
    readRemoteRef(ref) {
      const validated = validateExactLocalRef(normalizedRoot, ref);
      if (!validated.ok) return validated;
      const remote = git(
        normalizedRoot,
        ["ls-remote", "--exit-code", "--heads", "origin", ref],
        60_000,
      );
      if (remote.status === 2) return { ok: true, remoteRef: null };
      if (!remote.ok) {
        return {
          ok: false,
          reason: remote.stderr || `ls-remote failed for ${ref}`,
        };
      }
      const match = remote.stdout.match(
        /^((?:[0-9a-f]{40}|[0-9a-f]{64}))\t([^\n]+)\n?$/,
      );
      if (!match || match[2] !== ref) {
        return {
          ok: false,
          reason: `ls-remote returned malformed data for ${ref}`,
        };
      }
      return {
        ok: true,
        remoteRef: { ref: match[2], oid: match[1] },
      };
    },
    readRemoteTagRetention(head) {
      if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(head)) {
        return { ok: false, reason: `refusing to probe retention for malformed oid ${head}` };
      }
      const remote = git(normalizedRoot, ["ls-remote", "--tags", "origin"], 60_000);
      if (!remote.ok) {
        return {
          ok: false,
          reason: remote.stderr || "ls-remote --tags failed while proving retention",
        };
      }
      // An ANNOTATED tag emits two lines: `<tag-object-oid>\t<ref>` and
      // `<commit-oid>\t<ref>^{}`. A LIGHTWEIGHT tag emits only
      // `<commit-oid>\t<ref>`. So a tag retains `head` when its PEELED target
      // matches, falling back to the direct oid only when no peeled line
      // exists. Matching any line instead would report a tag as retaining its
      // own tag-object oid -- unreachable in practice, since a head is always a
      // commit, but it would make the probe mean something other than it says.
      const targets = new Map<string, { direct: string | null; peeled: string | null }>();
      for (const line of remote.stdout.split("\n")) {
        const match = line.match(/^((?:[0-9a-f]{40}|[0-9a-f]{64}))\t(refs\/tags\/[^\n]+?)(\^\{\})?$/);
        if (!match) continue;
        const [, oid, ref, peeledMarker] = match;
        const entry = targets.get(ref) ?? { direct: null, peeled: null };
        if (peeledMarker) entry.peeled = oid;
        else entry.direct = oid;
        targets.set(ref, entry);
      }
      for (const [ref, { direct, peeled }] of targets) {
        if ((peeled ?? direct) === head) return { ok: true, retainedBy: ref };
      }
      return { ok: true, retainedBy: null };
    },
  };
}

function compareRetirementCandidates(left: WorktreeLifecycleItem, right: WorktreeLifecycleItem): number {
  const leftUpdatedAt = left.updatedAtMs ?? Number.POSITIVE_INFINITY;
  const rightUpdatedAt = right.updatedAtMs ?? Number.POSITIVE_INFINITY;
  if (leftUpdatedAt !== rightUpdatedAt) return leftUpdatedAt - rightUpdatedAt;
  return retirementSortKey(left).localeCompare(retirementSortKey(right));
}

function retirementSortKey(item: WorktreeLifecycleItem): string {
  return item.ref ?? item.branch ?? item.path ?? item.head;
}

function beginAttempt(item: WorktreeLifecycleItem): RetirementAttempt {
  return {
    ref: item.ref ?? item.head,
    oid: item.head,
    action: item.path === null ? "remove-local-ref" : "remove-worktree-and-local-ref",
    worktreePostcondition: item.path === null ? "not-applicable" : "failed",
    localRefPostcondition: "not-attempted",
    outcome: "blocked",
    reason: null,
  };
}

function reportFailure(
  report: RetirementReport,
  item: WorktreeLifecycleItem,
  attempt: RetirementAttempt,
  state: RetirementState,
  reason: string,
): void {
  attempt.outcome =
    state.destructiveMutation || state.worktreeRemoved || state.localRefAbsent
      ? "partial"
      : "blocked";
  attempt.reason = reason;
  if (attempt.localRefPostcondition === "not-attempted" && state.localRefAbsent) {
    attempt.localRefPostcondition = "verified";
  }
  report.attempts.push({ ...attempt });
  report.blocked.push({
    branch: item.branch,
    ref: item.ref,
    oid: item.head,
    reason,
    partial: attempt.outcome === "partial",
  });
}

function cascadeRemainingBlocked(
  report: RetirementReport,
  selected: WorktreeLifecycleItem[],
  startIndex: number,
  reason: string,
): void {
  for (let index = startIndex; index < selected.length; index += 1) {
    const item = selected[index]!;
    report.blocked.push({
      branch: item.branch,
      ref: item.ref,
      oid: item.head,
      reason: `maintenance gate unavailable after earlier retirement failure: ${reason}`,
      partial: false,
    });
  }
}

function heartbeatThenVerify(
  operations: RetirementOperations,
  handle: RetirementGateHandle,
  phase:
    | "before retirement"
    | "before ignored cleanup"
    | "before worktree removal"
    | "before local ref retirement"
    | "after local retirement",
): OperationResult {
  const heartbeated = safeInvoke("heartbeatGate", () => operations.heartbeatGate(handle));
  if (!heartbeated.ok) {
    return {
      ok: false,
      reason: `maintenance gate heartbeat failed ${phase}: ${heartbeated.reason}`,
    };
  }
  const verified = safeInvoke("verifyGate", () => operations.verifyGate(handle));
  if (!verified.ok) {
    return {
      ok: false,
      reason: `maintenance gate ownership check failed ${phase}: ${verified.reason}`,
    };
  }
  return { ok: true };
}

function retirementIdentityError(
  expected: WorktreeLifecycleItem,
  actual: WorktreeLifecycleItem,
): string | null {
  if (actual.path !== expected.path) {
    return "retirement candidate path changed during final retirement probe";
  }
  if (actual.ref !== expected.ref) {
    return "retirement candidate ref changed during final retirement probe";
  }
  if (actual.head !== expected.head) {
    return "retirement candidate OID changed during final retirement probe";
  }
  if (actual.lane !== "retire-after-gate") {
    return "retirement candidate lane changed during final retirement probe";
  }
  return null;
}

function stillRetireReady(item: WorktreeLifecycleItem): boolean {
  return (
    item.lane === "retire-after-gate" &&
    item.changes.length === 0 &&
    item.nonDisposableIgnoredPaths.length === 0
  );
}

function restoreWhenPermitted(
  operations: RetirementOperations,
  gateHandle: RetirementGateHandle,
  item: WorktreeLifecycleItem,
  attempt: RetirementAttempt,
  state: RetirementState,
  reason: string,
): { reason: string; state: RetirementState; lostGate: boolean } {
  attempt.localRefPostcondition = "failed";
  const gate = safeInvoke("verifyGate", () => operations.verifyGate(gateHandle));
  if (!gate.ok) {
    return {
      reason: `${reason}; maintenance gate lost before restoration: ${gate.reason}`,
      state,
      lostGate: true,
    };
  }
  const restored = safeInvoke("restoreLocalRef", () => operations.restoreLocalRef(item));
  if (!restored.ok) {
    return {
      reason: `${reason}; local ref restoration failed: ${restored.reason}`,
      state,
      lostGate: false,
    };
  }
  state.localRefAbsent = false;
  return {
    reason,
    state,
    lostGate: false,
  };
}

function readRemoteRefStrict(
  operations: RetirementOperations,
  expectedRemoteRef: WorktreeRemoteRef,
  phase: "before local retirement started" | "before local retirement completed",
): RemoteReadResult {
  const remote = safeInvoke("readRemoteRef", () =>
    operations.readRemoteRef(expectedRemoteRef.ref),
  );
  if (!remote.ok) {
    return {
      ok: false,
      reason: `remote ref probe failed ${phase}: ${remote.reason}`,
    };
  }
  if (remote.remoteRef === null) {
    return {
      ok: false,
      reason: `remote ref disappeared ${phase}`,
    };
  }
  if (
    remote.remoteRef.ref !== expectedRemoteRef.ref ||
    remote.remoteRef.oid !== expectedRemoteRef.oid
  ) {
    return {
      ok: false,
      reason: `remote ref moved ${phase}`,
    };
  }
  return remote;
}

function safeInvoke<T extends { ok: boolean }>(
  label: string,
  operation: () => T,
): T | OperationFailure {
  try {
    return operation();
  } catch (error) {
    return {
      ok: false,
      reason: `${label} threw: ${errorMessage(error)}`,
    };
  }
}

function sanitizeGitEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (
      UNSAFE_GIT_ENVIRONMENT.has(key) ||
      /^GIT_CONFIG_(?:COUNT|KEY_\d+|VALUE_\d+)$/.test(key)
    ) {
      delete env[key];
    }
  }
  return env;
}

function command(
  executable: string,
  args: string[],
  cwd: string,
  timeout = 30_000,
): CommandResult {
  try {
    const result = spawnSync(executable, args, {
      cwd,
      env: sanitizeGitEnvironment(),
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      timeout,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const spawnError = result.error instanceof Error ? result.error.message : "";
    const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";
    return {
      ok: result.status === 0 && spawnError.length === 0,
      status: result.status,
      stdout: typeof result.stdout === "string" ? result.stdout : "",
      stderr: [stderr, spawnError].filter(Boolean).join(": "),
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      stdout: "",
      stderr: errorMessage(error),
    };
  }
}

function git(root: string, args: string[], timeout?: number): CommandResult {
  return command(
    "git",
    ["--no-optional-locks", "--no-replace-objects", "-C", root, ...args],
    root,
    timeout,
  );
}

function validateExactLocalRef(root: string, ref: string): OperationResult {
  if (!ref.startsWith("refs/heads/")) {
    return { ok: false, reason: `exact local branch ref is required: ${ref}` };
  }
  const checked = git(root, ["check-ref-format", ref]);
  if (!checked.ok || checked.stdout !== "" || checked.stderr) {
    return { ok: false, reason: checked.stderr || `invalid exact local ref: ${ref}` };
  }
  return { ok: true };
}

function strictSingleLine(raw: string): string | null {
  const body = raw.endsWith("\n") ? raw.slice(0, -1) : raw;
  if (!body || body.endsWith("\n") || body.includes("\r")) return null;
  return body;
}

function parseWorktreeListPaths(raw: string): string[] | null {
  const records = raw.split("\0\0").filter(Boolean);
  const paths: string[] = [];
  for (const record of records) {
    const field = record
      .split("\0")
      .filter(Boolean)
      .find((line) => line.startsWith("worktree "));
    if (!field) return null;
    const normalized = normalizeAbsoluteWorktreePath(field.slice("worktree ".length));
    if (normalized === null) return null;
    paths.push(normalized);
  }
  return paths;
}

function resolveDisposableIgnoredTarget(
  worktreePath: string,
  rawCandidate: string,
): OperationFailure | { ok: true; target: string } {
  if (rawCandidate.includes("\0")) {
    return { ok: false, reason: `invalid ignored path contains NUL: ${rawCandidate}` };
  }
  if (path.isAbsolute(rawCandidate)) {
    return {
      ok: false,
      reason: `refused disposable ignored cleanup outside the candidate worktree: ${rawCandidate}`,
    };
  }
  const normalizedRelative = rawCandidate.replace(/\\/g, "/").replace(/^\.\/+/, "");
  const segments = normalizedRelative.split("/").filter(Boolean);
  if (segments.length === 0 || segments.some((segment) => segment === "." || segment === "..")) {
    return {
      ok: false,
      reason: `refused disposable ignored cleanup outside the candidate worktree: ${rawCandidate}`,
    };
  }
  if (!isDisposableIgnoredPath(normalizedRelative)) {
    return {
      ok: false,
      reason: `refused non-disposable ignored cleanup path: ${rawCandidate}`,
    };
  }

  let current = worktreePath;
  for (const segment of segments) {
    current = path.join(current, segment);
    if (
      current !== worktreePath &&
      !current.startsWith(`${worktreePath}${path.sep}`)
    ) {
      return {
        ok: false,
        reason: `refused disposable ignored cleanup outside the candidate worktree: ${rawCandidate}`,
      };
    }
    try {
      const stat = lstatSync(current);
      if (stat.isSymbolicLink()) {
        return {
          ok: false,
          reason: `refused disposable ignored cleanup through a symbolic link: ${rawCandidate}`,
        };
      }
    } catch (error) {
      if (isErrno(error, "ENOENT")) {
        return { ok: true, target: current };
      }
      return {
        ok: false,
        reason: `disposable ignored cleanup probe failed for ${rawCandidate}: ${errorMessage(error)}`,
      };
    }
  }

  return { ok: true, target: current };
}

function zeroOidFor(oid: string): string {
  return oid.length === 64 ? ZERO_OID_64 : ZERO_OID_40;
}

function isErrno(error: unknown, code: string): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === code,
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}
