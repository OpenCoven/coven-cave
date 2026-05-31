/**
 * Maps a familiar's id (lowercased) to a Phosphor icon used wherever the UI
 * would otherwise render the familiar's emoji glyph. Unknown ids fall back
 * to a generic sparkle so the UI never goes blank.
 *
 * Daemon data still carries the `emoji` field — this layer only controls
 * the cave's rendering so the chrome stays in the Iconify visual system.
 */
const FAMILIAR_ICONS: Record<string, string> = {
  cody: "ph:lightning-fill",
  nova: "ph:sparkle-fill",
  sage: "ph:leaf-fill",
  charm: "ph:heart-fill",
  echo: "ph:waveform-fill",
  astra: "ph:star-four-fill",
  kitty: "ph:cat-fill",
};

const DEFAULT_FAMILIAR_ICON = "ph:sparkle-fill";

export function familiarIcon(id: string | null | undefined): string {
  if (!id) return DEFAULT_FAMILIAR_ICON;
  return FAMILIAR_ICONS[id.toLowerCase()] ?? DEFAULT_FAMILIAR_ICON;
}
