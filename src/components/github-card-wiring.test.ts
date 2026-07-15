// @ts-nocheck
// Wiring pins: the chat transcript must mount GitHub cards for coven:github
// markers and bare-line URLs (design: docs/chat-github-integration.md §1-2;
// bead cave-fpqx.6).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const chatView = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");
const card = readFileSync(new URL("./github-card.tsx", import.meta.url), "utf8");

// chat-view: imports and render paths.
assert.match(
  chatView,
  /import \{ sliceGitHubBlocks, stripGitHubMarkers, unfurlUserMessage, descriptorUrl \} from "@\/lib\/github-blocks"/,
  "chat-view imports the github-blocks lib",
);
assert.match(chatView, /import \{ GitHubCard \} from "@\/components\/github-card"/, "chat-view imports GitHubCard");
assert.match(chatView, /function splitSegmentsForGitHub\(/, "has the segments→github splitter");
assert.match(chatView, /<GitHubCard descriptor=/, "renders GitHubCard as a block segment");
assert.match(
  chatView,
  /splitSegmentsForGitHub\(splitTextForArtifacts\(visibleWithGh, artifactCtx\), onOpenUrl\)/,
  "settled path composes github splitting after artifact splitting on the marker-bearing text",
);
assert.match(
  chatView,
  /turn\.pending \? stripGitHubMarkers\(reasoningSplit\.visible\)/,
  "streaming path strips markers so raw tags never flash",
);
assert.match(
  chatView,
  /turn\.role === "user" \? unfurlUserMessage\(turn\.text\) : \[\]/,
  "bare-line unfurl is gated to user turns — never system messages",
);

// github-card: hydration + degradation contracts.
assert.match(card, /\/api\/github\/item\?repo=/, "card hydrates from /api/github/item");
assert.match(card, /cancelled/, "hydration effect guards against post-unmount setState");
assert.match(card, /connect GitHub to hydrate/, "unauth state degrades with a connect hint");
assert.match(card, /descriptorUrl\(descriptor\)/, "card links out via the canonical descriptor URL");
assert.match(card, /res\.status === 401 \|\| res\.status === 403/, "auth failures map to the unauth state");

// W1b (cave-fpqx.7): checks strip + expansion + review threads.
assert.match(card, /\/api\/github\/checks\?repo=/, "PR cards fetch the checks breakdown");
assert.match(
  card,
  /usePausablePoll\(\(\) => setTick\(\(t\) => t \+ 1\), 30_000, \{ enabled: enabled && pending \}\)/,
  "checks re-poll every 30s only while the rollup is pending (hidden tabs pause)",
);
assert.match(
  card,
  /item\.isPull && item\.state === "open" && !item\.merged/,
  "checks fetch is gated to open, unmerged pull requests",
);
assert.match(card, /countChecks\(data\.runs\)/, "strip buckets come from the shared countChecks helper");
assert.match(card, /aria-expanded=\{expanded\}/, "check details expand in place with an accessible toggle");
assert.match(card, /\/api\/github\/comments\?repo=.*isPull=1/, "review-thread cards hydrate from /api/github/comments");
assert.match(card, /connect GitHub to see review threads/, "unauthenticated review threads degrade legibly");
assert.match(
  card,
  /t\.comments\.some\(\(c\) => c\.id === descriptor\.threadId\)/,
  "thread matching uses comment databaseIds (what #discussion_r ids name), not GraphQL node ids",
);
assert.match(card, /isFailConclusion\(run\.conclusion\)/, "run glyphs share the fail-conclusion source of truth");

console.log("github chat-card wiring: ok");
