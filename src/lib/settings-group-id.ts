/** Stable DOM id for a Settings group and its search/deep-link target. */
export function settingsGroupId(label: string): string {
  return `settings-group-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`;
}
