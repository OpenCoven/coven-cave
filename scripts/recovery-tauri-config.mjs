import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const DESKTOP_RUNTIME_RESOURCES = {
  linux: [
    "resources/server/**/*",
    "resources/node/**/*",
    "resources/whisper/**/*",
    "resources/piper/**/*",
    "resources/kokoro/**/*",
    "resources/tools/**/*",
  ],
  macos: [
    "resources/server/**/*",
    "resources/node/**/*",
    "resources/whisper/**/*",
    "resources/piper/**/*",
    "resources/kokoro/**/*",
    "resources/tools/**/*",
  ],
  windows: [
    "resources/server-archive/**/*",
    "resources/node/**/*",
    "resources/whisper/**/*",
    "resources/piper/**/*",
    "resources/kokoro/**/*",
    "resources/tools/**/*",
  ],
};

export function recoveryResourceOverlay({ baseConfig, platformConfig, platform }) {
  if (!baseConfig || typeof baseConfig !== "object" || Array.isArray(baseConfig)) {
    throw new Error("release tag base Tauri config must be an object");
  }
  const resources = platformConfig?.bundle?.resources;
  if (!Array.isArray(resources) || resources.some((resource) => typeof resource !== "string")) {
    throw new Error("release tag Tauri bundle resources must be a string array");
  }
  const requiredResources = DESKTOP_RUNTIME_RESOURCES[platform];
  if (!requiredResources) {
    throw new Error(`unsupported recovery Tauri platform: ${platform}`);
  }

  // The overlay changes only the resource list. Tauri merges every other
  // historical application field from the release-tag configuration.
  return {
    bundle: {
      resources: [
        ...resources.filter((resource) => !requiredResources.includes(resource)),
        ...requiredResources,
      ],
    },
  };
}

export async function writeRecoveryResourceOverlay({
  baseConfigPath,
  platformConfigPath,
  platform,
  outputPath,
}) {
  const [baseConfig, platformConfig] = await Promise.all([
    readFile(baseConfigPath, "utf8").then(JSON.parse),
    readFile(platformConfigPath, "utf8").then(JSON.parse),
  ]);
  const overlay = recoveryResourceOverlay({ baseConfig, platformConfig, platform });
  await writeFile(outputPath, `${JSON.stringify(overlay)}\n`);
  return overlay;
}

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (!value) throw new Error(`${option} requires a value`);
    if (option === "--base") parsed.baseConfigPath = value;
    else if (option === "--platform-config") parsed.platformConfigPath = value;
    else if (option === "--platform") parsed.platform = value;
    else if (option === "--output") parsed.outputPath = value;
    else throw new Error(`unknown option: ${option}`);
  }
  for (const option of ["baseConfigPath", "platformConfigPath", "platform", "outputPath"]) {
    if (!parsed[option]) throw new Error(`missing ${option}`);
  }
  return parsed;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeRecoveryResourceOverlay(parseArgs(process.argv.slice(2))).catch((error) => {
    process.stderr.write(`recovery-tauri-config: ${error.message}\n`);
    process.exitCode = 1;
  });
}
