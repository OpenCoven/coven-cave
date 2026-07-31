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

/** Discovery deliberately uses the native CLI's read-only profile commands.
 * It never calls `profile use`, so inspecting the list cannot change a user's
 * active Hermes profile. */
export async function listHermesProfiles(options: {
  command?: string;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  run?: (command: string, args: string[], env: NodeJS.ProcessEnv) => Promise<string | null>;
  readSoul?: (homePath: string) => Promise<string | null>;
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
  const profiles = (await Promise.all(parseHermesProfileList(listed).map(async (id) => {
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
  }))).filter((profile): profile is HermesProfileSummary => profile !== null);
  return { profiles: profiles.sort((a, b) => a.displayName.localeCompare(b.displayName)) };
}

export async function GET() {
  const result = await listHermesProfiles();
  return NextResponse.json({ ok: true, ...result });
}
