import { NextResponse } from "next/server";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { saveConfig, type FamiliarBinding } from "@/lib/cave-config";
import { buildFamiliarsToml, familiarsTomlContainsId } from "@/lib/onboarding-familiars";
import { hasNonemptyDescriptionFromTomlBlock } from "@/lib/familiar-removal";
import { isValidFamiliarId } from "@/lib/server/familiar-id";
import { readTombstones, takeTombstone } from "@/lib/server/familiar-tombstones";

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

  const entry = (await readTombstones()).find((tombstone) => tombstone.id === id);
  if (!entry) {
    return NextResponse.json(
      { ok: false, error: `Nothing to restore for "${id}".` },
      { status: 404 },
    );
  }

  // Older tombstones can contain the same description-less block that broke
  // the daemon roster. Keep the tombstone so the user can recreate it with a
  // description; never restore a registry record Coven cannot parse.
  if (entry.tomlBlock && !hasNonemptyDescriptionFromTomlBlock(entry.tomlBlock)) {
    return NextResponse.json(
      { ok: false, error: `"${id}" needs a description before it can be restored.` },
      { status: 409 },
    );
  }

  const familiarsToml = path.join(homedir(), ".coven", "familiars.toml");
  let existing = "";
  try {
    existing = await readFile(familiarsToml, "utf8");
  } catch {
    /* absent — restore recreates the file */
  }

  // Conflict-check BEFORE consuming the tombstone: if the id was re-created in
  // the meantime, appending the snapshot would register a duplicate block (the
  // daemon only reads the first) and the binding write would clobber the new
  // familiar's. Leave both the tombstone and the newcomer intact instead.
  if (entry.tomlBlock && familiarsTomlContainsId(existing, id)) {
    return NextResponse.json(
      { ok: false, error: `A familiar with id "${id}" already exists — cannot restore over it.` },
      { status: 409 },
    );
  }

  await takeTombstone(id);

  if (entry.tomlBlock) {
    const base = existing || buildFamiliarsToml(null);
    const separator = base.endsWith("\n") ? "\n" : "\n\n";
    await writeFile(familiarsToml, `${base}${separator}${entry.tomlBlock}\n`, "utf8");
  }
  if (entry.binding) {
    await saveConfig({
      familiars: { [id]: entry.binding as unknown as Partial<FamiliarBinding> },
    });
  }

  return NextResponse.json({ ok: true, id });
}
