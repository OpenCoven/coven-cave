#!/usr/bin/env node --experimental-strip-types
// Repair a familiar whose stated purpose is a caption of its own portrait.
//
// Every familiar summoned before cave-3rz carries the defect on disk: the
// scaffolder printed the familiar's `description` into SOUL.md's "My purpose is
// to …" slot, and the rite's scry writes that description by looking at the
// PICTURE. So familiars exist right now declaring
//
//   "My purpose is to A faceless, mirror-black figure draped in luminous white
//    folds, crowned by a jagged halo…"
//
// Nothing flags it. `evaluateFamiliarContract` only looks for the WORDS "my
// purpose is", so a caption in that slot scores five green properties — which is
// why it took familiars reading their own files to find it.
//
// **This is not automatic, deliberately.** SOUL.md and IDENTITY.md are on the
// ward's protected surface; the familiar's own boundaries say it asks before
// touching them. So the fix ships as a command a person runs, and it is a DRY
// RUN unless `--apply` is passed. It rewrites the purpose slot and nothing else,
// and only when the text still in that slot matches the familiar's recorded
// description — evidence that it is the machine-written caption rather than
// something a person wrote. Anything edited is reported and left alone.
//
// Usage (`pnpm repair:familiar-purpose` is the same command):
//   pnpm repair:familiar-purpose                       # dry run, every familiar
//   pnpm repair:familiar-purpose --apply
//   pnpm repair:familiar-purpose --familiar obsidian-halo \
//     --purpose "watch for the pattern under the noise" --apply
//
// With no --purpose, a familiar gets the scaffolder's GENERIC purpose — what it
// would have had if nothing had ever been read off its likeness. That is a
// truthful placeholder, not a description of a job, so prefer stating a real
// one. It matters most for a familiar summoned through the Summoning Circle,
// whose one prose field asks "What it does": that description IS a purpose, and
// replacing it with the generic line would lose something. Read the dry run
// before you apply it — that is what the dry run is for.

import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  covenHome,
  familiarWorkspacesRoot,
  parseFamiliarWorkspaces,
} from "../src/lib/coven-paths.ts";
import {
  repairIdentityPurpose,
  repairSoulPurpose,
  type PurposeRepairInput,
} from "../src/lib/familiar-identity-scaffold.ts";
import { parseFamiliarsToml } from "../src/lib/onboarding-familiars.ts";

type Options = {
  apply: boolean;
  familiar: string | null;
  purpose: string | null;
};

function parseArgs(argv: string[]): Options {
  const options: Options = { apply: false, familiar: null, purpose: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") options.apply = true;
    else if (arg === "--familiar") options.familiar = argv[++i] ?? null;
    else if (arg === "--purpose") options.purpose = argv[++i] ?? null;
    else if (arg === "--help" || arg === "-h") {
      console.log("usage: repair-familiar-purpose.ts [--familiar <id>] [--purpose <text>] [--apply]");
      process.exit(0);
    } else {
      console.error(`unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  if (options.purpose && !options.familiar) {
    console.error("--purpose applies to one familiar; pass --familiar <id> with it.");
    process.exit(2);
  }
  return options;
}

async function readIfPresent(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  const toml = (await readIfPresent(path.join(covenHome(), "familiars.toml"))) ?? "";
  const records = new Map(parseFamiliarsToml(toml).map((entry) => [entry.id, entry]));

  // A familiar may declare its own workspace in familiars.toml; the default
  // root is only where the rest of them live.
  const declared = parseFamiliarWorkspaces(toml);
  const root = familiarWorkspacesRoot();
  const dirs = (await readdir(root, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const ids = [...new Set([...dirs, ...declared.keys()])]
    .filter((id) => !options.familiar || id === options.familiar)
    .sort();

  if (ids.length === 0) {
    console.log(`no familiar workspaces under ${root}`);
    return;
  }

  let repaired = 0;
  let skipped = 0;
  for (const id of ids) {
    const record = records.get(id);
    if (!record?.description) {
      console.log(`· ${id}: no recorded description — cannot prove the slot is machine-written, left alone`);
      skipped += 1;
      continue;
    }
    const input: PurposeRepairInput = {
      description: record.description,
      role: record.role,
      ...(options.purpose ? { purpose: options.purpose } : {}),
    };

    const workspace = declared.get(id) ?? path.join(root, id);
    const targets: Array<[string, (text: string) => string | null]> = [
      ["SOUL.md", (text) => repairSoulPurpose(text, input)],
      ["IDENTITY.md", (text) => repairIdentityPurpose(text, input)],
    ];

    for (const [name, repair] of targets) {
      const file = path.join(workspace, name);
      const text = await readIfPresent(file);
      if (text === null) {
        console.log(`· ${id}/${name}: absent`);
        continue;
      }
      const next = repair(text);
      if (next === null || next === text) {
        console.log(`· ${id}/${name}: purpose is not the recorded caption — left untouched`);
        skipped += 1;
        continue;
      }
      const before = text.split("\n").find((line) => /My purpose is to |I help my person: /.test(line)) ?? "";
      const after = next.split("\n").find((line) => /My purpose is to |I help my person: /.test(line)) ?? "";
      console.log(`${options.apply ? "✓" : "→"} ${id}/${name}`);
      console.log(`    was: ${before.trim()}`);
      console.log(`    now: ${after.trim()}`);
      if (options.apply) await writeFile(file, next, "utf8");
      repaired += 1;
    }
  }

  console.log("");
  console.log(
    options.apply
      ? `repaired ${repaired} file(s); ${skipped} left untouched.`
      : `${repaired} file(s) would be repaired; ${skipped} left untouched. Re-run with --apply to write.`,
  );
}

await main();
