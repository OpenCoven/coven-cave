import {
  MARKETPLACE_BRAND_MARKS,
  type MarketplaceBrandMarkDefinition,
} from "@/lib/marketplace-brand-marks.gen";

type MarketplaceBrandMarkProps = {
  mark: MarketplaceBrandMarkDefinition;
  size: "card" | "detail";
};

export function marketplaceBrandMark(pluginId: string): MarketplaceBrandMarkDefinition | null {
  return MARKETPLACE_BRAND_MARKS[pluginId] ?? null;
}

export function MarketplaceBrandMark({ mark, size }: MarketplaceBrandMarkProps) {
  const className = `marketplace-brand-mark marketplace-brand-mark--${size}`;
  if (mark.kind === "image") {
    return <img src={mark.src} alt="" aria-hidden="true" draggable={false} className={className} />;
  }
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <path d={mark.path} />
    </svg>
  );
}
