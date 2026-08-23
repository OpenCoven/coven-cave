export const STRICT_GIT_LOCAL_TIMEOUT_MS = 10_000;
export const STRICT_GIT_NETWORK_TIMEOUT_MS = 60_000;

export function strictGitTimeoutMs(args) {
  if (!Array.isArray(args) || args.length === 0) {
    throw new TypeError("strict Git arguments are required");
  }

  let commandIndex = 0;
  while (args[commandIndex] === "-C" || args[commandIndex] === "-c") {
    const option = args[commandIndex];
    const value = args[commandIndex + 1];
    if (option === "-C" && (typeof value !== "string" || !value)) {
      throw new TypeError("strict Git -C requires a directory");
    }
    if (option === "-c" && (typeof value !== "string" || !/^[^=]+=.*/.test(value))) {
      throw new TypeError("strict Git -c requires key=value");
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
