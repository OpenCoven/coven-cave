import { NextResponse } from "next/server.js";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadConfig, saveConfig } from "@/lib/cave-config";
import { covenHome } from "@/lib/coven-paths";
import {
  displayNameFromTomlBlock,
  removeFamiliarBlockFromToml,
} from "@/lib/familiar-removal";
import { isValidFamiliarId } from "@/lib/server/familiar-id";
import { addTombstone } from "@/lib/server/familiar-tombstones";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Remove ("detach") a familiar — the undo-safe half of the dual-track
 * lifecycle. Archive (client-side, cave-familiar-archive.ts) hides a familiar
 * but leaves it registered; Remove strips its `[[familiar]]` block from
 * `$COVEN_HOME/familiars.toml` (defaulting to `~/.coven`) and drops its
 * cave-config.json binding, which is
 * what a mistaken OpenClaw-agent binding actually needs.
 *
 * Safety model:
 * - Both the TOML block and the binding are snapshotted into the tombstone
 *   store BEFORE anything is mutated, so POST /api/familiars/removed can
 *   restore the entry exactly as it was for the whole restore window.
 * - Nothing else is touched: the upstream OpenClaw agent instance, chat and
 *   session history, and the familiar's workspace files (SOUL.md, memory,
 *   avatars) all stay on disk. Re-registering the same id picks them back up.
 */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!id || !isValidFamiliarId(id)) {
    return NextResponse.json({ ok: false, error: "path not allowed" }, { status: 403 });
  }

  const familiarsToml = path.join(covenHome(), "familiars.toml");
  let toml: string | null = null;
  try {
    toml = await readFile(familiarsToml, "utf8");
  } catch {
    /* absent — the familiar may still exist as a binding-only entry */
  }

  const surgery = toml === null ? null : removeFamiliarBlockFromToml(toml, id);
  const config = await loadConfig();
  const binding = config.familiars[id] ? { ...config.familiars[id] } : null;

  if (!surgery?.removed && !binding) {
    return NextResponse.json(
      { ok: false, error: `No familiar "${id}" to remove.` },
      { status: 404 },
    );
  }

  // Snapshot before mutating — never destroy the only copy of the entry.
  await addTombstone({
    id,
    displayName: (surgery?.removed ? displayNameFromTomlBlock(surgery.removed) : null) ?? id,
    removedAt: new Date().toISOString(),
    tomlBlock: surgery?.removed ?? null,
    binding: binding as Record<string, unknown> | null,
  });

  if (surgery?.removed && toml !== null) {
    await writeFile(familiarsToml, surgery.toml, "utf8");
  }
  if (binding) {
    await saveConfig({ familiars: { [id]: null } });
  }

  return NextResponse.json({
    ok: true,
    id,
    removedFromToml: Boolean(surgery?.removed),
    hadBinding: binding !== null,
  });
}
