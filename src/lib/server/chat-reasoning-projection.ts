import type { ChatReasoningBlock } from "../chat-reasoning-blocks.ts";
import { normalizeReasoningBlock } from "../chat-reasoning-blocks.ts";
import { projectDisplayId, projectDisplayText } from "./chat-display-projection.ts";
import type { ToolObservationContext } from "./chat-activity-projection.ts";

/** Only complete, provider-designated display fields enter here. No raw frame,
 * signature, encrypted state, tool payload, or caller disclosure flag is accepted.
 * Unknown classification defaults to metadata-only. */
export function projectReasoningText(text: unknown, representation: ChatReasoningBlock["representation"]): string | undefined {
  if ((representation !== "provider-summary" && representation !== "provider-progress") ||
    typeof text !== "string" || !text.trim() || Buffer.byteLength(text) > 64 * 1024) return undefined;
  try {
    const redacted = projectDisplayText(text, { classification: representation, complete: true });
    if (redacted === undefined) return undefined;
    // Redact before capping; never emit partial units before this projection.
    if (redacted.length <= 16_384) return redacted;
    let end = 16_350;
    if (/[\uD800-\uDBFF]/.test(redacted[end - 1]!)) end -= 1;
    return `${redacted.slice(0, end)}\n[summary truncated]`;
  } catch { return undefined; }
}

export class ReasoningBlockTracker {
  private readonly blocks = new Map<string, ChatReasoningBlock>();
  private readonly nativeIds = new Map<string, string>();
  private readonly context: () => ToolObservationContext;
  private readonly attemptId: string;
  private readonly now: () => number;
  constructor(context: () => ToolObservationContext, attemptId: string, now = Date.now) {
    this.context = context; this.attemptId = attemptId; this.now = now;
  }

  observe(id: string, phase: ChatReasoningBlock["phase"], text?: string, representation: ChatReasoningBlock["representation"] = "provider-summary", source: "runtime-report" | "application" = "runtime-report", unavailableReason?: ChatReasoningBlock["unavailableReason"], textOffset?: number): ChatReasoningBlock | undefined {
    if (!id || id.length > 160) return undefined;
    const key = `${this.attemptId}:${projectDisplayId(id)}`;
    const previous = this.blocks.get(key);
    if (previous?.phase === "complete" || previous?.phase === "unavailable" && phase === "running") return undefined;
    if (!previous && this.blocks.size >= 64) return undefined;
    const projected = phase === "complete" ? projectReasoningText(text, representation) : undefined;
    const context = this.context();
    const now = Math.max(this.now(), previous?.observation.updatedAt ?? 0);
    const sequence = previous ? previous.observation.sequence : context.nextSequence?.();
    const firstTextOffset = previous ? previous.textOffset : textOffset;
    const observation: ChatReasoningBlock["observation"] = {
      runId: context.runId, attemptId: this.attemptId,
      source,
      producer: { harness: context.harness, version: context.version, protocol: context.protocol },
      firstObservedAt: previous?.observation.firstObservedAt ?? now, updatedAt: now,
      ...(sequence !== undefined ? { sequence } : {}),
      completedAt: phase === "complete" ? now : null, binding: "unavailable",
    };
    const block = normalizeReasoningBlock({ schemaVersion: 1, id: key, representation, phase,
      disclosure: projected ? "display-safe" : "withheld", observation, ...(projected ? { text: projected } : {}),
      ...(firstTextOffset !== undefined ? { textOffset: firstTextOffset } : {}),
      ...(unavailableReason ? { unavailableReason } : {}) });
    if (!block) return undefined;
    this.blocks.set(key, block);
    this.nativeIds.set(key, id);
    return block;
  }

  settle(): ChatReasoningBlock[] {
    return [...this.blocks.values()].filter((block) => block.phase === "running").flatMap((block) =>
      this.observe(this.nativeIds.get(block.id)!, "unavailable", undefined, block.representation, "application") ?? []);
  }
  snapshot(): ChatReasoningBlock[] { return [...this.blocks.values()]; }

  /** Match the tool tracker's response to an authoritative text correction. */
  rebaseTextOffsets(after: number, delta: number): void {
    if (!delta) return;
    for (const [id, block] of this.blocks) {
      if (block.textOffset !== undefined && block.textOffset >= after) {
        this.blocks.set(id, { ...block, textOffset: Math.max(after, block.textOffset + delta) });
      }
    }
  }
}
