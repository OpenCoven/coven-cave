import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import type { LibraryDoc, LibraryCollection } from "@/lib/library-types";

// ── Familiar registry ─────────────────────────────────────────────────────────
// Each entry is a workspace root that exposes a research/ dir.
// Phase 1: Sage only. Phase 2: add Echo, Cody, etc. here (or read from coven daemon).
const FAMILIAR_WORKSPACES: { id: string; name: string; icon: string; root: string }[] = [
  {
    id: "sage",
    name: "Sage",
    icon: "ph:leaf-fill",
    root: path.join(homedir(), ".openclaw", "workspace", "sage"),
  },
];

// ── library.yaml schema (optional per-workspace manifest) ────────────────────
// If ~/.openclaw/workspace/<familiar>/research/library.yaml exists, it controls
// which subdirectories appear, their labels, icons, and sort order.
// Format:
//   collections:
//     - id: synthesis
//       label: "Synthesis"
//       icon: "ph:flask"        # phosphor icon name (optional)
//       recursive: true         # walk subdirs (default: true)
//       hidden: false           # exclude from rail (default: false)
//     - id: sources
//       label: "Papers & Sources"

type ManifestEntry = {
  id: string;
  label?: string;
  icon?: string;
  recursive?: boolean;
  hidden?: boolean;
};

type Manifest = { collections?: ManifestEntry[] };

function parseYamlManifest(content: string): Manifest {
  // Minimal YAML parser — handles the simple key:value / list format we use.
  // Not a full YAML parser; complex values not needed here.
  const result: Manifest = { collections: [] };
  const lines = content.split("\n");
  let inCollections = false;
  let current: ManifestEntry | null = null;

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^collections\s*:/.test(line)) { inCollections = true; continue; }
    if (inCollections) {
      // New list item
      const listMatch = line.match(/^  - id\s*:\s*(.+)$/);
      if (listMatch) {
        if (current) result.collections!.push(current);
        current = { id: listMatch[1].trim().replace(/['"]/g, "") };
        continue;
      }
      if (current) {
        const kvMatch = line.match(/^    (\w+)\s*:\s*(.+)$/);
        if (kvMatch) {
          const [, key, val] = kvMatch;
          const v = val.trim().replace(/^["']|["']$/g, "");
          if (key === "label")     current.label = v;
          else if (key === "icon") current.icon = v;
          else if (key === "recursive") current.recursive = v !== "false";
          else if (key === "hidden")    current.hidden = v === "true";
        }
      }
    }
  }
  if (current) result.collections!.push(current);
  return result;
}

function loadManifest(researchRoot: string): Manifest | null {
  const manifestPath = path.join(researchRoot, "library.yaml");
  if (!fs.existsSync(manifestPath)) return null;
  try {
    return parseYamlManifest(fs.readFileSync(manifestPath, "utf-8"));
  } catch {
    return null;
  }
}

// ── Auto-discovery ───────────────────────────────────────────────────────────
// Walk the research/ dir and return immediate subdirectories as collections.
function discoverCollections(researchRoot: string): LibraryCollection[] {
  if (!fs.existsSync(researchRoot)) return [];
  const entries = fs.readdirSync(researchRoot, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => ({
      id: e.name,
      label: e.name.charAt(0).toUpperCase() + e.name.slice(1).replace(/-/g, " "),
      path: path.join(researchRoot, e.name),
    }));
}

// ── Build final collection list ──────────────────────────────────────────────
// 1. Start with auto-discovered subdirs
// 2. Apply manifest overrides (label, icon, hidden, order)
// 3. Prepend "All" sentinel
function buildCollections(familiar: typeof FAMILIAR_WORKSPACES[number]): LibraryCollection[] {
  const researchRoot = path.join(familiar.root, "research");
  const discovered = discoverCollections(researchRoot);
  const manifest = loadManifest(researchRoot);

  let ordered: LibraryCollection[];

  if (manifest?.collections?.length) {
    // Manifest controls order and metadata; discovered fills in anything not listed
    const manifestIds = new Set(manifest.collections.map((m) => m.id));
    const extra = discovered.filter((d) => !manifestIds.has(d.id));

    ordered = [
      ...manifest.collections
        .filter((m) => !m.hidden)
        .map((m) => {
          const base = discovered.find((d) => d.id === m.id);
          return base
            ? { ...base, label: m.label ?? base.label, icon: m.icon }
            : null;
        })
        .filter(Boolean) as LibraryCollection[],
      ...extra,
    ];
  } else {
    // No manifest — use discovery order (alphabetical from readdir)
    ordered = discovered;
  }

  // Prepend "All" (always first)
  return [
    {
      id: "all",
      label: "All",
      path: researchRoot,
      familiar: familiar.id,
    } as LibraryCollection,
    ...ordered.map((c) => ({ ...c, familiar: familiar.id })),
  ];
}

// ── Security helper ──────────────────────────────────────────────────────────
function realpathOrResolve(value: string): string {
  const resolved = path.resolve(value);
  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function resolveResearchPath(p: string, researchRoot: string): string | null {
  const root = realpathOrResolve(researchRoot);
  const resolved = realpathOrResolve(p);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  return resolved;
}

// ── File walker ──────────────────────────────────────────────────────────────
function walkMdFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...walkMdFiles(full));
    else if (entry.isFile() && entry.name.endsWith(".md")) results.push(full);
  }
  return results;
}

// ── Frontmatter + excerpt helpers ────────────────────────────────────────────
function parseFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
  const fm: Record<string, string> = {};
  if (!content.startsWith("---")) return { frontmatter: fm, body: content };
  const end = content.indexOf("\n---", 3);
  if (end === -1) return { frontmatter: fm, body: content };
  const block = content.slice(4, end);
  for (const line of block.split("\n")) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    fm[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  return { frontmatter: fm, body: content.slice(end + 4).trimStart() };
}

function extractTitle(body: string, filename: string): string {
  const m = body.match(/^#{1,2}\s+(.+)/m);
  return m ? m[1].replace(/[*_`]/g, "").trim() : path.basename(filename, ".md").replace(/-/g, " ");
}

function extractExcerpt(body: string): string {
  const stripped = body.replace(/^#{1,6}\s+.+$/gm, "").replace(/[*_`#>\[\]]/g, "").replace(/\s+/g, " ").trim();
  return stripped.slice(0, 200);
}

function parseTags(fm: Record<string, string>): string[] {
  const raw = fm.tags ?? fm.tag ?? "";
  if (!raw) return [];
  return raw.replace(/[\[\]]/g, "").split(/[,\s]+/).map((t) => t.trim()).filter(Boolean);
}

// ── Route handler ────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const collectionId = req.nextUrl.searchParams.get("collection") ?? "all";
  const familiarId   = req.nextUrl.searchParams.get("familiar") ?? FAMILIAR_WORKSPACES[0].id;

  const familiar = FAMILIAR_WORKSPACES.find((f) => f.id === familiarId) ?? FAMILIAR_WORKSPACES[0];
  const researchRoot = path.join(familiar.root, "research");
  const familiarRoot = realpathOrResolve(familiar.root);
  const collections = buildCollections(familiar);

  const col = collections.find((c) => c.id === collectionId) ?? collections[0];

  const resolvedColPath = resolveResearchPath(col.path, researchRoot);
  if (!resolvedColPath) {
    return NextResponse.json({ ok: false, error: "collection path not allowed" }, { status: 403 });
  }

  const files = walkMdFiles(resolvedColPath);
  const docs: LibraryDoc[] = [];

  for (const file of files) {
    const resolvedFile = resolveResearchPath(file, researchRoot);
    if (!resolvedFile) continue;
    try {
      // resolvedFile is validated under researchRoot above. turbopackIgnore
      // prevents Next from tracing the dynamic path into the build manifest.
      const stat = fs.statSync(/* turbopackIgnore: true */ resolvedFile);
      const content = fs.readFileSync(/* turbopackIgnore: true */ resolvedFile, "utf-8");
      const { frontmatter, body } = parseFrontmatter(content);
      docs.push({
        id: path.relative(familiarRoot, resolvedFile),
        title: frontmatter.title ?? extractTitle(body, file),
        familiar: familiar.id,
        collection: collectionId,
        modifiedAt: stat.mtime.toISOString(),
        tags: parseTags(frontmatter),
        excerpt: extractExcerpt(body),
      });
    } catch {
      // skip unreadable files
    }
  }

  docs.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));

  return NextResponse.json({
    ok: true,
    docs,
    collection: collectionId,
    familiar: familiarId,
    collections,
    familiars: FAMILIAR_WORKSPACES.map(({ id, name, icon }) => ({ id, name, icon })),
  });
}
