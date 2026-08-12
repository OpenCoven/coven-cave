#!/usr/bin/env node

import { chmodSync, copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const DELIVERY_ID_KEYS = new Set(["deliveryid", "deliveryuuid", "requestuuid"]);

class AltoolCommandError extends Error {
  constructor(command, status, output) {
    super(`altool ${command} failed with exit code ${status}`);
    this.output = output;
  }
}

function takeFlag(args, index, flag) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

export function parseCommand(argv) {
  const [command, ...args] = argv;
  if (command === "apps") {
    if (args.length > 0) {
      throw new Error(`unsupported apps option: ${args[0]}`);
    }
    return { command };
  }
  if (command === "validate" || command === "upload") {
    const ipaPath = args[0];
    if (!ipaPath || ipaPath.startsWith("--")) {
      throw new Error(`${command} requires an IPA path`);
    }
    const remaining = args.slice(1);
    const wait = remaining.includes("--wait");
    const unknown = remaining.filter((arg) => arg !== "--wait");
    if (unknown.length > 0 || (command === "validate" && wait)) {
      throw new Error(`unsupported ${command} option: ${unknown[0] ?? "--wait"}`);
    }
    return { command, ipaPath, ...(command === "upload" ? { wait } : {}) };
  }

  if (command === "status") {
    const request = { command, wait: false, allowMissing: false };
    for (let index = 0; index < args.length; index += 1) {
      const arg = args[index];
      if (arg === "--wait") {
        request.wait = true;
      } else if (arg === "--allow-missing") {
        request.allowMissing = true;
      } else if (arg === "--delivery-id") {
        request.deliveryId = takeFlag(args, index, arg);
        index += 1;
      } else if (arg === "--apple-id") {
        request.appleId = takeFlag(args, index, arg);
        index += 1;
      } else if (arg === "--bundle-version") {
        request.bundleVersion = takeFlag(args, index, arg);
        index += 1;
      } else if (arg === "--short-version") {
        request.shortVersion = takeFlag(args, index, arg);
        index += 1;
      } else {
        throw new Error(`unsupported status option: ${arg}`);
      }
    }

    if (request.deliveryId) {
      if (request.appleId || request.bundleVersion || request.shortVersion) {
        throw new Error("--delivery-id cannot be combined with version selectors");
      }
      return request;
    }
    if (!request.appleId || !request.bundleVersion || !request.shortVersion) {
      throw new Error(
        "status requires --delivery-id, or --apple-id with --bundle-version and --short-version",
      );
    }
    return request;
  }

  throw new Error("expected apps, validate, upload, or status");
}

function authArgs(auth) {
  const args = [
    "--api-key",
    auth.keyId,
    "--api-issuer",
    auth.issuerId,
  ];
  if (auth.subject) {
    args.push("--api-key-subject", auth.subject);
  }
  args.push("--output-format", "json");
  return args;
}

export function buildAltoolArgs(request, auth) {
  if (request.command === "apps") {
    return ["altool", "--list-apps", ...authArgs(auth)];
  }
  if (request.command === "validate") {
    return [
      "altool",
      "--validate-app",
      request.ipaPath,
      "--type",
      "ios",
      ...authArgs(auth),
    ];
  }
  if (request.command === "upload") {
    return [
      "altool",
      "--upload-app",
      "-f",
      request.ipaPath,
      "--type",
      "ios",
      ...authArgs(auth),
    ];
  }

  const selector = request.deliveryId
    ? ["--delivery-id", request.deliveryId]
    : [
        "--apple-id",
        request.appleId,
        "--bundle-version",
        request.bundleVersion,
        "--bundle-short-version-string",
        request.shortVersion,
        "--platform",
        "ios",
      ];
  return [
    "altool",
    "--build-status",
    ...selector,
    ...(request.wait ? ["--wait"] : []),
    ...authArgs(auth),
  ];
}

function findDeliveryId(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findDeliveryId(item);
      if (found) return found;
    }
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      const normalizedKey = key.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
      if (
        DELIVERY_ID_KEYS.has(normalizedKey) &&
        typeof item === "string" &&
        item.length > 0
      ) {
        return item;
      }
      const found = findDeliveryId(item);
      if (found) return found;
    }
  }
  return null;
}

export function extractDeliveryId(output) {
  try {
    return findDeliveryId(JSON.parse(output));
  } catch {
    const match = output.match(
      /(?:delivery[-_ ]?(?:id|uuid)|request[-_ ]?uuid)["']?\s*[:=]\s*["']?([0-9a-z-]+)/i,
    );
    return match?.[1] ?? null;
  }
}

export function isBuildNotFound(output) {
  return (
    /"(?:code|errorCode)"\s*:\s*"(?:ENTITY_|BUILD_)?NOT_FOUND"/i.test(output) ||
    /\bno matching build\b/i.test(output) ||
    /\bno build (?:was )?found\b/i.test(output) ||
    /\bcould not find\b[^\n]*\bbuild\b/i.test(output) ||
    /\bbuild\b[^\n]*\bnot found\b/i.test(output)
  );
}

function stageApiKey(env, keyId) {
  const sourcePath = env.APPLE_API_KEY_PATH;
  if (!sourcePath) {
    return { env, cleanup: () => {} };
  }
  if (!existsSync(sourcePath)) {
    throw new Error(`APPLE_API_KEY_PATH does not exist: ${sourcePath}`);
  }

  const directory = mkdtempSync(join(tmpdir(), "coven-app-store-connect-"));
  const destination = join(directory, `AuthKey_${keyId}.p8`);
  copyFileSync(sourcePath, destination);
  chmodSync(destination, 0o600);
  return {
    env: { ...env, API_PRIVATE_KEYS_DIR: directory },
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}

function execute(request, auth, env) {
  const staged = stageApiKey(env, auth.keyId);
  try {
    const result = spawnSync("xcrun", buildAltoolArgs(request, auth), {
      encoding: "utf8",
      env: staged.env,
    });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new AltoolCommandError(
        request.command,
        result.status,
        `${result.stdout ?? ""}${result.stderr ?? ""}`,
      );
    }
    return `${result.stdout ?? ""}${result.stderr ?? ""}`;
  } finally {
    staged.cleanup();
  }
}

function usage() {
  return [
    "Usage:",
    "  pnpm appstore:apps",
    "  pnpm appstore:validate <app.ipa>",
    "  pnpm appstore:upload <app.ipa> [--wait]",
    "  pnpm appstore:status --delivery-id <uuid> [--wait]",
    "  pnpm appstore:status --apple-id <id> --bundle-version <build> --short-version <version> [--wait]",
    "",
    "Required environment: APPLE_API_KEY, APPLE_API_ISSUER.",
    "Optional: APPLE_API_KEY_PATH, APPLE_API_KEY_SUBJECT=user.",
  ].join("\n");
}

function main() {
  try {
    const request = parseCommand(process.argv.slice(2));
    const keyId = process.env.APPLE_API_KEY;
    const issuerId = process.env.APPLE_API_ISSUER;
    if (!keyId || !issuerId) {
      throw new Error("APPLE_API_KEY and APPLE_API_ISSUER are required");
    }
    if (
      (request.command === "validate" || request.command === "upload") &&
      !existsSync(request.ipaPath)
    ) {
      throw new Error(`IPA does not exist: ${request.ipaPath}`);
    }

    const auth = {
      keyId,
      issuerId,
      subject: process.env.APPLE_API_KEY_SUBJECT || undefined,
    };
    let uploadOutput;
    try {
      uploadOutput = execute(request, auth, process.env);
    } catch (error) {
      if (
        request.command === "status" &&
        request.allowMissing &&
        error instanceof AltoolCommandError &&
        isBuildNotFound(error.output)
      ) {
        console.error("app-store-connect: Apple reports no matching build");
        process.exitCode = 3;
        return;
      }
      throw error;
    }
    if (request.command === "upload" && request.wait) {
      const deliveryId = extractDeliveryId(uploadOutput);
      if (!deliveryId) {
        throw new Error("upload succeeded but altool did not return a delivery identifier");
      }
      execute({ command: "status", deliveryId, wait: true }, auth, process.env);
    }
  } catch (error) {
    console.error(`app-store-connect: ${error.message}`);
    console.error(usage());
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
