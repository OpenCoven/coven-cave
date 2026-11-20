import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import path from "node:path";

/**
 * `true` after a fresh Touch ID approval, `false` when the person declined or
 * let the prompt time out, and `"unavailable"` when no prompt can appear here:
 * not macOS, no bundled helper, or no usable Touch ID (the helper exits 2 when
 * `canEvaluatePolicy` fails). Callers must treat anything but `true` as refusal.
 */
export type ProjectFolderAuthentication = boolean | "unavailable";

/** OS authentication only: no caller-supplied approval or test environment switch. */
export function authenticateProjectFolder(reason: string): Promise<ProjectFolderAuthentication> {
  if (process.platform !== "darwin") return Promise.resolve("unavailable");
  const helper = path.join(process.cwd(), "native", "confirm-project-folder");
  if (!existsSync(helper)) return Promise.resolve("unavailable");
  return new Promise((resolve) => {
    execFile(helper, [reason], {
      windowsHide: true,
      timeout: 90_000,
      maxBuffer: 1024,
      env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", NODE_ENV: process.env.NODE_ENV ?? "production" },
    }, (error) => {
      if (error === null) return resolve(true);
      // Exit 2: the biometric policy cannot be evaluated on this Mac. A string
      // code means the helper could not be started at all.
      // execFile reports the exit status as a number on `code`, despite its type.
      const code: unknown = (error as { code?: unknown }).code;
      resolve(code === 2 || typeof code === "string" ? "unavailable" : false);
    });
  });
}
