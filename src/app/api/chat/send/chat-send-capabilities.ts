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
let hermesModelFlagProbe: Promise<boolean> | null = null;

function probeHelp(
  command: string,
  args: string[],
  matches: (help: string) => boolean,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let output = "";
    let settled = false;
    const done = (value: boolean) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    try {
      const child = spawn(command, args, {
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
  const { command, fixedArgs } = covenLaunchCommand();
  return (modelFlagProbe ??= probeHelp(
    command,
    [...fixedArgs, "run", "--help"],
    covenRunSupportsModelFlag,
  ));
}

export function covenRunSupportsPermission(): Promise<boolean> {
  const { command, fixedArgs } = covenLaunchCommand();
  return (permissionFlagProbe ??= probeHelp(
    command,
    [...fixedArgs, "run", "--help"],
    covenRunSupportsPermissionFlag,
  ));
}

export function covenRunSupportsAddDir(): Promise<boolean> {
  const { command, fixedArgs } = covenLaunchCommand();
  return (addDirFlagProbe ??= probeHelp(
    command,
    [...fixedArgs, "run", "--help"],
    covenRunSupportsAddDirFlag,
  ));
}

/** Hermes runs directly, so probe its own CLI rather than coven run. */
export function hermesChatSupportsModel(): Promise<boolean> {
  const command = process.platform === "win32" ? "hermes.exe" : "hermes";
  return (hermesModelFlagProbe ??= probeHelp(
    command,
    ["chat", "--help"],
    (help) => /(^|\s)--model(?![\w-])/m.test(help),
  ));
}
