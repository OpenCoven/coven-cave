// @ts-nocheck
import assert from "node:assert/strict";

import {
  matchDirectoryEntry,
  mergeDirectoryWithLocal,
  parseSkillsShDirectoryHtml,
  parseSkillsShSearchResponse,
  remoteSkillMarkdownUrl,
  remoteSkillMarkdownUrls,
} from "@/lib/server/skills-directory";

const escapedHtml = String.raw`<script>self.__next_f.push([1,"{\"skills\":[{\"source\":\"vercel-labs/skills\",\"skillId\":\"find-skills\",\"name\":\"find-skills\",\"installs\":2300000,\"weeklyInstalls\":[1,2,3,4,5,6,7,8],\"isOfficial\":true},{\"source\":\"anthropics/skills\",\"skillId\":\"frontend-design\",\"name\":\"frontend-design\",\"installs\":624300,\"weeklyInstalls\":[10,11]}],\"totalSkills\":9631}"])</script>`;
const escaped = parseSkillsShDirectoryHtml(escapedHtml);

assert.equal(escaped.length, 2, "parses escaped Next flight skills array");
assert.deepEqual(
  {
    id: escaped[0].id,
    slug: escaped[0].slug,
    name: escaped[0].name,
    owner: escaped[0].owner,
    repo: escaped[0].repo,
    installsAllTime: escaped[0].installsAllTime,
    weeklyInstalls: escaped[0].weeklyInstalls,
    trendScore: escaped[0].trendScore,
    hotScore: escaped[0].hotScore,
    official: escaped[0].trust.official,
    registryUrl: escaped[0].registryUrl,
    sourceUrl: escaped[0].sourceUrl,
  },
  {
    id: "find-skills",
    slug: "vercel-labs/skills/find-skills",
    name: "find-skills",
    owner: "vercel-labs",
    repo: "skills",
    installsAllTime: 2300000,
    weeklyInstalls: [1, 2, 3, 4, 5, 6, 7, 8],
    trendScore: 36,
    hotScore: 8,
    official: true,
    registryUrl: "https://www.skills.sh/vercel-labs/skills/find-skills",
    sourceUrl: "https://github.com/vercel-labs/skills",
  },
  "normalizes skills.sh rows into Cave directory entries",
);
assert.ok(escaped[0].agents.includes("codex"), "skills.sh rows inherit Cave's supported agent filters");
assert.deepEqual(escaped[1].tags, [], "non-official skills do not get an official tag");

const plainHtml = `{"skills":[{"source":"mattpocock/skills","skillId":"tdd","name":"tdd","installs":353500,"weeklyInstalls":[20]}]}`;
const plain = parseSkillsShDirectoryHtml(plainHtml);
assert.equal(plain.length, 1, "parses plain JSON payloads too");
assert.equal(plain[0].registryUrl, "https://www.skills.sh/mattpocock/skills/tdd");

const domainSourceHtml = `{"skills":[{"source":"open.feishu.cn","skillId":"lark-doc","name":"lark-doc","installs":348100,"weeklyInstalls":[30,40]}]}`;
const domainSource = parseSkillsShDirectoryHtml(domainSourceHtml);
assert.equal(domainSource.length, 1, "keeps non-GitHub skills.sh sources");
assert.deepEqual(
  {
    id: domainSource[0].id,
    slug: domainSource[0].slug,
    owner: domainSource[0].owner,
    repo: domainSource[0].repo,
    packageName: domainSource[0].packageName,
    registryUrl: domainSource[0].registryUrl,
    sourceUrl: domainSource[0].sourceUrl,
  },
  {
    id: "lark-doc",
    slug: "open.feishu.cn/lark-doc",
    owner: undefined,
    repo: undefined,
    packageName: "open.feishu.cn",
    registryUrl: "https://www.skills.sh/open.feishu.cn/lark-doc",
    sourceUrl: undefined,
  },
  "domain-backed sources remain installable without invented GitHub links",
);

const initialSkillsHtml = String.raw`<script>self.__next_f.push([1,"{\"initialSkills\":[{\"source\":\"vercel-labs/agent-skills\",\"skillId\":\"vercel-react-best-practices\",\"name\":\"vercel-react-best-practices\",\"installs\":524900,\"weeklyInstalls\":[100,200]}],\"view\":\"all-time\"}"])</script>`;
const initial = parseSkillsShDirectoryHtml(initialSkillsHtml);
assert.equal(initial.length, 1, "parses skills.sh's initialSkills Next payload");
assert.equal(initial[0].slug, "vercel-labs/agent-skills/vercel-react-best-practices");

const search = parseSkillsShSearchResponse({
  query: "react",
  searchType: "fuzzy",
  skills: [
    {
      id: "vercel-labs/agent-skills/vercel-react-best-practices",
      skillId: "vercel-react-best-practices",
      name: "vercel-react-best-practices",
      installs: 524934,
      source: "vercel-labs/agent-skills",
    },
  ],
});
assert.equal(search.length, 1, "parses skills.sh /api/search payloads");
assert.deepEqual(
  {
    id: search[0].id,
    slug: search[0].slug,
    packageName: search[0].packageName,
    registryUrl: search[0].registryUrl,
    installsAllTime: search[0].installsAllTime,
    weeklyInstalls: search[0].weeklyInstalls,
  },
  {
    id: "vercel-react-best-practices",
    slug: "vercel-labs/agent-skills/vercel-react-best-practices",
    packageName: "vercel-labs/agent-skills",
    registryUrl: "https://www.skills.sh/vercel-labs/agent-skills/vercel-react-best-practices",
    installsAllTime: 524934,
    weeklyInstalls: [],
  },
  "normalizes skills.sh search rows into installable Cave entries",
);

assert.equal(
  remoteSkillMarkdownUrl(escaped[0]),
  "https://raw.githubusercontent.com/vercel-labs/skills/main/skills/find-skills/SKILL.md",
  "builds constrained GitHub raw SKILL.md URLs for previews",
);
assert.deepEqual(
  remoteSkillMarkdownUrls({
    owner: "vercel-labs",
    repo: "agent-skills",
    id: "vercel-react-best-practices",
  }),
  [
    "https://raw.githubusercontent.com/vercel-labs/agent-skills/main/skills/vercel-react-best-practices/SKILL.md",
    "https://raw.githubusercontent.com/vercel-labs/agent-skills/main/skills/react-best-practices/SKILL.md",
  ],
  "tries publisher-prefix-stripped GitHub skill folders after the registry id",
);
assert.equal(
  remoteSkillMarkdownUrl({ owner: "vercel-labs", repo: "skills", id: "../find-skills" }),
  null,
  "rejects unsafe raw preview path segments",
);
assert.equal(
  matchDirectoryEntry("find-skills", [escaped[0], { ...escaped[0], packageName: "agentspace-so/skills", owner: "agentspace-so", repo: "skills" }], "agentspace-so/skills")?.owner,
  "agentspace-so",
  "source hint disambiguates duplicate skill ids",
);

const codexMerged = mergeDirectoryWithLocal([escaped[0]], [{
  id: "find-skills",
  name: "find-skills",
  owner: "vercel-labs",
  repo: "skills",
  packageName: "vercel-labs/skills",
  path: "/Users/test/.codex/skills/find-skills/SKILL.md",
  familiar: "codex-user",
}]);
assert.equal(codexMerged.length, 1, "Codex local match is attached to the registry row");
assert.equal(codexMerged[0].installed, true, "Codex local match marks the registry row installed");
assert.equal(codexMerged[0].local?.scope, "codex-user", "Codex local match preserves scope");

const agentsOnly = mergeDirectoryWithLocal([], [{
  id: "tdd",
  name: "tdd",
  path: "/repo/.agents/skills/tdd/SKILL.md",
  familiar: "agents-project",
}]);
assert.equal(agentsOnly.length, 1, "project .agents local-only skill is surfaced");
assert.equal(agentsOnly[0].local?.scope, "agents-project", "project .agents local-only skill preserves scope");

assert.deepEqual(parseSkillsShDirectoryHtml("<html></html>"), [], "missing payload is a safe empty parse");

console.log("skills-directory.test.ts OK");
