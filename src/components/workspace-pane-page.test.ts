// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./workspace-pane-page.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

assert.match(
  source,
  /<section\s+className="workspace-pane-page"\s+data-pane-instance=\{instanceId\}\s+aria-label=\{landmark\}>/,
  "WorkspacePanePage renders a named semantic section for one pane instance",
);
assert.match(
  source,
  /<WorkspacePaneErrorBoundary\s+landmark=\{landmark\}\s+resetKey=\{`\$\{instanceId\}:\$\{landmark\}`\}>[\s\S]*<\/WorkspacePaneErrorBoundary>/,
  "each page root wraps only its own pane content in a resettable boundary",
);

assert.match(
  source,
  /class WorkspacePaneErrorBoundary extends Component</,
  "the pane failure boundary uses React's class-based error-boundary API",
);
assert.match(
  source,
  /static getDerivedStateFromError\(error: unknown\)[\s\S]{0,240}normalizeThrownValue\(error\)/,
  "the boundary catches render errors and safely normalizes unknown thrown values",
);
assert.match(
  source,
  /static getDerivedStateFromProps[\s\S]{0,420}props\.resetKey !== state\.resetKey[\s\S]{0,220}errorMessage: null[\s\S]{0,180}resetKey: props\.resetKey/,
  "changing request identity or landmark clears stale pane-local failure state",
);
assert.match(
  source,
  /handleRetry = \(\) =>[\s\S]{0,260}errorMessage: null[\s\S]{0,140}retryKey: state\.retryKey \+ 1/,
  "retry clears only this boundary and increments the child remount key",
);
assert.match(
  source,
  /<Fragment key=\{this\.state\.retryKey\}>\{this\.props\.children\}<\/Fragment>/,
  "retry remounts only the failed pane children",
);
assert.doesNotMatch(
  source,
  /(?:window\.)?location\.reload|window\.location\s*=/,
  "pane retry never reloads the app or mutates global navigation",
);
assert.match(
  source,
  /role="alert"[\s\S]{0,320}\{this\.props\.landmark\} could not load[\s\S]{0,520}<Button[^>]*onClick=\{this\.handleRetry\}[^>]*>Try again<\/Button>/,
  "the error fallback is an alert that names the landmark and exposes the exact Try again Button",
);

assert.match(
  source,
  /status === "loading" \? \([\s\S]{0,520}<SkeletonRows[\s\S]{0,240}\) : unavailable \? \([\s\S]{0,520}\{landmark\} is unavailable[\s\S]{0,320}\{unavailable\.reason\}[\s\S]{0,420}<Button[^>]*onClick=\{unavailable\.onRecover\}[^>]*>\{unavailable\.recoveryLabel\}<\/Button>[\s\S]{0,260}\) : \(\s*children\s*\)/,
  "loading, unavailable, and ready content are mutually exclusive and use shared primitives",
);
assert.match(
  source,
  /workspace-pane-page__state--loading[\s\S]{0,180}role="status"[\s\S]{0,260}<SkeletonRows/,
  "loading uses SkeletonRows inside the stable page-root state geometry",
);
assert.match(
  source,
  /workspace-pane-page__state--unavailable[\s\S]{0,180}role="status"[\s\S]{0,180}aria-live="polite"/,
  "unavailable content is exposed as a live status",
);

const rootRule = css.match(/\.workspace-pane-page\s*\{([^}]*)\}/)?.[1] ?? "";
for (const [property, value] of [
  ["display", "flex"],
  ["flex", "1 1 auto"],
  ["flex-direction", "column"],
  ["width", "100%"],
  ["height", "100%"],
  ["min-width", "0"],
  ["min-height", "0"],
  ["overflow", "hidden"],
]) {
  assert.match(rootRule, new RegExp(`${property}:\\s*${value.replace("%", "\\%")}`), `.workspace-pane-page sets ${property}: ${value}`);
}
assert.match(
  rootRule,
  /container:\s*workspace-pane\s*\/\s*inline-size/,
  "the page root establishes the workspace-pane inline-size container",
);
assert.match(
  css,
  /\.workspace-pane-page\s*>\s*\*\s*\{[^}]*min-width:\s*0[^}]*min-height:\s*0[^}]*\}/,
  "direct page-root children may shrink in both axes",
);
assert.match(
  css,
  /\.workspace-pane-page__state\s*\{[^}]*flex:\s*1 1 auto[^}]*min-width:\s*0[^}]*min-height:\s*0[^}]*overflow-y:\s*auto[^}]*overflow-x:\s*hidden[^}]*\}/,
  "owned state layouts fill the pane and scroll vertically without widening it",
);
assert.doesNotMatch(
  css,
  /\.workspace-pane-page[^{}]*\{[^}]*overflow-x:\s*(?:auto|scroll)/,
  "the page root and its states never add generic horizontal scrolling",
);
assert.match(
  css,
  /\.workspace-pane-page__state-copy\s*\{[^}]*max-width:/,
  "state copy stays readable instead of spanning the full pane",
);

console.log("workspace-pane-page.test.ts: ok");
