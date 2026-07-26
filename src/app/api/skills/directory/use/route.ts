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
const USE_TIMEOUT_MS = 60_000;
const MAX_USE_BUFFER = 1024 * 1024;
const SAFE_USE_TARGET_RE = /^[A-Za-z0-9._@:/+-]+$/;
const SAFE_SKILL_NAME_RE = /^[A-Za-z0-9._@:/+ -]+$/;

type UseBody = {
  id?: unknown;
  source?: unknown;
};

function skillTarget(entry: SkillDirectoryEntry): string | null {
  if (entry.owner && entry.repo) return `${entry.owner}/${entry.repo}`;
  return entry.packageName ?? null;
}

function buildUseArgs(target: string, skill: string): string[] {
  return ["--yes", "skills", "use", target, "--skill", skill];
}

function localSkillDirective(entry: SkillDirectoryEntry): string {
  return `Use the "${entry.name}" skill.`;
}

export async function POST(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;

  const parsed = await readJsonBody<UseBody>(req, MAX_BODY_BYTES);
  if (!parsed.ok) return parsed.response;

  const id = typeof parsed.body.id === "string" ? parsed.body.id.trim() : "";
  const source = typeof parsed.body.source === "string" ? parsed.body.source.trim() : "";
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });

  const directory = await listSkillDirectoryEntriesWithLocal();
  const entry = matchDirectoryEntry(id, directory.entries, source);
  if (!entry) {
    return NextResponse.json({ ok: false, error: `skill "${id}" not found` }, { status: 404 });
  }

  const target = skillTarget(entry);
  const skill = entry.id;
  if (!target) {
    return NextResponse.json({
      ok: true,
      prompt: localSkillDirective(entry),
      source: "local-directive",
      entry,
    });
  }
  if (!SAFE_USE_TARGET_RE.test(target) || !SAFE_SKILL_NAME_RE.test(skill)) {
    return NextResponse.json({ ok: false, error: "skill source not usable" }, { status: 400 });
  }

  const args = buildUseArgs(target, skill);
  try {
    const { stdout, stderr } = await execFileAsync("npx", args, {
      cwd: process.cwd(),
      timeout: USE_TIMEOUT_MS,
      maxBuffer: MAX_USE_BUFFER,
      env: scrubSidecarInternalEnv({ ...process.env, npm_config_yes: "true" }),
    });
    const prompt = stdout.trim();
    if (!prompt) {
      return NextResponse.json({ ok: false, error: "skills use returned no prompt", stderr }, { status: 502 });
    }
    return NextResponse.json({
      ok: true,
      prompt,
      source: "skills-cli",
      entry,
      command: ["npx", ...args],
      stderr,
    });
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    return NextResponse.json(
      {
        ok: false,
        error: err.code === "ENOENT" ? "npx unavailable" : err.message || "skill use failed",
        stdout: err.stdout ?? "",
        stderr: err.stderr ?? "",
      },
      { status: err.code === "ENOENT" ? 500 : 502 },
    );
  }
}
