import { cleanImageDataUrl, type ChatAttachment } from "../chat-attachments.ts";
import { saveChatImageAttachment } from "./chat-attachment-store.ts";

/**
 * Move inline base64 images out of a transcript into the durable attachment
 * store, in place (#5587). Called by saveConversation just before it writes,
 * so it runs inside the server's own per-conversation write path: a
 * transcript is migrated on its next write, once per image.
 *
 * Only an image `dataUrl` without a `storedId` is moved, and only when the
 * store accepts it; anything it refuses (oversized, malformed, store down)
 * stays inline exactly as before, so no picture is ever lost. Returns how many
 * images moved.
 */
export async function externalizeInlineImages(
  turns: ReadonlyArray<{ attachments?: ChatAttachment[] }>,
): Promise<number> {
  let moved = 0;
  for (const turn of turns) {
    const attachments = turn.attachments;
    if (!attachments?.length) continue;
    for (let index = 0; index < attachments.length; index += 1) {
      const attachment = attachments[index];
      if (!attachment?.dataUrl || attachment.storedId) continue;
      const image = cleanImageDataUrl(attachment.dataUrl);
      if (!image) continue;
      const storedId = await saveChatImageAttachment(image.dataUrl, image.mimeType);
      if (!storedId) continue;
      const { dataUrl: _inline, ...rest } = attachment;
      attachments[index] = { ...rest, mimeType: rest.mimeType ?? image.mimeType, storedId };
      moved += 1;
    }
  }
  return moved;
}
