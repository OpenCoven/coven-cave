/**
 * Assist runner — the shared headless `codex exec` lane for one-shot,
 * bounded, read-only generation (docs/authoring-assist.md §7, cave-c40b).
 *
 * Extracted from the stitch sew so every authoring assist (sew, skill draft,
 * skill dry-run, …) reuses one spawn dance instead of growing private copies.
 * Follows the automation-runner stance: the invocation is built by a pure,
 * unit-tested function; the spawn itself is verified manually (CI has no
 * codex binary). The prompt goes to stdin; the agent's final message is read
 * from `--output-last-message` (a temp file), keeping progress noise on
 * stdout/stderr out of the caller's parse.
 *
 * The sandbox is pinned **read-only inside this module — deliberately not a
 * parameter** — so no future caller can quietly widen privileges: assist
 * prompts embed user-pasted and remote-fetched (attacker-influenceable)
 * content, and a distillation needs no tools. Anything that must write goes
 * through the existing deterministic routes or a watched chat, never here.
 */

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { harnessSpawnEnv } from "../harness-spawn-env.ts";

export type AssistInvocation = {
  command: string;
  args: string[];
  stdinPrompt: string;
};

export const ASSIST_TIMEOUT_MS = 180_000;

/** Pure: how to invoke `codex exec` for a bounded assist. Unit-tested. */
export function buildAssistInvocation(prompt: string, lastMessagePath: string): AssistInvocation {
  const command = process.env.COVEN_CODEX_BIN?.trim() || "codex";
  return {
    command,
    // --skip-git-repo-check: assists deliberately run in a neutral temp dir
    // (never the repo), which newer codex refuses as "not inside a trusted
    // directory" without the flag. Safe here because the sandbox is pinned
    // read-only — the trust check guards writable runs, and this can't write.
    args: [
      "exec",
      "--sandbox",
      "read-only",
      "--skip-git-repo-check",
      "--output-last-message",
      lastMessagePath,
      "-",
    ],
    stdinPrompt: prompt,
  };
}

export type AssistRunResult =
  | { ok: true; lastMessage: string }
  | { ok: false; error: string };

/**
 * Run one bounded assist end-to-end: spawn `codex exec`, wait (bounded), and
 * return the final message for the caller to parse against its own output
 * contract. Never throws. Spawn behavior is exercised manually — CI covers
 * `buildAssistInvocation` only.
 */
export async function runBoundedAssist(opts: {
  prompt: string;
  timeoutMs?: number;
  /** Human phrasing for the "codex isn't installed" failure — name the
   *  caller's escape hatch instead of leaking `spawn codex ENOENT` jargon. */
  missingRuntimeHint?: string;
}): Promise<AssistRunResult> {
  const timeoutMs = opts.timeoutMs ?? ASSIST_TIMEOUT_MS;
  const dir = await mkdtemp(
    /* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ tmpdir(), "assist-run-"),
  );
  const lastMessagePath = path.join(/* turbopackIgnore: true */ dir, "last-message.txt");
  try {
    const inv = buildAssistInvocation(opts.prompt, lastMessagePath);
    let stderrTail = "";
    const spawned = await new Promise<{ code: number | null; error?: string }>((resolve) => {
      let settled = false;
      const settle = (value: { code: number | null; error?: string }) => {
        if (!settled) {
          settled = true;
          resolve(value);
        }
      };
      // Neutral cwd: the assist's temp dir, not the server checkout — even a
      // read-only sandbox shouldn't be pointed at the repo as its workspace.
      // No familiar context: shared vault keys only (assists embed
      // attacker-influenceable content; scoped secrets never reach them).
      // `inv.command` is a runtime override (`COVEN_CODEX_BIN`) or a PATH
      // lookup, never a bundled executable. Calling through Reflect prevents
      // Next's child_process tracer from treating that dynamic command as a
      // repository-relative build input while preserving spawn semantics.
      const child = Reflect.apply(spawn, undefined, [
        inv.command,
        inv.args,
        {
          cwd: dir,
          stdio: ["pipe", "ignore", "pipe"],
          env: harnessSpawnEnv(),
        },
      ]);
      // Keep a bounded stderr tail so a non-zero exit carries its reason
      // (e.g. codex trust/auth refusals) instead of an opaque exit code.
      child.stderr?.on("data", (chunk: Buffer) => {
        stderrTail = (stderrTail + chunk.toString("utf8")).slice(-2000);
      });
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        settle({ code: null, error: "assist timed out" });
      }, timeoutMs);
      child.on("error", (err) => {
        clearTimeout(timer);
        const missing = (err as NodeJS.ErrnoException).code === "ENOENT";
        settle({
          code: null,
          error: missing
            ? `The ${inv.command} CLI isn't installed, so this assist can't run. Install it (npm i -g @openai/codex)${
                opts.missingRuntimeHint ? ` or ${opts.missingRuntimeHint}` : ""
              }.`
            : err.message,
        });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        settle({ code });
      });
      // `stdio[0]` is explicitly "pipe" above. Keep the null guard because
      // Reflect.apply necessarily widens Node's spawn overload at type-check
      // time even though the runtime contract guarantees a writable stream.
      if (!child.stdin) {
        settle({ code: null, error: "assist stdin unavailable" });
        return;
      }
      child.stdin.write(inv.stdinPrompt);
      child.stdin.end();
    });
    if (spawned.error) return { ok: false, error: spawned.error };
    if (spawned.code !== 0) {
      const reason = stderrTail.trim().split(/\r?\n/).filter(Boolean).slice(-3).join(" · ").slice(-300);
      return {
        ok: false,
        error: `codex exec exited with ${spawned.code}${reason ? ` — ${reason}` : ""}`,
      };
    }
    let lastMessage: string;
    try {
      lastMessage = await readFile(/* turbopackIgnore: true */ lastMessagePath, "utf8");
    } catch {
      // codex can exit 0 yet write no last-message file when it is not signed
      // in or refuses trust for the workspace. The real reason lands on stderr,
      // so surface that (and an explicit sign-in hint for the auth case)
      // instead of an opaque "produced no output".
      const tail = stderrTail
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(-3)
        .join(" · ")
        .slice(-300);
      const looksLikeAuth =
        /not logged in|log ?in|sign ?in|unauthorized|authenticate|auth|credential|token|401/i.test(
          stderrTail,
        );
      if (looksLikeAuth) {
        return {
          ok: false,
          error: `${inv.command} isn't signed in, so this assist produced no output. Run \`${inv.command} login\` in a terminal, then try again${
            tail ? ` (${tail})` : ""
          }.`,
        };
      }
      return {
        ok: false,
        error: `assist produced no output${tail ? ` — ${tail}` : ""}`,
      };
    }
    return { ok: true, lastMessage };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "assist failed" };
  } finally {
    await rm(/* turbopackIgnore: true */ dir, { recursive: true, force: true });
  }
}
