"use client";

import { useState } from "react";

import {
  resolveMarketplaceLogo,
  type MarketplaceLogoIdentity,
} from "@/lib/marketplace-logo";

type MarketplaceLogoProps = {
  id: string;
  displayName: string;
  logo?: MarketplaceLogoIdentity;
  size?: "card" | "detail" | "dossier";
};

export function MarketplaceLogo({
  id,
  displayName,
  logo,
  size = "card",
}: MarketplaceLogoProps) {
  const [failedAssetPath, setFailedAssetPath] = useState<string | null>(null);
  const bundled = resolveMarketplaceLogo(id, displayName);
  const resolved = logo?.kind === "brand" && !logo.assetPath && bundled.kind === "brand"
    ? { ...logo, assetPath: bundled.assetPath }
    : logo ?? bundled;
  const brandAssetPath = resolved.kind === "brand" ? resolved.assetPath : undefined;
  const showsBrand = Boolean(brandAssetPath && failedAssetPath !== brandAssetPath);
  const renderedKind = showsBrand ? "brand" : "monogram";

  return (
    <span
      className={`marketplace-logo marketplace-logo--${size}`}
      aria-hidden
      data-marketplace-logo-id={id}
      data-marketplace-logo-kind={renderedKind}
      title={showsBrand ? `${resolved.title} logo` : undefined}
    >
      {showsBrand && brandAssetPath ? (
        // Same-origin generated asset; a failed load falls back to the deterministic monogram.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="marketplace-logo__brand"
          src={brandAssetPath}
          alt=""
          width={24}
          height={24}
          decoding="async"
          loading="lazy"
          onError={() => setFailedAssetPath(brandAssetPath)}
        />
      ) : (
        <span className="marketplace-logo__monogram">{resolved.monogram}</span>
      )}
    </span>
  );
}
