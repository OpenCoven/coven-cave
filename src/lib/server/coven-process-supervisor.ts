import { execFile, type ExecFileException } from "node:child_process";
import {
  accessSync,
  constants as fsConstants,
  openSync,
  readSync,
  closeSync,
  statSync,
} from "node:fs";
import path from "node:path";
import {
  covenLaunchCommand,
  type CovenLaunchCommand,
} from "../coven-bin.ts";
import { canonicalProbeSpawnEnv } from "../harness-spawn-env.ts";

export const COVEN_PROCESS_SUPERVISOR_PROTOCOL = "coven.process-supervisor.v1";
export const COVEN_PROCESS_SUPERVISOR_CONTROL_PREFIX = "COVEN_PROCESS_SUPERVISOR_V1 ";
export const COVEN_PROCESS_SUPERVISOR_MAX_REQUEST_BYTES = 262_144;
export const COVEN_NATIVE_PATH_PROBE_TIMEOUT_MS = 2_500;
const PRINT_NATIVE_BINARY_PATH_ARG = "--print-native-binary-path";
const NATIVE_PATH_STDOUT_MAX_BYTES = 4_096;

export type CovenProcessSupervisorCommand = {
  command: string;
  fixedArgs: ["process-supervisor", "--protocol", typeof COVEN_PROCESS_SUPERVISOR_PROTOCOL];
};

export class CovenProcessSupervisorUnavailableError extends Error {
  readonly status = 409;

  constructor() {
    super(
      "Coven's native process supervisor is unavailable. Update or repair the Coven CLI, then retry Research; no Copilot process was started.",
    );
    this.name = "CovenProcessSupervisorUnavailableError";
  }
}

type ResolveDependencies = {
  platform?: NodeJS.Platform;
  launchCommand?: () => CovenLaunchCommand;
  execFileImpl?: typeof execFile;
  env?: NodeJS.ProcessEnv;
};

function absoluteForPlatform(value: string, platform: NodeJS.Platform): boolean {
  return platform === "win32" ? path.win32.isAbsolute(value) : path.posix.isAbsolute(value);
}

function hasNativeExecutableMagic(file: string, platform: NodeJS.Platform): boolean {
  let descriptor: number | null = null;
  try {
    const stats = statSync(file);
    if (!stats.isFile()) return false;
    accessSync(file, platform === "win32" ? fsConstants.F_OK : fsConstants.X_OK);
    descriptor = openSync(file, "r");
    const magic = Buffer.alloc(4);
    if (readSync(descriptor, magic, 0, magic.length, 0) < magic.length) return false;
    if (platform === "win32") return magic[0] === 0x4d && magic[1] === 0x5a;
    if (platform === "linux") {
      return magic[0] === 0x7f && magic[1] === 0x45 && magic[2] === 0x4c && magic[3] === 0x46;
    }
    if (platform === "darwin") {
      const signature = magic.readUInt32BE(0);
      return new Set([
        0xfeedface,
        0xcefaedfe,
        0xfeedfacf,
        0xcffaedfe,
        0xcafebabe,
        0xbebafeca,
        0xcafebabf,
        0xbfbafeca,
      ])
        .has(signature);
    }
    return false;
  } catch {
    return false;
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
}

/** Validate the machine-readable wrapper result before it becomes argv[0]. */
export function validatedNativeCovenPath(
  stdout: string,
  platform: NodeJS.Platform = process.platform,
): string | null {
  if (!stdout.endsWith("\n") || stdout.slice(0, -1).includes("\n") || stdout.includes("\r")) {
    return null;
  }
  const candidate = stdout.slice(0, -1);
  if (!candidate || candidate.includes("\0") || !absoluteForPlatform(candidate, platform)) {
    return null;
  }
  const expectedName = platform === "win32" ? "coven.exe" : "coven";
  const basename = platform === "win32" ? path.win32.basename(candidate) : path.posix.basename(candidate);
  if (platform === "win32" ? basename.toLowerCase() !== expectedName : basename !== expectedName) {
    return null;
  }
  return hasNativeExecutableMagic(candidate, platform) ? candidate : null;
}

function wrapperNativePath(
  launch: CovenLaunchCommand,
  dependencies: ResolveDependencies,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = (dependencies.execFileImpl ?? execFile)(
      launch.command,
      [...launch.fixedArgs, PRINT_NATIVE_BINARY_PATH_ARG],
      {
        encoding: "utf8",
        // Machine-path discovery must never materialize familiar-scoped Vault
        // values. The wrapper only reports its native executable; it has no
        // reason to inherit credentials or sidecar-internal control variables.
        env: dependencies.env ?? canonicalProbeSpawnEnv(),
        maxBuffer: NATIVE_PATH_STDOUT_MAX_BYTES,
        shell: false,
        timeout: COVEN_NATIVE_PATH_PROBE_TIMEOUT_MS,
        windowsHide: true,
      },
      (error: ExecFileException | null, stdout: string, stderr: string) => {
        if (error || stderr !== "") {
          reject(new CovenProcessSupervisorUnavailableError());
          return;
        }
        const nativePath = validatedNativeCovenPath(
          stdout,
          dependencies.platform ?? process.platform,
        );
        if (!nativePath) {
          reject(new CovenProcessSupervisorUnavailableError());
          return;
        }
        resolve(nativePath);
      },
    );
    // A late ENOENT can arrive asynchronously even when a custom callback
    // implementation never reports it. Keep the discovery promise settled and
    // prevent an unhandled ChildProcess error from crashing the sidecar.
    child.once("error", () => reject(new CovenProcessSupervisorUnavailableError()));
  });
}

/**
 * Resolve the exact native Coven executable. The npm wrapper is used only as
 * its documented machine-path oracle; it is never retained as the supervised
 * child because killing Node would not own the native process handle.
 */
export async function resolveCovenProcessSupervisorCommand(
  dependencies: ResolveDependencies = {},
): Promise<CovenProcessSupervisorCommand> {
  const platform = dependencies.platform ?? process.platform;
  const launch = (dependencies.launchCommand ?? covenLaunchCommand)();
  if (launch.resolutionTimedOut || launch.unresolvedWindowsShim) {
    throw new CovenProcessSupervisorUnavailableError();
  }

  let nativePath: string | null = null;
  if (launch.fixedArgs.length === 0 && absoluteForPlatform(launch.command, platform)) {
    nativePath = validatedNativeCovenPath(`${launch.command}\n`, platform);
  }
  nativePath ??= await wrapperNativePath(launch, dependencies);

  return {
    command: nativePath,
    fixedArgs: ["process-supervisor", "--protocol", COVEN_PROCESS_SUPERVISOR_PROTOCOL],
  };
}
