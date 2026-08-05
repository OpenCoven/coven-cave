// @ts-nocheck
// Pins the global Home | Build section switcher (cave-24d2r): both siderail
// hosts mount it, the tabs carry real tab semantics, and the shell derives the
// section from the active surface rather than storing a second source of truth.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import cssContract from "../../scripts/css-source-contract.cjs";

const { readEffectiveCssSync } = cssContract;

function read(relativePath) {
  try {
    return readFileSync(new URL(relativePath, import.meta.url), "utf8");
  } catch {
    return "";
  }
}

const tabs = read("./nav-section-tabs.tsx");
const sidebar = read("./sidebar-minimal.tsx");
const chatSidebar = read("./workspace-sidebar.tsx");
const workspace = read("./workspace.tsx");
const styles = read("../styles/sidebar-minimal/section-tabs.css");
const minimalHostStyles = read("../styles/sidebar-minimal/shell-chrome.css");
const railStyles = read("../styles/sidebar-minimal/activity-rail.css");
const shellStyles = read("../styles/globals/shell-navigation.css");
const globalStyleEntry = new URL("../app/globals.css", import.meta.url);

function ruleBody(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`));
  assert.ok(match, `expected a CSS rule for ${selector}`);
  return match[1];
}

function splitSelectors(selectorList) {
  const selectors = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < selectorList.length; index += 1) {
    const character = selectorList[index];
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (character === "," && depth === 0) {
      selectors.push(selectorList.slice(start, index).trim());
      start = index + 1;
    }
  }
  selectors.push(selectorList.slice(start).trim());
  return selectors;
}

function targetsSidebarMinimal(selector) {
  const hostMatches = [...selector.matchAll(/\.sidebar-minimal(?![-_a-zA-Z0-9])/g)];
  const hostMatch = hostMatches.at(-1);
  if (!hostMatch || hostMatch.index == null) return false;

  const suffix = selector.slice(hostMatch.index + hostMatch[0].length);
  let depth = 0;
  for (const character of suffix) {
    if (character === "(") depth += 1;
    else if (character === ")") depth -= 1;
    else if (depth === 0 && /[\s>+~]/.test(character)) return false;
  }
  return true;
}

function topPaddingValue(property, value) {
  if (property === "padding-top" || property === "padding-block-start") return value.trim();

  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "(") depth += 1;
    else if (character === ")") depth -= 1;
    else if (depth === 0 && /\s/.test(character)) return value.slice(0, index);
  }
  return value.trim();
}

function sidebarTopPaddingDeclarations(source) {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const declarations = [];
  for (const match of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = splitSelectors(match[1]);
    if (!selectors.some(targetsSidebarMinimal)) continue;

    for (const declaration of match[2].matchAll(
      /(?:^|;)\s*(padding|padding-top|padding-block|padding-block-start)\s*:\s*([^;!]+)(?:\s*!important)?/g,
    )) {
      declarations.push({
        selectors: selectors.filter(targetsSidebarMinimal),
        property: declaration[1],
        value: declaration[2].trim(),
        topValue: topPaddingValue(declaration[1], declaration[2]),
      });
    }
  }
  return declarations;
}

assert.match(tabs, /role="tablist"/, "the switcher is a tablist, not a second row of destinations");
assert.match(tabs, /role="tab"/, "each section renders as a tab");
assert.match(tabs, /aria-selected=\{active\}/, "the open section is announced as selected");
assert.match(tabs, /tabIndex=\{active \? 0 : -1\}/, "the switcher is one tab stop with roving focus");
assert.match(tabs, /ArrowLeft|ArrowRight/, "arrow keys move between sections");
assert.match(tabs, /focus-ring/, "tabs carry the shared focus ring");

assert.match(sidebar, /role="tabpanel"/, "the destination list is the switcher's panel");
assert.match(
  sidebar,
  /navItemsForSection\(section\)/,
  "the destination rows are filtered to the open section",
);
const homeTabsIndex = sidebar.indexOf(
  "<NavSectionTabs section={section} onSectionChange={onSectionChange}",
);
const homeFamiliarIndex = sidebar.indexOf(
  '<div className="sidebar-familiar-switch">',
);
const homeBrandIndex = sidebar.indexOf(
  '<div className="sidebar-brand-mark" aria-hidden="true">',
);
assert.ok(homeTabsIndex >= 0, "the Home rail hosts the shared switcher");
assert.ok(
  homeTabsIndex < homeFamiliarIndex,
  "the Home / Build switcher is the first Home rail control",
);
assert.ok(homeBrandIndex >= 0, "the collapsed Home rail keeps the decorative app brand");
assert.ok(
  homeTabsIndex < homeBrandIndex && homeBrandIndex < homeFamiliarIndex,
  "the decorative brand follows the fixed switcher without preceding room controls",
);
assert.match(
  sidebar,
  /section === "code" \? \(\s*<RecentActivityRollup/,
  "the session list belongs to the Build section",
);

const buildTabsIndex = chatSidebar.indexOf(
  '<NavSectionTabs section="code" onSectionChange={onSectionChange}',
);
const buildHeaderIndex = chatSidebar.indexOf('<header className="cnav__header">');
assert.ok(buildTabsIndex >= 0, "the Build rail hosts the shared switcher");
assert.ok(
  buildTabsIndex < buildHeaderIndex,
  "the Home / Build switcher is the first Build rail control",
);

assert.match(workspace, /const navSection = navSectionForMode\(mode\)/, "the shell derives the section from the surface");
assert.match(
  workspace,
  /setMode\(next === "code" \? "chat" : "home"\)/,
  "switching sections lands on that room's surface so rail and content agree",
);

assert.match(styles, /\.nav-sections\b/, "the switcher ships its own tokenized styles");
assert.match(
  styles,
  /color-mix\(in oklch, var\(--accent-presence\) 14%, transparent\)/,
  "the active tint derives from one solid token per the state-tint recipe",
);
assert.match(styles, /prefers-reduced-motion/, "the transition has a reduced-motion story");
assert.doesNotMatch(styles, /#[0-9a-fA-F]{3,8}\b/, "no hardcoded colors in the switcher styles");

assert.match(
  ruleBody(minimalHostStyles, ".sidebar-minimal"),
  /padding:\s*0 6px 10px/,
  "the expanded Home host is flush with the shared shell inset",
);
assert.match(
  ruleBody(railStyles, ".shell-nav--rail .sidebar-minimal"),
  /padding:\s*0(?:\s+0)?/,
  "the collapsed Home host keeps the same zero top inset",
);
const collapsedBrandRule = ruleBody(railStyles, ".shell-nav--rail .sidebar-brand-mark");
assert.match(collapsedBrandRule, /display:\s*grid/, "the collapsed Home rail shows the app brand");
assert.match(
  collapsedBrandRule,
  /pointer-events:\s*none/,
  "the decorative app brand cannot intercept the switcher or its focus ring",
);
assert.doesNotMatch(
  railStyles,
  /\.shell-nav--rail\s+\.sidebar-minimal:has\(\.nav-sections\)\s+\.sidebar-brand-mark\s*\{[^}]*display:\s*none/,
  "mounting the shared switcher must not hide collapsed Home branding",
);
assert.doesNotMatch(
  ruleBody(shellStyles, ".cnav"),
  /\bpadding(?:-top|-block-start)?\s*:/,
  "the Build host remains flush with the shared shell inset",
);

const effectiveGlobalStyles = readEffectiveCssSync(globalStyleEntry, "utf8");
assert.match(
  effectiveGlobalStyles,
  /\.document-reader\s*\{/,
  "the regression traverses through the final stylesheet imported by the app entrypoint",
);
assert.deepEqual(
  sidebarTopPaddingDeclarations(".sidebar-minimal .child { padding-top: var(--space-2); }"),
  [],
  "descendant padding is not a Home host padding regression",
);
assert.deepEqual(
  sidebarTopPaddingDeclarations(`
    @media (max-height: 760px) {
      .sidebar-minimal { padding: var(--space-2) 0 0; }
      .shell-nav--rail .sidebar-minimal:hover { padding-top: 8px; }
    }
  `).map(({ property, topValue }) => ({ property, topValue })),
  [
    { property: "padding", topValue: "var(--space-2)" },
    { property: "padding-top", topValue: "8px" },
  ],
  "media-query shorthand and longhand padding on the exact Home host are detected",
);
const sidebarTopPadding = sidebarTopPaddingDeclarations(effectiveGlobalStyles);
assert.ok(sidebarTopPadding.length > 0, "the regression scans effective app-wide Home host padding rules");
for (const declaration of sidebarTopPadding) {
  assert.match(
    declaration.topValue,
    /^0(?:[a-z%]+)?$/i,
    `${declaration.selectors.join(", ")} must keep zero top padding; found ${declaration.property}: ${declaration.value}`,
  );
}
