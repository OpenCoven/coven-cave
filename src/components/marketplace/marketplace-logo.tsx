"use client";

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
  const resolved = {
    ...resolveMarketplaceLogo(id, displayName),
    ...logo,
  };
  return (
    <span
      className={`marketplace-logo marketplace-logo--${size}`}
      aria-hidden
      data-marketplace-logo-id={id}
      data-marketplace-logo-kind={resolved.kind}
      title={resolved.kind === "brand" ? `${resolved.title} logo` : undefined}
    >
      {resolved.kind === "brand" && resolved.svgPath ? (
        <svg viewBox="0 0 24 24" focusable="false">
          <path d={resolved.svgPath} />
        </svg>
      ) : (
        <span className="marketplace-logo__monogram">{resolved.monogram}</span>
      )}
    </span>
  );
}
