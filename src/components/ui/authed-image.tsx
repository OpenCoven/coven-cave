"use client";

import type { ImgHTMLAttributes, ReactNode } from "react";
import { useAuthedImageState } from "@/lib/authed-image";

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  /**
   * Image source. A same-origin `/api/...` URL is fetched through the patched
   * `window.fetch` (which carries the sidecar auth token) and rendered as a
   * `blob:` URL, so it survives the packaged app's fail-closed `/api/` gate.
   * `data:` / `blob:` / cross-origin sources render directly. See
   * {@link file://src/lib/authed-image.ts} for the why.
   */
  src: string | null | undefined;
  /** Rendered while the authenticated fetch is in flight or after it fails. */
  fallback?: ReactNode;
};

/**
 * Drop-in `<img>` replacement that never paints WebKit's broken-image glyph for
 * an authenticated `/api/...` source in the packaged app. Prefer this over a raw
 * `<img src="/api/...">` anywhere an API-served image is displayed.
 */
export function AuthedImage({ src, fallback = null, alt = "", ...rest }: Props) {
  const { url } = useAuthedImageState(src);
  if (!url) return <>{fallback}</>;
  return <img src={url} alt={alt} {...rest} />;
}
