/** Core-owned workspace containment and locks, independent of mission parsing. */
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { assertMissionId, researchMissionsRoot } from "./research-runtime-contract.ts";

declare global {
  var __caveResearchMissionLocks: Map<string, Promise<void>> | undefined;
}

function missionLocks(): Map<string, Promise<void>> {
  globalThis.__caveResearchMissionLocks ??= new Map();
  return globalThis.__caveResearchMissionLocks;
}

export function researchMissionWorkspacePath(id: string): string {
  assertMissionId(id);
  return path.join(/* turbopackIgnore: true */ researchMissionsRoot(), id);
}

export function isWithin(candidate: string, root: string): boolean {
  const comparedCandidate = process.platform === "win32" ? candidate.toLowerCase() : candidate;
  const comparedRoot = process.platform === "win32" ? root.toLowerCase() : root;
  return comparedCandidate === comparedRoot || comparedCandidate.startsWith(comparedRoot + path.sep);
}

export function withResearchMissionLock<T>(
  id: string,
  operation: () => Promise<T>,
): Promise<T> {
  assertMissionId(id);
  const locks = missionLocks();
  const previous = locks.get(id) ?? Promise.resolve();
  const result = previous.then(operation, operation);
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  locks.set(id, tail);
  void tail.then(() => {
    if (locks.get(id) === tail) locks.delete(id);
  });
  return result;
}

export async function assertRealMissionDirectory(id: string): Promise<string> {
  const directory = researchMissionWorkspacePath(id);
  // Research workspaces live beneath the user's runtime cave home. They are
  // validated below, but are never build inputs for the Next server bundle.
  const stat = await lstat(/* turbopackIgnore: true */ directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error("mission workspace must be a real directory");
  }
  const [resolvedDirectory, resolvedRoot] = await Promise.all([
    realpath(/* turbopackIgnore: true */ directory),
    realpath(/* turbopackIgnore: true */ researchMissionsRoot()),
  ]);
  if (!isWithin(resolvedDirectory, resolvedRoot)) {
    throw new Error("mission workspace is outside research root");
  }
  return resolvedDirectory;
}

