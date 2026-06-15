import { isMemoryFilePathAllowed, resolveAllowedMemoryFileReadPath } from "./memory-file-sources.ts";

export function isAllowedMemoryFilePath(fullPath: string): boolean {
  return isMemoryFilePathAllowed(fullPath);
}

export async function resolveAllowedMemoryFilePath(fullPath: string): Promise<string | null> {
  return resolveAllowedMemoryFileReadPath(fullPath);
}
