import { NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import type { GraphifyResult, GraphifyGraph } from "@/lib/library-types";

const execFileAsync = promisify(execFile);

const GRAPHS_DIR = path.join(
  process.env.CAVE_LIBRARY_DIR ?? path.join(homedir(), ".coven", "library"),
  "graphs",
);


// ── Understand-Anything schema adapter ──────────────────────────────────────
// UA's knowledge-graph.json has a richer schema: nodes have {id, type, name,
// summary, tags, complexity, filePath, ...} and edges have {source, target,
// type, weight, direction, description}. We map it to GraphifyGraph so the
// existing canvas renderer works without changes.
function normalizeUAGraph(raw: unknown): GraphifyGraph {
  if (
    typeof raw !== "object" ||
    raw === null ||
    !Array.isArray((raw as Record<string, unknown>).nodes)
  ) {
    return { nodes: [], edges: [] };
  }
  const r = raw as Record<string, unknown>;
  const nodes = (r.nodes as Array<Record<string, unknown>>).map((n) => ({
    id: String(n.id ?? ""),
    label: String(n.name ?? n.id ?? ""),
    type: String(n.type ?? "file"),
    weight: typeof n.complexity === "string"
      ? ({ simple: 1, moderate: 2, complex: 3 } as Record<string, number>)[n.complexity] ?? 1
      : typeof n.weight === "number" ? n.weight : 1,
    tags: Array.isArray(n.tags) ? (n.tags as string[]) : [],
    summary: typeof n.summary === "string" ? n.summary : undefined,
    filePath: typeof n.filePath === "string" ? n.filePath : undefined,
  }));
  const edges = Array.isArray(r.edges)
    ? (r.edges as Array<Record<string, unknown>>).map((e) => ({
        source: String(e.source ?? ""),
        target: String(e.target ?? ""),
        label: typeof e.type === "string" ? e.type : undefined,
        weight: typeof e.weight === "number" ? e.weight : 1,
      }))
    : [];
  return { nodes, edges };
}

function generateId(): string {
  return `graph_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

async function ensureGraphsDir(): Promise<void> {
  await fs.mkdir(GRAPHS_DIR, { recursive: true });
}

async function readAllGraphMeta(): Promise<Omit<GraphifyResult, "graphJson" | "reportMd">[]> {
  try {
    await fs.access(GRAPHS_DIR);
  } catch {
    return [];
  }
  const files = await fs.readdir(GRAPHS_DIR);
  const metas: Omit<GraphifyResult, "graphJson" | "reportMd">[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const raw = await fs.readFile(path.join(GRAPHS_DIR, file), "utf-8");
      const parsed = JSON.parse(raw) as GraphifyResult;
      metas.push({
        id: parsed.id,
        label: parsed.label,
        targetPath: parsed.targetPath,
        generatedAt: parsed.generatedAt,
      });
    } catch {
      // skip malformed
    }
  }
  return metas.sort((a, b) => (a.generatedAt < b.generatedAt ? 1 : -1));
}

async function readGraphById(id: string): Promise<GraphifyResult | null> {
  try {
    const raw = await fs.readFile(path.join(GRAPHS_DIR, `${id}.json`), "utf-8");
    return JSON.parse(raw) as GraphifyResult;
  } catch {
    return null;
  }
}

// Resolve graphify binary — try PATH first, then uv tool path
async function resolveGraphifyBin(): Promise<string> {
  // Try common locations
  const candidates = [
    "graphify",
    path.join(homedir(), ".local", "bin", "graphify"),
    "/usr/local/bin/graphify",
  ];
  for (const c of candidates) {
    try {
      await execFileAsync("which", [c.includes("/") ? c : "graphify"]);
      return c.includes("/") ? c : "graphify";
    } catch {
      if (c.includes("/")) {
        try {
          await fs.access(c);
          return c;
        } catch { /* continue */ }
      }
    }
  }
  // Fall back to uv run
  return "graphify";
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");

  if (id) {
    const result = await readGraphById(id);
    if (!result) {
      return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, result });
  }

  // ?path= loads an existing UA knowledge-graph.json directly (no pipeline run)
  const rawPath = req.nextUrl.searchParams.get("path");
  if (rawPath) {
    try {
      const uaPath = path.join(rawPath, ".understand-anything", "knowledge-graph.json");
      const raw = await fs.readFile(uaPath, "utf-8");
      const graphJson = normalizeUAGraph(JSON.parse(raw));
      const label = path.basename(rawPath);
      const id = `ua_${Buffer.from(rawPath).toString("base64url").slice(0, 16)}`;
      const result: GraphifyResult = {
        id,
        label,
        targetPath: rawPath,
        generatedAt: new Date().toISOString(),
        graphJson,
      };
      return NextResponse.json({ ok: true, result });
    } catch (err) {
      return NextResponse.json({ ok: false, error: `could not read UA graph: ${String(err)}` }, { status: 404 });
    }
  }

  const metas = await readAllGraphMeta();
  return NextResponse.json({ ok: true, graphs: metas });
}

export async function POST(req: NextRequest) {
  const body = await req.json() as { targetPath?: string; label?: string };
  if (!body.targetPath) {
    return NextResponse.json({ ok: false, error: "targetPath required" }, { status: 400 });
  }

  const targetPath = body.targetPath;

  // Verify path exists
  try {
    const stat = await fs.stat(targetPath);
    if (!stat.isDirectory()) {
      return NextResponse.json({ ok: false, error: "targetPath must be a directory" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ ok: false, error: "targetPath does not exist" }, { status: 400 });
  }

  const graphifyBin = await resolveGraphifyBin();

  // Run graphify with timeout
  try {
    await execFileAsync(graphifyBin, [targetPath], {
      cwd: targetPath,
      timeout: 120_000,
      env: { ...process.env, PATH: `${process.env.PATH}:${path.join(homedir(), ".local", "bin")}` },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[graph/route] graphify error:", msg);
    return NextResponse.json({ ok: false, error: `graphify failed: ${msg}` }, { status: 500 });
  }

  // Read outputs — prefer Understand-Anything output, fall back to legacy graphify-out
  const uaGraphPath = path.join(targetPath, ".understand-anything", "knowledge-graph.json");
  const legacyGraphPath = path.join(targetPath, "graphify-out", "graph.json");

  let graphJson: GraphifyGraph;
  try {
    // Try UA output first (richer: summaries, complexity, typed edges)
    const uaRaw = await fs.readFile(uaGraphPath, "utf-8").catch(() => null);
    if (uaRaw) {
      graphJson = normalizeUAGraph(JSON.parse(uaRaw));
    } else {
      // Fall back to legacy graphify-out/graph.json
      const raw = await fs.readFile(legacyGraphPath, "utf-8");
      graphJson = JSON.parse(raw) as GraphifyGraph;
    }
    if (!Array.isArray(graphJson.nodes)) graphJson.nodes = [];
    if (!Array.isArray(graphJson.edges)) graphJson.edges = [];
  } catch (err) {
    return NextResponse.json({ ok: false, error: `could not read graph output: ${String(err)}` }, { status: 500 });
  }

  let reportMd: string | undefined;
  try {
    reportMd = await fs.readFile(path.join(targetPath, "graphify-out", "GRAPH_REPORT.md"), "utf-8");
  } catch {
    reportMd = undefined;
  }

  const id = generateId();
  const label = body.label ?? path.basename(targetPath);

  const result: GraphifyResult = {
    id,
    label,
    targetPath,
    generatedAt: new Date().toISOString(),
    reportMd,
    graphJson,
  };

  await ensureGraphsDir();
  await fs.writeFile(
    path.join(GRAPHS_DIR, `${id}.json`),
    JSON.stringify(result, null, 2),
    "utf-8",
  );

  return NextResponse.json({ ok: true, result });
}
