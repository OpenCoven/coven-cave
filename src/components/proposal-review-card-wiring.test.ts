// Wiring pin: chat-view slices proposal-review markers into inline receipt
// cards as the OUTERMOST splitter of the segment chain, so every earlier
// splitter still receives the same prose it did before (their own wiring pins
// stay intact) and the receipt card renders wherever the marker sat.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");

assert.match(
  source,
  /import \{ ProposalReviewCard \} from "@\/components\/proposal-review-card";/,
  "chat-view imports the receipt card",
);
assert.match(
  source,
  /import \{ proposalReviewKey, sliceProposalReviewBlocks \} from "@\/lib\/proposal-review-blocks";/,
  "chat-view imports the scanner and key helper",
);
assert.match(
  source,
  /function splitSegmentsForProposalReviews\(\s*segments: MessageBubbleSegment\[\],\s*\): MessageBubbleSegment\[\] \{[\s\S]*?sliceProposalReviewBlocks\(segment\.text\)[\s\S]*?<ProposalReviewCard review=\{piece\.review\} \/>/,
  "the splitter turns each review piece into a block segment carrying the card",
);
assert.match(
  source,
  /const split = splitSegmentsForProposalReviews\(\s*splitSegmentsForGitHub\(\s*splitSegmentsForArtifacts\(/,
  "proposal reviews are split outermost, after every existing splitter",
);
assert.doesNotMatch(
  source,
  /ProposalReviewCard[^\n]*on(Approve|Deny)/,
  "the receipt card is wired without approve/deny handlers",
);

console.log("proposal-review-card-wiring.test.ts: ok");
