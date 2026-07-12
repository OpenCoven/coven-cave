import { NextResponse } from "next/server";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { callDaemon } from "@/lib/coven-daemon";
import { bindingFor, loadConfig, saveConfig } from "@/lib/cave-config";
import {
  explicitFamiliarIdsFromToml,
  filterInstallSeedFamiliars,
} from "@/lib/familiar-roster-guard";
import { resolveFamiliarAvatar } from "@/lib/server/familiar-avatar";
import {
  buildFamiliarsToml,
  familiarsTomlContainsId,
  normalizeFamiliarDraft,
  type OnboardingFamiliarInput,
} from "@/lib/onboarding-familiars";
import { adapterManifestScaffoldForHarness } from "@/lib/harness-adapters";
import { scaffoldFamiliarContractFiles } from "@/lib/server/familiar-contract-files";
import { removedFamiliarIds, takeTombstone } from "@/lib/server/familiar-tombstones";

export const dynamic = "force-dynamic";

export type DaemonFamiliar = {
  id: string;
  display_name: string;
  role: string;
  description?: string;
  pronouns?: string;
  status?: string;
  last_seen?: string;
  active_sessions?: number;
  memory_freshness?: string;
};

export async function GET() {
  const covenDir = path.join(homedir(), ".coven");
  const familiarsToml = path.join(covenDir, "familiars.toml");
  const [res, config, removedIds, explicitIds] = await Promise.all([
    callDaemon<(DaemonFamiliar & { emoji?: string; icon?: string })[]>({
      path: "/api/v1/familiars",
    }),
    loadConfig(),
    removedFamiliarIds().catch(() => new Set<string>()),
    readFile(familiarsToml, "utf8")
      .then(explicitFamiliarIdsFromToml)
      .catch(() => new Set<string>()),
  ]);
  if (!res.ok) {
    // Auth failures (401/403) mean the hub/daemon rejected our access token
    // — typically a stale or missing token after a hub reconnect. Surface
    // that distinctly and actionably instead of collapsing every daemon
    // failure into a bare 503/401 code in the notch ("Failed to load
    // familiars (401)"), which tells the user nothing about how to recover.
    if (res.status === 401 || res.status === 403) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Not authorized to load familiars — the Coven hub rejected this Cave's access token. Reconnect to the hub (or re-run setup) to refresh it.",
          reason: "unauthorized",
          familiars: [],
        },
        { status: res.status },
      );
    }
    return NextResponse.json(
      { ok: false, error: res.error ?? `daemon http ${res.status}`, familiars: [] },
      { status: 503 },
    );
  }
  // Pass `emoji` through — it's the daemon-provided default glyph the
  // glyph picker uses as the starting value. The Cave-local override store
  // (`cave-glyph-overrides.ts`) wins on render when the user picks something.
  //
  // `avatarUrl` points at the workspace avatar (.../familiars/<id>/avatars/<img>)
  // when one exists, cache-busted by file mtime plus renderer format so both
  // content changes and server-side encoding changes refetch in desktop
  // WebViews. Familiars with no on-disk avatar omit it and render the glyph.
  //
  // A removed familiar (DELETE /api/familiars/[id]) can linger in the daemon's
  // in-memory roster until it re-reads familiars.toml — hide tombstoned ids so
  // Remove takes effect immediately in every client.
  const familiars = await Promise.all(
    filterInstallSeedFamiliars(res.data ?? [], explicitIds)
      .filter((f) => !removedIds.has(f.id))
      .map(async (f) => {
      const configEntry = config.familiars[f.id] ?? {};
      const binding = bindingFor(config, f.id);
      const avatar = await resolveFamiliarAvatar(f.id);
      return {
        ...f,
        display_name: binding.display_name ?? f.display_name,
        role: binding.role ?? f.role,
        pronouns: binding.pronouns ?? f.pronouns,
        description: binding.description ?? f.description,
        color: binding.color,
        harness: binding.harness,
        defaultHarness: config.defaults.harness,
        harnessOverride: configEntry.harness ?? null,
        model: binding.model,
        note: binding.note,
        voiceProvider: binding.voiceProvider,
        voiceModel: binding.voiceModel,
        voiceName: binding.voiceName,
        autoSelfReport: configEntry.autoSelfReport ?? false,
        asanaEnabled: configEntry.asanaEnabled,
        asanaWorkspaceGid: configEntry.asanaWorkspaceGid,
        avatarUrl: avatar
          ? `/api/familiars/${encodeURIComponent(f.id)}/avatar?v=${Math.round(avatar.mtimeMs)}&format=png`
          : undefined,
      };
    }),
  );
  return NextResponse.json({ ok: true, familiars });
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

type CreateBody = { familiar?: OnboardingFamiliarInput };

/**
 * Create a familiar from the UI ("New familiar" dialog).
 *
 * Reuses the same write primitives as onboarding (`normalizeFamiliarDraft`,
 * `buildFamiliarsToml`, the adapter-manifest scaffold) so a familiar created
 * here is indistinguishable from one created during first-run setup.
 *
 * Difference from `/api/onboarding/setup`: this route NEVER writes
 * `defaults`. Onboarding sets the global default harness/model from the first
 * familiar; adding an Nth familiar from the roster must not silently change the
 * user's default, so we only upsert that one familiar's binding via
 * `saveConfig({ familiars })`, which deep-merges and leaves everything else
 * (defaults, roles, add-ons, marketplace) untouched.
 */
export async function POST(req: Request) {
  let body: CreateBody = {};
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    /* allow empty — handled by the validation below */
  }

  if (!body.familiar) {
    return NextResponse.json(
      { ok: false, error: "Familiar details are required." },
      { status: 400 },
    );
  }

  let draft;
  try {
    draft = normalizeFamiliarDraft(body.familiar);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Invalid familiar." },
      { status: 400 },
    );
  }

  const covenDir = path.join(homedir(), ".coven");
  const familiarsToml = path.join(covenDir, "familiars.toml");
  const adaptersDir = path.join(covenDir, "adapters");

  await mkdir(covenDir, { recursive: true });

  // Reject duplicates rather than appending a second [[familiar]] block with
  // the same id (the daemon would only ever see the first).
  const familiarsExists = await pathExists(familiarsToml);
  if (familiarsExists) {
    const existingToml = await readFile(familiarsToml, "utf8");
    if (familiarsTomlContainsId(existingToml, draft.id)) {
      return NextResponse.json(
        { ok: false, error: `A familiar with id "${draft.id}" already exists.` },
        { status: 409 },
      );
    }
    const separator = existingToml.endsWith("\n") ? "\n" : "\n\n";
    await writeFile(
      familiarsToml,
      `${existingToml}${separator}${buildFamiliarsToml(draft).replace(/^# User familiars for this Coven\.\n+/, "")}`,
      "utf8",
    );
  } else {
    await writeFile(familiarsToml, buildFamiliarsToml(draft), "utf8");
  }

  // Re-creating a removed id must clear its tombstone: the roster GET hides
  // tombstoned ids, so a stale entry would make the new familiar invisible.
  await takeTombstone(draft.id).catch(() => {});

  // Scaffold the harness adapter manifest if it's missing (parity with
  // onboarding) so a familiar bound to a not-yet-configured harness still works.
  const adapterManifest = adapterManifestScaffoldForHarness(draft.harness);
  if (adapterManifest) {
    await mkdir(adaptersDir, { recursive: true });
    const manifestPath = path.join(adaptersDir, adapterManifest.filename);
    if (!(await pathExists(manifestPath))) {
      await writeFile(manifestPath, adapterManifest.contents, "utf8");
    }
  }

  // Upsert only this familiar's binding. No `defaults` key → global defaults
  // are preserved (see the doc comment above).
  await saveConfig({
    familiars: {
      [draft.id]: {
        harness: draft.harness,
        model: draft.model,
        ...(draft.runtime ? { runtime: draft.runtime } : {}),
      },
    },
  });

  // Scaffold the Familiar Contract (SOUL.md / IDENTITY.md / ward.toml /
  // MEMORY.md) so the new familiar is contract-compliant from birth instead of
  // showing up for "rehabilitation" in the Studio Contract tab. Best-effort and
  // additive: pre-existing files are left untouched, and a write failure must
  // not fail creation — the familiar is already registered above.
  let contractWrote: string[] = [];
  try {
    contractWrote = await scaffoldFamiliarContractFiles({
      id: draft.id,
      displayName: draft.displayName,
      role: draft.role,
      description: draft.description,
      glyph: draft.glyph,
    });
  } catch {
    /* non-fatal — identity files can be authored later via the Contract tab */
  }

  return NextResponse.json({ ok: true, id: draft.id, contractWrote });
}
