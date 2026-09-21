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
   * Avatar image source. Two stores can hold a portrait for the same familiar —
   * the workspace avatar (`base.avatarUrl`, served from
   * `~/.coven/workspaces/familiars/<id>/avatars/`) and a Cave-local upload — and
   * when both exist this is the one written most recently. Undefined when
   * neither exists — the glyph renders instead.
   */
  avatarImage?: string;
  /**
   * The *other* avatar image source, if both exist — lets `FamiliarAvatar`
   * degrade a failed primary image to the alternate image (workspace avatar ↔
   * Cave-local upload) before ever falling back to the glyph. Undefined when
   * only one source exists.
   */
  avatarImageFallback?: string;
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

function workspaceAvatarWrittenAt(avatarUrl: string | undefined): number | null {
  if (!avatarUrl) return null;
  const stamp = /[?&]v=(\d+)/.exec(avatarUrl)?.[1];
  if (!stamp) return null;
  const ms = Number(stamp);
  return Number.isFinite(ms) ? ms : null;
}

export function orderAvatarSources(
  avatarUrl: string | undefined,
  image: FamiliarImage | undefined,
): { avatarImage?: string; avatarImageFallback?: string } {
  const upload = image?.dataUrl || undefined;
  if (!avatarUrl) return { avatarImage: upload, avatarImageFallback: undefined };
  if (!upload) return { avatarImage: avatarUrl, avatarImageFallback: undefined };

  const workspaceAt = workspaceAvatarWrittenAt(avatarUrl);
  const uploadAt = image?.updatedAt ? Date.parse(image.updatedAt) : Number.NaN;
  const uploadIsNewer =
    Number.isFinite(uploadAt) && (workspaceAt === null || uploadAt > workspaceAt);

  return uploadIsNewer
    ? { avatarImage: upload, avatarImageFallback: avatarUrl }
    : { avatarImage: avatarUrl, avatarImageFallback: upload };
}

// Stored colour overrides written by the old "Moon" preset carry a
// three-colour color-mix() that browsers compute to transparent (color-mix
// takes exactly two colours). Map it to the preset's current value so the
// familiar keeps a visible accent without asking people to re-pick it.
const LEGACY_COLOR_ALIASES: Record<string, string> = {
  "color-mix(in oklch, var(--accent-presence-soft) 58%, var(--text-primary) 18%, white 24%)":
    "oklch(0.82 0.03 291)",
};

export function normalizeFamiliarColor(color: string | null | undefined): string | null {
  if (!color) return null;
  const trimmed = color.trim();
  if (!trimmed) return null;
  return LEGACY_COLOR_ALIASES[trimmed] ?? trimmed;
}

export function resolveFamiliar(base: Familiar, ctx: ResolveContext): ResolvedFamiliar {
  const ov = ctx.override ?? {};
  const glyphOverrides = ctx.glyphOverride ? { [base.id]: ctx.glyphOverride } : {};
  return {
    ...base,
    display_name: ov.display_name ?? base.display_name,
    role: ov.role ?? base.role,
    familiarType: ov.familiarType ?? base.familiarType,
    pronouns: ov.pronouns ?? base.pronouns,
    description: ov.description ?? base.description,
    color: normalizeFamiliarColor(ov.color) ?? normalizeFamiliarColor(base.color) ?? "var(--accent-presence)",
    // Rank the two portrait stores by recency, retaining the other source as
    // the fallback so a failed image never skips straight to the glyph.
    ...orderAvatarSources(base.avatarUrl, ctx.image),
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
