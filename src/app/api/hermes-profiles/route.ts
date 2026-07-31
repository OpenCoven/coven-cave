import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { NextResponse } from "next/server.js";
import {
  parseHermesProfileHome,
  parseHermesProfileList,
  parseHermesProfileDescription,
  summarizeHermesProfile,
  type HermesProfileSummary,
} from "@/lib/hermes-profiles";
import { harnessSpawnEnv } from "@/lib/harness-spawn-env";
import { resolveHermesLaunch } from "@/lib/runtime-availability";

const execFileAsync = promisify(execFile);
const MAX_DISCOVERED_HERMES_PROFILES = 32;
const MAX_CONCURRENT_PROFILE_DISCOVERY = 2;
const PROFILE_DISCOVERY_DEADLINE_MS = 5_000;

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function runHermes(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(command, args, {
      env,
      timeout: 2_500,
      maxBuffer: 64 * 1024,
      windowsHide: true,
    });
    return stdout;
  } catch {
    return null;
  }
}

async function beforeDeadline<T>(operation: Promise<T>, remainingMs: number): Promise<T | null> {
  if (remainingMs <= 0) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), remainingMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Discovery deliberately uses the native CLI's read-only profile commands.
 * It never calls `profile use`, so inspecting the list cannot change a user's
 * active Hermes profile. A corrupt registry cannot turn this endpoint into an
 * unbounded local process fan-out: only a small, capped queue runs before the
 * request deadline. */
export async function listHermesProfiles(options: {
  command?: string;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  run?: (command: string, args: string[], env: NodeJS.ProcessEnv) => Promise<string | null>;
  readSoul?: (homePath: string) => Promise<string | null>;
  /** Test-only seams; production always uses the bounded defaults above. */
  maxProfiles?: number;
  concurrency?: number;
  deadlineMs?: number;
} = {}): Promise<{ profiles: HermesProfileSummary[]; hint?: string }> {
  const env = options.env ?? harnessSpawnEnv(null);
  const launch = options.command
    ? { state: "ready" as const, command: options.command }
    : resolveHermesLaunch({ env });
  if (launch.state !== "ready") {
    return {
      profiles: [],
      hint: "Install and complete setup for Hermes Agent, then return to choose a saved profile.",
    };
  }
  const run = options.run ?? runHermes;
  const listed = await run(launch.command, ["profile", "list"], env);
  if (listed === null) {
    return { profiles: [], hint: "Couldn't list Hermes profiles. Check Hermes setup, then try again." };
  }
  const readSoul = options.readSoul ?? (async (homePath: string) =>
    readFile(path.join(homePath, "SOUL.md"), "utf8").catch(() => null));
  const maxProfiles = Math.min(
    Math.max(1, options.maxProfiles ?? MAX_DISCOVERED_HERMES_PROFILES),
    MAX_DISCOVERED_HERMES_PROFILES,
  );
  const concurrency = Math.min(
    Math.max(1, options.concurrency ?? MAX_CONCURRENT_PROFILE_DISCOVERY),
    MAX_CONCURRENT_PROFILE_DISCOVERY,
  );
  const ids = parseHermesProfileList(listed).slice(0, maxProfiles);
  const deadline = Date.now() + Math.max(0, options.deadlineMs ?? PROFILE_DISCOVERY_DEADLINE_MS);
  let nextIndex = 0;
  const profiles: HermesProfileSummary[] = [];

  const discover = async (id: string): Promise<HermesProfileSummary | null> => {
    const [shown, described] = await Promise.all([
      run(launch.command, ["profile", "show", id], env),
      run(launch.command, ["profile", "describe", id], env),
    ]);
    if (shown === null) return null;
    const homePath = parseHermesProfileHome(shown, options.homeDir ?? homedir());
    if (!homePath) return null;
    return summarizeHermesProfile({
      id,
      homePath,
      soulMarkdown: await readSoul(homePath),
      description: parseHermesProfileDescription(described),
    });
  };
  const worker = async () => {
    while (Date.now() < deadline) {
      const id = ids[nextIndex++];
      if (!id) return;
      const profile = await beforeDeadline(discover(id), deadline - Date.now());
      if (profile) profiles.push(profile);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker));
  return { profiles: profiles.sort((a, b) => a.displayName.localeCompare(b.displayName)) };
}

export async function GET() {
  const result = await listHermesProfiles();
  return NextResponse.json({ ok: true, ...result });
}
