import { execFile } from "node:child_process";

/** Only the CLI's explicit signed-out response can trigger interactive recovery. */
export function codexNeedsLogin(
  launch: { command: string; fixedArgs: readonly string[] },
  env: NodeJS.ProcessEnv,
): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(launch.command, [...launch.fixedArgs, "login", "status"], {
      env, timeout: 3000, maxBuffer: 8192, windowsHide: true, encoding: "utf8",
    }, (error, stdout, stderr) => {
      resolve(error?.code === 1 && [stdout, stderr].some((output) => output.trim() === "Not logged in"));
    });
  });
}
