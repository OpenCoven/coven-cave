#!/usr/bin/env node
/**
 * generate-daily-notes — scaffold a Daily Note for every familiar.
 *
 * Writes `~/.coven/workspaces/familiars/<id>/notes/<YYYY-MM-DD>.md` for each
 * familiar, in the same Markdown format the Familiars → Daily Notes tab reads
 * (## Notes + ## Self-reflection — see src/lib/daily-note.ts). The Notes section
 * is a deterministic activity digest (memory files the familiar touched that
 * day); the Self-reflection section is seeded with guiding prompts for the
 * familiar/user to complete — Cave has no server-side LLM, so this script never
 * fabricates a reflection. The companion Codex automation
 * (automations/familiar-daily-notes.toml) is what fills in genuine,
 * agent-authored reflections on a schedule.
 *
 * Idempotent: a note that already has content is left alone unless --force, so
 * re-runs (and the daily automation) never clobber human/agent edits.
 *
 * Usage:
 *   node --experimental-strip-types scripts/generate-daily-notes.mjs [YYYY-MM-DD] [--force]
 *
 * (The strip-types flag is needed because this imports the TS source of truth
 * for path resolution + the note format, keeping it from drifting.)
 */
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { familiarIds, familiarWorkspace } from "../src/lib/coven-paths.ts";
import { formatDailyNote, isEmptyNote, parseDailyNote } from "../src/lib/daily-note.ts";

function localDateSlug(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const dateArg = process.argv.slice(2).find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) ?? localDateSlug(new Date());
const force = process.argv.includes("--force");

const REFLECTION_SEED = [
  "- What went well today?",
  "- What was challenging, and how did I handle it?",
  "- What will I do differently next time?",
].join("\n");

/** Collect the names of memory files a familiar touched on the target day. */
async function memoryActivity(workspace, slug) {
  const root = path.join(workspace, "memory");
  const touched = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        try {
          const info = await stat(full);
          if (localDateSlug(info.mtime) === slug) touched.push(path.relative(root, full));
        } catch {
          // unreadable file — skip
        }
      }
    }
  }
  await walk(root);
  return touched.sort();
}

function buildDigest(touched) {
  if (touched.length === 0) {
    return "_No tracked memory activity for this day yet._";
  }
  const lines = [`Touched ${touched.length} memory file${touched.length === 1 ? "" : "s"}:`, ""];
  for (const file of touched.slice(0, 20)) lines.push(`- \`${file}\``);
  if (touched.length > 20) lines.push(`- …and ${touched.length - 20} more`);
  return lines.join("\n");
}

async function readExisting(file) {
  try {
    const raw = await readFile(file, "utf8");
    return parseDailyNote(raw);
  } catch {
    return null;
  }
}

async function main() {
  const ids = await familiarIds();
  let written = 0;
  let skipped = 0;

  for (const id of ids) {
    const workspace = await familiarWorkspace(id);
    const notesDir = path.join(workspace, "notes");
    const file = path.join(notesDir, `${dateArg}.md`);

    const existing = await readExisting(file);
    if (existing && !isEmptyNote(existing) && !force) {
      console.log(`skip   ${id} (${dateArg}.md already has content)`);
      skipped += 1;
      continue;
    }

    const touched = await memoryActivity(workspace, dateArg);
    const note = {
      notes: buildDigest(touched),
      // Preserve any reflection already authored; otherwise seed the prompts.
      reflection: existing?.reflection?.trim() ? existing.reflection : REFLECTION_SEED,
    };

    await mkdir(notesDir, { recursive: true });
    await writeFile(file, formatDailyNote(dateArg, note), "utf8");
    console.log(`write  ${id} → ${file}`);
    written += 1;
  }

  console.log(`\nDaily notes for ${dateArg}: ${written} written, ${skipped} skipped (${ids.length} familiars).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
