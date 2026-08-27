export interface DockedComposerVisibilityInput {
  following: boolean;
  hasStagedInput: boolean;
  releasedScrollDistance: number;
  composerHeight: number;
}

export function shouldShowDockedComposer({
  following,
  hasStagedInput,
  releasedScrollDistance,
  composerHeight,
}: DockedComposerVisibilityInput): boolean {
  if (following || hasStagedInput) return true;
  if (composerHeight <= 0) return false;
  return Math.max(0, releasedScrollDistance) <= composerHeight;
}
