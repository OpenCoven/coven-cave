// Per-familiar accent colour for surfaces that show items from many familiars
// at once (e.g. the calendar at "All familiars" scope). A familiar's resolved
// colour defaults to the brand accent, so familiars without an explicit colour
// would all look identical — we derive a stable distinct hue for those instead,
// while still honouring any colour the user actually set.

const DEFAULT_ACCENT = "var(--accent-presence)";

/**
 * Deterministic, distinct accent derived from a seed (the familiar id). Same
 * seed → same colour across renders/sessions. Moderate chroma + fixed lightness
 * stay legible on both themes. Mirrors the explorer's projectTint approach.
 */
export function familiarTint(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return `oklch(0.72 0.13 ${hash % 360})`;
}

/**
 * The accent to use for a familiar: its explicit colour when set to something
 * other than the shared default, otherwise a derived distinct hue keyed by id.
 */
export function familiarAccent(explicit: string | null | undefined, id: string): string {
  return explicit && explicit !== DEFAULT_ACCENT ? explicit : familiarTint(id);
}
