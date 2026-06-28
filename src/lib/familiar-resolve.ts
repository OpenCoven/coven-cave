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
  /**
   * The *other* avatar image source, if both exist — lets `FamiliarAvatar`
   * degrade a failed primary image to the alternate image (workspace avatar ↔
   * Cave-local upload) before ever falling back to the glyph. Undefined when
   * only one source exists.
   */
  avatarImageFallback?: string;
  /** Absolute `~/.coven` workspace avatar path (loads only via Tauri's asset
   *  protocol, resolved client-side post-mount). Consumed by familiar-avatar-src. */
  avatarPath?: string;
  /** Avatar file mtime — cache-buster for the resolved asset URL. */
  avatarVersion?: number;
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
    // source of truth and wins as the primary; a Cave-local upload is the
    // fallback. Crucially, when BOTH exist the upload is kept as
    // `avatarImageFallback` so a failed workspace image degrades to the upload
    // (not straight to the glyph) — the avatar image is always preferred over
    // the icon when any source can load.
    avatarImage: base.avatarUrl ?? ctx.image?.dataUrl,
    avatarImageFallback: base.avatarUrl ? ctx.image?.dataUrl : undefined,
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
