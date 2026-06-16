"use client";

import { useEffect, useMemo, useState } from "react";
import { FamiliarGlyph } from "./familiar-glyph";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";
import { avatarAssetUrl, canResolveWorkspaceAvatar } from "@/lib/familiar-avatar-src";

type Size = "sm" | "md" | "lg" | "xl";

const PX: Record<Size, number> = { sm: 16, md: 22, lg: 36, xl: 48 };

type Props = {
  familiar: ResolvedFamiliar;
  size?: Size;
  className?: string;
  title?: string;
};

/**
 * The `/api/familiars/<id>/avatar` route reads the same workspace file and
 * downscales it. It works in any context (browser or the Tauri webview, both
 * served by the local server), so it's the reliable fallback when the direct
 * asset link isn't usable.
 */
function avatarRouteUrl(familiar: ResolvedFamiliar): string | undefined {
  if (!familiar.avatarPath) return undefined;
  const v = familiar.avatarVersion ? `?v=${familiar.avatarVersion}` : "";
  return `/api/familiars/${encodeURIComponent(familiar.id)}/avatar${v}`;
}

/**
 * Ordered `<img src>` candidates for a familiar avatar, best first. The avatar
 * component renders the first that hasn't errored and advances on load failure:
 *
 *   1. Direct `.coven` file via Tauri's asset protocol (`convertFileSrc`) — the
 *      "link straight to the path" case. Only resolvable inside the Tauri webview
 *      and only for paths inside the asset-protocol scope, so it's computed after
 *      mount and may be absent.
 *   2. The `/api/familiars/<id>/avatar` route — downscales and works everywhere
 *      (browser, or a workspace path outside the asset scope). Reliable baseline.
 *   3. A Cave-local uploaded data URL.
 *
 * When all are exhausted (or none exist) the glyph renders instead.
 */
function useAvatarCandidates(familiar: ResolvedFamiliar): string[] {
  const [assetUrl, setAssetUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    setAssetUrl(undefined);
    if (!familiar.avatarPath) return;
    if (!canResolveWorkspaceAvatar()) return;
    let cancelled = false;
    void (async () => {
      try {
        const { convertFileSrc } = await import("@tauri-apps/api/core");
        const url = avatarAssetUrl(convertFileSrc(familiar.avatarPath!), familiar.avatarVersion);
        if (!cancelled) setAssetUrl(url);
      } catch {
        // Leave assetUrl unset - the route candidate covers it.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [familiar.avatarPath, familiar.avatarVersion]);

  return useMemo(
    () => [assetUrl, avatarRouteUrl(familiar), familiar.avatarImage].filter((s): s is string => !!s),
    [assetUrl, familiar],
  );
}

export function FamiliarAvatar({ familiar, size = "md", className, title }: Props) {
  const px = PX[size];
  const candidates = useAvatarCandidates(familiar);
  // Track srcs that failed to load so an onError advances to the next candidate.
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  const src = candidates.find((c) => !failed.has(c));

  if (src) {
    return (
      <img
        src={src}
        alt={familiar.display_name}
        width={px}
        height={px}
        className={className ?? "inline-block rounded-sm object-cover"}
        title={title}
        onError={() =>
          setFailed((prev) => {
            const next = new Set(prev);
            next.add(src);
            return next;
          })
        }
      />
    );
  }
  return (
    <FamiliarGlyph
      glyph={familiar.glyph}
      size={size}
      className={className}
      title={title}
    />
  );
}
