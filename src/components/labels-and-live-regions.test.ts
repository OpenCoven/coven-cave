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

// 4. library-doc-list.tsx search input has an accessible name.
{
  const src = read("library-doc-list.tsx");
  assert.match(
    src,
    /<input[\s\S]*?aria-label="[^"]+"/,
    "library doc-list search input has aria-label",
  );
}

// 5. chat-view.tsx transcript container is a log with aria-live.
{
  const src = read("chat-view.tsx");
  const threadBlock = src.match(/className="cave-chat-thread"[\s\S]{0,200}/)?.[0] ?? "";
  assert.match(threadBlock, /role="log"/, "chat thread has role=log");
  assert.match(threadBlock, /aria-live="polite"/, "chat thread has aria-live=polite");
}

// 6. inbox-toast.tsx root has aria-live + aria-atomic.
{
  const src = read("inbox-toast.tsx");
  assert.match(src, /aria-live="polite"/, "inbox-toast has aria-live=polite");
  assert.match(src, /aria-atomic="true"/, "inbox-toast has aria-atomic=true");
}

console.log("labels-and-live-regions.test.ts OK");
