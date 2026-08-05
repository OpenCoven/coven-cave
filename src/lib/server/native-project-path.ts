import path from "node:path";

export type NativeProjectPathPlatform = NodeJS.Platform;

type NativePathApi = typeof path.posix;

function pathApi(platform: NativeProjectPathPlatform): NativePathApi {
  return platform === "win32" ? path.win32 : path.posix;
}

function foldNativePath(value: string, platform: NativeProjectPathPlatform): string {
  return platform === "win32" ? value.toLocaleLowerCase("en-US") : value;
}

/**
 * Normalize an absolute path with the host platform's own syntax.
 *
 * POSIX deliberately keeps backslashes and surrounding whitespace: both are
 * valid filename characters there. Windows accepts either separator and uses
 * case-insensitive identity.
 */
export function normalizeNativeProjectPath(
  value: string | null | undefined,
  platform: NativeProjectPathPlatform = process.platform,
): string | null {
  if (typeof value !== "string" || !value || value.includes("\0")) return null;
  const api = pathApi(platform);
  if (!api.isAbsolute(value)) return null;
  return api.resolve(value);
}

export function nativeProjectPathIdentityKey(
  value: string | null | undefined,
  platform: NativeProjectPathPlatform = process.platform,
): string | null {
  const normalized = normalizeNativeProjectPath(value, platform);
  return normalized === null ? null : foldNativePath(normalized, platform);
}

export function nativeProjectPathsEqual(
  left: string | null | undefined,
  right: string | null | undefined,
  platform: NativeProjectPathPlatform = process.platform,
): boolean {
  const leftKey = nativeProjectPathIdentityKey(left, platform);
  const rightKey = nativeProjectPathIdentityKey(right, platform);
  return leftKey !== null && rightKey !== null && leftKey === rightKey;
}

export type NativeProjectRelativePath = {
  absolutePath: string;
  relativePath: string;
};

export function resolveNativePathWithinRoot(
  rootValue: string | null | undefined,
  candidateValue: string | null | undefined,
  platform: NativeProjectPathPlatform = process.platform,
): NativeProjectRelativePath | null {
  if (typeof candidateValue !== "string" || !candidateValue || candidateValue.includes("\0")) {
    return null;
  }
  if (platform === "win32" && /^[A-Za-z]:(?![\\/])/.test(candidateValue)) {
    return null;
  }
  const api = pathApi(platform);
  const root = normalizeNativeProjectPath(rootValue, platform);
  if (root === null) return null;
  const candidate = api.isAbsolute(candidateValue)
    ? api.normalize(candidateValue)
    : api.resolve(root, candidateValue);
  const relativePath = api.relative(root, candidate);
  if (
    !relativePath ||
    api.isAbsolute(relativePath) ||
    relativePath.split(api.sep).includes("..")
  ) {
    return null;
  }
  return {
    absolutePath: api.join(root, relativePath),
    relativePath,
  };
}

export type NativeGitRelativeProjectTarget = {
  absolutePath: string;
  projectRelativePath: string;
  gitRelativePath: string;
};

export function resolveNativeProjectPathForGitRoot(
  projectRoot: string | null | undefined,
  gitRoot: string | null | undefined,
  candidatePath: string | null | undefined,
  platform: NativeProjectPathPlatform = process.platform,
): NativeGitRelativeProjectTarget | null {
  const projectTarget = resolveNativePathWithinRoot(
    projectRoot,
    candidatePath,
    platform,
  );
  if (!projectTarget) return null;
  const gitTarget = resolveNativePathWithinRoot(
    gitRoot,
    projectTarget.absolutePath,
    platform,
  );
  if (!gitTarget) return null;
  return {
    absolutePath: projectTarget.absolutePath,
    projectRelativePath: projectTarget.relativePath,
    gitRelativePath:
      platform === "win32"
        ? gitTarget.relativePath.replace(/\\/g, "/")
        : gitTarget.relativePath,
  };
}
