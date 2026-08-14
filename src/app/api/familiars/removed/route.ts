import { NextResponse } from "next/server";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import {
  saveConfigUnlocked,
  withFamiliarLifecycleGuard,
  type FamiliarBinding,
} from "@/lib/cave-config";
import { covenHome } from "@/lib/coven-paths";
import { buildFamiliarsToml, familiarsTomlContainsId } from "@/lib/onboarding-familiars";
import { hasNonemptyDescriptionFromTomlBlock } from "@/lib/familiar-removal";
import { isValidFamiliarId } from "@/lib/server/familiar-id";
import { readTombstones, takeTombstone } from "@/lib/server/familiar-tombstones";
import { writeFileAtomic } from "@/lib/server/atomic-write";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The "Recently removed" shelf backing the undo-safe familiar Remove flow.
 *
 *   GET  /api/familiars/removed        → { ok, removed: [{ id, displayName, removedAt }] }
 *   POST /api/familiars/removed {id}   → restore the tombstoned familiar
 *
 * Restore re-appends the snapshotted `[[familiar]]` block to
 * ~/.coven/familiars.toml and re-saves the cave-config.json binding, so the
 * familiar comes back exactly as removed (workspace files never moved).
 */
export async function GET() {
  const removed = (await readTombstones()).map(({ id, displayName, removedAt }) => ({
    id,
    displayName,
    removedAt,
  }));
  return NextResponse.json({ ok: true, removed });
}

export async function POST(req: Request) {
  let body: { id?: unknown };
  try {
    body = (await req.json()) as { id?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id : "";
  if (!id || !isValidFamiliarId(id)) {
    return NextResponse.json({ ok: false, error: "A familiar id is required." }, { status: 400 });
  }

  return withFamiliarLifecycleGuard(async (config) => {
    const entry = (await readTombstones()).find((tombstone) => tombstone.id === id);
    if (!entry) {
      return NextResponse.json(
        { ok: false, error: `Nothing to restore for "${id}".` },
        { status: 404 },
      );
    }

    if (entry.tomlBlock && !hasNonemptyDescriptionFromTomlBlock(entry.tomlBlock)) {
      return NextResponse.json(
        { ok: false, error: `"${id}" needs a description before it can be restored.` },
        { status: 409 },
      );
    }

    const familiarsToml = path.join(covenHome(), "familiars.toml");
    let existing: string | null = null;
    try {
      existing = await readFile(familiarsToml, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (entry.tomlBlock && familiarsTomlContainsId(existing ?? "", id)) {
      return NextResponse.json(
        { ok: false, error: `A familiar with id "${id}" already exists — cannot restore over it.` },
        { status: 409 },
      );
    }

    const priorBinding = config.familiars[id] ? { ...config.familiars[id] } : null;
    let configSaved = false;
    let tomlSaved = false;
    try {
      if (entry.binding) {
        await saveConfigUnlocked({
          familiars: { [id]: entry.binding as unknown as Partial<FamiliarBinding> },
        });
        configSaved = true;
      }
      if (entry.tomlBlock) {
        const base = existing ?? buildFamiliarsToml(null);
        const separator = base.endsWith("\n") ? "\n" : "\n\n";
        await writeFileAtomic(familiarsToml, `${base}${separator}${entry.tomlBlock}\n`);
        tomlSaved = true;
      }
      await takeTombstone(id);
    } catch (error) {
      if (tomlSaved) {
        if (existing === null) await rm(familiarsToml, { force: true }).catch(() => {});
        else await writeFileAtomic(familiarsToml, existing).catch(() => {});
      }
      if (configSaved) {
        await saveConfigUnlocked({ familiars: { [id]: priorBinding } }).catch(() => {});
      }
      throw error;
    }

    return NextResponse.json({ ok: true, id });
  });
}
