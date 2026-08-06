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
   * when both exist this is the one written MOST RECENTLY (see
   * `orderAvatarSources`). Undefined when neither exists — the glyph renders
   * instead.
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

/**
 * When was the workspace avatar last written? `/api/familiars` cache-busts the
 * URL with the file's mtime (`?v=<mtimeMs>`), so the URL dates itself. `null`
 * when there is no avatar, or when the URL carries no readable stamp.
 */
function workspaceAvatarWrittenAt(avatarUrl: string | undefined): number | null {
  if (!avatarUrl) return null;
  const stamp = /[?&]v=(\d+)/.exec(avatarUrl)?.[1];
  if (!stamp) return null;
  const ms = Number(stamp);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Order the two portrait sources — **most recently written first**.
 *
 * A familiar can be given a portrait from two places that do not know about
 * each other: the summoning rite POSTs one to `/api/familiars/<id>/avatar`
 * (workspace, on disk), and Identity → Look's dropzone writes one to the
 * Cave-local IndexedDB store. Ranking them by KIND — workspace always first —
 * meant a familiar that already had a workspace avatar could never have its
 * portrait changed from the dropzone: the dropzone showed the new picture (it
 * renders its own store directly) while every `FamiliarAvatar` on the surface
 * kept rendering the workspace file, and no reload ever cleared it, because
 * nothing was stale — the resolve simply recomputed the same answer.
 *
 * Recency is the rule the user is actually expressing: the portrait they set
 * last is the portrait they want. Both sources are still returned, so the
 * fallback chain that degrades a failed image to the alternate one (rather than
 * to the glyph) is unchanged — only the order is.
 *
 * A source that cannot be dated never displaces one that can; when neither can
 * be dated the historic workspace-first order stands.
 *
 * Exported for tests.
 */
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
    color: ov.color ?? base.color ?? "var(--accent-presence)",
    // The two portrait stores are ranked by recency, not by kind — see
    // `orderAvatarSources`. When BOTH exist the loser is kept as
    // `avatarImageFallback` so a failed primary degrades to the other image
    // (not straight to the glyph): an avatar image is always preferred over the
    // icon when any source can load.
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
