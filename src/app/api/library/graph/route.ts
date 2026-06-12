import { NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import type { GraphifyResult, GraphifyGraph, GraphifyRunSnapshot } from "@/lib/library-types";
import { resolveSecret } from "@/lib/vault";

const execFileAsync = promisify(execFile);

const GRAPHIFY_LLM_ENV_KEYS = [
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "MOONSHOT_API_KEY",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "DEEPSEEK_API_KEY",
] as const;

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

function isSafeGraphId(id: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(id);
}

async function readGraphById(id: string): Promise<GraphifyResult | null> {
  if (!isSafeGraphId(id)) {
    return null;
  }

  const graphsRoot = path.resolve(GRAPHS_DIR);
  const expectedFile = `${id}.json`;

  try {
    const files = await fs.readdir(graphsRoot);
    const matchedFile = files.find((file) => file === expectedFile);
    if (!matchedFile) {
      return null;
    }

    const safePath = path.resolve(graphsRoot, matchedFile);
    if (!(safePath === graphsRoot || safePath.startsWith(`${graphsRoot}${path.sep}`))) {
      return null;
    }

    const raw = await fs.readFile(safePath, "utf-8");
    return withGraphRunSnapshots(JSON.parse(raw) as GraphifyResult);
  } catch {
    return null;
  }
}

function makeGraphRunSnapshot({
  id,
  targetPath,
  label,
  status,
  graphJson,
  error,
}: {
  id: string;
  targetPath: string;
  label?: string;
  status: GraphifyRunSnapshot["status"];
  graphJson?: GraphifyGraph;
  error?: string;
}): GraphifyRunSnapshot {
  return {
    id,
    targetPath,
    label,
    status,
    generatedAt: new Date().toISOString(),
    nodeCount: graphJson?.nodes.length ?? 0,
    edgeCount: graphJson?.edges.length ?? 0,
    error,
  };
}

function withGraphRunSnapshots(result: GraphifyResult): GraphifyResult {
  if (Array.isArray(result.snapshots) && result.snapshots.length > 0) return result;
  return {
    ...result,
    snapshots: [
      {
        id: `${result.id}_completed`,
        targetPath: result.targetPath,
        label: result.label,
        status: "completed",
        generatedAt: result.generatedAt,
        nodeCount: result.graphJson?.nodes?.length ?? 0,
        edgeCount: result.graphJson?.edges?.length ?? 0,
      },
    ],
  };
}

async function writeGraphResult(result: GraphifyResult): Promise<void> {
  await ensureGraphsDir();
  await fs.writeFile(
    path.join(GRAPHS_DIR, `${result.id}.json`),
    JSON.stringify(result, null, 2),
    "utf-8",
  );
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

function buildGraphifyEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${process.env.PATH}:${path.join(homedir(), ".local", "bin")}`,
  };
  for (const key of GRAPHIFY_LLM_ENV_KEYS) {
    const value = resolveSecret(key);
    if (value) env[key] = value;
  }
  return env;
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
        snapshots: [
          makeGraphRunSnapshot({
            id: `${id}_loaded`,
            targetPath: rawPath,
            label,
            status: "completed",
            graphJson,
          }),
        ],
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

  // Constrain user-provided paths to a safe root directory.
  // Use HOME as the allowed workspace root for graph operations.
  const safeRoot = await fs.realpath(homedir());
  const resolvedTargetPath = path.resolve(safeRoot, body.targetPath);

  let targetPath: string;
  try {
    targetPath = await fs.realpath(resolvedTargetPath);
  } catch {
    return NextResponse.json({ ok: false, error: "targetPath does not exist" }, { status: 400 });
  }

  const safeRootWithSep = safeRoot.endsWith(path.sep) ? safeRoot : `${safeRoot}${path.sep}`;
  if (targetPath !== safeRoot && !targetPath.startsWith(safeRootWithSep)) {
    return NextResponse.json({ ok: false, error: "targetPath is outside allowed root" }, { status: 403 });
  }

  // Verify path exists and is a directory
  try {
    const stat = await fs.stat(targetPath);
    if (!stat.isDirectory()) {
      return NextResponse.json({ ok: false, error: "targetPath must be a directory" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ ok: false, error: "targetPath does not exist" }, { status: 400 });
  }

  const graphifyBin = await resolveGraphifyBin();
  const id = generateId();
  const label = body.label ?? path.basename(targetPath);
  const snapshots: GraphifyRunSnapshot[] = [
    makeGraphRunSnapshot({
      id: `${id}_started`,
      targetPath,
      label,
      status: "started",
    }),
  ];
  const startedResult: GraphifyResult = {
    id,
    label,
    targetPath,
    generatedAt: snapshots[0]!.generatedAt,
    snapshots,
    graphJson: { nodes: [], edges: [] },
  };
  await writeGraphResult(startedResult);

  // Run graphify with timeout
  try {
    await execFileAsync(graphifyBin, [targetPath], {
      cwd: targetPath,
      timeout: 120_000,
      env: buildGraphifyEnv(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const failedSnapshots = [
      ...snapshots,
      makeGraphRunSnapshot({
        id: `${id}_failed`,
        targetPath,
        label,
        status: "failed",
        error: msg,
      }),
    ];
    await writeGraphResult({
      ...startedResult,
      snapshots: failedSnapshots,
      generatedAt: failedSnapshots[failedSnapshots.length - 1]!.generatedAt,
    });
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

  snapshots.push(makeGraphRunSnapshot({
    id: `${id}_completed`,
    targetPath,
    label,
    status: "completed",
    graphJson,
  }));

  const result: GraphifyResult = {
    id,
    label,
    targetPath,
    generatedAt: snapshots[snapshots.length - 1]!.generatedAt,
    reportMd,
    snapshots,
    graphJson,
  };

  await writeGraphResult(result);

  return NextResponse.json({ ok: true, result });
}
