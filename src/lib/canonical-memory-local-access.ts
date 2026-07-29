import type { TauriPlatform } from "./tauri-platform.ts";

export function canonicalMemoryLocalAccessEligible(input: {
  platform: TauriPlatform;
  hostname: string | null | undefined;
}): boolean {
  if (input.platform !== "browser" && input.platform !== "desktop") {
    return false;
  }
  if (typeof input.hostname !== "string") return false;

  const hostname = input.hostname;
  return hostname === "127.0.0.1" ||
    hostname === "localhost" ||
    hostname === "::1" ||
    hostname === "[::1]";
}
