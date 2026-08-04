import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const renderer = readFileSync(new URL("./marketplace-brand-mark.tsx", import.meta.url), "utf8");
const card = readFileSync(new URL("./marketplace-card.tsx", import.meta.url), "utf8");
const detail = readFileSync(new URL("./marketplace-detail.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../../styles/globals/surface-marketplace.css", import.meta.url), "utf8");

assert.match(renderer, /MARKETPLACE_BRAND_MARKS\[pluginId\] \?\? null/, "lookup fails closed");
assert.match(renderer, /aria-hidden="true"/, "marks are decorative beside the product name");
assert.match(renderer, /focusable="false"/, "inline SVG never enters keyboard focus");
assert.match(renderer, /fill="currentColor"/, "single-path marks follow theme foreground");
assert.match(renderer, /alt=""/, "multicolor images expose no duplicate accessible name");
assert.doesNotMatch(renderer, /dangerouslySetInnerHTML|https?:\/\//, "renderer injects no markup or remote URL");

assert.match(card, /const brandMark = marketplaceBrandMark\(plugin\.id\)/);
assert.match(card, /brandMark \? \([\s\S]{0,240}<MarketplaceBrandMark mark=\{brandMark\} size="card"[\s\S]{0,240}: \([\s\S]{0,160}<Icon name=\{kindIcon\(plugin\.kind\)\}/);
assert.match(detail, /const brandMark = marketplaceBrandMark\(plugin\.id\)/);
assert.match(detail, /brandMark \? \([\s\S]{0,240}<MarketplaceBrandMark mark=\{brandMark\} size="detail"[\s\S]{0,240}: \([\s\S]{0,160}<Icon name=\{kindIcon\(plugin\.kind\)\}/);

assert.match(css, /\.marketplace-brand-mark--card[\s\S]{0,160}var\(--icon-md\)/);
assert.match(css, /\.marketplace-brand-mark--detail[\s\S]{0,160}var\(--icon-lg\)/);
assert.doesNotMatch(css, /\.marketplace-brand-mark[^{]*\{[^}]*#[0-9a-f]{3,8}/i, "brand hooks add no CSS colors");

console.log("marketplace-brand-mark.test.ts: ok");
