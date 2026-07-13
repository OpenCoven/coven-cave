import { constants as fsConstants } from "node:fs";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { loadProjects, projectForRoot } from "../cave-projects.ts";
import { recordKnowledgePackSeed } from "../cave-config.ts";
import { parseMdDocument } from "../md-frontmatter.ts";
import {
  KNOWLEDGE_PACK_SCHEMA_VERSION,
  isValidPackSlug,
  type KnowledgeCollectionMeta,
  type KnowledgePackFolder,
  type KnowledgePackManifest,
  type KnowledgePackSeedRequest,
  type KnowledgePackSeedResult,
  type KnowledgePackTemplateMeta,
} from "../knowledge-pack-types.ts";
import {
  readCollectionMeta,
  collectionMetaExists,
  readKnowledgeEntry,
  writeCollectionMeta,
  writeKnowledgeEntry,
} from "./knowledge-vault.ts";

export function marketplacePluginsRoot(): string {
  return process.env.COVEN_MARKETPLACE_PLUGINS_DIR || path.join(process.cwd(), "marketplace", "plugins");
}

function pluginDir(packId: string): string {
  if (!isValidPackSlug(packId)) throw new Error("invalid pack id");
  const root = path.resolve(marketplacePluginsRoot());
  const resolved = path.resolve(root, packId);
  if (!resolved.startsWith(root + path.sep) || path.dirname(resolved) !== root) throw new Error("invalid pack id");
  return resolved;
}

function hasString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFolder(value: unknown): value is KnowledgePackFolder {
  if (!value || typeof value !== "object") return false;
  const folder = value as Partial<KnowledgePackFolder>;
  return isValidPackSlug(folder.id) && hasString(folder.name) && hasString(folder.description) && hasString(folder.entityType) && Array.isArray(folder.fields) && Array.isArray(folder.templates) && folder.templates.every(isValidPackSlug);
}

function isTemplate(value: unknown): value is KnowledgePackTemplateMeta {
  if (!value || typeof value !== "object") return false;
  const template = value as Partial<KnowledgePackTemplateMeta>;
  return isValidPackSlug(template.id) && isValidPackSlug(template.folder) && hasString(template.name) && hasString(template.path);
}

function parseManifest(raw: string, dirName: string): KnowledgePackManifest | null {
  try {
    const manifest = JSON.parse(raw) as Partial<KnowledgePackManifest>;
    if (manifest.schemaVersion !== KNOWLEDGE_PACK_SCHEMA_VERSION) return null;
    if (!isValidPackSlug(manifest.id) || manifest.id !== dirName) return null;
    if (!hasString(manifest.displayName) || !hasString(manifest.description) || !hasString(manifest.version)) return null;
    if (!Array.isArray(manifest.folders) || !manifest.folders.every(isFolder)) return null;
    if (!Array.isArray(manifest.templates) || !manifest.templates.every(isTemplate)) return null;
    return {
      schemaVersion: KNOWLEDGE_PACK_SCHEMA_VERSION,
      id: manifest.id,
      displayName: manifest.displayName,
      description: manifest.description,
      version: manifest.version,
      ...(hasString(manifest.defaultRoot) ? { defaultRoot: manifest.defaultRoot } : {}),
      folders: manifest.folders,
      templates: manifest.templates,
      skills: Array.isArray(manifest.skills) ? manifest.skills.filter(isValidPackSlug) : [],
      prompts: Array.isArray(manifest.prompts) ? manifest.prompts.filter(isValidPackSlug) : [],
      workflows: Array.isArray(manifest.workflows) ? manifest.workflows.filter(isValidPackSlug) : [],
    };
  } catch {
    return null;
  }
}

export async function listKnowledgePacks(): Promise<KnowledgePackManifest[]> {
  let entries;
  try {
    entries = await readdir(marketplacePluginsRoot(), { withFileTypes: true });
  } catch {
    return [];
  }
  const packs: KnowledgePackManifest[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || !isValidPackSlug(entry.name)) continue;
    try {
      const manifest = parseManifest(await readFile(path.join(marketplacePluginsRoot(), entry.name, "pack.json"), "utf8"), entry.name);
      if (manifest) packs.push(manifest);
    } catch {
      // Broken marketplace entries are ignored.
    }
  }
  return packs;
}

export async function readKnowledgePack(packId: string): Promise<KnowledgePackManifest | null> {
  if (!isValidPackSlug(packId)) return null;
  try {
    return parseManifest(await readFile(path.join(pluginDir(packId), "pack.json"), "utf8"), packId);
  } catch {
    return null;
  }
}

export async function readPackTemplate(packId: string, templateMeta: KnowledgePackTemplateMeta): Promise<string> {
  const dir = pluginDir(packId);
  if (!isValidPackSlug(templateMeta.id)) throw new Error("invalid template id");
  const expectedRelative = path.join("templates", `${templateMeta.id}.md`);
  if (path.normalize(templateMeta.path) !== expectedRelative) throw new Error("invalid template path");
  const resolved = path.resolve(dir, expectedRelative);
  if (!resolved.startsWith(dir + path.sep)) throw new Error("invalid template path");
  return readFile(resolved, "utf8");
}

function folderMeta(pack: KnowledgePackManifest, folder: KnowledgePackFolder): KnowledgeCollectionMeta {
  return {
    name: folder.name,
    description: folder.description,
    entityType: folder.entityType,
    ...(folder.storyQuestion ? { storyQuestion: folder.storyQuestion } : {}),
    fields: folder.fields,
    pack: { id: pack.id, version: pack.version },
    summary: `${folder.name} — ${folder.description}`,
  };
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function writeFileIfMissing(filePath: string, contents: string, result: KnowledgePackSeedResult): Promise<void> {
  if (await exists(filePath)) {
    result.skipped.push(filePath);
    return;
  }
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents, "utf8");
  result.created.push(filePath);
}

function templatesByFolder(pack: KnowledgePackManifest, folder: KnowledgePackFolder): KnowledgePackTemplateMeta[] {
  return folder.templates.flatMap((id) => pack.templates.filter((template) => template.id === id && template.folder === folder.id));
}

async function seedVault(pack: KnowledgePackManifest): Promise<KnowledgePackSeedResult> {
  const result: KnowledgePackSeedResult = { ok: true, target: "vault", created: [], skipped: [], collections: [] };
  for (const folder of pack.folders) {
    const meta = folderMeta(pack, folder);
    result.collections?.push(folder.id);
    const hasMetaFile = await collectionMetaExists(folder.id);
    // Never overwrite an existing collection.yml — users customize it (esp.
    // `summary`, which reaches every harness prompt) and the docs promise
    // seeding never clobbers existing files. Report the touch either way.
    if (!hasMetaFile) {
      await writeCollectionMeta(folder.id, meta);
      result.created.push(`${folder.id}/collection.yml`);
    } else {
      result.skipped.push(`${folder.id}/collection.yml`);
    }

    const [template] = templatesByFolder(pack, folder);
    if (!template) continue;
    if (await readKnowledgeEntry(template.id, folder.id)) {
      result.skipped.push(`${folder.id}/${template.id}`);
      continue;
    }
    const raw = await readPackTemplate(pack.id, template);
    const doc = parseMdDocument(raw);
    const tags = Array.from(new Set([...doc.tags, pack.id]));
    await writeKnowledgeEntry({
      id: template.id,
      collection: folder.id,
      title: doc.title ?? template.name,
      tags,
      scope: "global",
      enabled: false,
      extra: { type: folder.entityType, ...doc.rest },
      body: doc.body,
    });
    result.created.push(`${folder.id}/${template.id}`);
  }
  await recordKnowledgePackSeed(pack.id, { target: "vault" });
  return result;
}

function validateSubfolder(value: string | undefined): string[] {
  if (!value) return [];
  const segments = value.split("/").filter(Boolean);
  if (segments.length > 3 || segments.length === 0 || !segments.every(isValidPackSlug)) throw new Error("invalid subfolder");
  return segments;
}

function assertWithinRoot(resolved: string, root: string): void {
  if (!(resolved === root || resolved.startsWith(root + path.sep))) throw new Error("project path outside root");
}

async function seedProject(pack: KnowledgePackManifest, request: Extract<KnowledgePackSeedRequest, { target: "project" }>): Promise<KnowledgePackSeedResult> {
  const projects = await loadProjects();
  const project = projectForRoot(request.projectRoot, projects);
  if (!project) throw new Error("unregistered project root");
  const projectRoot = path.resolve(project.root);
  const base = path.resolve(projectRoot, ...validateSubfolder(request.subfolder));
  assertWithinRoot(base, projectRoot);
  const result: KnowledgePackSeedResult = { ok: true, target: "project", created: [], skipped: [] };
  for (const folder of pack.folders) {
    const folderDir = path.resolve(base, folder.id);
    assertWithinRoot(folderDir, projectRoot);
    const meta = folderMeta(pack, folder);
    await writeFileIfMissing(path.join(folderDir, ".cave", "frontmatter.yml"), stringifyYaml(meta), result);
    const readme = `${folder.description} ${folder.storyQuestion ? `This folder answers: ${folder.storyQuestion}` : `Use this folder for ${folder.name}.`}\n`;
    await writeFileIfMissing(path.join(folderDir, "README.md"), readme, result);
    for (const template of templatesByFolder(pack, folder)) {
      await writeFileIfMissing(path.join(folderDir, "_templates", `${template.id}.md`), await readPackTemplate(pack.id, template), result);
    }
  }
  await recordKnowledgePackSeed(pack.id, { target: "project", root: project.root });
  return result;
}

export async function seedKnowledgePack(request: KnowledgePackSeedRequest): Promise<KnowledgePackSeedResult> {
  if (!isValidPackSlug(request.packId)) throw new Error("invalid pack id");
  const pack = await readKnowledgePack(request.packId);
  if (!pack) throw new Error("unknown pack");
  if (request.target === "vault") return seedVault(pack);
  if (request.target === "project") return seedProject(pack, request);
  throw new Error("invalid target");
}
