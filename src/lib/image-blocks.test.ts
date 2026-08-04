// @ts-nocheck
// Behavioral tests for image blocks (cave-djuvt) — the `<coven:image>` marker
// protocol behind the chat image carousel.
import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_CAROUSEL_IMAGES,
  imageCarouselKey,
  imageLabel,
  isRenderableImageSrc,
  sliceImageBlocks,
  stripImageMarkers,
  stripIncompleteImageMarker,
} from "./image-blocks.ts";

const PNG = "https://example.com/a.png";
const PNG2 = "https://example.com/b.png";

// ── src allow-list (a security barrier, not a nicety) ────────────────────────

test("src: accepts https, data:image, blob:, and same-origin /api paths", () => {
  assert.ok(isRenderableImageSrc(PNG));
  assert.ok(isRenderableImageSrc("data:image/png;base64,iVBORw0KGgo="));
  assert.ok(isRenderableImageSrc("blob:http://localhost/abc"));
  assert.ok(isRenderableImageSrc("/api/chat/attachment?id=x.png"));
});

test("src: refuses script, file, bare http, protocol-relative, and SVG payloads", () => {
  for (const bad of [
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "http://example.com/a.png",
    "//evil.example.com/a.png",
    "data:text/html;base64,PHNjcmlwdD4=",
    "data:image/svg+xml;base64,PHN2Zz4=",
    "",
    null,
    undefined,
  ]) {
    assert.equal(isRenderableImageSrc(bad), false, `refused: ${String(bad)}`);
  }
});

test("src: control characters can't smuggle a scheme past the prefix checks", () => {
  assert.equal(isRenderableImageSrc("java\nscript:alert(1)"), false);
  assert.equal(isRenderableImageSrc("\u0000https://example.com/a.png"), false);
  assert.equal(isRenderableImageSrc("\nhttps://example.com/a.png"), false);
  assert.equal(isRenderableImageSrc("https://example.com/a.png\t"), false);
  const pieces = sliceImageBlocks(`<coven:image src="\n${PNG}" />`);
  assert.equal(pieces.some((piece) => piece.kind === "carousel"), false);
});

// ── slicing ──────────────────────────────────────────────────────────────────

test("slice: a lone marker becomes a one-image carousel and leaves no raw tag", () => {
  const pieces = sliceImageBlocks(`Here:\n<coven:image src="${PNG}" alt="Home" />\nDone.`);
  const carousels = pieces.filter((p) => p.kind === "carousel");
  assert.equal(carousels.length, 1);
  assert.deepEqual(carousels[0].carousel.images, [{ src: PNG, alt: "Home", caption: undefined }]);
  const text = pieces.filter((p) => p.kind === "text").map((p) => p.text).join("");
  assert.ok(!text.includes("<coven:image"));
  assert.match(text, /Here:/);
  assert.match(text, /Done\./);
});

test("slice: adjacent markers merge into ONE carousel", () => {
  const pieces = sliceImageBlocks(
    `<coven:image src="${PNG}" />\n<coven:image src="${PNG2}" />`,
  );
  const carousels = pieces.filter((p) => p.kind === "carousel");
  assert.equal(carousels.length, 1, "one deck, not two cards");
  assert.deepEqual(carousels[0].carousel.images.map((i) => i.src), [PNG, PNG2]);
});

test("slice: markers separated by real prose stay separate decks", () => {
  const pieces = sliceImageBlocks(
    `<coven:image src="${PNG}" />\n\nSome words in between.\n\n<coven:image src="${PNG2}" />`,
  );
  assert.equal(pieces.filter((p) => p.kind === "carousel").length, 2);
});

test("slice: a shared group id merges across prose, at the first marker's position", () => {
  const pieces = sliceImageBlocks(
    `<coven:image src="${PNG}" group="shots" />\n\nProse.\n\n<coven:image src="${PNG2}" group="shots" />`,
  );
  const carousels = pieces.filter((p) => p.kind === "carousel");
  assert.equal(carousels.length, 1);
  assert.deepEqual(carousels[0].carousel.images.map((i) => i.src), [PNG, PNG2]);
  assert.equal(carousels[0].carousel.group, "shots");
  assert.equal(pieces.indexOf(carousels[0]) < pieces.length - 1, true, "deck mounts before the trailing prose");
  const text = pieces.filter((p) => p.kind === "text").map((p) => p.text).join("");
  assert.match(text, /Prose\./);
});

test("slice: distinct groups stay distinct decks", () => {
  const pieces = sliceImageBlocks(
    `<coven:image src="${PNG}" group="a" />\ntext\n<coven:image src="${PNG2}" group="b" />`,
  );
  assert.equal(pieces.filter((p) => p.kind === "carousel").length, 2);
});

test("slice: adjacent markers in distinct explicit groups stay distinct", () => {
  const pieces = sliceImageBlocks(
    `<coven:image src="${PNG}" group="before" />\n<coven:image src="${PNG2}" group="after" />`,
  );
  const carousels = pieces.filter((p) => p.kind === "carousel");
  assert.equal(carousels.length, 2, "explicit groups must not be welded together by adjacency");
  assert.deepEqual(carousels.map((p) => p.carousel.group), ["before", "after"]);
});

test("slice: duplicate attributes are rejected without leaking a raw marker", () => {
  const pieces = sliceImageBlocks(`<coven:image src="javascript:alert(1)" src="${PNG}" />`);
  assert.equal(pieces.filter((p) => p.kind === "carousel").length, 0);
  assert.ok(!pieces.some((p) => p.kind === "text" && p.text.includes("<coven:image")));
});

test("slice: an unsafe marker is dropped silently and breaks the adjacency run", () => {
  const pieces = sliceImageBlocks(
    `<coven:image src="${PNG}" />\n<coven:image src="javascript:alert(1)" />\n<coven:image src="${PNG2}" />`,
  );
  const carousels = pieces.filter((p) => p.kind === "carousel");
  assert.equal(carousels.length, 2, "the rejected marker must not weld the two decks together");
  const text = pieces.filter((p) => p.kind === "text").map((p) => p.text).join("");
  assert.ok(!text.includes("javascript:"), "an unsafe src never reaches the DOM as text either");
  assert.ok(!text.includes("<coven:image"));
});

test("slice: fenced markers stay literal example text", () => {
  const text = "```\n<coven:image src=\"" + PNG + "\" />\n```";
  const pieces = sliceImageBlocks(text);
  assert.equal(pieces.filter((p) => p.kind === "carousel").length, 0);
  assert.equal(pieces[0].text, text);
});

test("slice: a caption containing '>' does not terminate the marker early", () => {
  const pieces = sliceImageBlocks(`<coven:image src="${PNG}" caption="before -> after" />`);
  const carousel = pieces.find((p) => p.kind === "carousel")?.carousel;
  assert.equal(carousel?.images[0].caption, "before -> after");
});

test("slice: a deck is capped, extra markers are dropped rather than mounted", () => {
  const many = Array.from(
    { length: MAX_CAROUSEL_IMAGES + 5 },
    (_, i) => `<coven:image src="https://example.com/${i}.png" group="g" />`,
  ).join("\n");
  const carousel = sliceImageBlocks(many).find((p) => p.kind === "carousel")?.carousel;
  assert.equal(carousel?.images.length, MAX_CAROUSEL_IMAGES);
});

test("slice: text with no markers returns unchanged", () => {
  const pieces = sliceImageBlocks("just prose");
  assert.deepEqual(pieces, [{ kind: "text", text: "just prose" }]);
});

test("slice: an incomplete terminal marker is dropped without exposing protocol text", () => {
  const pieces = sliceImageBlocks(`Before <coven:image src="${PNG}`);
  assert.deepEqual(pieces, [{ kind: "text", text: "Before " }]);
});

// ── streaming strip ──────────────────────────────────────────────────────────

test("strip: complete markers vanish from the streamed text", () => {
  assert.equal(stripImageMarkers(`a <coven:image src="${PNG}" /> b`), "a  b");
});

test("strip: an unterminated tail hides until the stream completes it", () => {
  assert.equal(stripImageMarkers(`Look: <coven:image src="${PNG}`), "Look: ");
  assert.equal(stripIncompleteImageMarker("Look: <coven:im"), "Look: ");
});

test("strip: a '>' inside a still-open caption does not read as the tag close", () => {
  const partial = `x <coven:image src="${PNG}" caption="a -> b`;
  assert.equal(stripImageMarkers(partial), "x ");
});

test("strip: fenced markers survive the streaming strip", () => {
  const text = "```\n<coven:image src=\"" + PNG + "\" />\n```";
  assert.equal(stripImageMarkers(text), text);
});

// ── labels + keys ────────────────────────────────────────────────────────────

test("label: alt wins, then caption, then a positional fallback", () => {
  assert.equal(imageLabel({ src: PNG, alt: "A", caption: "C" }, 0, 2), "A");
  assert.equal(imageLabel({ src: PNG, caption: "C" }, 0, 2), "C");
  assert.equal(imageLabel({ src: PNG }, 0, 2), "Image 1 of 2");
});

test("key: group decks key by group, ad-hoc decks by their sources", () => {
  assert.equal(imageCarouselKey({ images: [{ src: PNG }], group: "g" }), "group:g");
  assert.equal(imageCarouselKey({ images: [{ src: PNG }, { src: PNG2 }] }), `${PNG}|${PNG2}`);
});
