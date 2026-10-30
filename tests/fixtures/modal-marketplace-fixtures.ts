import type { MarketplacePlugin } from "@/lib/marketplace-catalog";
import type { KnowledgePackManifest } from "@/lib/knowledge-pack-types";
import type { SkillBrowserEntry } from "@/lib/skill-directory";
import type { CraftInstallPlan } from "@/lib/server/craft-install";

export const modalMarketplacePlugin = {
  id: "fixture-review",
  displayName: "Project planning and dependency review",
  description: "Review the project plan, preserve authored decisions, and record unresolved dependencies with a concrete next action.",
  category: "Review",
  author: "Fixture",
  trust: "reference-local",
  policy: { installation: "AVAILABLE", authentication: "NONE" },
  capabilities: ["network.http"],
  keywords: ["review", "planning"],
  roleAffinity: [],
  kind: "skill",
  version: "0.1.0",
  installed: false,
  updateAvailable: false,
  requiresSetup: false,
  available: true,
  requiredConfig: [],
  configured: false,
} satisfies MarketplacePlugin;

export const modalKnowledgePack = {
  schemaVersion: "opencoven.knowledge-pack.v1",
  id: "fixture-review",
  displayName: "Project planning and dependency review",
  description: modalMarketplacePlugin.description,
  version: "0.1.0",
  defaultRoot: "review",
  folders: Array.from({ length: 8 }, (_, index) => ({
    id: `review-${index}`,
    name: `Project review ${index + 1}`,
    description: "Record evidence, unresolved dependencies and the next action.",
    entityType: "review",
    fields: [{ key: "status", label: "Status", options: ["pending", "reviewed"] }],
    templates: [`review-${index}`],
  })),
  templates: Array.from({ length: 8 }, (_, index) => ({
    id: `review-${index}`,
    folder: `review-${index}`,
    name: `Project review ${index + 1}`,
    description: "Record evidence and the next action.",
    path: `templates/review-${index}.md`,
  })),
  skills: ["fixture-review"],
  prompts: ["review-project"],
  workflows: ["review-dependencies"],
} satisfies KnowledgePackManifest;

export const modalSkill = {
  id: "fixture-review",
  name: "Project planning and dependency review",
  description: modalMarketplacePlugin.description,
  version: "0.1.0",
  source: "local",
  local: { installed: true, path: "/fixture/review/SKILL.md", scope: "coven" },
  tags: ["review", "planning"],
} satisfies SkillBrowserEntry;

export const modalCraftPlan = {
  id: "fixture-review",
  displayName: modalMarketplacePlugin.displayName,
  description: modalMarketplacePlugin.description,
  version: "0.1.0",
  installTarget: "fixture-review@opencoven-first-party",
  commands: {
    marketplaceCheck: ["codex", "plugin", "marketplace", "list", "--json"],
    install: ["codex", "plugin", "add", "fixture-review@opencoven-first-party", "--json"],
    verify: ["codex", "plugin", "list", "--json"],
    uninstall: ["codex", "plugin", "remove", "fixture-review@opencoven-first-party", "--json"],
  },
  components: { required: [], optionalEnhancements: [] },
  bundled: { skills: ["fixture-review"], prompts: ["review-project"], workflows: ["review-dependencies"] },
  requiredCapabilities: ["network.http"],
  recommendedRoles: ["reviewer"],
  provenance: { source: "https://example.test/review", commit: "0".repeat(40), license: "MIT", licensePath: "LICENSE", resources: [] },
  runtime: { id: "codex", marketplace: "opencoven-first-party", scope: "user", disclosure: "Synthetic preview. No installation runs in this fixture." },
} satisfies CraftInstallPlan;

export function modalMarketplaceResponse(path: string): Record<string, unknown> | null {
  if (path === "/api/roles") return { ok: true, roles: [] };
  if (path === "/api/harnesses") return { ok: true, harnesses: [{ id: "codex", installed: true }] };
  if (path === "/api/marketplace/crafts/plan") return { ok: true, plan: modalCraftPlan };
  if (path === "/api/knowledge/packs") return { ok: true, packs: [modalKnowledgePack] };
  if (path === "/api/skills/file") return { ok: true, text: "# Project review\n\n" + "## Dependencies\n\nPreserve authored decisions and record the next action.\n\n".repeat(20) };
  if (path === "/api/marketplace/config") return {
    ok: true,
    fields: [{ key: "endpoint", env: "FIXTURE_REVIEW_ENDPOINT", title: "Review endpoint", description: "Synthetic configuration; no request reaches this address.", sensitive: false, default: "https://example.test/review", validatable: false, satisfied: false, source: "none", ref: null }],
  };
  return null;
}
