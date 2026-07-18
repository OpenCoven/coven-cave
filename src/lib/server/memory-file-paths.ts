import {
  isMemoryFilePathAllowed,
  resolveAllowedFileReadPath,
  resolveAllowedMemoryFileReadPath,
} from "./memory-file-sources.ts";

export { resolveAllowedFileReadPath };

export function isAllowedMemoryFilePath(fullPath: string): boolean {
  return isMemoryFilePathAllowed(fullPath);
}

export async function resolveAllowedMemoryFilePath(fullPath: string): Promise<string | null> {
  return resolveAllowedMemoryFileReadPath(fullPath);
}
