// Spawn-safe launcher resolution for the Copilot CLI.
//
// A global npm installation on Windows exposes `copilot.cmd`. Node cannot
// execute that shim directly with spawn(), and `shell: true` would re-parse
// prompt text as command syntax. Reuse Cave's reviewed cmd-to-JavaScript
// conversion so both the version probe and direct JSONL launches execute the
// same launcher with argv kept as data.

import { execFileSync } from "node:child_process";
import { covenLaunchCommandForBinary, pickWindowsLauncher, type CovenLaunchCommand } from "./coven-bin.ts";

function windowsCopilotLauncher(binary: string, platform: NodeJS.Platform): string {
  if (platform !== "win32" || /\.(?:cmd|bat|exe|com)$/i.test(binary)) return binary;
  try {
    const output = execFileSync("where", [binary], {
      encoding: "utf8",
      timeout: 1_500,
      windowsHide: true,
    });
    return pickWindowsLauncher(output.split(/\r?\n/)) ?? binary;
  } catch {
    return binary;
  }
}

/** A direct spawn command for either a native binary or an npm cmd shim. */
export function copilotLaunchCommandForBinary(
  binary: string,
  platform: NodeJS.Platform = process.platform,
): CovenLaunchCommand {
  return covenLaunchCommandForBinary(windowsCopilotLauncher(binary, platform), platform);
}
