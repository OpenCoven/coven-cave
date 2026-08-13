// @ts-nocheck
import assert from "node:assert/strict";
import { wireMarkdownLinks } from "./message-dom-wiring.ts";
import { readerOutline } from "../lib/reader-outline.ts";

type ClickHandler = (event: {
  defaultPrevented: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  button: number;
  preventDefault: () => void;
}) => void;

function fakeLink(rawHref: string, href: string) {
  const listeners = new Map<string, ClickHandler>();
  return {
    href,
    getAttribute: (name: string) => (name === "href" ? rawHref : null),
    classList: { contains: () => false },
    addEventListener: (name: string, listener: ClickHandler) => listeners.set(name, listener),
    listener: (name: string) => listeners.get(name),
  };
}

function fakeContainer(...links: ReturnType<typeof fakeLink>[]) {
  return {
    querySelectorAll: () => links,
  } as unknown as HTMLElement;
}

const markdown = "# Goal\n\n[Jump to goal](#goal)";
const [goal] = readerOutline(markdown);
assert.equal(goal?.id, "goal", "the spec reader creates the target heading anchor");

const forwarded: string[] = [];
const headingLink = fakeLink("#goal", "http://localhost/chat#goal");
wireMarkdownLinks(fakeContainer(headingLink), (url) => forwarded.push(url));
assert.equal(
  headingLink.listener("click"),
  undefined,
  "a spec heading fragment keeps native anchor navigation instead of opening the browser pane",
);
assert.deepEqual(forwarded, []);

const externalLink = fakeLink("https://example.com/guide", "https://example.com/guide");
wireMarkdownLinks(fakeContainer(externalLink), (url) => forwarded.push(url));
let prevented = false;
externalLink.listener("click")?.({
  defaultPrevented: false,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  button: 0,
  preventDefault: () => { prevented = true; },
});
assert.equal(prevented, true, "external links remain forwarded");
assert.deepEqual(forwarded, ["https://example.com/guide"]);

console.log("chat-spec-card-fragment-links.test.ts: ok");
