import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { heapLimitNodeOptions } from "./heap-limits.mjs";

const DEV_RECYCLE_EXIT_CODE = 75;
const RESTART_DELAY_MS = 500;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function devServerEnvironment(env = process.env) {
  const existingNodeOptions =
    typeof env.NODE_OPTIONS === "string" ? env.NODE_OPTIONS.trim() : "";
  const nodeOptions = /(?:^|\s)--max-old-space-size=\d+(?:\s|$)/u.test(existingNodeOptions)
    ? existingNodeOptions
    : heapLimitNodeOptions(env);
  return {
    ...env,
    NODE_ENV: "development",
    NODE_OPTIONS: nodeOptions,
    COVEN_CAVE_DEV_SUPERVISED: "1",
  };
}

export function shouldRestartDevServer({ code, signal, stopping }) {
  return !stopping && signal === null && code === DEV_RECYCLE_EXIT_CODE;
}

function childExit(child) {
  return new Promise((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("close", (code, signal) => resolveExit({ code, signal }));
  });
}

export async function runDevServerSupervisor() {
  let child = null;
  let stopping = false;

  const stop = (signal) => {
    stopping = true;
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill(signal);
    }
  };
  const onSigint = () => stop("SIGINT");
  const onSigterm = () => stop("SIGTERM");
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  try {
    for (;;) {
      child = spawn(
        process.execPath,
        ["--experimental-strip-types", "server.ts"],
        {
          cwd: root,
          env: devServerEnvironment(process.env),
          stdio: "inherit",
        },
      );
      const result = await childExit(child);
      child = null;

      if (!shouldRestartDevServer({ ...result, stopping })) {
        if (result.signal === "SIGINT") return 130;
        if (result.signal === "SIGTERM") return 143;
        return result.code ?? 1;
      }

      console.warn(
        `[dev-supervisor] restarting after heap recycle in ${RESTART_DELAY_MS}ms`,
      );
      await new Promise((resolveDelay) => setTimeout(resolveDelay, RESTART_DELAY_MS));
    }
  } finally {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runDevServerSupervisor();
}
