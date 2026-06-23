import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { covenHome } from "@/lib/coven-paths";
import type { CodexAutomation } from "@/lib/codex-automations-types";
import {
  recordRun,
  updateRun,
  hasRunningRun,
  type AutomationRunRecord,
} from "@/lib/automation-runs.ts";

export type CodexExecInvocation = {
  command: string;
  args: string[];
  cwd: string;
  stdinPrompt: string;
};

/** Pure: how to invoke `codex exec` for an automation. Unit-tested. */
export function buildCodexExecInvocation(auto: CodexAutomation): CodexExecInvocation {
  const command = process.env.COVEN_CODEX_BIN?.trim() || "codex";
  const args = ["exec", ...(auto.model ? ["--model", auto.model] : []), "-"];
  const cwd = auto.cwds[0] || process.cwd();
  return { command, args, cwd, stdinPrompt: auto.prompt };
}

function logDir(): string {
  return path.join(covenHome(), "automation-run-logs");
}

/**
 * Fire-and-forget: record a `running` run, spawn `codex exec` (prompt → stdin,
 * output → log file), and resolve immediately with the running record. The
 * child's close handler flips the record to succeeded/failed. Throws if a run
 * is already in flight for this automation. The spawn is verified manually
 * (CI has no codex binary); only `buildCodexExecInvocation` is unit-tested.
 */
export async function startAutomationRun(auto: CodexAutomation): Promise<AutomationRunRecord> {
  if (await hasRunningRun(auto.id)) {
    throw new Error("a run is already in progress for this automation");
  }
  await mkdir(logDir(), { recursive: true });
  const startedAt = new Date().toISOString();
  const inv = buildCodexExecInvocation(auto);
  const run = await recordRun({
    automationId: auto.id,
    automationName: auto.name,
    startedAt,
    status: "running",
  });
  const logPath = path.join(logDir(), `${run.id}.log`);
  await updateRun(run.id, { logPath });

  try {
    const out = createWriteStream(logPath, { flags: "a" });
    const child = spawn(inv.command, inv.args, { cwd: inv.cwd, stdio: ["pipe", "pipe", "pipe"] });
    child.stdout.pipe(out);
    child.stderr.pipe(out);
    child.stdin.write(inv.stdinPrompt);
    child.stdin.end();
    child.on("error", (err) => {
      void updateRun(run.id, {
        status: "failed",
        finishedAt: new Date().toISOString(),
        summary: err instanceof Error ? err.message : "spawn error",
      });
    });
    child.on("close", (code) => {
      void updateRun(run.id, {
        status: code === 0 ? "succeeded" : "failed",
        finishedAt: new Date().toISOString(),
        exitCode: code ?? undefined,
        summary: code === 0 ? "Run completed" : `Exited with code ${code}`,
      });
    });
  } catch (err) {
    await updateRun(run.id, {
      status: "failed",
      finishedAt: new Date().toISOString(),
      summary: err instanceof Error ? err.message : "could not start run",
    });
  }
  return run;
}
