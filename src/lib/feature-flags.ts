function envFlag(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

export function caveChatoutCodex(): boolean {
  return envFlag(process.env.NEXT_PUBLIC_CAVE_CHATOUT_CODEX);
}

/**
 * Dedicated Code surface (cave-k0ua): the Codex-style multi-session coding
 * tab. While flagged off, the sidebar keeps the GitHub row and `?mode=code`
 * deep links fall back to the legacy redirect (most-recent repo chat). When
 * on, the Code row replaces the GitHub row (GitHub mounts as a tab inside
 * Code). NEXT_PUBLIC_ env vars are inlined at build time, so both branches
 * of the swap stay in the bundle but the choice is fixed per build.
 */
export function caveCodeSurface(): boolean {
  return envFlag(process.env.NEXT_PUBLIC_CAVE_CODE_SURFACE);
}
