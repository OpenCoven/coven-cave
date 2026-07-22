import { NextResponse } from "next/server";
import { constants } from "node:fs";
import { open, readdir } from "node:fs/promises";
import path from "node:path";
import {
  isBrowsableSkillAuxName,
  MAX_SKILL_FILE_PREVIEW_BYTES,
  resolveBrowsableSkillDir,
} from "@/lib/server/skill-file-paths";

export const dynamic = "force-dynamic";

export type SkillDirEntry = {
  name: string;
  kind: "file" | "dir";
  size?: number;
  /** For dirs: up to the first 20 child names, display-only (never readable). */
  children?: string[];
};

/**
 * Skill-detail file browser: list the text files inside one scanned skill
 * directory, or read one of them by NAME. The directory must prove itself
 * first — its descriptor (SKILL.md / automation.toml) has to pass the same
 * allow-list as /api/skills/file — and reads only accept a single validated
 * filename joined to that proven directory, so this never becomes an
 * arbitrary-file-read primitive.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const dir = url.searchParams.get("dir");
  if (!dir) {
    return NextResponse.json({ ok: false, error: "dir required" }, { status: 400 });
  }
  const skillDir = await resolveBrowsableSkillDir(dir);
  if (!skillDir) {
    return NextResponse.json({ ok: false, error: "path not allowed" }, { status: 403 });
  }

  const fileName = url.searchParams.get("file");
  if (fileName) {
    if (!isBrowsableSkillAuxName(fileName)) {
      return NextResponse.json({ ok: false, error: "file not allowed" }, { status: 403 });
    }
    try {
      const file = await open(
        /* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ skillDir, fileName),
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      try {
        const stat = await file.stat();
        if (!stat.isFile()) {
          return NextResponse.json({ ok: false, error: "not a file" }, { status: 404 });
        }
        if (stat.size > MAX_SKILL_FILE_PREVIEW_BYTES) {
          return NextResponse.json({ ok: false, error: "file too large" }, { status: 413 });
        }
        const text = await file.readFile("utf8");
        return NextResponse.json({ ok: true, name: fileName, text, size: stat.size });
      } finally {
        await file.close();
      }
    } catch (err) {
      return NextResponse.json(
        { ok: false, error: err instanceof Error ? err.message : "read failed" },
        { status: 404 },
      );
    }
  }

  try {
    const dirents = await readdir(/* turbopackIgnore: true */ skillDir, { withFileTypes: true });
    const entries: SkillDirEntry[] = [];
    for (const entry of dirents) {
      if (entry.name.startsWith(".")) continue;
      if (entry.isFile() && isBrowsableSkillAuxName(entry.name)) {
        let size: number | undefined;
        try {
          const file = await open(
            /* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ skillDir, entry.name),
            constants.O_RDONLY | constants.O_NOFOLLOW,
          );
          try {
            size = (await file.stat()).size;
          } finally {
            await file.close();
          }
        } catch {
          continue; // Symlink or unreadable — not browsable.
        }
        entries.push({ name: entry.name, kind: "file", size });
      } else if (entry.isDirectory()) {
        let children: string[] = [];
        try {
          children = (await readdir(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ skillDir, entry.name)))
            .filter((name) => !name.startsWith("."))
            .slice(0, 20);
        } catch {
          // Unreadable subdir still lists, just without children.
        }
        entries.push({ name: entry.name, kind: "dir", children });
      }
    }
    // Descriptor first, then files A→Z, then dirs A→Z — matches the modal rail.
    entries.sort((a, b) => {
      const rank = (e: SkillDirEntry) =>
        e.name === "SKILL.md" || e.name === "automation.toml" ? 0 : e.kind === "file" ? 1 : 2;
      return rank(a) - rank(b) || a.name.localeCompare(b.name);
    });
    return NextResponse.json({ ok: true, dir: skillDir, entries });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "list failed" },
      { status: 500 },
    );
  }
}
