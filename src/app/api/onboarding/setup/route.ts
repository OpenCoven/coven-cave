import { NextResponse } from "next/server";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { caveHome, covenHome } from "@/lib/coven-paths";
import {
  normalizeMultiHostConfig,
  saveConfigUnlocked,
  withFamiliarLifecycleGuard,
  type CaveMultiHostConfig,
} from "@/lib/cave-config";
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
import { modelForRuntimeSwitch } from "@/lib/runtime-models";
import { ensureAdapterManifestScaffold } from "@/lib/server/adapter-manifest-scaffold";
import { writeFileAtomic } from "@/lib/server/atomic-write";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SetupBody = {
  harness?: string;
  model?: string;
  familiar?: OnboardingFamiliarInput;
  multiHost?: Partial<CaveMultiHostConfig>;
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
  const model = modelForRuntimeSwitch(
    harness,
    draft?.model ?? body.model ?? null,
  );

  const covenDir = covenHome();
  const caveDir = caveHome();
  const familiarsToml = path.join(covenDir, "familiars.toml");
  const conversationsDir = path.join(caveDir, "conversations");
  const memoryDir = path.join(covenDir, "memory");

  const wrote: string[] = [];

  await mkdir(covenDir, { recursive: true });
  await mkdir(caveDir, { recursive: true });
  await mkdir(conversationsDir, { recursive: true });
  await mkdir(memoryDir, { recursive: true });

  const adapterManifest = adapterManifestScaffoldForHarness(harness);
  if (adapterManifest && await ensureAdapterManifestScaffold(harness)) {
    wrote.push(`adapters/${adapterManifest.filename}`);
  }

  // Always update the cave config defaults so the user's chosen adapter
  // binding takes effect even if they re-run setup.
  //
  // IMPORTANT: nextConfig must carry over every field from `existing` that we
  // are not explicitly changing here. Earlier versions of this route emitted a
  // {version, defaults, familiars}-only literal, which silently wiped the
  // user's `addons`, `roles`, and `marketplace.installed` settings every time
  // they added a familiar. Guard against that regression with the source-test
  // at src/app/api/onboarding/setup/route.test.ts.
  await withFamiliarLifecycleGuard(async (existing) => {
    const familiarsExists = await pathExists(familiarsToml);
    const existingToml = familiarsExists
      ? await readFile(familiarsToml, "utf8")
      : null;
    let nextToml: string | null = null;
    if (existingToml === null) {
      nextToml = buildFamiliarsToml(draft);
    } else if (draft && !familiarsTomlContainsId(existingToml, draft.id)) {
      const separator = existingToml.endsWith("\n") ? "\n" : "\n\n";
      nextToml =
        `${existingToml}${separator}${buildFamiliarsToml(draft).replace(/^# User familiars for this Coven\.\n+/, "")}`;
    }

    let tomlSaved = false;
    try {
      if (nextToml !== null) {
        await writeFileAtomic(familiarsToml, nextToml);
        tomlSaved = true;
      }
      await saveConfigUnlocked({
        defaults: {
          harness,
          model: model || existing.defaults.model,
        },
        ...(draft
          ? {
              familiars: {
                [draft.id]: {
                  harness: draft.harness,
                  ...(draft.model ? { model: draft.model } : {}),
                  ...(draft.runtime ? { runtime: draft.runtime } : {}),
                },
              },
            }
          : {}),
        multiHost: normalizeMultiHostConfig({
          ...existing.multiHost,
          ...(body.multiHost ?? {}),
        }),
      });
    } catch (error) {
      if (tomlSaved) {
        if (existingToml === null) await rm(familiarsToml, { force: true }).catch(() => {});
        else await writeFileAtomic(familiarsToml, existingToml).catch(() => {});
      }
      throw error;
    }
    if (tomlSaved) wrote.push("familiars.toml");
  });
  wrote.push("cave/config.json");

  return NextResponse.json({ ok: true, wrote, covenDir });
}
