import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SYNC = path.join(ROOT, "scripts", "sync-marketplace.py");

function legacyPlugin(name) {
  return {
    name,
    displayName: name,
    version: "0.1.0",
    description: `${name} component`,
    category: "Research",
    keywords: [name],
    capabilities: [],
    sourceRefs: ["https://github.com/OpenCoven/coven-cave"],
    trust: "official-local",
    skill: {
      description: `${name} component skill`,
      useCases: ["Test component resolution"],
      guardrails: ["Stay inside the test fixture"],
    },
  };
}

function provenance(upstreamPath, hash = "a".repeat(64)) {
  return {
    upstreamPath,
    contentHash: `sha256:${hash}`,
    modifications: ["Normalized frontmatter for Codex plugin packaging."],
  };
}

function validCraft(overrides = {}) {
  const craft = {
    schemaVersion: "opencoven.craft.v1",
    components: {
      required: ["fetch", "filesystem"],
      optional: ["exa"],
    },
    bundled: {
      skills: [
        {
          id: "brainstorming-research-ideas",
          sourcePath: "craft-sources/seekers-lens/brainstorming-research-ideas/SKILL.md",
          ...provenance("21-research-ideation/brainstorming-research-ideas/SKILL.md"),
        },
        {
          id: "creative-thinking-for-research",
          sourcePath: "craft-sources/seekers-lens/creative-thinking-for-research/SKILL.md",
          ...provenance("21-research-ideation/creative-thinking-for-research/SKILL.md", "b".repeat(64)),
        },
      ],
      prompts: [
        {
          id: "open-a-research-space",
          name: "Open a research space",
          description: "Generate and rank bounded research directions.",
          body: "Explore {{topic}} with divergent and convergent research lenses.\r\nUse evidence to rank the candidates.",
        },
      ],
      workflows: [
        {
          id: "diverge-converge-refine",
          name: "Diverge, converge, refine",
          description: "Turn a broad topic into a bounded pilot.",
          steps: ["Generate candidate directions", "Rank with evidence", "Define a pilot"],
        },
      ],
    },
    requiredCapabilities: ["filesystem.read", "network.http", "reasoning.sequential"],
    recommendedRoles: ["researcher", "strategist"],
    provenance: {
      source: "https://github.com/orchestra-research/AI-Research-SKILLs",
      commit: "773a52944ba4747a18bd4ae9ade53fff041adcbc",
      license: "MIT",
      licensePath: "craft-sources/orchestra-research/LICENSE",
    },
    mcpServers: {
      "local-search": { command: "research-search", args: ["--stdio"], type: "stdio" },
    },
    ...overrides,
  };
  return {
    name: "seekers-lens",
    displayName: "Seeker's Lens",
    kind: "craft",
    visibility: "public",
    version: "0.1.0",
    description: "Discovery and ideation for bounded research work.",
    category: "Research Crafts",
    keywords: ["research", "ideation"],
    capabilities: ["research"],
    sourceRefs: ["https://github.com/orchestra-research/AI-Research-SKILLs"],
    trust: "official-local",
    license: "MIT",
    craft,
  };
}

function fixtureCatalog(craft = validCraft(), extra = []) {
  return {
    schemaVersion: "opencoven.marketplace.catalog.v1",
    name: "opencoven-first-party",
    displayName: "OpenCoven First-Party Marketplace",
    description: "test catalog",
    version: "0.1.0",
    generatedBy: "scripts/sync-marketplace.py",
    plugins: [legacyPlugin("fetch"), legacyPlugin("filesystem"), legacyPlugin("exa"), ...extra, craft],
  };
}

function writeFixture(catalog, sourcePaths = true) {
  const dir = mkdtempSync(path.join(tmpdir(), "coven-craft-sync-"));
  const marketplace = path.join(dir, "marketplace");
  mkdirSync(marketplace, { recursive: true });
  const catalogPath = path.join(marketplace, "catalog.json");
  writeFileSync(catalogPath, JSON.stringify(catalog, null, 2) + "\n");
  if (sourcePaths) {
    for (const skill of catalog.plugins.find((p) => p.kind === "craft")?.craft?.bundled?.skills ?? []) {
      const target = path.join(marketplace, skill.sourcePath);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, `---\nname: ${skill.id}\ndescription: Fixture skill.\nlicense: MIT\n---\n\n# ${skill.id}\n`);
    }
    const provenance = catalog.plugins.find((p) => p.kind === "craft")?.craft?.provenance;
    if (provenance?.licensePath) {
      const license = path.join(marketplace, provenance.licensePath);
      mkdirSync(path.dirname(license), { recursive: true });
      writeFileSync(license, "MIT License\n\nCopyright fixture\n");
    }
  }
  return { dir, marketplace, catalogPath };
}

function runSync(fixture, extraArgs = []) {
  return spawnSync(
    "python3",
    [SYNC, "--catalog", fixture.catalogPath, "--marketplace-root", fixture.marketplace, ...extraArgs],
    { cwd: ROOT, encoding: "utf8" },
  );
}

function normalizePathDiagnostics(text) {
  return text.replaceAll("\\", "/");
}

function generatedDigest(root) {
  const out = [];
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (full !== path.join(root, "catalog.json")) {
        const rel = path.relative(root, full).split(path.sep).join("/");
        const hash = createHash("sha256").update(readFileSync(full)).digest("hex");
        out.push(`${rel}:${hash}`);
      }
    }
  }
  walk(root);
  return out;
}

function expectRejected(catalog, pattern, sourcePaths = true) {
  const fixture = writeFixture(catalog, sourcePaths);
  try {
    const result = runSync(fixture);
    assert.notEqual(result.status, 0, `invalid catalog unexpectedly passed: ${result.stdout}`);
    assert.match(result.stderr, pattern);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
}

const fixture = writeFixture(fixtureCatalog());
try {
  const binarySource = path.join(
    fixture.marketplace,
    "craft-sources",
    "seekers-lens",
    "brainstorming-research-ideas",
    "fixture.bin",
  );
  const binaryPayload = Buffer.from([0x00, 0x0d, 0x0a, 0x41]);
  writeFileSync(binarySource, binaryPayload);
  const first = runSync(fixture);
  assert.equal(first.status, 0, first.stderr);

  const pluginRoot = path.join(fixture.marketplace, "plugins", "seekers-lens");
  const manifest = JSON.parse(readFileSync(path.join(pluginRoot, ".codex-plugin", "plugin.json"), "utf8"));
  assert.equal(manifest.name, "seekers-lens");
  assert.equal(manifest.version, "0.1.0");
  assert.equal(manifest.skills, "./skills/");
  assert.equal(manifest.mcpServers, "./.mcp.json");
  assert.ok(Array.isArray(manifest.interface.defaultPrompt));
  assert.equal(manifest.interface.defaultPrompt.length, 1);
  assert.equal(manifest.license, "MIT");

  for (const skill of ["brainstorming-research-ideas", "creative-thinking-for-research"]) {
    assert.match(readFileSync(path.join(pluginRoot, "skills", skill, "SKILL.md"), "utf8"), new RegExp(`name: ${skill}`));
  }
  const generatedPrompt = readFileSync(path.join(pluginRoot, "prompts", "open-a-research-space.md"));
  assert.match(generatedPrompt.toString("utf8"), /Open a research space/);
  assert.ok(
    generatedPrompt.includes(Buffer.from("\nUse evidence to rank the candidates.")),
    "CRLF prompt bodies are emitted with LF",
  );
  assert.equal(generatedPrompt.includes(Buffer.from("\r\n")), false, "generated prompt content uses LF");
  assert.deepEqual(
    JSON.parse(readFileSync(path.join(pluginRoot, "workflows", "diverge-converge-refine.json"), "utf8")).steps,
    ["Generate candidate directions", "Rank with evidence", "Define a pilot"],
  );
  assert.equal(
    JSON.parse(readFileSync(path.join(pluginRoot, ".mcp.json"), "utf8")).mcpServers["local-search"].command,
    "research-search",
  );
  const portableSpec = JSON.parse(readFileSync(path.join(pluginRoot, "assets", "craft.json"), "utf8"));
  assert.equal(portableSpec.schemaVersion, "opencoven.craft.v1");
  assert.equal(portableSpec.provenance.license, "MIT");
  assert.match(readFileSync(path.join(pluginRoot, "assets", "UPSTREAM_LICENSE.txt"), "utf8"), /MIT License/);

  const caveManifest = JSON.parse(readFileSync(path.join(pluginRoot, "plugin.json"), "utf8"));
  assert.equal(caveManifest.kind, "craft");
  assert.deepEqual(caveManifest.craft.components.required, ["fetch", "filesystem"]);

  const marketplace = JSON.parse(readFileSync(path.join(fixture.marketplace, "marketplace.json"), "utf8"));
  const entry = marketplace.plugins.find((p) => p.name === "seekers-lens");
  assert.equal(entry.kind, "craft");
  assert.equal(entry.craft.schemaVersion, "opencoven.craft.v1");
  const codexMarketplace = JSON.parse(readFileSync(path.join(fixture.marketplace, "exports", "codex", "marketplace.json"), "utf8"));
  assert.equal(codexMarketplace.plugins.find((p) => p.name === "seekers-lens").category, "Research Crafts");

  const before = generatedDigest(fixture.marketplace);
  const second = runSync(fixture);
  assert.equal(second.status, 0, second.stderr);
  assert.deepEqual(generatedDigest(fixture.marketplace), before, "generation should be deterministic");

  const crlfMarketplace = path.join(fixture.marketplace, "marketplace.json");
  writeFileSync(
    crlfMarketplace,
    readFileSync(crlfMarketplace, "utf8").replaceAll("\r\n", "\n").replaceAll("\n", "\r\n"),
  );
  const lineEndingCheck = runSync(fixture, ["--check"]);
  assert.equal(lineEndingCheck.status, 0, lineEndingCheck.stderr);

  const binaryOutput = path.join(pluginRoot, "skills", "brainstorming-research-ideas", "fixture.bin");
  assert.deepEqual(readFileSync(binaryOutput), binaryPayload, "bundled byte assets are copied exactly");
  writeFileSync(binaryOutput, Buffer.from([0x00, 0x0a, 0x41]));
  const binaryDrift = runSync(fixture, ["--check"]);
  assert.notEqual(binaryDrift.status, 0);
  assert.match(
    normalizePathDiagnostics(binaryDrift.stderr),
    /stale marketplace\/plugins\/seekers-lens\/skills\/brainstorming-research-ideas\/fixture\.bin/,
  );
  const repairedBinary = runSync(fixture);
  assert.equal(repairedBinary.status, 0, repairedBinary.stderr);
  assert.deepEqual(readFileSync(binaryOutput), binaryPayload, "sync restores bundled byte assets exactly");

  writeFileSync(path.join(pluginRoot, "prompts", "open-a-research-space.md"), "stale\n");
  const stale = runSync(fixture, ["--check"]);
  assert.notEqual(stale.status, 0);
  assert.match(
    normalizePathDiagnostics(stale.stderr),
    /stale marketplace\/plugins\/seekers-lens\/prompts\/open-a-research-space\.md/,
  );
  const repaired = runSync(fixture);
  assert.equal(repaired.status, 0, repaired.stderr);

  const orphan = path.join(pluginRoot, "prompts", "removed-resource.md");
  writeFileSync(orphan, "this resource is no longer declared\n");
  const orphaned = runSync(fixture, ["--check"]);
  assert.notEqual(orphaned.status, 0);
  assert.match(
    normalizePathDiagnostics(orphaned.stderr),
    /unexpected marketplace\/plugins\/seekers-lens\/prompts\/removed-resource\.md/,
  );
  const cleaned = runSync(fixture);
  assert.equal(cleaned.status, 0, cleaned.stderr);
  assert.equal(existsSync(orphan), false, "sync removes undeclared files from fully managed Craft packages");
} finally {
  rmSync(fixture.dir, { recursive: true, force: true });
}

const hiddenFixture = writeFixture(fixtureCatalog({ ...validCraft(), visibility: "hidden" }));
try {
  const hidden = runSync(hiddenFixture);
  assert.equal(hidden.status, 0, hidden.stderr);
  assert.ok(readFileSync(path.join(hiddenFixture.marketplace, "plugins", "seekers-lens", "plugin.json"), "utf8"));
  const browseIds = JSON.parse(readFileSync(path.join(hiddenFixture.marketplace, "marketplace.json"), "utf8")).plugins.map((p) => p.name);
  assert.ok(!browseIds.includes("seekers-lens"), "hidden Crafts must not become generally browsable");
} finally {
  rmSync(hiddenFixture.dir, { recursive: true, force: true });
}

expectRejected(
  fixtureCatalog(validCraft({ ...validCraft().craft, components: { required: ["missing"], optional: [] } })),
  /missing component plugin "missing"/i,
);

const duplicate = validCraft();
duplicate.craft.bundled.prompts[0].id = duplicate.craft.bundled.skills[0].id;
expectRejected(fixtureCatalog(duplicate), /duplicate Craft resource id "brainstorming-research-ideas"/i);

const unsafe = validCraft();
unsafe.craft.bundled.skills[0].sourcePath = "../outside/SKILL.md";
expectRejected(fixtureCatalog(unsafe), /unsafe Craft source path/i, false);

const craftSymlinkFixture = writeFixture(fixtureCatalog());
try {
  const target = path.join(craftSymlinkFixture.marketplace, "outside-secret.md");
  writeFileSync(target, "outside\n");
  const skillRoot = path.join(craftSymlinkFixture.marketplace, "craft-sources", "seekers-lens", "brainstorming-research-ideas");
  try {
    symlinkSync(target, path.join(skillRoot, "leak.md"));
    const result = runSync(craftSymlinkFixture);
    assert.notEqual(result.status, 0, "craft symlink source should be rejected");
    assert.match(result.stderr, /craft skill source contains a symlink/i);
  } catch (error) {
    // Windows developer-mode / elevation policy can forbid ordinary users from
    // creating symlinks. The generator's rejection path runs on platforms that
    // support the fixture; do not turn an unavailable OS capability into a
    // false test failure on native Windows.
    if (error?.code !== "EPERM") throw error;
    console.log("sync-marketplace: skipped symlink fixture (Windows policy)");
  }
} finally {
  rmSync(craftSymlinkFixture.dir, { recursive: true, force: true });
}

const unsupported = validCraft();
unsupported.craft.provenance.license = "GPL-3.0";
expectRejected(fixtureCatalog(unsupported), /unsupported Craft license "GPL-3.0"/i);

const nestedComponent = validCraft();
nestedComponent.name = "nested-craft";
const nested = validCraft({ ...validCraft().craft, components: { required: ["nested-craft"], optional: [] } });
expectRejected(fixtureCatalog(nested, [nestedComponent]), /nested Craft component "nested-craft"/i);

// Production reference Craft: fully generated and, as of the enablement
// slice, publicly browsable and installable alongside the other six
// audited research Crafts.
const productionCatalog = JSON.parse(readFileSync(path.join(ROOT, "marketplace", "catalog.json"), "utf8"));
const productionThreadLab = productionCatalog.plugins.find((plugin) => plugin.name === "tweet-thread-lab");
assert.ok(productionThreadLab, "the production catalog includes Tweet Thread Lab");
assert.equal(productionThreadLab.displayName, "Tweet Thread Lab");
assert.equal(productionThreadLab.trust, "official-local");
assert.deepEqual(productionThreadLab.capabilities, ["read_files", "write_files", "network"]);
assert.equal(productionThreadLab.skill.managed, "manual");

const productionThreadLabRoot = path.join(ROOT, "marketplace", "plugins", "tweet-thread-lab");
const threadLabManifest = JSON.parse(readFileSync(path.join(productionThreadLabRoot, "plugin.json"), "utf8"));
const threadLabCodexManifest = JSON.parse(
  readFileSync(path.join(productionThreadLabRoot, ".codex-plugin", "plugin.json"), "utf8"),
);
assert.equal(threadLabManifest.name, "tweet-thread-lab");
assert.deepEqual(threadLabManifest.capabilities, ["read_files", "write_files", "network"]);
assert.equal(threadLabManifest.skills, "./skills/");
assert.equal(threadLabCodexManifest.name, "tweet-thread-lab");
assert.equal(threadLabCodexManifest.skills, "./skills/");

const productionMemoryRoot = path.join(ROOT, "marketplace", "plugins", "coven-memory");
const memoryManifest = JSON.parse(readFileSync(path.join(productionMemoryRoot, "plugin.json"), "utf8"));
const memoryCodexManifest = JSON.parse(
  readFileSync(path.join(productionMemoryRoot, ".codex-plugin", "plugin.json"), "utf8"),
);
assert.equal(memoryManifest.name, "coven-memory");
assert.equal(memoryManifest.skills, "./skills/");
assert.equal(memoryCodexManifest.skills, "./skills/");

const threadLabSkillRoot = path.join(productionThreadLabRoot, "skills", "tweet-thread-lab");
const threadLabSkill = readFileSync(path.join(threadLabSkillRoot, "SKILL.md"), "utf8");
const threadLabProtocol = readFileSync(path.join(threadLabSkillRoot, "references", "protocol.md"), "utf8");
const threadLabRubric = readFileSync(path.join(threadLabSkillRoot, "references", "rubric.md"), "utf8");
assert.match(threadLabSkill, /^## When to use$/m);
assert.match(threadLabSkill, /^## Inputs$/m);
assert.match(threadLabSkill, /^## Steps$/m);
assert.match(threadLabSkill, /^## Hard gates$/m);
assert.match(threadLabSkill, /^## Artifacts$/m);
assert.match(threadLabSkill, /^## Verification$/m);
assert.match(
  threadLabSkill,
  /node "<validatorPath>" validate <candidate\.json> \[brief\.json\]/i,
);
assert.match(threadLabSkill, /materialize the canonical validation record before the manifest or approval/i);
assert.match(threadLabSkill, /only after the bundled command succeeds may `cave\.output` record/i);
assert.match(threadLabSkill, /loaded `SKILL\.md`.*installed.*validatorPath/i);
assert.match(threadLabSkill, /`tooling\.json`/i);
assert.match(
  threadLabProtocol,
  /"validatorPath": "\/absolute\/installed\/.+\/tweet-thread-lab\/bin\/tweet-thread-validate\.mjs"/i,
);
assert.match(threadLabProtocol, /loaded.*SKILL\.md/i);
assert.match(threadLabProtocol, /validatorPath.*absolute installed/i);
for (const document of [threadLabSkill, threadLabProtocol, threadLabRubric]) {
  assert.doesNotMatch(document, /\.\.\/\.\.\/bin\/tweet-thread-validate\.mjs/i);
  assert.doesNotMatch(document, /node \S*tweet-thread-validate\.mjs validate/i);
}
assert.doesNotMatch(threadLabProtocol, /node bin\/tweet-thread-validate\.mjs validate/i);
assert.match(
  threadLabProtocol,
  /node "<validatorPath>" validate <candidate\.json> \[brief\.json\]/i,
);
assert.match(threadLabProtocol, /blinded scorecard/i);
assert.match(threadLabProtocol, /publicTrialSha256/i);
assert.match(threadLabProtocol, /armToken/i);
assert.match(threadLabProtocol, /reveal.*canonical.*candidateSha256/i);
assert.match(threadLabRubric, /judge.*must not receive.*candidate/i);
for (const document of [threadLabSkill, threadLabProtocol, threadLabRubric]) {
  assert.match(document, /scorecard set commitment/i);
  assert.match(document, /before (?:identity )?reveal|before .*stopping.*unlock/i);
}
for (const document of [threadLabSkill, threadLabProtocol]) {
  assert.match(document, /`strategies\.json`/);
  assert.match(document, /`execution-log\.jsonl`/);
  assert.match(document, /`validations`/);
  assert.match(document, /tweet-thread-validate\.mjs/);
}
assert.ok(
  existsSync(path.join(productionThreadLabRoot, "bin", "tweet-thread-validate.mjs")),
  "the dependency-free validator bundle is shipped with the plugin",
);
assert.doesNotMatch(threadLabSkill, /candidate with its strategy/i);
assert.doesNotMatch(threadLabSkill, /manifest .*exposes failures or partial state/i);
assert.doesNotMatch(
  threadLabProtocol,
  /manifest with every candidate, scorecard, approval, failure, and partial state/i,
);
for (const reference of ["protocol.md", "rubric.md"]) {
  assert.ok(existsSync(path.join(threadLabSkillRoot, "references", reference)), `${reference} is bundled`);
}
for (const schema of [
  "blinded-scorecard-set-commitment.schema.json",
  "thread-brief.schema.json",
  "blinded-thread-scorecard.schema.json",
  "thread-candidate.schema.json",
  "thread-run-manifest.schema.json",
  "thread-scorecard.schema.json",
  "thread-validation-record.schema.json",
]) {
  assert.ok(
    existsSync(path.join(threadLabSkillRoot, "references", "schemas", schema)),
    `${schema} is bundled without drifting from the protocol generator`,
  );
}

const productionSeeker = productionCatalog.plugins.find((plugin) => plugin.name === "seekers-lens");
assert.ok(productionSeeker, "the production catalog includes Seeker's Lens");
assert.equal(productionSeeker.kind, "craft");
assert.equal(productionSeeker.visibility, "public");
assert.deepEqual(productionSeeker.craft.components.required, ["fetch", "filesystem", "memory", "sequential-thinking"]);
assert.deepEqual(productionSeeker.craft.components.optional, ["exa", "tavily", "firecrawl", "searxng", "research-ingestion"]);
assert.deepEqual(
  productionSeeker.craft.bundled.skills.map((skill) => [skill.id, skill.contentHash]),
  [
    ["brainstorming-research-ideas", "sha256:8422a1a6dc0a88d05f02b9fbe0f8c2ae06a77024856d18125efa13d19d855d46"],
    ["creative-thinking-for-research", "sha256:ec111f9236d7f9d72c895cebbf0f534ac93f4249172607559ad4bf92aefc5310"],
  ],
);
assert.equal(productionSeeker.craft.provenance.commit, "773a52944ba4747a18bd4ae9ade53fff041adcbc");
assert.equal(productionSeeker.craft.provenance.license, "MIT");

const productionRoot = path.join(ROOT, "marketplace", "plugins", "seekers-lens");
const productionManifest = JSON.parse(readFileSync(path.join(productionRoot, ".codex-plugin", "plugin.json"), "utf8"));
assert.ok(Array.isArray(productionManifest.interface.defaultPrompt));
assert.equal(productionManifest.skills, "./skills/");
assert.equal(existsSync(path.join(productionRoot, ".mcp.json")), false, "components stay separate plugins; the Craft does not duplicate MCP config");
for (const skill of productionSeeker.craft.bundled.skills) {
  assert.ok(existsSync(path.join(productionRoot, "skills", skill.id, "SKILL.md")), `${skill.id} is bundled`);
}
const productionBrowse = JSON.parse(readFileSync(path.join(ROOT, "marketplace", "marketplace.json"), "utf8"));
assert.ok(productionBrowse.plugins.some((plugin) => plugin.name === "seekers-lens"), "public Crafts are browsable");
assert.ok(productionBrowse.plugins.some((plugin) => plugin.name === "tweet-thread-lab"), "Tweet Thread Lab is browsable");
const productionCodexBrowse = JSON.parse(readFileSync(path.join(ROOT, "marketplace", ".claude-plugin", "marketplace.json"), "utf8"));
const codexSeeker = productionCodexBrowse.plugins.find((plugin) => plugin.name === "seekers-lens");
assert.ok(codexSeeker, "public Crafts are installable through the Codex marketplace export");
assert.equal(codexSeeker.source, "./plugins/seekers-lens", "Codex plugin sources stay inside the registered marketplace root");
// Generated manifests must satisfy the runtime contract in
// src/lib/server/bundled-copilot-plugins.ts (isSkillOnlyManifest): an
// app-bundled plugin loads ONLY when its plugin.json advertises a skills
// directory and carries no agents/hooks/mcpServers. That field was previously
// absent from the generator and hand-edited into the generated file, so a
// routine `sync-marketplace.py` run would have deleted it and silently dropped
// Coven recall from Copilot chats. Pin it on the generated output.
const bundledMemory = JSON.parse(
  readFileSync(path.join(ROOT, "marketplace", "plugins", "coven-memory", "plugin.json"), "utf8"),
);
const bundledSkills = Array.isArray(bundledMemory.skills) ? bundledMemory.skills : [bundledMemory.skills];
assert.ok(
  bundledSkills.length > 0 && bundledSkills.every((entry) => entry === "skills/" || entry === "./skills/"),
  "coven-memory advertises its skills directory, or the app stops loading the bundle",
);
for (const key of ["agents", "hooks", "mcpServers"]) {
  assert.ok(!(key in bundledMemory), `coven-memory stays skill-only (no ${key})`);
}
assert.ok(
  existsSync(path.join(ROOT, "marketplace", "plugins", "coven-memory", "skills", "recall", "SKILL.md")),
  "the advertised directory actually holds the recall skill",
);
// A prompt-only plugin has no skills/ directory, so it must not claim one.
const promptOnly = productionCatalog.plugins.find(
  (plugin) => !plugin.skill && plugin.kind !== "craft" && plugin.kind !== "knowledge-pack",
);
if (promptOnly) {
  const promptManifest = JSON.parse(
    readFileSync(path.join(ROOT, "marketplace", "plugins", promptOnly.name, "plugin.json"), "utf8"),
  );
  assert.ok(!("skills" in promptManifest), `${promptOnly.name} carries no skill, so it advertises no skills directory`);
}

assert.equal(
  productionCodexBrowse.plugins.find((plugin) => plugin.name === "tweet-thread-lab")?.source,
  "./plugins/tweet-thread-lab",
  "Tweet Thread Lab stays inside the registered marketplace root",
);
const productionCheck = spawnSync("python3", [SYNC, "--check"], { cwd: ROOT, encoding: "utf8" });
assert.equal(productionCheck.status, 0, productionCheck.stderr);

console.log("sync-marketplace.test.mjs: ok");
