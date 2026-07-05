/**
 * GET /api/marketplace
 *
 * Lists installable first-party plugins for the Marketplace tab. Reads the
 * generated product catalog (marketplace/marketplace.json) and each plugin's
 * manifest (marketplace/plugins/<id>/plugin.json) for detail, merges in local
 * install state from cave-config (marketplace.installed), and returns card
 * models. Never returns secret values. Read-only.
 */

import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "@/lib/cave-config";
import { hasConfiguredSecretMetadata } from "@/lib/vault";
import {
  mergeCatalog,
  sanitizeMarketplaceCatalogCards,
  sanitizeMarketplacePlugins,
  type MarketplaceJsonPlugin,
  type PluginManifest,
} from "@/lib/marketplace-catalog";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MARKETPLACE_DIR = path.join(process.cwd(), "marketplace");

export async function GET() {
  let marketplacePlugins: MarketplaceJsonPlugin[] = [];
  try {
    const raw = JSON.parse(await readFile(path.join(MARKETPLACE_DIR, "marketplace.json"), "utf8"));
    if (raw && Array.isArray(raw.plugins)) marketplacePlugins = raw.plugins as MarketplaceJsonPlugin[];
  } catch {
    return NextResponse.json({ ok: true, plugins: [] });
  }

  const manifests: Record<string, PluginManifest> = {};
  await Promise.all(
    marketplacePlugins.map(async (p) => {
      try {
        manifests[p.name] = JSON.parse(
          await readFile(path.join(MARKETPLACE_DIR, "plugins", p.name, "plugin.json"), "utf8"),
        ) as PluginManifest;
      } catch {
        // Manifest missing/unparseable: card still renders from marketplace.json
        // fields with degraded detail.
      }
    }),
  );

  const cfg = await loadConfig();
  const marketplaceSafePlugins = sanitizeMarketplacePlugins(marketplacePlugins);
  const merged = mergeCatalog(marketplaceSafePlugins, manifests, cfg.marketplace.installed);
  const plugins = sanitizeMarketplaceCatalogCards(merged.map((p) => ({
    ...p,
    // configured = every required field has a value already in env/.env.local
    // or has vault metadata. This must not resolve or cache secret values.
    configured: p.requiredConfig.every((f) => hasConfiguredSecretMetadata(f.env)),
  })));
  return NextResponse.json({ ok: true, plugins });
}
