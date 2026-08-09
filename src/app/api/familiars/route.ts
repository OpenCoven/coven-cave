import { NextResponse } from "next/server";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { callDaemon } from "@/lib/coven-daemon";
import { saveConfig } from "@/lib/cave-config";
import { covenHome } from "@/lib/coven-paths";
import { enrichFamiliar } from "@/lib/server/familiar-enrichment";
import { loadVisibleFamiliarRoster } from "@/lib/server/familiar-roster";
import { filterFamiliarsForProject, loadProjectPermissions } from "@/lib/project-permissions";
import {
  buildFamiliarsToml,
  familiarsTomlContainsId,
  normalizeFamiliarDraft,
  type OnboardingFamiliarInput,
} from "@/lib/onboarding-familiars";
import { ensureAdapterManifestScaffold } from "@/lib/server/adapter-manifest-scaffold";
import { scaffoldFamiliarContractFiles } from "@/lib/server/familiar-contract-files";
import { removedFamiliarIds, takeTombstone } from "@/lib/server/familiar-tombstones";
import { loadPreferences } from "@/lib/server/preferences-store";
import { voiceBindingForNewFamiliar } from "@/lib/voice/new-familiar-defaults";

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

export async function GET(req: Request) {
  const rosterResult = await loadVisibleFamiliarRoster();
  if (!rosterResult.ok) {
    // Auth failures (401/403) mean the hub/daemon rejected our access token
    // — typically a stale or missing token after a hub reconnect. Surface
    // that distinctly and actionably instead of collapsing every daemon
    // failure into a bare 503/401 code in the notch ("Failed to load
    // familiars (401)"), which tells the user nothing about how to recover.
    if (rosterResult.status === 401 || rosterResult.status === 403) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Not authorized to load familiars — the Coven hub rejected this Cave's access token. Reconnect to the hub (or re-run setup) to refresh it.",
          reason: "unauthorized",
          familiars: [],
        },
        { status: rosterResult.status },
      );
    }
    return NextResponse.json(
      { ok: false, error: rosterResult.error, familiars: [] },
      { status: 503 },
    );
  }
  const { config } = rosterResult;
  const projectIds = [...new Set(
    new URL(req.url).searchParams
      .getAll("projectId")
      .map((projectId) => projectId.trim())
      .filter(Boolean),
  )];
  // Board task creation selects the project first. Restrict its familiar
  // picker using the same read-level session-launch rule enforced by
  // /api/board/:id/chat; the route's final assertProjectAccess remains the
  // authority for a launch request.
  const permissions = projectIds.length > 0 ? await loadProjectPermissions() : null;
  const rostersByProject = new Map(
    projectIds.map((projectId) => [
      projectId,
      filterFamiliarsForProject(permissions!, rosterResult.roster, projectId, "session-launch"),
    ]),
  );
  const roster = projectIds.length === 0
    ? rosterResult.roster
    : projectIds.length === 1
      ? rostersByProject.get(projectIds[0]) ?? []
      : [...new Map(
          [...rostersByProject.values()].flat().map((familiar) => [familiar.id, familiar]),
        ).values()];
  const familiars = await Promise.all(
    roster.map((familiar) => enrichFamiliar(familiar, config)),
  );

  // The table can show cards from many projects at once. Fetching the daemon
  // roster once per project is especially expensive for hub and remote-host
  // installs, so repeated projectId parameters return each filtered roster
  // from one config/permissions/daemon snapshot.
  if (projectIds.length > 1) {
    const familiarById = new Map(familiars.map((familiar) => [familiar.id, familiar]));
    return NextResponse.json({
      ok: true,
      familiarsByProject: Object.fromEntries(
        projectIds.map((projectId) => [
          projectId,
          (rostersByProject.get(projectId) ?? []).flatMap((familiar) => {
            const enriched = familiarById.get(familiar.id);
            return enriched ? [enriched] : [];
          }),
        ]),
      ),
    });
  }
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

  const covenDir = covenHome();
  const familiarsToml = path.join(covenDir, "familiars.toml");

  await mkdir(covenDir, { recursive: true });

  // The local familiars.toml is only half the truth: in hub mode (or before
  // the local daemon re-reads the file) the roster can hold ids this file has
  // never seen — e.g. a familiar summoned from another machine on the same
  // hub. Check the live roster best-effort so we don't shadow an existing
  // familiar with a second declaration; a daemon failure must not block
  // creation. Tombstoned ids are exempt — a lingering roster entry for a
  // removed familiar must not veto re-creating it.
  const [liveRoster, removed] = await Promise.all([
    callDaemon<DaemonFamiliar[]>({ path: "/api/v1/familiars" }),
    removedFamiliarIds().catch(() => new Set<string>()),
  ]);
  if (
    liveRoster.ok &&
    !removed.has(draft.id) &&
    (liveRoster.data ?? []).some((f) => f.id.toLowerCase() === draft.id.toLowerCase())
  ) {
    return NextResponse.json(
      { ok: false, error: `A familiar with id "${draft.id}" already exists in this coven.` },
      { status: 409 },
    );
  }

  // Check for a local duplicate before making any config change. Keep the
  // verified contents for the later registration write, after the binding has
  // been persisted.
  const existingToml = await pathExists(familiarsToml)
    ? await readFile(familiarsToml, "utf8")
    : null;
  if (existingToml && familiarsTomlContainsId(existingToml, draft.id)) {
    return NextResponse.json(
      { ok: false, error: `A familiar with id "${draft.id}" already exists.` },
      { status: 409 },
    );
  }

  // Scaffold the harness adapter manifest if it is missing, or repair the
  // known Windows Hermes shim before the new familiar can launch it. Persist
  // the binding before registering the familiar below: a profile-selected
  // familiar must never become visible without its explicit profile binding.
  await ensureAdapterManifestScaffold(draft.harness);

  // Upsert only this familiar's binding. No `defaults` key → global defaults
  // are preserved (see the doc comment above).
  const preferences = await loadPreferences();
  const voiceBinding = voiceBindingForNewFamiliar(preferences.voice);
  await saveConfig({
    familiars: {
      [draft.id]: {
        harness: draft.harness,
        model: draft.model,
        ...(draft.hermesProfile ? { hermesProfile: draft.hermesProfile } : {}),
        ...(draft.runtime ? { runtime: draft.runtime } : {}),
        voiceProvider: null,
        voiceModel: null,
        voiceName: null,
        ...voiceBinding,
      },
    },
  });

  // The duplicate was checked above before any mutation. Register only after
  // saveConfig succeeds: if binding persistence fails, no unbound familiar is
  // registered for chat to launch through a Hermes default profile.
  if (existingToml !== null) {
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
