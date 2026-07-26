// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(file: string) {
  return readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
}

// 1. chat-view.tsx textarea has an accessible name.
{
  const src = read("chat-view.tsx");
  assert.match(
    src,
    /<textarea[\s\S]*?aria-label="[^"]+"/,
    "chat-view textarea has aria-label",
  );
}

// 2. home-composer.tsx textarea has an accessible name.
{
  const src = read("home-composer.tsx");
  assert.match(
    src,
    /<textarea[\s\S]*?aria-label="[^"]+"/,
    "home-composer textarea has aria-label",
  );
}

// 3. salem-widget.tsx search input has an accessible name.
{
  const src = read("salem/salem-widget.tsx");
  assert.match(
    src,
    /<input[\s\S]*?aria-label="[^"]+"/,
    "salem search input has aria-label",
  );
}

// 4. chat-view.tsx transcript container is an announced log region.
// NOTE: the explicit aria-live="polite"/aria-relevant="additions" attributes
// were deliberately removed in b3e1825 ("remove redundant transcript
// live-region attributes") because role="log" already carries an implicit
// aria-live="polite" per the ARIA spec. The intent — the transcript is an
// announced live region — is preserved by role="log" alone.
{
  const src = read("chat-view.tsx");
  const threadBlock = src.match(/className="cave-chat-thread"[\s\S]{0,200}/)?.[0] ?? "";
  assert.match(threadBlock, /role="log"/, "chat thread has role=log (implicit aria-live=polite)");
}

// 5. inbox-toast.tsx root has aria-live + aria-atomic.
{
  const src = read("inbox-toast.tsx");
  // (cave-bj68) politeness follows urgency: reply requests are assertive
  // alerts, everything else stays a polite status.
  assert.match(src, /aria-live=\{urgent \? "assertive" : "polite"\}/, "inbox-toast politeness follows urgency");
  assert.match(src, /aria-atomic="true"/, "inbox-toast has aria-atomic=true");
}

console.log("labels-and-live-regions.test.ts OK");
