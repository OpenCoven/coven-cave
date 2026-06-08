import { NextResponse } from "next/server";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { loadConfig } from "@/lib/cave-config";
import {
  buildFamiliarsToml,
  familiarsTomlContainsId,
  normalizeFamiliarDraft,
  type OnboardingFamiliarDraft,
  type OnboardingFamiliarInput,
} from "@/lib/onboarding-familiars";
import {
  adapterManifestScaffoldForHarness,
  isTrustedOnboardingHarness,
} from "@/lib/harness-adapters";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SetupBody = {
  harness?: string;
  model?: string;
  familiar?: OnboardingFamiliarInput;
};

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  let body: SetupBody = {};
  try {
    body = (await req.json()) as SetupBody;
  } catch {
    /* allow empty */
  }

  let draft: OnboardingFamiliarDraft | null = null;
  try {
    draft = body.familiar ? normalizeFamiliarDraft(body.familiar) : null;
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Invalid familiar.",
      },
      { status: 400 },
    );
  }
  const harness = (draft?.harness ?? body.harness ?? "codex").trim() || "codex";
  if (!isTrustedOnboardingHarness(harness)) {
    return NextResponse.json(
      { ok: false, error: `Unsupported harness: ${harness}.` },
      { status: 400 },
    );
  }
  const model =
    (draft?.model ?? body.model ?? "codex-local").trim() || "codex-local";

  const home = homedir();
  const covenDir = path.join(home, ".coven");
  const familiarsToml = path.join(covenDir, "familiars.toml");
  const configJson = path.join(covenDir, "cave-config.json");
  const conversationsDir = path.join(covenDir, "cave-conversations");
  const memoryDir = path.join(covenDir, "memory");
  const adaptersDir = path.join(covenDir, "adapters");

  const wrote: string[] = [];

  await mkdir(covenDir, { recursive: true });
  await mkdir(conversationsDir, { recursive: true });
  await mkdir(memoryDir, { recursive: true });
  await mkdir(adaptersDir, { recursive: true });

  const adapterManifest = adapterManifestScaffoldForHarness(harness);
  if (adapterManifest) {
    const manifestPath = path.join(adaptersDir, adapterManifest.filename);
    if (!(await pathExists(manifestPath))) {
      await writeFile(manifestPath, adapterManifest.contents, "utf8");
      wrote.push(`adapters/${adapterManifest.filename}`);
    }
  }

  const familiarsExists = await pathExists(familiarsToml);
  if (!familiarsExists) {
    await writeFile(familiarsToml, buildFamiliarsToml(draft), "utf8");
    wrote.push("familiars.toml");
  } else if (draft) {
    const existingToml = await readFile(familiarsToml, "utf8");
    if (!familiarsTomlContainsId(existingToml, draft.id)) {
      const separator = existingToml.endsWith("\n") ? "\n" : "\n\n";
      await writeFile(
        familiarsToml,
        `${existingToml}${separator}${buildFamiliarsToml(draft).replace(/^# User familiars for this Coven\.\n+/, "")}`,
        "utf8",
      );
      wrote.push("familiars.toml");
    }
  }

  // Always update cave-config.json defaults so the user's chosen adapter
  // binding takes effect even if they re-run setup.
  const existing = await loadConfig();
  const nextConfig = {
    version: existing.version || 1,
    defaults: { harness, model },
    familiars: draft
      ? {
          ...(existing.familiars ?? {}),
          [draft.id]: { harness: draft.harness, model: draft.model },
        }
      : (existing.familiars ?? {}),
  };
  await writeFile(configJson, JSON.stringify(nextConfig, null, 2), "utf8");
  wrote.push("cave-config.json");

  return NextResponse.json({ ok: true, wrote, covenDir });
}
