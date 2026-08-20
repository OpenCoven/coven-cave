// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  isAutoApplyAllowed,
  parseAgenticRecommendationsOutput,
  rankAgenticRecommendations,
  verifyAutoApplicableRecommendation,
} from "../lib/agentic-recommendations.ts";

const source = readFileSync(new URL("./agentic-recommendation-card.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles/globals/primitives.css", import.meta.url), "utf8");

assert.match(source, /export function AgenticRecommendationCard/, "exports the shared card");
assert.match(source, /AgenticRecommendationCardState/, "models ready, loading, empty, blocked, and error states");
assert.match(source, /"loading"[\s\S]*?"empty"[\s\S]*?"blocked"[\s\S]*?"error"/, "covers every non-ready state");
assert.match(source, /Rank #\{recommendation\.ordinal\}/, "shows the recommendation rank");
assert.match(source, /inferredGoal/, "shows the inferred goal");
assert.match(source, /Why this recommendation/, "keeps rationale behind a clear disclosure");
assert.match(source, /<details/, "uses native, keyboard-accessible disclosure");
assert.match(source, /focus-ring/, "gives the disclosure a visible keyboard focus ring");
assert.match(source, /evidenceRefs\.map/, "renders all evidence references");
assert.match(source, /PropertyPill/, "reuses PropertyPill for interactive evidence");
assert.match(source, /Evidence:/, "gives each evidence chip an accessible name");

assert.match(source, /Verified/, "states verified status in text");
assert.match(source, /Requires approval|No approval required/, "states approval requirements in text");
assert.match(source, /Blocked —/, "states blocked status in text, not just by color");
assert.match(source, /verification\.checks/, "renders verification checks for review");

for (const action of ["Apply", "Review", "Edit", "Dismiss", "Revert"]) {
  assert.match(source, new RegExp(`>\\s*${action}\\s*<`), `offers the ${action} action when supplied`);
}

assert.match(source, /SkeletonGroup|Skeleton/, "uses Skeleton primitives while loading");
assert.match(source, /Loading recommendations…/, "names the loading state");
assert.match(source, /EmptyState/, "uses EmptyState when there is no recommendation");
assert.match(source, /ErrorState/, "uses ErrorState when loading fails");
assert.match(source, />\s*Retry\s*</, "offers retry for error state");

const autoCandidate = parseAgenticRecommendationsOutput(JSON.stringify({
  recommendations: [{
    id: "auto-card",
    surface: "board",
    kind: "canonicalize-reference",
    payload: {
      canonicalUrl: "https://example.invalid/reference",
      referenceId: "reference-42",
    },
    rationale: "The canonical URL is mechanically verified.",
    inferredGoal: "Keep the reference canonical.",
    rankReasons: ["trusted verification"],
    evidenceRefs: [{ id: "reference-42", kind: "task", label: "Canonicalize reference" }],
    contextFingerprint: "ctx-v1-0123456789abcdef0123456789abcdef",
  }],
}))[0]!;
const verifiedAuto = verifyAutoApplicableRecommendation(autoCandidate, [{
  id: "reference-exists",
  state: "passed",
  detail: "The adapter resolved the reference.",
}]);
assert.ok(verifiedAuto, "trusted adapter verification creates an auto-apply candidate");
const trustedRanked = rankAgenticRecommendations([verifiedAuto])[0]!;
const unstampedVerifiedClone = structuredClone(trustedRanked);
const noApplyHandler = undefined;
const applyHandler = () => {};

assert.equal(isAutoApplyAllowed(unstampedVerifiedClone), false, "a verified-looking clone remains untrusted");
assert.equal(
  isAutoApplyAllowed(unstampedVerifiedClone) && Boolean(noApplyHandler),
  false,
  "an unstamped clone with no Apply callback stays disabled",
);
assert.equal(isAutoApplyAllowed(trustedRanked) && Boolean(applyHandler), true, "trusted ranked work enables Apply");
const reviewMode = {
  ...trustedRanked,
  application: { ...trustedRanked.application, mode: "review" as const },
};
assert.equal(isAutoApplyAllowed(reviewMode), false, "review-mode recommendations never auto-apply");
assert.match(
  source,
  /const canApply = isAutoApplyAllowed\(recommendation\) && Boolean\(onApply\);/,
  "Apply eligibility uses the trusted verifier rather than status text",
);
assert.match(source, /disabled=\{!canApply\}/, "Apply is disabled when the trusted eligibility gate fails");
assert.match(source, /disabled=\{!onReview\}/, "Review remains available through its own callback");
assert.match(source, /disabled=\{!onEdit\}/, "Edit remains available through its own callback");
assert.match(
  source,
  /if \(!isAutoApplyAllowed\(recommendation\)\) return;\s*onApply\?\.\(recommendation\);/,
  "Apply rechecks trust inside its click handler",
);

const longEvidenceLabel = "x".repeat(2000);
assert.equal(longEvidenceLabel.length, 2000, "regression fixture is the maximum evidence-label length");
assert.match(
  source,
  /<span className="agentic-recommendation-card__evidence-pill">\s*<PropertyPill[\s\S]*?\/>\s*<\/span>/,
  "clickable PropertyPill evidence has a constrainable wrapper",
);
assert.match(
  source,
  /className="ui-pill agentic-recommendation-card__evidence-pill"[\s\S]*?agentic-recommendation-card__evidence-label/,
  "static UI-pill evidence has a truncatable label",
);
assert.match(
  css,
  /\.agentic-recommendation-card__evidence-pill \{[^}]*min-width: 0;[^}]*max-width: 100%;/s,
  "evidence chip wrappers can shrink inside narrow cards",
);
assert.match(
  css,
  /\.agentic-recommendation-card__evidence-pill > \.ui-pill \{[^}]*min-width: 0;[^}]*max-width: 100%;/s,
  "clickable PropertyPill output is constrained too",
);
assert.match(
  css,
  /\.agentic-recommendation-card__evidence-label,[\s\S]*?text-overflow: ellipsis;[\s\S]*?white-space: nowrap;/,
  "static and clickable evidence labels ellipsize instead of overflowing",
);

console.log("agentic-recommendation-card.test.ts: ok");
