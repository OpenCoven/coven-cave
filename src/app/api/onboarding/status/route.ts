import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { callDaemon } from "@/lib/coven-daemon";
import { loadConfig } from "@/lib/cave-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const execFileAsync = promisify(execFile);

type Step = { ok: boolean; detail?: string; hint?: string };

async function checkCovenCli(): Promise<Step> {
  const command = process.platform === "win32" ? "where" : "command";
  const args = process.platform === "win32" ? ["coven"] : ["-v", "coven"];
  try {
    const { stdout } = await execFileAsync(command, args, { timeout: 1500 });
    const found = stdout.trim();
    if (found) return { ok: true, detail: found };
  } catch {
    /* not found */
  }
  return {
    ok: false,
    hint: "Install the coven CLI from OpenCoven/coven, make sure it is on PATH, then re-check.",
  };
}

async function checkCovenHome(): Promise<Step> {
  const p = path.join(homedir(), ".coven");
  try {
    const s = await stat(p);
    if (s.isDirectory()) return { ok: true, detail: p };
  } catch {
    /* missing */
  }
  return { ok: false, hint: "Cave can create ~/.coven for you." };
}

async function checkDaemon(): Promise<Step> {
  const res = await callDaemon<{ ok?: boolean }>({ path: "/api/v1/health", timeoutMs: 800 });
  if (res.ok) return { ok: true, detail: "daemon socket reachable" };
  return { ok: false, hint: res.error ?? `daemon http ${res.status}` };
}

async function checkFamiliars(): Promise<{ step: Step; count: number }> {
  const res = await callDaemon<unknown[]>({ path: "/api/v1/familiars", timeoutMs: 800 });
  const count = Array.isArray(res.data) ? res.data.length : 0;
  if (res.ok && count > 0) {
    return { step: { ok: true, detail: `${count} familiar${count === 1 ? "" : "s"} loaded` }, count };
  }
  return {
    step: {
      ok: false,
      hint: res.ok ? "Create your first familiar in Cave, or add one to ~/.coven/familiars.toml." : "daemon offline",
    },
    count,
  };
}

async function checkBinding(familiarsAvailable: boolean): Promise<Step> {
  const config = await loadConfig();
  const hasDefaults = !!config.defaults.harness && !!config.defaults.model;
  if (!hasDefaults) {
    return { ok: false, hint: "Pick a default harness + model for your familiars." };
  }
  if (!familiarsAvailable) {
    return { ok: false, hint: "Bindings set but no familiars to bind." };
  }
  return { ok: true, detail: `${config.defaults.harness} · ${config.defaults.model}` };
}

export async function GET() {
  const [covenCli, covenHome, daemon, familiarsRes] = await Promise.all([
    checkCovenCli(),
    checkCovenHome(),
    checkDaemon(),
    checkFamiliars(),
  ]);
  const binding = await checkBinding(familiarsRes.count > 0);

  const steps = {
    covenCli,
    covenHome,
    daemon,
    familiars: familiarsRes.step,
    binding,
  };
  const complete = Object.values(steps).every((s) => s.ok);

  return NextResponse.json({ ok: true, complete, steps });
}
