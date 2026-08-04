// @ts-nocheck
import assert from "node:assert/strict";
import {
  buildPromptWithAttachments,
  normalizeChatAttachments,
  stripPreviewOnlyAttachmentFields,
  stripPreviewOnlyAttachmentFieldsKeepingImages,
} from "./chat-attachments.ts";

const attachments = normalizeChatAttachments([
  {
    name: "notes.md",
    type: "text/markdown",
    size: 42,
    text: "First line\nSecond line",
  },
  {
    name: "diagram.png",
    type: "image/png",
    size: 128,
  },
  {
    name: "../secret.txt",
    type: "text/plain",
    size: 12,
    text: "hidden",
  },
]);

assert.deepEqual(
  attachments.map((attachment) => attachment.name),
  ["notes.md", "diagram.png", "secret.txt"],
);

const prompt = buildPromptWithAttachments("Please review these.", attachments);

assert.match(prompt, /^Please review these\./);
assert.match(prompt, /Attached files:/);
assert.match(prompt, /1\. notes\.md \(text\/markdown, 42 B\)/);
assert.match(prompt, /```text\nFirst line\nSecond line\n```/);
// Image attachments never render the misleading "(content unavailable)" —
// without a delivered payload they get an explicit not-delivered notice.
assert.match(prompt, /2\. diagram\.png \(image\/png, 128 B\)\n\(image attachment was not delivered — payload missing or over the size limit\)/);
assert.doesNotMatch(prompt, /2\. diagram\.png[^\n]*\n\(content unavailable\)/);
assert.match(prompt, /3\. secret\.txt \(text\/plain, 12 B\)/);

// Board dispatch opts into the by-design metadata-only wording: task cards strip
// image payloads at storage, so their absence isn't a delivery failure.
const boardPrompt = buildPromptWithAttachments("Work the task.", attachments, { imagesMetadataOnly: true });
assert.match(boardPrompt, /2\. diagram\.png \(image\/png, 128 B\)\n\(image attached as metadata only — task cards don't store image content\)/);
assert.doesNotMatch(boardPrompt, /was not delivered/);

const mediaPrompt = buildPromptWithAttachments("Summarize these.", normalizeChatAttachments([
  {
    name: "demo.mp4",
    type: "video/mp4",
    mimeType: "video/mp4",
    size: 1_048_576,
  },
  {
    name: "bundle.zip",
    type: "application/zip",
    mimeType: "application/zip",
    size: 2048,
  },
]));
assert.match(
  mediaPrompt,
  /1\. demo\.mp4 \(video\/mp4, 1\.0 MB\)\n\(video attached as metadata only — frames and audio are not decoded yet\)/,
);
assert.match(
  mediaPrompt,
  /2\. bundle\.zip \(application\/zip, 2\.0 KB\)\n\(file attached as metadata only — text content was not available\)/,
);
assert.doesNotMatch(mediaPrompt, /\(content unavailable\)/);

const attachmentOnly = buildPromptWithAttachments("", [attachments[0]]);
assert.match(attachmentOnly, /^Review the attached file\./);

const [truncated] = normalizeChatAttachments([
  {
    name: "huge.txt",
    type: "text/plain",
    size: 300_000,
    text: "x".repeat(300_000),
  },
]);

assert.equal(truncated.text.length, 64_000);
assert.equal(truncated.truncated, true);

assert.deepEqual(
  stripPreviewOnlyAttachmentFields([
    {
      name: "diagram.png",
      type: "image/png",
      mimeType: "image/png",
      size: 128,
      dataUrl: "data:image/png;base64,abc123",
    },
  ]),
  [
    {
      name: "diagram.png",
      type: "image/png",
      size: 128,
    },
  ],
);

// The send-body variant keeps valid image payloads (so the server can deliver
// them to the harness) but still strips preview fields from non-images.
assert.deepEqual(
  stripPreviewOnlyAttachmentFieldsKeepingImages([
    {
      name: "diagram.png",
      type: "image/png",
      mimeType: "image/png",
      size: 128,
      dataUrl: "data:image/png;base64,aGVsbG8=",
    },
    {
      name: "doc.pdf",
      type: "application/pdf",
      mimeType: "application/pdf",
      size: 64,
      dataUrl: "data:application/pdf;base64,aGVsbG8=",
    },
  ]),
  [
    {
      name: "diagram.png",
      type: "image/png",
      size: 128,
      mimeType: "image/png",
      dataUrl: "data:image/png;base64,aGVsbG8=",
    },
    {
      name: "doc.pdf",
      type: "application/pdf",
      size: 64,
    },
  ],
);

// ── Multi-megabyte image data URLs ───────────────────────────────────────────
//
// `cleanImageDataUrl` used to match one anchored pattern against the WHOLE data
// URL, which put a backtracking regex engine across several million characters
// of base64 inside a single `String.prototype.match`. That threw
// `RangeError: Maximum call stack size exceeded at String.match` on a ~6 MB
// payload — and because it threw inside the scry route's stream `start`, the
// stream ended after its `staged` event with no terminal frame at all.
//
// This is NOT scry-specific. `POST /api/chat/send` runs pasted images through
// `normalizeChatAttachments` on exactly the same strings: `fileToAttachment`
// inlines any image up to MAX_ATTACHMENT_IMAGE_BYTES with no downscale. The
// sizes below are the sizes that path actually produces.
//
// The cap is not the fix and must not become one: a 5 MB photo is a legitimate
// attachment and has to keep working.

/** A data URL whose decoded payload is about `mb` megabytes. */
function bigImageDataUrl(mb, { mime = "image/png", corrupt = false } = {}) {
  const body = "QUJD".repeat(Math.floor((mb * 1024 * 1024) / 3));
  return `data:${mime};base64,${corrupt ? `${body}%` : body}`;
}

for (const mb of [1, 3, 4.9]) {
  const url = bigImageDataUrl(mb);
  const [image] = normalizeChatAttachments([
    { name: "photo.png", type: "image/png", size: mb * 1024 * 1024, dataUrl: url },
  ]);
  assert.equal(
    image.dataUrl,
    url,
    `${mb}MB image must survive normalization (${url.length} chars)`,
  );
  assert.equal(image.mimeType, "image/png");
}

// The same sizes, but malformed — this is the shape that made the old pattern
// backtrack, one frame per character, all the way back to the start.
for (const mb of [1, 3, 4.9]) {
  const url = bigImageDataUrl(mb, { corrupt: true });
  assert.doesNotThrow(
    () => normalizeChatAttachments([{ name: "bad.png", type: "image/png", dataUrl: url }]),
    `a malformed ${mb}MB payload must be rejected, never thrown on`,
  );
  const [rejected] = normalizeChatAttachments([
    { name: "bad.png", type: "image/png", dataUrl: url },
  ]);
  assert.equal(rejected.dataUrl, undefined, "a non-base64 body is dropped, not carried");
}

// Over the cap is still refused, by size and not by accident.
{
  const [oversized] = normalizeChatAttachments([
    { name: "huge.png", type: "image/png", dataUrl: bigImageDataUrl(6) },
  ]);
  assert.equal(oversized.dataUrl, undefined, "an image past the 5MB cap is dropped");
}

// And the whole prompt builder — the exact call the scry route makes — must get
// through a payload of that size without throwing.
{
  const url = bigImageDataUrl(4.9);
  const built = buildPromptWithAttachments(
    "Look at this.",
    normalizeChatAttachments([{ name: "photo.png", type: "image/png", dataUrl: url }]),
    { imagesSupported: true, imageFilePaths: new Map([[0, "/tmp/photo.png"]]) },
  );
  assert.match(built, /\/tmp\/photo\.png/, "the image reaches the harness as a path");
}

// ── The header parse ─────────────────────────────────────────────────────────
// Exactly the acceptance set the old pattern had, kept honest case by case.

const HEADER_CASES = [
  ["data:image/png;base64,aGVsbG8=", "image/png"],
  ["data:image/svg+xml;base64,aGVsbG8=", "image/svg+xml"],
  ["data:IMAGE/PNG;BASE64,aGVsbG8=", "image/png"],
  ["data:image/png;base64,aGVsbG8", "image/png"],
  ["data:image/png;base64,aGVsbG9v", "image/png"],
];
for (const [url, mime] of HEADER_CASES) {
  const [ok] = normalizeChatAttachments([{ name: "a.png", type: "image/png", dataUrl: url }]);
  assert.equal(ok.dataUrl, url, `${url} must be accepted`);
  assert.equal(ok.mimeType, mime, `${url} must report ${mime}`);
}

const REJECT_CASES = [
  "data:application/pdf;base64,aGVsbG8=",
  "data:image/png;base64",
  "data:image/png,aGVsbG8=",
  "data:image/png;base64,",
  "data:image/png;base64,===",
  "data:image/png;base64,aGVsbG8===",
  "data:image/png;base64,aGVsb G8=",
  "https://example.com/a.png",
  `data:image/${"x".repeat(61)};base64,aGVsbG8=`,
];
for (const url of REJECT_CASES) {
  const [bad] = normalizeChatAttachments([{ name: "a.png", type: "image/png", dataUrl: url }]);
  assert.equal(bad.dataUrl, undefined, `${url} must be rejected`);
}

console.log("chat-attachments: large image data URLs ok");

// ── The new parse accepts exactly what the old pattern accepted ──────────────
// Removing a regex is only safe if nothing that used to be a valid attachment
// stops being one. This is that proof, over the shapes that actually differ.

const OLD_PATTERN = /^data:(image\/[a-z0-9.+-]{1,60});base64,([A-Za-z0-9+/]+={0,2})$/i;
const ALPHABET = ["A", "z", "0", "9", "+", "/", "=", "%", " ", ",", ";", "-"];
let compared = 0;
for (const mime of ["image/png", "image/svg+xml", "IMAGE/JPEG", "application/pdf", "image/"]) {
  for (let n = 0; n < 3000; n++) {
    let body = "";
    const length = n % 7;
    for (let i = 0; i < length; i++) {
      body += ALPHABET[(n * 7 + i * 13) % ALPHABET.length];
    }
    const url = `data:${mime};base64,${body}`;
    const old = OLD_PATTERN.exec(url);
    const [now] = normalizeChatAttachments([{ name: "a", type: "image/png", dataUrl: url }]);
    // The old pattern had no size floor of its own; `cleanImageDataUrl` rejects
    // a payload that decodes to zero bytes, then and now. Compare on that basis.
    const oldAccepts = Boolean(old) && Math.floor((old[2].length * 3) / 4)
      - (old[2].endsWith("==") ? 2 : old[2].endsWith("=") ? 1 : 0) > 0;
    assert.equal(
      Boolean(now.dataUrl),
      oldAccepts,
      `acceptance changed for ${JSON.stringify(url)}`,
    );
    if (oldAccepts) assert.equal(now.mimeType, old[1].toLowerCase());
    compared++;
  }
}
assert.ok(compared > 10_000, `compared ${compared} shapes`);

// ── The body must never meet a backtracking pattern ─────────────────────────
// The behaviour above cannot catch a regression here: reintroducing the old
// pattern would still accept the same strings, and only fall over on a payload
// large enough to exhaust the stack in a server's call depth. So this is pinned
// as a source contract, the way other invariants in this repo are.
{
  const source = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("./chat-attachments.ts", import.meta.url), "utf8"),
  );
  const body = source.slice(source.indexOf("export function cleanImageDataUrl"));
  const fn = body.slice(0, body.indexOf("\n}") + 2);
  assert.doesNotMatch(
    fn,
    /\.match\(|\.test\(|\.exec\([^)]*body/,
    "cleanImageDataUrl must not run a pattern over the payload — see the note on IMAGE_DATA_URL_HEADER_RE",
  );
  assert.match(fn, /indexOf\(","\)/, "the header/body split is an indexOf, not a pattern");
  assert.match(fn, /isBase64Body\(body\)/, "the payload is checked by a bounded scan");
  assert.doesNotMatch(
    source,
    /\[A-Za-z0-9\+\/\]\+=\{0,2\}\)\$\/i;/,
    "the old whole-string pattern must not come back as the live one",
  );
}

console.log("chat-attachments: acceptance unchanged across " + compared + " shapes");
