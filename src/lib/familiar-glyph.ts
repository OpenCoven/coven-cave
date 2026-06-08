/**
 * Familiar glyph model.
 *
 * A glyph is a Phosphor icon name (`ph:cat-fill`).
 *
 * The `ph:` prefix is the discriminator on the wire (in the legacy familiar
 * glyph field or the Cave-local override store). The `name` is intentionally a plain string:
 * chrome icons stay type-checked via `IconName` in `@/lib/icon`, but
 * user-picked icons can reference any of Phosphor's names without needing
 * each to land in the strict registry.
 */

import type { Familiar } from "@/lib/types";

export type FamiliarGlyph = { kind: "icon"; name: string };

/** Fallback rendered when no daemon icon and no override are present. */
export const DEFAULT_FAMILIAR_GLYPH: FamiliarGlyph = {
  kind: "icon",
  name: "ph:sparkle-fill",
};

/**
 * Parse a raw glyph string into a structured glyph. Only Phosphor icon names
 * are accepted; older non-icon values are ignored so the app stays
 * icon-only at render time. Empty / undefined returns null so the caller can
 * apply its own fallback.
 */
export function parseGlyphString(raw: string | undefined | null): FamiliarGlyph | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("ph:")) {
    return { kind: "icon", name: trimmed };
  }
  return null;
}

/** Serialize a glyph for storage (override store, or eventually familiars.toml). */
export function serializeGlyph(glyph: FamiliarGlyph): string {
  return glyph.name;
}

/**
 * Deterministic keyword → Phosphor glyph mapping. Used as the final fallback
 * before DEFAULT_FAMILIAR_GLYPH when a familiar has no override, no daemon
 * icon, and no daemon emoji. Case-insensitive substring match on `role`.
 *
 * The first matching keyword wins, so order keys most-specific → most-generic
 * if you extend this.
 */
const ROLE_GLYPH_MAP: Array<[string, string]> = [
  ["code", "ph:code-bold"],
  ["chat", "ph:chat-circle-fill"],
  ["music", "ph:music-notes-fill"],
  ["research", "ph:books-fill"],
  ["art", "ph:palette-fill"],
  ["data", "ph:chart-bar-fill"],
  ["ops", "ph:gear-fill"],
  ["writer", "ph:pencil-fill"],
  ["design", "ph:pen-nib-fill"],
];

export function inferGlyphFromRole(role: string | undefined): FamiliarGlyph | null {
  if (!role) return null;
  const lower = role.toLowerCase();
  for (const [kw, name] of ROLE_GLYPH_MAP) {
    if (lower.includes(kw)) return { kind: "icon", name };
  }
  return null;
}

/**
 * Resolve the glyph to render for a familiar.
 *
 * Precedence (highest first):
 *   1. Cave-local override (`overrides[familiar.id]`).
 *   2. Daemon-provided `familiar.icon` (must be `ph:*`).
 *   3. Legacy daemon `emoji` field (only when it stores a `ph:*` name).
 *   4. `inferGlyphFromRole(familiar.role)` — keyword inference.
 *   5. `DEFAULT_FAMILIAR_GLYPH`.
 */
export function resolveFamiliarGlyph(
  familiar: Pick<Familiar, "id" | "emoji" | "icon" | "role">,
  overrides: Record<string, string>,
): FamiliarGlyph {
  const override = parseGlyphString(overrides[familiar.id]);
  if (override) return override;
  const daemonIcon = parseGlyphString(familiar.icon);
  if (daemonIcon) return daemonIcon;
  const daemonEmoji = parseGlyphString(familiar.emoji);
  if (daemonEmoji) return daemonEmoji;
  const inferred = inferGlyphFromRole(familiar.role);
  if (inferred) return inferred;
  return DEFAULT_FAMILIAR_GLYPH;
}
