import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./chat-follow-up-cards.tsx", import.meta.url), "utf8");
const transcriptStyles = await readFile(new URL("../styles/cave-chat/transcript.css", import.meta.url), "utf8");

function cssBlock(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = transcriptStyles.match(new RegExp(`${escaped} \\{([\\s\\S]*?)\\n\\}`, "m"));
  assert.ok(match, `missing CSS block for ${selector}`);
  return match[1];
}

const compactTitleBlock = cssBlock(".cave-chat-followups .cave-followup-card__title");
const compactSeparatorBlock = cssBlock(".cave-chat-followups .cave-followup-card__separator");
const compactRecommendedIndicatorBlock = cssBlock(".cave-chat-followups .cave-followup-card__recommended-indicator");
const followUpMetaBlock = source.match(/function followUpMetaFor\(path: NextPath\): FollowUpMeta \{([\s\S]*?)\n\}/m)?.[1];

assert.ok(followUpMetaBlock, "missing follow-up metadata mapper");

assert.match(source, /role="group"/, "follow-up cards are exposed as a labelled group");
assert.match(source, /aria-label="Suggested next steps"/, "the group names its purpose");
assert.match(source, /<button[\s\S]*?type="button"[\s\S]*?focus-ring/, "each follow-up is a native focusable button");
assert.match(source, /onActivate\(path\)/, "activation is delegated to the owning chat surface");
assert.doesNotMatch(source, /\bsend\(path\.prompt\)/, "cards never send assistant text directly");
assert.doesNotMatch(source, /recommended\?: boolean/, "recommendation is not controlled by a separate prop");
assert.doesNotMatch(source, /recommended = true/, "recommendation is not inferred from default props");
assert.doesNotMatch(source, /index === 0/, "recommendation is never inferred from array position");
assert.match(
  source,
  /const accessibleNameParts = \[\s*`\$\{meta\.typeLabel\}: \$\{path\.label\}\.`,\s*`\$\{meta\.outcome\}\.`,\s*\];\s*if \(path\.recommended\) accessibleNameParts\.push\("Recommended\."\);\s*if \(unavailable\) accessibleNameParts\.push\("No links available to save\."\);\s*const accessibleName = accessibleNameParts\.join\(" "\);/,
  "accessible names include the exact type, full label, outcome, optional recommendation suffix, and a truthful unavailable reason with no double punctuation",
);
assert.match(source, /aria-label=\{accessibleName\}/, "buttons expose the full accessible name");
assert.match(
  source,
  /saveLinkAvailable\?: boolean;/,
  "availability is an optional presentation-only boolean prop, not derived internally",
);
assert.match(
  source,
  /const unavailable = path\.kind === "action" && path\.actionId === "save-link" && saveLinkAvailable === false;/,
  "only the save-link action can ever be unavailable, and only on a truthful false from the caller",
);
assert.doesNotMatch(source, /^import \{ extractLinks/m, "FollowUpCards never imports the link-extraction helper — availability is caller-supplied");
assert.match(source, /aria-disabled=\{unavailable \|\| undefined\}/, "aria-disabled is truthful and omitted (not false) when available");
assert.doesNotMatch(source, /(?<!aria-)\bdisabled=\{unavailable/, "the control must never use native disabled — it stays focusable to announce the reason");
assert.match(source, /paths\.map\(\(path, index\) =>/, "render keys can use the stable source order as a duplicate-only suffix");
assert.match(source, /key=\{`\$\{keyBase\}:\$\{index\}`\}/, "keys append the render index only as a duplicate disambiguator");
assert.match(source, /<strong className="cave-followup-card__title">\{path\.label\}<\/strong>/, "the visual title keeps the full label in the DOM");
assert.match(source, /cave-followup-card--recommended/, "recommended paths receive a dedicated class");
assert.match(source, /Recommended/, "the literal Recommended marker stays in the DOM");
assert.match(source, /cave-followup-card__recommended-indicator/, "recommended cards render a dedicated visible cue in the compact footer");
assert.match(source, /<Icon name="ph:seal-check" width=\{12\} \/>/, "the compact recommendation cue uses the approved subset icon");
assert.match(source, /cave-followup-card__separator/, "follow-up cards keep a visible separator between type and title");
assert.doesNotMatch(source, /\bAction\b/, "generic action labels are replaced with exact path types");
assert.match(
  followUpMetaBlock,
  /if \(path\.kind === "reply"\) \{\s*return \{\s*icon: "ph:chat-circle-dots",\s*typeLabel: "Reply",\s*outcome: "Drafts a reply below",\s*\};\s*\}/,
  "reply follow-ups keep their exact icon, label, and outcome mapping",
);
assert.match(
  followUpMetaBlock,
  /if \(path\.kind === "task"\) \{\s*return \{\s*icon: "ph:check-square",\s*typeLabel: "Task",\s*outcome: "Opens a linked task review",\s*\};\s*\}/,
  "task follow-ups keep their exact icon, label, and outcome mapping",
);
assert.match(
  followUpMetaBlock,
  /if \(path\.actionId === "save-link"\) \{\s*return \{\s*icon: "ph:link-simple",\s*typeLabel: "Save",\s*outcome: "Opens link destinations",\s*\};\s*\}/,
  "save-link follow-ups keep their exact icon, label, and outcome mapping",
);
assert.match(
  followUpMetaBlock,
  /if \(path\.actionId === "open-tasks"\) \{\s*return \{\s*icon: "ph:list-checks",\s*typeLabel: "Tasks",\s*outcome: "Opens Tasks",\s*\};\s*\}/,
  "open-tasks follow-ups keep their exact icon, label, and outcome mapping",
);
assert.match(compactTitleBlock, /overflow: hidden;/, "footer titles can visually truncate");
assert.match(compactTitleBlock, /text-overflow: ellipsis;/, "footer titles keep an ellipsis");
assert.match(compactTitleBlock, /white-space: nowrap;/, "footer titles stay on one line");
assert.match(compactSeparatorBlock, /display: inline;/, "the compact footer renders the type/title separator");
assert.match(compactSeparatorBlock, /color: var\(--text-muted\);/, "the compact footer separator stays visually legible");
assert.match(compactRecommendedIndicatorBlock, /display: inline-flex;/, "compact recommended cards keep a visible cue");
assert.match(compactRecommendedIndicatorBlock, /flex: 0 0 auto;/, "the compact recommendation cue stays compact beside truncated titles");
assert.doesNotMatch(compactRecommendedIndicatorBlock, /position: absolute;|width: 1px;|height: 1px;/, "the compact recommendation cue is never visually hidden");
const compactUnavailableBlock = cssBlock('.cave-chat-followups .cave-followup-card[aria-disabled="true"]');
assert.match(compactUnavailableBlock, /opacity: var\(--opacity-disabled\);/, "the compact footer visually mutes an unavailable card using the shared disabled-opacity token");
assert.match(compactUnavailableBlock, /cursor: not-allowed;/, "the compact footer signals unavailability via cursor, never by removing focusability");
const fullUnavailableBlock = cssBlock('.cave-followup-card[aria-disabled="true"]');
assert.match(fullUnavailableBlock, /opacity: var\(--opacity-disabled\);/, "the full historical card visually mutes an unavailable card using the shared disabled-opacity token");
assert.match(fullUnavailableBlock, /cursor: not-allowed;/, "the full historical card signals unavailability via cursor, never by removing focusability");
assert.match(
  transcriptStyles,
  /\.cave-chat-followups \.cave-followup-card__outcome,[\s\S]*?\.cave-chat-followups \.cave-followup-card__recommended \{[\s\S]*?position: absolute;[\s\S]*?width: 1px;[\s\S]*?height: 1px;/,
  "compact footer cards visually hide only the full recommendation text and outcome metadata while keeping them accessible",
);

console.log("chat-follow-up-cards.test.ts: ok");
