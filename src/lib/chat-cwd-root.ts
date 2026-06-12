function isAbsolutePath(value: string): boolean {
  return value.startsWith("/") || value.startsWith("\\\\") || /^[A-Za-z]:[\\/]/.test(value);
}

function trimTrailingSeparators(value: string): string {
  return value.replace(/[\\/]+$/, "");
}

function trimLeadingSeparators(value: string): string {
  return value.replace(/^[\\/]+/, "");
}

export function resolveRootedCwd(
  cwdDraft: string | null | undefined,
  rootDraft: string | null | undefined,
  fallbackRoot: string | null | undefined,
): string {
  const cwd = cwdDraft?.trim() ?? "";
  const root = rootDraft?.trim() || fallbackRoot?.trim() || "";
  if (!cwd) return root;
  if (isAbsolutePath(cwd)) return cwd;
  if (!root) return cwd;
  const separator = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  return `${trimTrailingSeparators(root)}${separator}${trimLeadingSeparators(cwd)}`;
}
