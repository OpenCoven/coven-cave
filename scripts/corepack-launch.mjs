import { statSync } from "node:fs";
import path from "node:path";

function environmentValue(env, key, platform) {
  if (platform !== "win32") return env[key];
  const wanted = key.toUpperCase();
  return Object.entries(env).find(([name]) => name.toUpperCase() === wanted)?.[1];
}

function defaultIsFile(candidate) {
  try {
    const metadata = statSync(candidate);
    return metadata.isFile() || metadata.isSymbolicLink();
  } catch {
    return false;
  }
}

export function resolveCorepackLaunch(
  args,
  {
    platform = process.platform,
    env = process.env,
    nodePath = process.execPath,
    isFile = defaultIsFile,
  } = {},
) {
  if (platform !== "win32") {
    return { command: "corepack", args: [...args] };
  }

  const pathApi = path.win32;
  const searchPath = environmentValue(env, "PATH", platform) ?? "";
  const directories = [
    pathApi.dirname(nodePath),
    ...searchPath.split(pathApi.delimiter),
  ];
  const seen = new Set();

  for (const rawDirectory of directories) {
    const directory = rawDirectory.trim();
    if (!directory || seen.has(directory.toLowerCase())) continue;
    seen.add(directory.toLowerCase());

    for (const name of ["corepack.exe", "corepack.com"]) {
      const executable = pathApi.join(directory, name);
      if (isFile(executable)) {
        return { command: executable, args: [...args] };
      }
    }

    const entry = pathApi.join(
      directory,
      "node_modules",
      "corepack",
      "dist",
      "corepack.js",
    );
    if (!isFile(entry)) continue;
    if (
      !isFile(pathApi.join(directory, "corepack.cmd"))
      && !isFile(pathApi.join(directory, "corepack.bat"))
    ) {
      continue;
    }
    return {
      command: nodePath,
      args: [entry, ...args],
    };
  }

  throw new Error(
    "Windows PATH does not contain a spawn-safe Corepack launcher; expected corepack.exe or a Corepack npm shim beside node_modules/corepack/dist/corepack.js.",
  );
}
