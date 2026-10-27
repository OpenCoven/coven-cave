import type { ReactNode } from "react";
import { MarketplaceDetail } from "@/components/marketplace/marketplace-detail";
import { CraftDetail } from "@/components/marketplace/craft-detail";
import { CraftCreateDrawer } from "@/components/marketplace/craft-create-drawer";
import { KnowledgePackDetail } from "@/components/marketplace/knowledge-pack-detail";
import { KnowledgePackSeedModal } from "@/components/marketplace/knowledge-pack-seed-modal";
import { MarketplaceConfigure } from "@/components/marketplace/marketplace-configure";
import { SkillExploreDrawer } from "@/components/marketplace/skill-explore-drawer";
import { modalMarketplacePlugin, modalKnowledgePack, modalSkill } from "./modal-marketplace-fixtures";
import "@/styles/globals/surface-marketplace.css";

const noop = () => {};

export function modalMarketplaceFixtures(onClose: () => void): Record<string, ReactNode> {
  return {
    "market-detail": <MarketplaceDetail plugin={modalMarketplacePlugin} busy={false} onClose={onClose} onAdd={noop} onRemove={noop} />,
    "craft-detail": <CraftDetail plugin={{ ...modalMarketplacePlugin, kind: "craft" }} busy={false} onClose={onClose} onInstall={noop} onRemove={noop} onActionCleared={noop} />,
    "craft-create": <CraftCreateDrawer open onClose={onClose} onCreated={noop} />,
    "knowledge-detail": <KnowledgePackDetail plugin={{ ...modalMarketplacePlugin, kind: "knowledge-pack" }} busy={false} onClose={onClose} />,
    "knowledge-seed": <KnowledgePackSeedModal open manifest={modalKnowledgePack} alreadyInstalled={false} onClose={onClose} />,
    "market-config": <MarketplaceConfigure open pluginId={modalMarketplacePlugin.id} displayName={modalMarketplacePlugin.displayName} onClose={onClose} onChanged={noop} />,
    "skill-explore": <SkillExploreDrawer skill={modalSkill} onClose={onClose} />,
  };
}
