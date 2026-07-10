import {
  installMarketplacePlugin,
  loadConfig,
  uninstallMarketplacePlugin,
} from "../cave-config.ts";
import { loadCraftDefinition } from "./craft-catalog.ts";
import {
  createCraftInstallService,
  defaultCraftCommandRunner,
  type CraftInstallationRecord,
} from "./craft-install.ts";

export const craftInstallService = createCraftInstallService({
  runner: defaultCraftCommandRunner,
  catalog: { get: loadCraftDefinition },
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
