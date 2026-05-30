import { NextResponse } from "next/server";
import { spawn } from "node:child_process";

export const dynamic = "force-dynamic";

export async function POST() {
  return new Promise<Response>((resolve) => {
    const child = spawn("coven", ["daemon", "start"], {
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve(
        NextResponse.json(
          { ok: false, error: "timeout", stdout, stderr },
          { status: 504 },
        ),
      );
    }, 8000);

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve(
        NextResponse.json({ ok: false, error: err.message }, { status: 500 }),
      );
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(
        NextResponse.json({ ok: code === 0, exitCode: code, stdout, stderr }),
      );
    });
  });
}
