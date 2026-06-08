// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sanitizerSource = await readFile(new URL("./html-sanitize.ts", import.meta.url), "utf8");
const messageBubbleSource = await readFile(new URL("../components/message-bubble.tsx", import.meta.url), "utf8");
const libraryPreviewSource = await readFile(new URL("../components/library-doc-preview.tsx", import.meta.url), "utf8");

assert.match(
  sanitizerSource,
  /export function sanitizeHtml\(html: string\): string/,
  "shared sanitizer should expose one sanitizer for rendered markdown HTML",
);

assert.match(
  sanitizerSource,
  /querySelectorAll\("\*"\)/,
  "sanitizer should walk generic DOM Elements instead of assuming only HTMLElements",
);

assert.doesNotMatch(
  sanitizerSource,
  /querySelectorAll<HTMLElement>/,
  "sanitizer should not use HTMLElement-only generics because parsed HTML can contain SVG/MathML elements",
);

assert.match(
  sanitizerSource,
  /"xlink:href"/,
  "sanitizer should handle SVG URL-bearing attributes",
);

assert.match(
  sanitizerSource,
  /replace\(\S*\\u0000-\\u001F\\u007F\\s/,
  "sanitizer should normalize whitespace/control characters before URL scheme checks",
);

assert.match(
  messageBubbleSource,
  /import \{ sanitizeHtml \} from "@\/lib\/html-sanitize"/,
  "message markdown should use the shared sanitizer",
);

assert.match(
  libraryPreviewSource,
  /import \{ sanitizeHtml \} from "@\/lib\/html-sanitize"/,
  "library markdown preview should use the shared sanitizer",
);

assert.doesNotMatch(
  messageBubbleSource,
  /function sanitizeHtml/,
  "message markdown should not keep a duplicate inline sanitizer",
);

assert.doesNotMatch(
  libraryPreviewSource,
  /new DOMParser\(\)\.parseFromString\(raw, "text\/html"\)/,
  "library markdown preview should not keep a duplicate inline sanitizer",
);
