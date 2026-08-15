// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const carousel = readFileSync(new URL("./image-carousel.tsx", import.meta.url), "utf8");

assert.match(
  carousel,
  /className=\{`focus-ring flex aspect-video w-full[^$`]*\boverflow-hidden\b[^$`]*\$\{/,
  "each inline slide establishes a full-width frame that clips overflow",
);
assert.match(
  carousel,
  /className="block h-full w-full object-cover"/,
  "inline carousel images fill the complete slide frame",
);
assert.match(
  carousel,
  /className="rounded-lg object-contain block \[max-height:75vh\]!/,
  "the lightbox preserves an uncropped view of the complete image",
);

console.log("image-carousel-fill.test.ts: all assertions passed");
