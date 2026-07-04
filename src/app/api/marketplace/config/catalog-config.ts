/**
 * Shared, path-injection-safe catalog lookups for the marketplace config routes.
 * The request `id` only SELECTS a catalog entry; filesystem paths are built from
 * the trusted, file-derived name (never from the request string).
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  requiredConfigFromManifest,
  remoteUrlFromManifest,
  sanitizeMarketplacePlugins,
  type MarketplaceJsonPlugin,
  type PluginManifest,
  type RequiredConfigField,
} from "@/lib/marketplace-catalog";

export const MARKETPLACE_DIR = path.join(process.cwd(), "marketplace");

/** Resolve a request id to the matching catalog entry's own (trusted) name, or null. */
export async function resolveCatalogName(id: string): Promise<string | null> {
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

/** Required config fields for a trusted plugin name (path built from the name). */
export async function requiredConfigFor(name: string): Promise<RequiredConfigField[]> {
  try {
    const manifest = JSON.parse(
      await readFile(path.join(MARKETPLACE_DIR, "plugins", name, "plugin.json"), "utf8"),
    ) as PluginManifest;
    return requiredConfigFromManifest(manifest);
  } catch {
    return [];
  }
}

/** The remote MCP endpoint URL for a trusted plugin name, or undefined. */
export async function remoteUrlFor(name: string): Promise<string | undefined> {
  try {
    const manifest = JSON.parse(
      await readFile(path.join(MARKETPLACE_DIR, "plugins", name, "plugin.json"), "utf8"),
    ) as PluginManifest;
    return remoteUrlFromManifest(manifest);
  } catch {
    return undefined;
  }
}
