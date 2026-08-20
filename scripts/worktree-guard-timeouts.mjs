export const STRICT_GIT_LOCAL_TIMEOUT_MS = 10_000;
export const STRICT_GIT_NETWORK_TIMEOUT_MS = 60_000;

export function strictGitTimeoutMs(args) {
  if (!Array.isArray(args) || args.length === 0) {
    throw new TypeError("strict Git arguments are required");
  }

  let commandIndex = 0;
  while (args[commandIndex] === "-C") {
    if (typeof args[commandIndex + 1] !== "string" || !args[commandIndex + 1]) {
      throw new TypeError("strict Git -C requires a directory");
    }
    commandIndex += 2;
  }

  const command = args[commandIndex];
  if (typeof command !== "string" || !command) {
    throw new TypeError("strict Git command is required");
  }
  return command === "fetch" || command === "ls-remote"
    ? STRICT_GIT_NETWORK_TIMEOUT_MS
    : STRICT_GIT_LOCAL_TIMEOUT_MS;
}
