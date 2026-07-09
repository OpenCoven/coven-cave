import { readFile } from "node:fs/promises";
import path from "node:path";
import { sanitizeMarketplacePlugins, type MarketplaceJsonPlugin } from "@/lib/marketplace-catalog";

// Shared catalog-id resolver (cave-1f9h). Extracted from the install route so
// the install and pack-prompts routes agree on the allowlist. A request id
// only ever SELECTS a catalog entry; the returned name is the entry's OWN
// trusted string from marketplace.json — filesystem paths are built from that,
// never from the request (avoids js/path-injection).

const MARKETPLACE_DIR = path.join(process.cwd(), "marketplace");

/** Resolve a user-provided id to the matching catalog entry's own name, or
 *  null when the id is not in the catalog. */
export async function resolveCatalogName(id: string): Promise<string | null> {
  if (!id) return null;
  try {
    const raw = JSON.parse(await readFile(path.join(MARKETPLACE_DIR, "marketplace.json"), "utf8"));
    const plugins = sanitizeMarketplacePlugins(
      raw && Array.isArray(raw.plugins) ? (raw.plugins as MarketplaceJsonPlugin[]) : [],
    );
    const match = plugins.find((p: { name?: string }) => p.name === id);
    return match && typeof match.name === "string" ? match.name : null;
  } catch {
    return null;
  }
}

/** Absolute path to an installed/catalog plugin's directory — built from the
 *  file-derived name only. Callers MUST pass a name from resolveCatalogName. */
export function pluginDir(name: string): string {
  return path.join(MARKETPLACE_DIR, "plugins", name);
}
