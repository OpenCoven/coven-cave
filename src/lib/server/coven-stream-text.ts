// Reassemble a familiar's answer from `coven run --stream-json` output.
//
// The stream interleaves the answer with transport frames: the system init
// event, tool calls and results, rate-limit notices, and the final result
// frame. Only assistant text blocks are the answer. Harnesses that ignore
// --stream-json print plain text, which is kept whole, including a bare JSON
// answer line.
//
// In a stream, every other frame is dropped. Appending them (the old
// behavior) put the system-init object ahead of the familiar's JSON, so
// callers that take the first `{` parsed transport instead of the answer
// (#5629).

type StreamFrame = {
  type?: unknown;
  message?: { content?: Array<{ type?: string; text?: string }> };
};

const STREAM_FRAME_TYPES = new Set(["assistant", "system", "user", "result"]);

function frameOf(line: string): StreamFrame | null {
  if (!line.startsWith("{") || !line.endsWith("}")) return null;
  try {
    const parsed: unknown = JSON.parse(line);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as StreamFrame
      : null;
  } catch {
    return null;
  }
}

export function assistantTextFromStream(raw: string): string {
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const frames = lines.map(frameOf);
  const isStream = frames.some(
    (frame) => typeof frame?.type === "string" && STREAM_FRAME_TYPES.has(frame.type),
  );
  if (!isStream) return raw;

  let assistantText = "";
  lines.forEach((line, index) => {
    const frame = frames[index];
    if (!frame) {
      // Stray non-JSON output inside a stream (a harness warning, say).
      assistantText += `${line}\n`;
      return;
    }
    if (frame.type !== "assistant" || !Array.isArray(frame.message?.content)) return;
    for (const block of frame.message.content) {
      if (block?.type === "text" && typeof block.text === "string") assistantText += block.text;
    }
  });
  return assistantText.trim() ? assistantText : raw;
}
