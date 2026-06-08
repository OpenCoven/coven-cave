import { isMemoryFilePathAllowed } from "./memory-file-sources.ts";

export function isAllowedMemoryFilePath(fullPath: string): boolean {
  return isMemoryFilePathAllowed(fullPath);
}
