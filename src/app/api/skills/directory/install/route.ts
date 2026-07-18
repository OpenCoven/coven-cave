import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import { scrubSidecarInternalEnv } from "@/lib/coven-bin";
import { readJsonBody, rejectNonLocalRequest } from "@/lib/server/api-security";
import {
  listSkillDirectoryEntriesWithLocal,
  matchDirectoryEntry,
  type SkillDirectoryEntry,
} from "@/lib/server/skills-directory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const execFileAsync = promisify(execFile);
const MAX_BODY_BYTES = 16 * 1024;
const INSTALL_TIMEOUT_MS = 120_000;
const MAX_INSTALL_BUFFER = 1024 * 1024;
const DEFAULT_INSTALL_AGENTS = ["claude-code", "codex"] as const;
const SAFE_INSTALL_TARGET_RE = /^[A-Za-z0-9._@:/+-]+$/;
const SAFE_SKILL_NAME_RE = /^[A-Za-z0-9._@:/+ -]+$/;
const SAFE_AGENT_RE = /^[a-z0-9-]+$/;

type InstallBody = {
  id?: unknown;
  source?: unknown;
  agents?: unknown;
};

function installTarget(entry: SkillDirectoryEntry): string | null {
  if (entry.owner && entry.repo) return `${entry.owner}/${entry.repo}`;
  return entry.packageName ?? null;
}

function normalizedAgents(value: unknown): string[] {
  if (!Array.isArray(value)) return [...DEFAULT_INSTALL_AGENTS];
  const agents = value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => SAFE_AGENT_RE.test(entry));
  return agents.length > 0 ? [...new Set(agents)] : [...DEFAULT_INSTALL_AGENTS];
}

function buildInstallArgs(target: string, skill: string, agents: string[]): string[] {
  const args = ["--yes", "skills", "add", target, "--skill", skill, "-g", "-y"];
  for (const agent of agents) args.push("-a", agent);
  return args;
}

export async function POST(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;

  const parsed = await readJsonBody<InstallBody>(req, MAX_BODY_BYTES);
  if (!parsed.ok) return parsed.response;

  const id = typeof parsed.body.id === "string" ? parsed.body.id.trim() : "";
  const source = typeof parsed.body.source === "string" ? parsed.body.source.trim() : "";
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });

  const directory = await listSkillDirectoryEntriesWithLocal();
  const entry = matchDirectoryEntry(id, directory.entries, source);
  if (!entry) {
    return NextResponse.json({ ok: false, error: `skill "${id}" not found` }, { status: 404 });
  }
  if (entry.installed || entry.local?.installed) {
    return NextResponse.json({ ok: true, installed: true, alreadyInstalled: true, entry });
  }

  const target = installTarget(entry);
  const skill = entry.id;
  if (!target || !SAFE_INSTALL_TARGET_RE.test(target) || !SAFE_SKILL_NAME_RE.test(skill)) {
    return NextResponse.json({ ok: false, error: "skill source not installable" }, { status: 400 });
  }

  const agents = normalizedAgents(parsed.body.agents);
  const args = buildInstallArgs(target, skill, agents);

  try {
    const { stdout, stderr } = await execFileAsync("npx", args, {
      cwd: process.cwd(),
      timeout: INSTALL_TIMEOUT_MS,
      maxBuffer: MAX_INSTALL_BUFFER,
      env: scrubSidecarInternalEnv({ ...process.env, npm_config_yes: "true" }),
    });
    return NextResponse.json({
      ok: true,
      installed: true,
      alreadyInstalled: false,
      entry,
      agents,
      command: ["npx", ...args],
      stdout,
      stderr,
    });
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    return NextResponse.json(
      {
        ok: false,
        error: err.code === "ENOENT" ? "npx unavailable" : err.message || "install failed",
        stdout: err.stdout ?? "",
        stderr: err.stderr ?? "",
      },
      { status: err.code === "ENOENT" ? 500 : 502 },
    );
  }
}
