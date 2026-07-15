export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { mkdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { loadConfig, saveConfig } from "@/lib/cave-config";
import { adapterManifestScaffoldForHarness } from "@/lib/harness-adapters";

const ALLOWED_TOP_LEVEL_KEYS = new Set([
  "addons",
  "defaults",
  "familiars",
  "roles",
  "marketplace",
  "multiHost",
  "omnigent",
  "chatAutoArchive",
]);
type ConfigPatchBody = Record<string, unknown>;

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

function harnessesFromConfigPatch(body: ConfigPatchBody): string[] {
  const harnesses = new Set<string>();
  const defaults = body.defaults;
  if (defaults && typeof defaults === "object") {
    const defaultsHarness = (defaults as Record<string, unknown>).harness;
    if (typeof defaultsHarness === "string" && defaultsHarness.trim()) {
      harnesses.add(defaultsHarness.trim());
    }
  }

  const familiars = body.familiars;
  if (familiars && typeof familiars === "object") {
    for (const patch of Object.values(familiars)) {
      if (!patch || typeof patch !== "object") continue;
      const patchHarness = (patch as Record<string, unknown>).harness;
      if (typeof patchHarness === "string" && patchHarness.trim()) {
        harnesses.add(patchHarness.trim());
      }
    }
  }
  return [...harnesses];
}

async function scaffoldAdapterManifestsFromPatch(body: ConfigPatchBody): Promise<void> {
  const harnesses = harnessesFromConfigPatch(body);
  if (harnesses.length === 0) return;
  const adaptersDir = path.join(homedir(), ".coven", "adapters");
  let ensuredAdaptersDir = false;
  for (const harness of harnesses) {
    const scaffold = adapterManifestScaffoldForHarness(harness);
    if (!scaffold) continue;
    if (!ensuredAdaptersDir) {
      await mkdir(adaptersDir, { recursive: true });
      ensuredAdaptersDir = true;
    }
    const manifestPath = path.join(adaptersDir, scaffold.filename);
    if (!(await pathExists(manifestPath))) {
      await writeFile(manifestPath, scaffold.contents, "utf8");
    }
  }
}

export async function GET() {
  try {
    const config = await loadConfig();
    return NextResponse.json({ ok: true, config });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "failed to load config" },
      { status: 500 },
    );
  }
}

export async function PATCH(req: NextRequest) {
  let body: ConfigPatchBody;
  try {
    body = await req.json() as ConfigPatchBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  // Reject unknown top-level keys
  for (const key of Object.keys(body)) {
    if (!ALLOWED_TOP_LEVEL_KEYS.has(key)) {
      return NextResponse.json(
        { ok: false, error: `unknown config key: ${key}` },
        { status: 400 },
      );
    }
  }

  try {
    await scaffoldAdapterManifestsFromPatch(body);
    const updated = await saveConfig(body as Parameters<typeof saveConfig>[0]);
    return NextResponse.json({ ok: true, config: updated });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "failed to save config" },
      { status: 500 },
    );
  }
}
