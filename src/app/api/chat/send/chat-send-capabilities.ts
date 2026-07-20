import { spawn } from "node:child_process";
import { covenLaunchCommand } from "@/lib/coven-bin";
import {
  covenRunSupportsAddDirFlag,
  covenRunSupportsModelFlag,
  covenRunSupportsPermissionFlag,
} from "@/lib/harness-adapters";
import { harnessSpawnEnv } from "@/lib/harness-spawn-env";

let modelFlagProbe: Promise<boolean> | null = null;
let permissionFlagProbe: Promise<boolean> | null = null;
let addDirFlagProbe: Promise<boolean> | null = null;

function probeRunHelp(matches: (help: string) => boolean): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let output = "";
    let settled = false;
    const done = (value: boolean) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    try {
      const { command, fixedArgs } = covenLaunchCommand();
      const child = spawn(command, [...fixedArgs, "run", "--help"], {
        env: harnessSpawnEnv(),
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stdout.on("data", (chunk) => (output += chunk.toString()));
      child.stderr.on("data", (chunk) => (output += chunk.toString()));
      const timeout = setTimeout(() => {
        try {
          child.kill("SIGTERM");
        } catch {
          // The capability is unsupported when the probe cannot complete.
        }
        done(false);
      }, 2500);
      child.on("close", () => {
        clearTimeout(timeout);
        done(matches(output));
      });
      child.on("error", () => {
        clearTimeout(timeout);
        done(false);
      });
    } catch {
      done(false);
    }
  });
}

/** Capability probes are cached because old Coven CLIs reject unknown flags. */
export function covenRunSupportsModel(): Promise<boolean> {
  return (modelFlagProbe ??= probeRunHelp(covenRunSupportsModelFlag));
}

export function covenRunSupportsPermission(): Promise<boolean> {
  return (permissionFlagProbe ??= probeRunHelp(covenRunSupportsPermissionFlag));
}

export function covenRunSupportsAddDir(): Promise<boolean> {
  return (addDirFlagProbe ??= probeRunHelp(covenRunSupportsAddDirFlag));
}
