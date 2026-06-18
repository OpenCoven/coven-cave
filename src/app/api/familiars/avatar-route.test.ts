// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./[id]/avatar/route.ts", import.meta.url), "utf8");
const listSource = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

assert.match(
  source,
  /\.png\(\{ compressionLevel: 9, adaptiveFiltering: true \}\)/,
  "Raster familiar avatars should be encoded as PNG for desktop WebView compatibility",
);
assert.match(
  source,
  /contentType: "image\/png"/,
  "Raster familiar avatars should be served with an image/png content type",
);
assert.doesNotMatch(
  source,
  /\.webp\(/,
  "Raster familiar avatars should not be encoded as WebP because desktop WebViews can lack the codec",
);
assert.doesNotMatch(
  source,
  /contentType: "image\/webp"/,
  "Raster familiar avatars should not be served as image/webp",
);
assert.match(
  listSource,
  /avatar\?v=\$\{Math\.round\(avatar\.mtimeMs\)\}&format=png/,
  "Familiar avatar URLs should include the renderer format so old cached WebP responses are bypassed",
);

console.log("avatar-route.test.ts: ok");
