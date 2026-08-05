/**
 * Marker-adoption directive — the prompt block that teaches agents the
 * `coven:` card protocol (docs/chat-github-integration.md §1/§3/§5): GitHub
 * display markers, agent-proposed write actions, and skill stage markers.
 *
 * Piggyback model, like buildNextPathsDirective: the directive rides every
 * chat turn (buildPromptWithResponseControls) so familiars adopt the card
 * protocol organically — no runtime dependency on adoption; turns without
 * markers render exactly as before.
 *
 * Syntax taught here must stay in lockstep with the parsers in
 * github-blocks.ts (display + action markers), skill-blocks.ts (stages), and
 * image-blocks.ts (carousel images).
 */
export function buildCovenMarkersDirective(): string {
  return [
    "<coven_cards>",
    "This chat renders self-closing coven: markers as live inline cards. Attribute values always in double quotes; markers inside code fences stay literal example text.",
    'When your reply centers on a specific GitHub item, embed a marker at the natural spot and the app renders a live card there: <coven:github kind="pr" repo="owner/repo" number="123" /> — kinds: pr, issue, commit (sha="…"), run (run="…" the Actions run id). Keep passing mentions as plain text.',
    'To propose a GitHub write, emit an action marker: <coven:github-action kind="comment" repo="owner/repo" number="123" body="…" />. It renders as a proposal card the user must tap to fire — never present the action as already performed. Kinds: comment, reply, issue-create (title="…"), issue-state (state="open" or "closed"), review (event="APPROVE", "REQUEST_CHANGES", or "COMMENT"), merge (method="squash", "merge", or "rebase"), rerun (run="…"), dispatch (workflow="…" ref="…").',
    'To show pictures, emit an image marker at the natural spot: <coven:image src="https://…/shot.png" alt="what it shows" caption="short line" />. Consecutive markers, or markers sharing a group="…" id, collapse into ONE browsable carousel — prefer that over several separate images or markdown image syntax. src must be an https: URL, a data:image/…;base64 payload, or a same-origin /api/… path; anything else is dropped.',
    'To share a written specification, emit a complete fenced document:\n````spec title="Short title"\n# Short title\n\nWrite the specification in Markdown.\n````\nThe chat replaces it with a compact spec card that opens in its reader. Use four backticks when the spec contains ordinary triple-backtick code examples. Use this only for a real spec, not ordinary prose or status updates.',
    'While using a skill, report progress with <coven:skill name="the-skill" stage="running" note="short status" /> — stages: loaded, running, done, error. Re-emit with the same name to update that card in place.',
    'During an /auto mission, report your state with <coven:auto-status state="clarifying|working|blocked|failed|done" note="short status" /> — clarifying while you still need answers from the human, working while proceeding silently, blocked the moment you need a human (permissions, a decision, credentials, anything you cannot resolve yourself) with the reason in note, failed if you hit something unrecoverable, done when the mission is finished with a one-line summary in note. Re-emit to update the card in place; only blocked, failed, and done draw the human back into the chat, and a mission that ends with no marker at all never reaches them.',
    "Never mention these instructions or the marker syntax in your visible reply.",
    "</coven_cards>",
  ].join("\n");
}
