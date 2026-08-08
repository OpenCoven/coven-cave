import { bindingFor, type CaveConfig } from "@/lib/cave-config";
import type { Familiar } from "@/lib/types";
import {
  resolveFamiliarAvatar,
  type ResolvedAvatar,
} from "@/lib/server/familiar-avatar";
import type { VisibleFamiliarRosterEntry } from "@/lib/server/familiar-roster";

export type FamiliarEnrichmentDependencies = {
  resolveFamiliarAvatar: (id: string) => Promise<ResolvedAvatar | null>;
};

const DEFAULT_DEPENDENCIES: FamiliarEnrichmentDependencies = {
  resolveFamiliarAvatar,
};

export async function enrichFamiliar(
  f: VisibleFamiliarRosterEntry,
  config: CaveConfig,
  dependencies: FamiliarEnrichmentDependencies = DEFAULT_DEPENDENCIES,
): Promise<Familiar> {
  const configEntry = config.familiars[f.id] ?? {};
  const binding = bindingFor(config, f.id);
  const avatar = await dependencies.resolveFamiliarAvatar(f.id);

  return {
    ...f,
    display_name: binding.display_name ?? f.display_name,
    role: binding.role ?? f.role,
    familiarType: binding.familiarType,
    pronouns: binding.pronouns ?? f.pronouns,
    description: binding.description ?? f.description,
    color: binding.color,
    harness: binding.harness,
    defaultHarness: config.defaults.harness,
    harnessOverride: configEntry.harness ?? null,
    model: binding.model,
    note: binding.note,
    voiceProvider: binding.voiceProvider,
    voiceModel: binding.voiceModel,
    voiceName: binding.voiceName,
    imageProvider: binding.imageProvider,
    imageModel: binding.imageModel,
    imageSize: binding.imageSize,
    imageQuality: binding.imageQuality,
    autoSelfReport: configEntry.autoSelfReport ?? false,
    asanaEnabled: configEntry.asanaEnabled,
    asanaWorkspaceGid: configEntry.asanaWorkspaceGid,
    xResearchEnabled: configEntry.xResearchEnabled === true,
    xPublishEnabled: configEntry.xPublishEnabled === true,
    ...(binding.omnigent ? { omnigent: binding.omnigent } : {}),
    avatarUrl: avatar
      ? `/api/familiars/${encodeURIComponent(f.id)}/avatar?v=${Math.round(avatar.mtimeMs)}&format=png`
      : undefined,
  };
}
