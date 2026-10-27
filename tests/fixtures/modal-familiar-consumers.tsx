import type { ReactNode } from "react";
import { FamiliarSummoningCircle } from "@/components/familiar-summoning-circle";
import { FamiliarMcpSection } from "@/components/familiar-tab-mcp";
import { FamiliarSkillsSection } from "@/components/familiar-tab-skills";
import { deriveFamiliarSectionData } from "@/lib/familiar-tab-section-model";
import { resolveFamiliar } from "@/lib/familiar-resolve";
import type { Familiar } from "@/lib/types";
import "@/styles/familiar-tab.css";

const familiar: Familiar = { id: "fixture-review", display_name: "Review familiar", role: "Review project plans and preserve authored dependencies", harness: "codex" };
const resolved = resolveFamiliar(familiar, { archived: false });
const data = deriveFamiliarSectionData({ familiar, roles: [], localSkills: [], harnessCapabilities: [], harnesses: [], errors: [], daemonRunning: false });
const noop = () => {};

export function modalFamiliarFixtures(onClose: () => void): Record<string, ReactNode> {
  return {
    "summoning-new": <FamiliarSummoningCircle open onClose={onClose} existingIds={[familiar.id]} defaultHarness="codex" daemonRunning={false} onCreated={noop} />,
    "summoning-enhance": <FamiliarSummoningCircle open onClose={onClose} existingIds={[familiar.id]} enhance={resolved} onCreated={noop} onEnhanced={noop} memoryCount={0} />,
    "familiar-mcp": <FamiliarMcpSection data={data} />,
    "familiar-skill": <FamiliarSkillsSection data={{ ...data, skillRows: [{ id: "fixture-review", key: "/fixture/review", name: "Project review", kind: "agent", source: "familiar", sourceKind: "familiar", tags: ["review"], path: "/fixture/review", description: "Preserve authored decisions and record unresolved dependencies." }], skillCount: 1 }} />,
  };
}
