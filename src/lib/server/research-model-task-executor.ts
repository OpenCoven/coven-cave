// Read-only structured model-task boundary (Unit 2, cave-6sles.11).
//
// §10.2 requires a server-side `executeResearchModelTask` that is read-only
// and structured. v1 runs `runCovenOneShot` from ./coven-oneshot.ts — a local
// one-shot, non-session, non-tool CLI invocation that returns stdout text —
// with a "produce JSON only, no tools, no project root" instruction. This is
// deliberately NOT a refactor of the chat/send monolith, and it grants no
// project root, tools, or write authority.
//
// The executor must not import mission-creation, automation, artifact, or
// write-tool modules (asserted by research-topic-discovery-authority.test.ts).

import { isRecord } from "../research-protocol/common.ts";
import {
  parseResearchModelReceiptV1,
  type ResearchModelReceiptV1,
} from "../research-protocol/topic-discovery.ts";
import { TOPIC_DISCOVERY_BUDGET } from "../research-topic-discovery.ts";

// Type-only alias for runCovenOneShot's signature; the real function is
// lazily imported so the executor module (and its injected-fake tests) load
// without pulling in the `@/`-aliased coven-oneshot graph.
export type RunOneShot = (
  args: readonly string[],
  signal: AbortSignal,
  cwd?: string,
  familiarId?: string,
) => Promise<string>;

export type ResearchModelTaskRequest = {
  familiarId: string;
  inputBytes: Uint8Array; // assembled, delimited prompt (already bounded)
  outputSchema: "topic-candidates-v1";
};

export type ResearchModelTaskResult = {
  output: Record<string, unknown>; // raw JSON, caller-validated against outputSchema
  modelReceipt: ResearchModelReceiptV1;
};

export type ResearchModelTaskExecutor = {
  execute(request: ResearchModelTaskRequest): Promise<ResearchModelTaskResult>;
};

export type ResolvedModelState = {
  harness?: string;
  model?: string;
};

export type ResearchModelTaskFailure = {
  code: "output_invalid" | "output_too_large" | "model_unavailable";
  message: string;
  retryable: boolean;
};

export class ResearchModelTaskError extends Error {
  readonly failure: ResearchModelTaskFailure;

  constructor(failure: ResearchModelTaskFailure) {
    super(failure.message);
    this.name = "ResearchModelTaskError";
    this.failure = failure;
  }
}

const SAFE_ID = /^[a-z0-9_-]+$/i;

// Reassemble the assistant's text from a `coven run --stream-json` stream, or
// fall back to the raw text for harnesses that emit plain text. Mirrors the
// board enrich-steps route's assistantTextFromOutput.
function assistantTextFromOutput(raw: string): string {
  let assistantText = "";
  const lines = raw.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        const event = JSON.parse(trimmed) as {
          type?: string;
          message?: { content?: Array<{ type?: string; text?: string }> };
        };
        if (event.type === "assistant" && event.message?.content) {
          for (const block of event.message.content) {
            if (block.type === "text" && typeof block.text === "string") assistantText += block.text;
          }
          continue;
        }
      } catch {
        /* fall through to plain-text fallback */
      }
    }
    assistantText += `${trimmed}\n`;
  }
  return assistantText.trim() ? assistantText : raw;
}

// Extract the first balanced JSON object from a haystack, tolerating stream
// chatter around it. Returns null when no object parses.
function extractJsonObject(raw: string): Record<string, unknown> | null {
  const text = assistantTextFromOutput(raw);
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          const value: unknown = JSON.parse(text.slice(start, i + 1));
          return isRecord(value) ? value : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

async function defaultResolveState(familiarId: string): Promise<ResolvedModelState | null> {
  try {
    // Lazy import: the real config graph is only pulled in when the executor
    // actually runs against a familiar, so the executor module (and its
    // injected-fake tests) load without the cave-config dependency graph.
    const { bindingFor, loadConfig } = await import("../cave-config.ts");
    const config = await loadConfig();
    const binding = bindingFor(config, familiarId);
    if (!binding.harness) return null;
    return { harness: binding.harness, model: binding.model || undefined };
  } catch {
    return null;
  }
}

export function createResearchModelTaskExecutor(options: {
  runOneShot?: RunOneShot;
  resolveState?: (familiarId: string) => Promise<ResolvedModelState | null>;
  maxOutputBytes?: number;
} = {}): ResearchModelTaskExecutor {
  const runOneShot =
    options.runOneShot ??
    (async (args, signal, cwd, familiarId) => {
      const { runCovenOneShot } = await import("./coven-oneshot.ts");
      return runCovenOneShot(args, signal, cwd, familiarId);
    });
  const resolveState = options.resolveState ?? defaultResolveState;
  const maxOutputBytes = options.maxOutputBytes ?? TOPIC_DISCOVERY_BUDGET.maxOutputBytes;

  return {
    async execute(request) {
      const state = await resolveState(request.familiarId);
      if (!state?.harness) {
        throw new ResearchModelTaskError({
          code: "model_unavailable",
          message: `no model runtime resolved for familiar ${request.familiarId}`,
          retryable: false,
        });
      }

      const prompt = new TextDecoder().decode(request.inputBytes);
      const args: string[] = [
        "run",
        state.harness,
        "--stream-json",
        "--permission",
        "read-only",
        "--title",
        "Topic discovery",
        "--labels",
        "research,topic-discovery",
      ];
      if (SAFE_ID.test(request.familiarId)) args.push("--familiar", request.familiarId);
      args.push("--", prompt);

      const raw = await runOneShot(args, new AbortController().signal, undefined, request.familiarId);

      if (raw.length > maxOutputBytes) {
        throw new ResearchModelTaskError({
          code: "output_too_large",
          message: `model output exceeded the ${maxOutputBytes}-byte cap`,
          retryable: true,
        });
      }

      const output = extractJsonObject(raw);
      if (output === null) {
        throw new ResearchModelTaskError({
          code: "output_invalid",
          message: "model produced no parseable JSON object",
          retryable: true,
        });
      }

      const modelReceipt: ResearchModelReceiptV1 = {
        familiarId: request.familiarId,
        runtime: state.harness,
        effectiveModel: state.model ?? null,
        modelSource: state.model ? "familiar-default" : "runtime-default",
        providerBilling: "user-connected",
        usage: { inputTokens: null, outputTokens: null, costUsd: null, reportedByRuntime: false },
      };
      const checked = parseResearchModelReceiptV1(modelReceipt, "$.modelReceipt");
      if (!checked.ok) {
        throw new ResearchModelTaskError({
          code: "output_invalid",
          message: `model receipt failed validation: ${checked.error.code}`,
          retryable: false,
        });
      }

      return { output, modelReceipt: checked.value };
    },
  };
}
