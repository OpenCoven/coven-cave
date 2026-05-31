/**
 * Familiar glyph model.
 *
 * A glyph is either:
 *   - `{ kind: "emoji", char }` — any Unicode emoji literal the user picked
 *   - `{ kind: "icon",  name }` — a Phosphor icon name (`ph:cat-fill`)
 *
 * The `ph:` prefix is the discriminator on the wire (in `Familiar.emoji` or
 * the Cave-local override store) so both kinds round-trip through a single
 * string field. The `name` is intentionally a plain string — chrome icons
 * stay type-checked via `IconName` in `@/lib/icon`, but user-picked icons
 * can reference any of Phosphor's ~1500 names without needing each to land
 * in the strict registry.
 */

import type { Familiar } from "@/lib/types";

export type FamiliarGlyph =
  | { kind: "emoji"; char: string }
  | { kind: "icon"; name: string };

/** Fallback rendered when no daemon emoji and no override are present. */
export const DEFAULT_FAMILIAR_GLYPH: FamiliarGlyph = {
  kind: "icon",
  name: "ph:sparkle-fill",
};

/**
 * Parse a raw glyph string into a structured glyph. Anything starting with
 * `ph:` is treated as a Phosphor icon name; anything else is treated as a
 * literal emoji char. Empty / undefined returns null so the caller can apply
 * its own fallback.
 */
export function parseGlyphString(raw: string | undefined | null): FamiliarGlyph | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("ph:")) {
    return { kind: "icon", name: trimmed };
  }
  return { kind: "emoji", char: trimmed };
}

/** Serialize a glyph for storage (override store, or eventually familiars.toml). */
export function serializeGlyph(glyph: FamiliarGlyph): string {
  return glyph.kind === "icon" ? glyph.name : glyph.char;
}

/**
 * Resolve the glyph to render for a familiar.
 *
 * Precedence (highest first):
 *   1. Cave-local override (`overrides[familiar.id]`)
 *   2. Daemon-provided `familiar.emoji`
 *   3. `DEFAULT_FAMILIAR_GLYPH`
 */
export function resolveFamiliarGlyph(
  familiar: Pick<Familiar, "id" | "emoji">,
  overrides: Record<string, string>,
): FamiliarGlyph {
  const override = parseGlyphString(overrides[familiar.id]);
  if (override) return override;
  const daemon = parseGlyphString(familiar.emoji);
  if (daemon) return daemon;
  return DEFAULT_FAMILIAR_GLYPH;
}
