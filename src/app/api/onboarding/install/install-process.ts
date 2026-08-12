import { spawn } from "node:child_process";
import { covenSpawnEnv } from "@/lib/coven-bin";
import {
  BoundedProcessOutput,
  safeProcessErrorMessage,
  terminateProcessTree,
} from "@/lib/process-execution";
import { redactSensitiveInstallOutput } from "./install-job-output";

export type InstallProcessResult = {
  code: number | null;
  signal: NodeJS.Signals | null;
  output: string;
};

/** Run a fixed installer command with bounded lifetime and redacted output. */
export function runInstallProcess(
  command: string,
  args: string[],
  options: { timeoutMs: number; env?: NodeJS.ProcessEnv },
): Promise<InstallProcessResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: options.env ?? covenSpawnEnv(),
      shell: false,
      detached: process.platform !== "win32",
    });
    const output = new BoundedProcessOutput(8_192);
    let settled = false;
    let timedOut = false;
    const finish = (result: InstallProcessResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      void terminateProcessTree(child).then(() => finish({
        code: null,
        signal: "SIGTERM",
        output: redactSensitiveInstallOutput(output.text()),
      }));
    }, options.timeoutMs);
    child.stdout.on("data", (data) => {
      output.append(data);
    });
    child.stderr.on("data", (data) => {
      output.append(data);
    });
    child.on("error", (error) => {
      finish({
        code: 1,
        signal: null,
        output: safeProcessErrorMessage(error, "Coven CLI"),
      });
    });
    child.on("close", (code, signal) => {
      if (timedOut) {
        finish({
          code: null,
          signal: "SIGTERM",
          output: redactSensitiveInstallOutput(output.text()),
        });
        return;
      }
      finish({
        code,
        signal,
        output: redactSensitiveInstallOutput(output.text()),
      });
    });
  });
}
