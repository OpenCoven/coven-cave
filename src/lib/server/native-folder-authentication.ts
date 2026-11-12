import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import path from "node:path";

/** OS authentication only: no caller-supplied approval or test environment switch. */
export function authenticateProjectFolder(reason: string): Promise<boolean> {
  if (process.platform !== "darwin") return Promise.resolve(false);
  const helper = path.join(process.cwd(), "native", "confirm-project-folder");
  if (!existsSync(helper)) return Promise.resolve(false);
  return new Promise((resolve) => {
    execFile(helper, [reason], {
      windowsHide: true,
      timeout: 90_000,
      maxBuffer: 1024,
      env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", NODE_ENV: process.env.NODE_ENV ?? "production" },
    }, (error) => resolve(error === null));
  });
}
