#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import {
  claimTailscaleServeRoute,
  findServeUrl,
  parseTailscaleServeStatus,
  resetTailscaleServeRoute,
  runTailscaleCommand,
  serveRouteOwnedByBackend,
  type TailscaleServeClaimResult,
  type TailscaleServeResetResult,
} from "../src/lib/mobile-handoff.ts";
import {
  stopOwnedProcessTree,
  type StopOwnedProcessResult,
} from "./mobile-process-ownership.ts";

const EXIT_CONFLICT = 10;
const EXIT_BUSY = 11;
const EXIT_CLEANUP_FAILED = 12;
const EXIT_STATUS_FAILED = 13;
const EXIT_MUTATION_FAILED = 14;

function argumentValue(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? null : null;
}

async function probeLoopbackBackend(target: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1200);
  try {
    await fetch(new URL("/api/familiars", target), {
      headers: { accept: "application/json" },
      redirect: "manual",
      signal: controller.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function exitCode(kind: string): number {
  if (kind === "owned" || kind === "claimed" || kind === "removed") return 0;
  if (kind === "conflict" || kind === "not-owned") return EXIT_CONFLICT;
  if (kind === "busy") return EXIT_BUSY;
  if (kind === "cleanup-failed" || kind === "process-cleanup-failed") {
    return EXIT_CLEANUP_FAILED;
  }
  if (kind === "status-failed" || kind === "status-malformed") return EXIT_STATUS_FAILED;
  return EXIT_MUTATION_FAILED;
}

function printableResult(result: Record<string, unknown>, backendUrl: string) {
  const output: Record<string, unknown> = {
    kind: result.kind,
    backendUrl,
  };
  for (const field of ["targets", "stderr", "warning", "alreadyAbsent"] as const) {
    if (result[field] !== undefined) output[field] = result[field];
  }
  return output;
}

type MobileServeOwnershipCliDependencies = {
  claim: (
    options: Parameters<typeof claimTailscaleServeRoute>[0],
  ) => Promise<TailscaleServeClaimResult>;
  reset: (
    options: Parameters<typeof resetTailscaleServeRoute>[0],
  ) => Promise<TailscaleServeResetResult>;
  stopProcessOwner?: (ownerPath: string) => Promise<StopOwnedProcessResult>;
  stdout: (value: string) => void;
  stderr: (value: string) => void;
  readStdin?: () => Promise<string>;
};

const defaultDependencies: MobileServeOwnershipCliDependencies = {
  claim: claimTailscaleServeRoute,
  reset: resetTailscaleServeRoute,
  stopProcessOwner: stopOwnedProcessTree,
  stdout: (value) => process.stdout.write(value),
  stderr: (value) => process.stderr.write(value),
  readStdin: async () => {
    let input = "";
    for await (const chunk of process.stdin) input += String(chunk);
    return input;
  },
};

export async function runMobileServeOwnershipCli(
  args: string[],
  dependencies?: MobileServeOwnershipCliDependencies,
): Promise<number> {
  const deps = dependencies ?? defaultDependencies;
  const command = args[0];
  const backendUrl = argumentValue(args, "--backend");
  const channel = argumentValue(args, "--channel");
  const processOwnerPath = argumentValue(args, "--process-owner");
  if (
    (command !== "claim" && command !== "reset" && command !== "url")
    || !backendUrl
    || (
      command !== "url"
      && channel !== "dev"
      && channel !== "packaged"
    )
  ) {
    deps.stderr(
      "usage: mobile-serve-ownership.ts claim --backend <loopback-url> --channel {dev|packaged}\n"
      + "       mobile-serve-ownership.ts reset --backend <loopback-url> --channel {dev|packaged} [--process-owner <state-file>]\n"
      + "       mobile-serve-ownership.ts url --backend <loopback-url> < status.json\n",
    );
    return 2;
  }

  let port = "";
  try {
    const parsed = new URL(backendUrl);
    if (
      parsed.protocol !== "http:"
      || !["127.0.0.1", "localhost", "::1", "[::1]"].includes(parsed.hostname)
      || !parsed.port
    ) {
      throw new Error("backend must be an explicit loopback HTTP URL");
    }
    port = parsed.port;
  } catch {
    deps.stderr(`${JSON.stringify({ kind: "invalid-backend", backendUrl })}\n`);
    return 2;
  }

  if (command === "url") {
    const rawStatus = await (deps.readStdin ?? defaultDependencies.readStdin!)();
    const parsed = parseTailscaleServeStatus(rawStatus);
    if ("error" in parsed) {
      deps.stdout(`${JSON.stringify({
        kind: "status-malformed",
        backendUrl,
        stderr: parsed.error,
      })}\n`);
      return EXIT_STATUS_FAILED;
    }
    const url = serveRouteOwnedByBackend(parsed.value, backendUrl)
      ? findServeUrl(parsed.value, backendUrl)
      : null;
    const result = url
      ? { kind: "url", backendUrl, url }
      : { kind: "https-unavailable", backendUrl };
    deps.stdout(`${JSON.stringify(result)}\n`);
    return url ? 0 : EXIT_MUTATION_FAILED;
  }

  const env = {
    ...process.env,
    COVEN_CAVE_BUNDLE: channel === "packaged" ? "1" : undefined,
    PORT: port,
  };
  const configuredTimeout = Number(process.env.TAILSCALE_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0
    ? configuredTimeout
    : 8000;
  const options = {
    backendUrl,
    runTailscale: (args: string[]) => runTailscaleCommand(args, timeoutMs),
    probeBackend: probeLoopbackBackend,
    env,
    ...(command === "reset" && processOwnerPath
      ? {
          beforeReset: async () => {
            const stopProcessOwner = deps.stopProcessOwner
              ?? defaultDependencies.stopProcessOwner!;
            const stopped = await stopProcessOwner(processOwnerPath);
            if (stopped.kind !== "stopped") {
              throw new Error(`owned process cleanup failed: ${JSON.stringify(stopped)}`);
            }
          },
        }
      : {}),
  };
  const result = command === "claim"
    ? await deps.claim(options)
    : await deps.reset(options);
  const output = printableResult(result as unknown as Record<string, unknown>, backendUrl);
  deps.stdout(`${JSON.stringify(output)}\n`);
  return exitCode(result.kind);
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = await runMobileServeOwnershipCli(process.argv.slice(2));
}
