import { spawn } from "node:child_process";
import { stripAnsi } from "@/lib/ansi";
import { covenSpawnEnv } from "@/lib/coven-bin";
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
  options: { shell: boolean; timeoutMs: number },
): Promise<InstallProcessResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: covenSpawnEnv(),
      shell: options.shell,
    });
    let output = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), options.timeoutMs);
    child.stdout.on("data", (data) => {
      output = redactSensitiveInstallOutput(output + stripAnsi(data.toString()));
    });
    child.stderr.on("data", (data) => {
      output = redactSensitiveInstallOutput(output + stripAnsi(data.toString()));
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: 1, signal: null, output: error.message });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, output });
    });
  });
}
