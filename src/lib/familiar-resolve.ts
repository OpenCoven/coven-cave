"use client";

import { useMemo } from "react";
import { resolveFamiliarGlyph, type FamiliarGlyph } from "./familiar-glyph.ts";
import { applyFamiliarOrder, useFamiliarOrder } from "./cave-familiar-order.ts";
import { useFamiliarOverrides, type FamiliarOverride } from "./cave-familiar-overrides.ts";
import { useFamiliarImages, type FamiliarImage } from "./cave-familiar-images.ts";
import { useGlyphOverrides } from "./cave-glyph-overrides.ts";
import { useArchivedFamiliars } from "./cave-familiar-archive.ts";
import type { Familiar } from "./types.ts";

export type ResolvedFamiliar = Omit<Familiar, "display_name" | "role"> & {
  display_name: string;
  role: string;
  /** Always non-empty; falls back to var(--accent-presence). */
  color: string;
  /**
   * Avatar image source: the familiar's workspace avatar URL (`base.avatarUrl`,
   * served from `~/.coven/workspaces/familiars/<id>/avatars/`) when present,
   * else a Cave-local uploaded data URL as fallback. Undefined when neither
   * exists — the glyph renders instead.
   */
  avatarImage?: string;
  /** Resolved glyph for fallback rendering when no image is set. */
  glyph: FamiliarGlyph;
  archived: boolean;
};

type ResolveContext = {
  override?: FamiliarOverride;
  image?: FamiliarImage;
  glyphOverride?: string;
  archived: boolean;
};

export function resolveFamiliar(base: Familiar, ctx: ResolveContext): ResolvedFamiliar {
  const ov = ctx.override ?? {};
  const glyphOverrides = ctx.glyphOverride ? { [base.id]: ctx.glyphOverride } : {};
  return {
    ...base,
    display_name: ov.display_name ?? base.display_name,
    role: ov.role ?? base.role,
    pronouns: ov.pronouns ?? base.pronouns,
    description: ov.description ?? base.description,
    color: ov.color ?? base.color ?? "var(--accent-presence)",
    // The familiar's workspace avatar (.../familiars/<id>/avatars/<img>) is the
    // source of truth and always wins; a Cave-local upload is only the fallback
    // when the familiar has no workspace avatar on disk.
    avatarImage: base.avatarUrl ?? ctx.image?.dataUrl,
    glyph: resolveFamiliarGlyph(
      { id: base.id, icon: base.icon, emoji: base.emoji, role: ov.role ?? base.role },
      glyphOverrides,
    ),
    archived: ctx.archived,
  };
}

export function useResolvedFamiliars(
  familiars: Familiar[],
  options?: { includeArchived?: boolean },
): ResolvedFamiliar[] {
  const overrides = useFamiliarOverrides();
  const images = useFamiliarImages();
  const glyphOverrides = useGlyphOverrides();
  const archived = useArchivedFamiliars();
  const order = useFamiliarOrder();
  const includeArchived = options?.includeArchived ?? false;

  return useMemo(() => {
    const ordered = applyFamiliarOrder(familiars, order);
    const resolved: ResolvedFamiliar[] = [];
    for (const f of ordered) {
      const isArchived = f.id in archived;
      if (isArchived && !includeArchived) continue;
      resolved.push(
        resolveFamiliar(f, {
          override: overrides[f.id],
          image: images[f.id],
          glyphOverride: glyphOverrides[f.id],
          archived: isArchived,
        }),
      );
    }
    return resolved;
  }, [familiars, order, overrides, images, glyphOverrides, archived, includeArchived]);
}
