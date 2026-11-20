// Readable coven:ui projection for native Copy (#6060). UiBlockReadableText
// loads this bundle into a JavaScriptCore context, so a copied block is the
// same readable lines desktop and the markdown page show. No DOM here.
import { projectUiBlocksToReadable } from "../../../src/lib/ui-block-readable.ts";

globalThis.covenProjectUiBlocks = (text, streaming) =>
  projectUiBlocksToReadable(String(text ?? ""), { streaming: streaming === true });
