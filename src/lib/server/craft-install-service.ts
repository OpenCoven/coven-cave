import {
  installMarketplacePlugin,
  loadConfig,
  uninstallMarketplacePlugin,
} from "../cave-config.ts";
import { loadCraftDefinition } from "./craft-catalog.ts";
import {
  CraftTransactionError,
  craftAffectedRoleDiagnostic,
  createCraftInstallService,
  defaultCraftCommandRunner,
  type CraftInstallationRecord,
} from "./craft-install.ts";
import { roleCraftService } from "./role-crafts.ts";
import { withCraftTransaction } from "./keyed-transaction-lock.ts";

export const craftInstallService = createCraftInstallService({
  runner: defaultCraftCommandRunner,
  catalog: { get: loadCraftDefinition },
  withTransaction: withCraftTransaction,
  beforeUninstall: async (definition) => {
    const affectedRoles = await roleCraftService.attachments(definition.id);
    if (affectedRoles.length === 0) return;
    const message = "Detach this Craft from every Role before removing it.";
    throw new CraftTransactionError("craft_equipped", message, {
      step: "role-check",
      message,
      ...craftAffectedRoleDiagnostic(affectedRoles),
    });
  },
  store: {
    async get(id) {
      const entry = (await loadConfig()).marketplace.installed[id];
      if (
        !entry
        || !entry.runtime
        || !entry.verifiedAt
        || !entry.craftVersion
      ) return undefined;
      return {
        id,
        version: entry.version,
        source: entry.source,
        installedAt: entry.installedAt,
        runtime: entry.runtime,
        verifiedAt: entry.verifiedAt,
        craftVersion: entry.craftVersion,
      } satisfies CraftInstallationRecord;
    },
    async record(record) {
      const installedAt = await installMarketplacePlugin(
        record.id,
        record.version,
        record.source,
        {
          runtime: record.runtime,
          verifiedAt: record.verifiedAt,
          craftVersion: record.craftVersion,
        },
      );
      return { ...record, installedAt };
    },
    async remove(id) {
      await uninstallMarketplacePlugin(id);
    },
  },
});
