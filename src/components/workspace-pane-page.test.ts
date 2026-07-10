import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { WorkspacePanePageProps } from "./workspace-pane-page";

const validReadyProps: WorkspacePanePageProps = {
  instanceId: "pane-ready",
  landmark: "Ready pane",
  children: null,
};
const validLoadingProps: WorkspacePanePageProps = {
  instanceId: "pane-loading",
  landmark: "Loading pane",
  status: "loading",
};
const validUnavailableProps: WorkspacePanePageProps = {
  instanceId: "pane-unavailable",
  landmark: "Unavailable pane",
  unavailable: { reason: "Offline", recoveryLabel: "Reconnect", onRecover: () => undefined },
};

// @ts-expect-error loading is exclusive and cannot carry unavailable recovery state
const invalidLoadingUnavailable: WorkspacePanePageProps = {
  instanceId: "pane-invalid-loading-unavailable",
  landmark: "Invalid pane",
  status: "loading",
  unavailable: { reason: "Offline", recoveryLabel: "Reconnect", onRecover: () => undefined },
};
// @ts-expect-error loading never renders children
const invalidLoadingChildren: WorkspacePanePageProps = {
  instanceId: "pane-invalid-loading-children",
  landmark: "Invalid pane",
  status: "loading",
  children: null,
};
// @ts-expect-error unavailable never renders children
const invalidUnavailableChildren: WorkspacePanePageProps = {
  instanceId: "pane-invalid-unavailable-children",
  landmark: "Invalid pane",
  unavailable: { reason: "Offline", recoveryLabel: "Reconnect", onRecover: () => undefined },
  children: null,
};
// @ts-expect-error ready cannot carry unavailable recovery state
const invalidReadyUnavailable: WorkspacePanePageProps = {
  instanceId: "pane-invalid-ready-unavailable",
  landmark: "Invalid pane",
  status: "ready",
  unavailable: { reason: "Offline", recoveryLabel: "Reconnect", onRecover: () => undefined },
  children: null,
};

void [
  validReadyProps,
  validLoadingProps,
  validUnavailableProps,
  invalidLoadingUnavailable,
  invalidLoadingChildren,
  invalidUnavailableChildren,
  invalidReadyUnavailable,
];

const source = await readFile(new URL("./workspace-pane-page.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

const commonProps = source.match(/type WorkspacePanePageCommonProps = \{([\s\S]*?)\n\};/)?.[1] ?? "";
assert.match(commonProps, /instanceId:\s*string;/, "the public page-root props require an instance identity");
assert.match(commonProps, /landmark:\s*string;/, "the public page-root props require a landmark name");
const readyProps = source.match(/type WorkspacePanePageReadyProps = \{([\s\S]*?)\n\};/)?.[1] ?? "";
assert.match(readyProps, /status\?:\s*"ready";/, "ready status may be omitted");
assert.match(readyProps, /unavailable\?:\s*never;/, "ready pages cannot carry unavailable state");
assert.match(readyProps, /children:\s*ReactNode;/, "ready pages require children");
const loadingProps = source.match(/type WorkspacePanePageLoadingProps = \{([\s\S]*?)\n\};/)?.[1] ?? "";
assert.match(loadingProps, /status:\s*"loading";/, "loading status is explicit");
assert.match(loadingProps, /unavailable\?:\s*never;/, "loading pages cannot carry unavailable state");
assert.match(loadingProps, /children\?:\s*never;/, "loading pages cannot carry children");
const unavailableProps = source.match(/type WorkspacePanePageUnavailableProps = \{([\s\S]*?)\n\};/)?.[1] ?? "";
assert.match(unavailableProps, /status\?:\s*never;/, "unavailable pages cannot carry status");
assert.match(unavailableProps, /unavailable:\s*WorkspacePaneUnavailable;/, "unavailable pages require recovery state");
assert.match(unavailableProps, /children\?:\s*never;/, "unavailable pages cannot carry children");
assert.match(
  source,
  /export type WorkspacePanePageProps = WorkspacePanePageCommonProps &[\s\S]{0,180}WorkspacePanePageReadyProps \| WorkspacePanePageLoadingProps \| WorkspacePanePageUnavailableProps/,
  "the public props are a common identity intersected with exclusive page states",
);
assert.match(
  source,
  /export function WorkspacePanePage\(\{[\s\S]{0,180}status = "ready"/,
  "WorkspacePanePage defaults to the ready state",
);
assert.match(
  source,
  /import \{ workspacePaneErrorMessage, workspacePaneResetKey \} from "@\/lib\/workspace-pane-error";/,
  "the component imports the runtime-tested pane error helpers",
);

assert.match(
  source,
  /<section[\s\S]{0,180}ref=\{paneRef\}[\s\S]{0,120}className="workspace-pane-page"[\s\S]{0,120}data-pane-instance=\{instanceId\}[\s\S]{0,120}aria-label=\{landmark\}[\s\S]{0,80}tabIndex=\{-1\}/,
  "WorkspacePanePage renders a programmatically focusable named section for one pane instance",
);
assert.match(
  source,
  /<WorkspacePaneErrorBoundary[\s\S]{0,120}landmark=\{landmark\}[\s\S]{0,160}resetKey=\{workspacePaneResetKey\(instanceId, landmark\)\}[\s\S]{0,120}recoveryFocusRef=\{paneRef\}\s*>[\s\S]*<\/WorkspacePaneErrorBoundary>/,
  "each page root passes its focus ref and collision-safe reset key to its local boundary",
);

assert.match(
  source,
  /class WorkspacePaneErrorBoundary extends Component</,
  "the pane failure boundary uses React's class-based error-boundary API",
);
assert.match(
  source,
  /static getDerivedStateFromError\(error: unknown\)[\s\S]{0,240}workspacePaneErrorMessage\(error\)/,
  "the boundary catches render errors through the runtime-tested normalizer",
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
assert.match(
  source,
  /componentWillUnmount\(\)[\s\S]{0,120}cancelScheduledFocus\(\)/,
  "the boundary cancels scheduled focus when it unmounts",
);
assert.match(
  source,
  /window\.cancelAnimationFrame\(this\.focusFrame\)[\s\S]{0,420}typeof window === "undefined"[\s\S]{0,180}window\.requestAnimationFrame/,
  "focus scheduling is cancellable and guarded for server rendering",
);
assert.match(
  source,
  /<Button ref=\{this\.retryButtonRef\}[^>]*onClick=\{this\.handleRetry\}[^>]*>Try again<\/Button>/,
  "the shared Retry Button exposes a real focus ref",
);
assert.doesNotMatch(
  source,
  /(?:window\.)?location\.reload|window\.location\s*=/,
  "pane retry never reloads the app or mutates global navigation",
);
assert.doesNotMatch(source, /<button\b/, "pane states use the existing Button primitive, never a hand-rolled button");
assert.doesNotMatch(
  source,
  /(?:__test|testOnly|forTests?|resetForTests?)/i,
  "the page root exposes no test-only methods or hooks",
);
assert.doesNotMatch(
  source,
  /function normalizeThrownValue|JSON\.stringify/,
  "the component does not duplicate error normalization or reset-key serialization",
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
const titleRule = css.match(/\.workspace-pane-page__state-title\s*\{([^}]*)\}/)?.[1] ?? "";
assert.match(titleRule, /font-size:\s*var\(--text-base\)/, "state titles use the shared base text token");
assert.doesNotMatch(titleRule, /font-size:\s*13px/, "state titles do not hardcode type size");
const descriptionRule = [...css.matchAll(/\.workspace-pane-page__state-description\s*\{([^}]*)\}/g)]
  .map((match) => match[1] ?? "")
  .find((rule) => /font-size:/.test(rule)) ?? "";
assert.match(descriptionRule, /font-size:\s*var\(--text-sm\)/, "state descriptions use the shared small text token");
assert.match(descriptionRule, /line-height:\s*var\(--leading-normal\)/, "state descriptions use shared leading");
assert.doesNotMatch(descriptionRule, /font-size:\s*12px|line-height:\s*1\.5/, "state descriptions do not hardcode type metrics");

console.log("workspace-pane-page.test.ts: ok");
