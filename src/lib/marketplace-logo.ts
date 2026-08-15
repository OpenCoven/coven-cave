import registryJson from "./marketplace-logo-registry.gen.json" with { type: "json" };

export type MarketplaceLogoIdentity = {
  kind: "brand" | "monogram";
  title: string;
  monogram: string;
  slug?: string;
  svgPath?: string;
  assetPath?: string;
  source?: string;
};

type MarketplaceLogoRegistry = {
  schemaVersion: 1;
  catalogCount: number;
  brandCount: number;
  monogramCount: number;
  entries: Record<string, MarketplaceLogoIdentity>;
};

const registry = registryJson as MarketplaceLogoRegistry;

export function marketplaceMonogram(value: string): string {
  const words = value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").match(/[A-Za-z0-9]+/g) ?? [];
  const first = words[0];
  if (!first) return "?";
  if (words.length === 1) return first.slice(0, 2).toUpperCase();
  return `${first[0] ?? ""}${words.at(-1)?.[0] ?? ""}`.toUpperCase();
}

export function resolveMarketplaceLogo(id: string, displayName: string): MarketplaceLogoIdentity {
  return registry.entries[id] ?? {
    kind: "monogram",
    title: displayName,
    monogram: marketplaceMonogram(displayName || id),
  };
}

export function marketplaceLogoCoverage() {
  return {
    catalogCount: registry.catalogCount,
    brandCount: registry.brandCount,
    monogramCount: registry.monogramCount,
  };
}
