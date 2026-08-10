import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import type {
  DaemonRequest,
  DaemonResponse,
  DaemonTarget,
} from "@/lib/coven-daemon";
import { isSupportedDaemonApiVersion } from "../daemon-startup-contract.ts";

export const SESSION_LAUNCH_POLICY_CAPABILITY = "sessionLaunchPolicy";

export const SESSION_LAUNCH_POLICY_REQUIRED_DIAGNOSTIC =
  "This Coven daemon cannot safely run unattended Research with workspace writes. Update Coven, restart the daemon, and try again.";

export const INVALID_RESEARCH_WRITE_GRANT_DIAGNOSTIC =
  "Cave could not verify the Research artifact workspace for unattended writes. Retry in the mission workspace, or recreate the mission if its workspace was removed.";

export const OWNER_LOCAL_RESEARCH_DAEMON_REQUIRED_DIAGNOSTIC =
  "Unattended Research writes require the owner-local Coven daemon socket. Remove the remote COVEN_SOCKET override, restart Cave, and try again.";

export type ResearchSessionLaunchPolicy = {
  approval: "never";
  sandbox: "workspace-write";
  addDirs: string[];
};

/** Require the exact daemon contract and named opt-in; every mismatch fails closed. */
export function supportsSessionLaunchPolicy(health: unknown): boolean {
  if (!health || typeof health !== "object" || Array.isArray(health)) return false;
  const healthRecord = health as { ok?: unknown; apiVersion?: unknown; capabilities?: unknown };
  if (
    healthRecord.ok !== true
    || !isSupportedDaemonApiVersion(healthRecord.apiVersion)
  ) return false;
  const capabilities = healthRecord.capabilities;
  return Boolean(
    capabilities
    && typeof capabilities === "object"
    && !Array.isArray(capabilities)
    && (capabilities as Record<string, unknown>)[SESSION_LAUNCH_POLICY_CAPABILITY] === true,
  );
}

export function shouldRequestResearchSessionLaunchPolicy(input: {
  trustedLocalResearch: boolean;
  harness: string;
  sshBound: boolean;
  hubAuthority: boolean;
}): boolean {
  return input.trustedLocalResearch
    && input.harness === "codex"
    && !input.sshBound
    && !input.hubAuthority;
}

/** Canonicalize the internal Research-only write grants before daemon trust. */
export async function validatedResearchLaunchAddDirs(
  directories: readonly string[],
  projectRoot: string,
): Promise<string[] | null> {
  let canonicalRoot = projectRoot;
  try {
    canonicalRoot = await realpath(projectRoot);
  } catch {
    // Session root validation remains authoritative if it disappears during
    // this race. Secondary write grants themselves always fail closed.
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const directory of directories) {
    if (typeof directory !== "string" || !path.isAbsolute(directory) || directory.includes("\0")) {
      return null;
    }
    try {
      const canonical = await realpath(directory);
      if (!(await stat(canonical)).isDirectory()) return null;
      if (canonical !== canonicalRoot && !seen.has(canonical)) {
        seen.add(canonical);
        result.push(canonical);
      }
    } catch {
      return null;
    }
  }
  return result;
}

/**
 * The caller has already canonicalized each directory and proven it exists.
 * The daemon repeats that validation before applying the sandbox policy.
 */
export function researchSessionLaunchPolicy(
  addDirs: readonly string[],
): ResearchSessionLaunchPolicy {
  return {
    approval: "never",
    sandbox: "workspace-write",
    addDirs: [...addDirs],
  };
}

type LocalDaemonTarget = Extract<DaemonTarget, { mode: "local" }>;

/**
 * A target labelled `local` can still contain a remote Windows named-pipe UNC
 * supplied through COVEN_SOCKET or daemon.json. Only the local-machine pipe
 * namespace (or an absolute Unix-domain socket path) is an owner-local IPC
 * authority suitable for the unattended write policy.
 */
export function isOwnerLocalResearchDaemonTarget(
  target: LocalDaemonTarget,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const socketPath = target.socketPath.trim();
  if (!socketPath || socketPath.includes("\0")) return false;
  if (platform === "win32") {
    const prefix = "\\\\.\\pipe\\";
    return socketPath.toLowerCase().startsWith(prefix) && socketPath.length > prefix.length;
  }
  return path.posix.isAbsolute(socketPath);
}

/**
 * Dispatch a session create without allowing a policy-bearing request to
 * re-resolve daemon authority after its local capability probe. Requests that
 * do not carry the Research policy retain the normal config-aware route.
 */
export function dispatchResearchDaemonRequest<T>(
  request: DaemonRequest,
  policy: {
    launchPolicy: ResearchSessionLaunchPolicy;
    pinnedTarget: LocalDaemonTarget;
  } | undefined,
  dependencies: {
    callDaemon: <R>(request: DaemonRequest) => Promise<DaemonResponse<R>>;
    callDaemonTarget: <R>(target: DaemonTarget, request: DaemonRequest) => Promise<DaemonResponse<R>>;
  },
): Promise<DaemonResponse<T>> {
  if (policy) {
    const body = request.body;
    if (
      !body
      || typeof body !== "object"
      || Array.isArray(body)
      || (body as { launchPolicy?: unknown }).launchPolicy !== policy.launchPolicy
    ) {
      throw new Error("policy-bearing Research request lost its pinned launch policy");
    }
    return dependencies.callDaemonTarget<T>(policy.pinnedTarget, request);
  }
  return dependencies.callDaemon<T>(request);
}
