// @ts-nocheck
// Route inventory (issue #3283, cave-m4ih.5): every page route must carry a
// declared IA classification, mirroring how api-contracts.test.ts governs API
// routes. Adding a page.tsx without classifying it here fails the suite, so
// the route surface can only grow deliberately. The classifications also
// carry teeth: redirect stubs must actually redirect into the canonical
// /dashboard tree, and dev-only pages must stay out of every navigation host.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const appDir = fileURLToPath(new URL(".", import.meta.url));

// kinds:
//   workspace   — the single-page workspace shell (all WorkspaceMode surfaces)
//   destination — a real standalone page with an IA slot (breadcrumb back to /,
//                 or linked from the workspace/dashboard)
//   redirect    — compatibility stub that forwards into a canonical route;
//                 kept so old deep links never 404
//   window-host — not navigation: a route loaded by a dedicated native window
//   dev-only    — design/review reference pages; never linked from nav hosts
const ROUTE_INVENTORY = {
  "/": { kind: "workspace" },
  "/dashboard": { kind: "destination" },
  "/dashboard/familiars/growth": { kind: "destination" },
  "/dashboard/familiars/[id]/analytics": { kind: "destination" },
  "/dashboard/familiars/[id]/profile": { kind: "destination" },
  "/settings": { kind: "destination" },
  "/weaves": { kind: "destination" },
  "/proposals": { kind: "destination" },
  "/profile": { kind: "destination" },
  "/daily-report/[date]": { kind: "destination" },
  "/quick-chat": { kind: "window-host" },
  "/retro": { kind: "redirect", target: "/dashboard/familiars/growth" },
  "/dashboard/retro": { kind: "redirect", target: "/dashboard/familiars/growth" },
  "/familiars/growth": { kind: "redirect", target: "/dashboard/familiars/growth" },
  "/familiars/[id]/analytics": { kind: "redirect", target: "/dashboard/familiars/", leaf: "/analytics" },
  "/familiars/[id]/profile": { kind: "redirect", target: "/dashboard/familiars/", leaf: "/profile" },
  "/aesthetic": { kind: "dev-only" },
  "/mockup": { kind: "dev-only" },
  "/mockup/familiar-chatout-codex": { kind: "dev-only" },
  "/preview/fonts": { kind: "dev-only" },
};

// ── Discover every page.tsx under src/app ────────────────────────────────────
function discoverRoutes(dir, prefix = "") {
  const routes = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      // Route groups "(group)" and parallel routes "@slot" don't add segments,
      // but this app uses neither — treat them as plain segments if they appear
      // so they surface in the inventory diff and force a classification call.
      routes.push(...discoverRoutes(path.join(dir, entry.name), `${prefix}/${entry.name}`));
    } else if (entry.name === "page.tsx" || entry.name === "page.ts") {
      routes.push(prefix === "" ? "/" : prefix);
    }
  }
  return routes;
}

const discovered = discoverRoutes(appDir).sort();
const declared = Object.keys(ROUTE_INVENTORY).sort();

for (const route of discovered) {
  assert.ok(
    ROUTE_INVENTORY[route],
    `new page route "${route}" must be classified in ROUTE_INVENTORY (workspace / destination / redirect / window-host / dev-only) — see issue #3283`,
  );
}
for (const route of declared) {
  assert.ok(
    discovered.includes(route),
    `ROUTE_INVENTORY declares "${route}" but no page file exists — remove the stale entry`,
  );
}

// ── Redirect stubs actually redirect, into their declared canonical target ───
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

for (const [route, spec] of Object.entries(ROUTE_INVENTORY)) {
  if (spec.kind !== "redirect") continue;
  const file = path.join(appDir, route.replace(/^\//, ""), "page.tsx");
  const source = readFileSync(file, "utf8");
  const executableSource = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.match(
    executableSource,
    /import \{ redirect \} from "next\/navigation"/,
    `${route} must import next/navigation's redirect`,
  );
  const leafPattern = spec.leaf ? `[^\\r\\n]*${escapeRegExp(spec.leaf)}[^\\r\\n]*` : "";
  const redirectPattern = new RegExp(
    `^\\s*redirect\\(\\s*(["'\\\`])${escapeRegExp(spec.target)}${leafPattern}\\1\\s*\\);?`,
    "m",
  );
  assert.match(
    executableSource,
    redirectPattern,
    `${route} must redirect into ${spec.target}${spec.leaf ?? ""}…`,
  );
  assert.doesNotMatch(source, /return \(|return </, `${route} is a pure stub — it must not render JSX of its own`);
}

// ── Destination pages carry the standalone left side-panel ───────────────────
// Destination routes render outside the SPA workspace (which owns
// SidebarMinimal), so without a shell they'd have no nav at all — the exact
// "dashboard has no sidepanel" gap (cave-4i6u). Every destination page must
// mount AnalyticsPageShell, the standalone rail with ?mode= deep links back
// into the SPA. Window-hosts (overlay windows) and dev-only pages stay bare.
for (const [route, spec] of Object.entries(ROUTE_INVENTORY)) {
  if (spec.kind !== "destination") continue;
  const file = path.join(appDir, route.replace(/^\//, ""), "page.tsx");
  const source = readFileSync(file, "utf8");
  assert.ok(
    source.includes("AnalyticsPageShell"),
    `${route} is a destination route — it must mount AnalyticsPageShell so the left side-panel is present on every page (cave-4i6u)`,
  );
}

// ── Dev-only pages stay out of every navigation host ─────────────────────────
const componentsDir = new URL("../components/", import.meta.url);
const navHosts = [
  ["sidebar-minimal.tsx", componentsDir],
  ["mobile-bottom-tabs.tsx", componentsDir],
  ["command-palette.tsx", componentsDir],
  ["sidebar-footer.tsx", componentsDir],
  ["workspace.tsx", componentsDir],
  ["keyboard-shortcuts.ts", new URL("../lib/", import.meta.url)],
];
const devOnlyRoutes = Object.entries(ROUTE_INVENTORY)
  .filter(([, spec]) => spec.kind === "dev-only")
  .map(([route]) => route);
for (const [file, base] of navHosts) {
  const source = readFileSync(new URL(file, base), "utf8");
  for (const route of devOnlyRoutes) {
    assert.ok(
      !source.includes(`"${route}"`) && !source.includes(`'${route}'`) && !source.includes(`\`${route}\``),
      `${file} must not link the dev-only route ${route}`,
    );
  }
}

console.log(`route-inventory: ${discovered.length} routes classified`);
