import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { stripAnsi } from "@/lib/ansi";
import { covenBin, covenSpawnEnv } from "@/lib/coven-bin";

export const dynamic = "force-dynamic";

/** Allowlist of coven sub-commands callable from chat slash commands. */
const ALLOWED = new Set(["doctor", "daemon"]);

const SUBCOMMAND_ARGS: Record<string, string[]> = {
  doctor: [],
  daemon: ["status"],
};

export async function POST(req: Request) {
  let body: { command?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }
  if (!body.command || !ALLOWED.has(body.command)) {
    return NextResponse.json(
      { ok: false, error: "command not allowed" },
      { status: 400 },
    );
  }

  const args = [body.command, ...(SUBCOMMAND_ARGS[body.command] ?? [])];

  return new Promise<Response>((resolve) => {
    const child = spawn(covenBin(), args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: covenSpawnEnv(),
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    const t = setTimeout(() => {
      child.kill("SIGTERM");
      resolve(
        NextResponse.json(
          { ok: false, error: "timeout", stdout: stripAnsi(out), stderr: stripAnsi(err) },
          { status: 504 },
        ),
      );
    }, 6000);
    child.on("error", (e) => {
      clearTimeout(t);
      resolve(NextResponse.json({ ok: false, error: e.message }, { status: 500 }));
    });
    child.on("close", (code) => {
      clearTimeout(t);
      resolve(
        NextResponse.json({
          ok: code === 0,
          exitCode: code,
          stdout: stripAnsi(out),
          stderr: stripAnsi(err),
        }),
      );
    });
  });
}
