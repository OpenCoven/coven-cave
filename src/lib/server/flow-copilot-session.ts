// Direct copilot spawn for flow sessions (cave-lhc0).
//
// The daemon's nonInteractive session launch mangles multi-word prompts for
// the copilot adapter (the CLI reports "your prompt was not quoted, so the
// extra words were treated as separate arguments"), which broke every
// copilot-familiar flow — including each bounded research-mission iteration.
// Chat hit the same daemon deficiency and answers it by spawning the CLI
// directly with a real argv (src/app/api/chat/send/route.ts, cave-yesg);
// this gives flow sessions the same escape hatch.
//
// The spawned run persists its transcript as a Cave conversation under the
// flow's session id, which is exactly where the flow transcript endpoint
// (/api/flows/session-transcript) and the research-mission reconcile
// (parseResearchControl over conversation turns) already look first.

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { saveConversation } from "../cave-conversations.ts";
import {
  buildCopilotStreamArgs,
  copilotIdentityPreamble,
  parseCopilotChatEvent,
  type CopilotStreamSpec,
} from "../copilot-stream.ts";
import { harnessSpawnEnv } from "../harness-spawn-env.ts";

/** One bounded flow iteration should never outlive this. */
const FLOW_COPILOT_TIMEOUT_MS = 60 * 60_000;

export type CopilotFlowLaunch = {
  spec: CopilotStreamSpec;
  prompt: string;
  projectRoot: string;
  familiarId: string | null;
  familiarName?: string;
  familiarRole?: string;
};

export type CopilotFlowStart = {
  sessionId: string;
  /** Resolves when the one-shot exits and the transcript is persisted. */
  done: Promise<void>;
};

/**
 * Launch one non-interactive copilot run for a compiled flow prompt.
 * Returns as soon as the process starts; the transcript (user prompt +
 * assistant output) lands in the Cave conversation when the run finishes, so
 * pollers see the complete output including any trailing control markers.
 */
export function startCopilotFlowRun(launch: CopilotFlowLaunch): CopilotFlowStart {
  const sessionId = randomUUID();
  const identity = launch.familiarId
    ? copilotIdentityPreamble(launch.familiarId, launch.familiarName, launch.familiarRole)
    : "";
  const prompt = identity ? `${identity}\n\n${launch.prompt}` : launch.prompt;
  const args = buildCopilotStreamArgs({
    spec: launch.spec,
    prompt,
    resumeSessionId: null,
    newSessionId: sessionId,
    model: null,
    permissionMode: "full",
    // Flow runs have no granted-roots concept; the spawn cwd (projectRoot)
    // is already trusted and must not be listed (cave-n1yc contract).
    addDirs: [],
  });

  const child = spawn(launch.spec.executable, args, {
    cwd: launch.projectRoot,
    env: harnessSpawnEnv(launch.familiarId),
    stdio: ["ignore", "pipe", "pipe"],
  });

  const startedAt = new Date().toISOString();
  let assistantText = "";
  const deltaByMessage = new Map<string, string>();
  let stderrTail = "";

  const rl = createInterface({ input: child.stdout });
  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) return;
    let raw: unknown;
    try { raw = JSON.parse(trimmed); } catch { return; }
    const event = parseCopilotChatEvent(raw);
    if (!event) return;
    if (event.kind === "text_delta") {
      deltaByMessage.set(event.messageId, (deltaByMessage.get(event.messageId) ?? "") + event.text);
    } else if (event.kind === "message") {
      // The final frame carries the complete content — prefer it over deltas.
      deltaByMessage.set(event.messageId, event.content);
    }
  });

  child.stderr.on("data", (chunk: Buffer) => {
    stderrTail = (stderrTail + chunk.toString()).slice(-2_000);
  });

  const timeout = setTimeout(() => {
    try { child.kill("SIGKILL"); } catch { /* already gone */ }
  }, FLOW_COPILOT_TIMEOUT_MS);
  timeout.unref?.();

  const done = new Promise<void>((resolve) => {
    child.on("error", (err) => {
      stderrTail = `${stderrTail}\n${err.message}`.slice(-2_000);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      assistantText = [...deltaByMessage.values()].join("\n").trim();
      // Any non-zero (or missing) exit code is an error — even with partial
      // output, the run didn't finish cleanly and the diagnostics must not
      // be dropped. Captured text is preserved ahead of the exit note.
      const failed = code !== 0;
      const exitNote = failed
        ? `copilot exited with code ${code ?? "?"}${stderrTail.trim() ? `:\n${stderrTail.trim()}` : ""}`
        : "";
      const finishedAt = new Date().toISOString();
      const text = [assistantText, exitNote].filter(Boolean).join("\n\n");
      void (async () => {
        try {
          const userTurnId = randomUUID();
          const assistantTurnId = randomUUID();
          await saveConversation({
            sessionId,
            harnessSessionId: sessionId,
            familiarId: launch.familiarId ?? "",
            harness: "copilot",
            createdAt: startedAt,
            updatedAt: finishedAt,
            turns: [
              { id: userTurnId, role: "user", text: prompt, createdAt: startedAt },
              {
                id: assistantTurnId,
                parentId: userTurnId,
                role: "assistant",
                text,
                createdAt: finishedAt,
                ...(failed ? { isError: true } : {}),
              },
            ],
            activeLeafId: assistantTurnId,
          });
        } catch {
          // Transcript persistence is best-effort; the run itself finished.
        }
        resolve();
      })();
    });
  });

  return { sessionId, done };
}
