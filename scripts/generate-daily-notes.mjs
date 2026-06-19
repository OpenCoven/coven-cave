#!/usr/bin/env node
/**
 * generate-daily-notes — scaffold a Daily Note for every familiar.
 *
 * Writes `~/.coven/workspaces/familiars/<id>/notes/<YYYY-MM-DD>.md` for each
 * familiar, in the same Markdown format the Familiars → Daily Notes tab reads
 * (## Notes + ## Self-reflection — see src/lib/daily-note.ts).
 *
 * The `## Notes` section is a deterministic activity digest: the sessions the
 * familiar ran that day (from the daemon) plus the memory files it touched
 * (with excerpts). The `## Self-reflection` section is seeded with guiding
 * prompts — Cave has no server-side LLM, so this script never fabricates a
 * reflection; the companion Codex automation (automations/familiar-daily-notes.toml)
 * fills in genuine, agent-authored reflections on a schedule.
 *
 * Section-targeted + safe by default:
 *   (no flag)            idempotent — skip a note that already has content.
 *   --section notes      refresh ONLY the activity digest; keep any reflection
 *                        already there (authored or seeded). Safe to re-run.
 *   --section reflection reset ONLY the reflection to the seed prompts; keep the
 *                        digest. Use before re-authoring reflections.
 *   --section all        rewrite both (digest + seed reflection). Full reset.
 *
 * Usage:
 *   node --experimental-strip-types scripts/generate-daily-notes.mjs [YYYY-MM-DD] [--section notes|reflection|all]
 *
 * (The strip-types flag is needed because this imports the TS source of truth
 * for path resolution + the note format, keeping it from drifting.)
 */
import { request } from "node:http";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { covenHome, familiarIds, familiarWorkspace } from "../src/lib/coven-paths.ts";
import {
  buildActivityDigest,
  excerptOf,
  formatDailyNote,
  isEmptyNote,
  parseDailyNote,
} from "../src/lib/daily-note.ts";

function localDateSlug(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const argv = process.argv.slice(2);
const dateArg = argv.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) ?? localDateSlug(new Date());
const sectionFlag = (() => {
  const i = argv.indexOf("--section");
  const val = i >= 0 ? argv[i + 1] : argv.includes("--force") ? "all" : null;
  return ["notes", "reflection", "all"].includes(val) ? val : null; // null = default idempotent
})();

const REFLECTION_SEED = [
  "- What went well today?",
  "- What was challenging, and how did I handle it?",
  "- What will I do differently next time?",
].join("\n");

/** GET a daemon endpoint over the unix socket. Best-effort: resolves null on any failure. */
function daemonGet(reqPath) {
  return new Promise((resolve) => {
    const req = request(
      { socketPath: path.join(covenHome(), "coven.sock"), path: reqPath, method: "GET", timeout: 4000 },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
    req.end();
  });
}

/** Sessions the daemon recorded for `familiarId`, updated on the target day. */
function sessionsForDay(allSessions, familiarId, slug) {
  return allSessions
    .filter((s) => s.familiar_id === familiarId && localDateSlug(new Date(s.updated_at)) === slug)
    .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))
    .map((s) => ({ title: s.title, harness: s.harness }));
}

/** Memory files a familiar touched on the target day, with a short excerpt each. */
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
          if (localDateSlug(info.mtime) !== slug) continue;
          let excerpt = "";
          if (/\.(md|txt)$/i.test(entry.name)) {
            excerpt = excerptOf(await readFile(full, "utf8").catch(() => ""));
          }
          touched.push({ file: path.relative(root, full), excerpt });
        } catch {
          // unreadable file — skip
        }
      }
    }
  }
  await walk(root);
  return touched.sort((a, b) => (a.file < b.file ? -1 : 1));
}

async function readExisting(file) {
  try {
    return parseDailyNote(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

async function main() {
  const ids = await familiarIds();
  const allSessions = (await daemonGet("/api/v1/sessions")) || [];
  const sessionList = Array.isArray(allSessions) ? allSessions : allSessions.sessions || [];
  const daemonNote = Array.isArray(allSessions) || allSessions?.sessions ? "" : " (daemon offline — sessions skipped)";

  let written = 0;
  let skipped = 0;

  for (const id of ids) {
    const workspace = await familiarWorkspace(id);
    const notesDir = path.join(workspace, "notes");
    const file = path.join(notesDir, `${dateArg}.md`);
    const existing = (await readExisting(file)) ?? { notes: "", reflection: "" };
    const hasContent = !isEmptyNote(existing);

    // Default mode is idempotent: never disturb a note that already has content.
    if (sectionFlag === null && hasContent) {
      console.log(`skip   ${id} (${dateArg}.md already has content)`);
      skipped += 1;
      continue;
    }

    const digest = buildActivityDigest(sessionsForDay(sessionList, id, dateArg), await memoryActivity(workspace, dateArg));
    const seededReflection = existing.reflection.trim() ? existing.reflection : REFLECTION_SEED;

    // Decide each section per the targeting flag (default writes both for a fresh note).
    const writeNotes = sectionFlag === null || sectionFlag === "notes" || sectionFlag === "all";
    const resetReflection = sectionFlag === "reflection" || sectionFlag === "all";
    const note = {
      notes: writeNotes ? digest : existing.notes,
      reflection: resetReflection ? REFLECTION_SEED : seededReflection,
    };

    await mkdir(notesDir, { recursive: true });
    await writeFile(file, formatDailyNote(dateArg, note), "utf8");
    console.log(`write  ${id} → ${file}`);
    written += 1;
  }

  console.log(
    `\nDaily notes for ${dateArg}: ${written} written, ${skipped} skipped (${ids.length} familiars)` +
      `${sectionFlag ? ` [section=${sectionFlag}]` : ""}${daemonNote}.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
