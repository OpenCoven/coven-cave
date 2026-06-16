"use client";

import { useEffect, useState } from "react";
import { FamiliarGlyph } from "./familiar-glyph";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";

type Size = "sm" | "md" | "lg" | "xl";

const PX: Record<Size, number> = { sm: 16, md: 22, lg: 36, xl: 48 };

type Props = {
  familiar: ResolvedFamiliar;
  size?: Size;
  className?: string;
  title?: string;
};

/**
 * Resolve the `<img src>` for a familiar avatar.
 *
 * A workspace avatar is an absolute `.coven` path (`avatarPath`); we link to the
 * file directly through Tauri's asset protocol (`convertFileSrc`) instead of
 * proxying bytes through an API route. That only works inside the Tauri webview,
 * so it's computed after mount — server render and any non-Tauri context fall
 * back to the Cave-local upload (`avatarImage`) if present, else the glyph.
 */
function useAvatarSrc(familiar: ResolvedFamiliar): string | undefined {
  // `avatarImage` (a data URL) is SSR-safe and usable as the initial value; a
  // workspace `avatarPath` resolves only client-side, so start without it.
  const [src, setSrc] = useState<string | undefined>(
    familiar.avatarPath ? undefined : familiar.avatarImage,
  );

  useEffect(() => {
    if (!familiar.avatarPath) {
      setSrc(familiar.avatarImage);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        // convertFileSrc needs the Tauri webview runtime; outside it (browser,
        // SSR) the file isn't loadable, so degrade to the upload / glyph.
        if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
          if (!cancelled) setSrc(familiar.avatarImage);
          return;
        }
        const { convertFileSrc } = await import("@tauri-apps/api/core");
        const base = convertFileSrc(familiar.avatarPath!);
        const url = familiar.avatarVersion ? `${base}?v=${familiar.avatarVersion}` : base;
        if (!cancelled) setSrc(url);
      } catch {
        if (!cancelled) setSrc(familiar.avatarImage);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [familiar.avatarPath, familiar.avatarVersion, familiar.avatarImage]);

  return src;
}

export function FamiliarAvatar({ familiar, size = "md", className, title }: Props) {
  const px = PX[size];
  const src = useAvatarSrc(familiar);
  if (src) {
    return (
      <img
        src={src}
        alt={familiar.display_name}
        width={px}
        height={px}
        className={className ?? "inline-block rounded-sm object-cover"}
        title={title}
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
