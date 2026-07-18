#!/usr/bin/env python3
"""Generate Coven Cave marketplace packages and compatibility exports."""

from __future__ import annotations

import argparse
import errno
import json
import re
import sys
from pathlib import Path, PurePosixPath
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
MARKETPLACE = ROOT / "marketplace"
CATALOG = MARKETPLACE / "catalog.json"
PLUGIN_ROOT = MARKETPLACE / "plugins"
EXPORT_ROOT = MARKETPLACE / "exports"
CRAFT_SCHEMA_VERSION = "opencoven.craft.v1"
KNOWLEDGE_PACK_SCHEMA_VERSION = "opencoven.knowledge-pack.v1"
SUPPORTED_CRAFT_LICENSES = {
    "Apache-2.0",
    "BSD-2-Clause",
    "BSD-3-Clause",
    "ISC",
    "MIT",
}
RESOURCE_ID_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
FRONTMATTER_KEY_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_-]*$")
CONTENT_HASH_RE = re.compile(r"^sha256:[0-9a-f]{64}$")
COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")


def _string_list(value: Any, label: str, *, allow_empty: bool = False) -> list[str]:
    if not isinstance(value, list) or (not value and not allow_empty):
        suffix = "" if allow_empty else " and must not be empty"
        raise ValueError(f"{label} must be a list of strings{suffix}")
    if any(not isinstance(item, str) or not item.strip() for item in value):
        raise ValueError(f"{label} must contain non-empty strings")
    if len(value) != len(set(value)):
        raise ValueError(f"{label} contains duplicate ids")
    return value


def _safe_relative_path(value: Any, label: str, *, required_prefix: str | None = None) -> PurePosixPath:
    if not isinstance(value, str) or not value or "\\" in value:
        raise ValueError(f"unsafe {label}: {value!r}")
    candidate = PurePosixPath(value)
    if candidate.is_absolute() or any(part in {"", ".", ".."} for part in candidate.parts):
        raise ValueError(f"unsafe {label}: {value!r}")
    if required_prefix and (not candidate.parts or candidate.parts[0] != required_prefix):
        raise ValueError(f"unsafe {label}: {value!r}")
    return candidate


def _require_text(mapping: dict[str, Any], key: str, label: str) -> str:
    value = mapping.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{label}.{key} must be a non-empty string")
    return value


def validate_craft(
    plugin: dict[str, Any],
    plugins_by_name: dict[str, dict[str, Any]],
    marketplace_dir: Path,
) -> None:
    name = plugin.get("name", "<unnamed>")
    craft = plugin.get("craft")
    if not isinstance(craft, dict):
        raise ValueError(f'Craft "{name}" is missing its craft specification')
    if craft.get("schemaVersion") != CRAFT_SCHEMA_VERSION:
        raise ValueError(f'Craft "{name}" must use schemaVersion {CRAFT_SCHEMA_VERSION}')
    if plugin.get("license") not in SUPPORTED_CRAFT_LICENSES:
        raise ValueError(f'unsupported Craft license "{plugin.get("license")}"')

    components = craft.get("components")
    if not isinstance(components, dict):
        raise ValueError(f'Craft "{name}" components must be an object')
    required = _string_list(components.get("required"), f'Craft "{name}" required components')
    optional = _string_list(
        components.get("optional", []),
        f'Craft "{name}" optional components',
        allow_empty=True,
    )
    overlap = sorted(set(required) & set(optional))
    if overlap:
        raise ValueError(f'Craft "{name}" repeats components as required and optional: {", ".join(overlap)}')
    for component_id in [*required, *optional]:
        component = plugins_by_name.get(component_id)
        if component is None:
            raise ValueError(f'Craft "{name}" references missing component plugin "{component_id}"')
        if component.get("kind") == "craft":
            raise ValueError(f'Craft "{name}" contains nested Craft component "{component_id}"')

    bundled = craft.get("bundled")
    if not isinstance(bundled, dict):
        raise ValueError(f'Craft "{name}" bundled resources must be an object')
    skills = bundled.get("skills")
    prompts = bundled.get("prompts", [])
    workflows = bundled.get("workflows", [])
    if not isinstance(skills, list) or not skills:
        raise ValueError(f'Craft "{name}" must bundle at least one skill')
    if not isinstance(prompts, list) or not isinstance(workflows, list):
        raise ValueError(f'Craft "{name}" prompts and workflows must be lists')

    seen_resource_ids: set[str] = set()
    for resource_type, resources in (("skill", skills), ("prompt", prompts), ("workflow", workflows)):
        for resource in resources:
            if not isinstance(resource, dict):
                raise ValueError(f'Craft "{name}" {resource_type} resources must be objects')
            resource_id = _require_text(resource, "id", f'Craft "{name}" {resource_type}')
            if not RESOURCE_ID_RE.fullmatch(resource_id):
                raise ValueError(f'invalid Craft resource id "{resource_id}"')
            if resource_id in seen_resource_ids:
                raise ValueError(f'duplicate Craft resource id "{resource_id}"')
            seen_resource_ids.add(resource_id)

            if resource_type == "skill":
                source_path = _safe_relative_path(
                    resource.get("sourcePath"),
                    "Craft source path",
                    required_prefix="craft-sources",
                )
                source_file = (marketplace_dir / Path(*source_path.parts)).resolve()
                source_root = (marketplace_dir / "craft-sources").resolve()
                try:
                    source_file.relative_to(source_root)
                except ValueError as exc:
                    raise ValueError(f'unsafe Craft source path: {resource.get("sourcePath")!r}') from exc
                if not source_file.is_file():
                    raise ValueError(f'Craft source file does not exist: {resource.get("sourcePath")}')
                _safe_relative_path(resource.get("upstreamPath"), "Craft upstream path")
                content_hash = _require_text(resource, "contentHash", f'Craft "{name}" skill "{resource_id}"')
                if not CONTENT_HASH_RE.fullmatch(content_hash):
                    raise ValueError(f'Craft skill "{resource_id}" has an invalid sha256 content hash')
                _string_list(
                    resource.get("modifications"),
                    f'Craft skill "{resource_id}" modification notes',
                )
            elif resource_type == "prompt":
                _require_text(resource, "name", f'Craft "{name}" prompt "{resource_id}"')
                _require_text(resource, "body", f'Craft "{name}" prompt "{resource_id}"')
            else:
                _require_text(resource, "name", f'Craft "{name}" workflow "{resource_id}"')
                _string_list(
                    resource.get("steps"),
                    f'Craft workflow "{resource_id}" steps',
                )

    _string_list(craft.get("requiredCapabilities"), f'Craft "{name}" required capabilities')
    _string_list(craft.get("recommendedRoles"), f'Craft "{name}" recommended roles')
    provenance = craft.get("provenance")
    if not isinstance(provenance, dict):
        raise ValueError(f'Craft "{name}" provenance must be an object')
    source = _require_text(provenance, "source", f'Craft "{name}" provenance')
    if not source.startswith("https://"):
        raise ValueError(f'Craft "{name}" provenance source must be https')
    commit = _require_text(provenance, "commit", f'Craft "{name}" provenance')
    if not COMMIT_RE.fullmatch(commit):
        raise ValueError(f'Craft "{name}" provenance commit must be a full 40-character hash')
    license_id = _require_text(provenance, "license", f'Craft "{name}" provenance')
    if license_id not in SUPPORTED_CRAFT_LICENSES:
        raise ValueError(f'unsupported Craft license "{license_id}"')
    license_path = _safe_relative_path(
        provenance.get("licensePath"),
        "Craft license path",
        required_prefix="craft-sources",
    )
    license_file = (marketplace_dir / Path(*license_path.parts)).resolve()
    source_root = (marketplace_dir / "craft-sources").resolve()
    try:
        license_file.relative_to(source_root)
    except ValueError as exc:
        raise ValueError(f'unsafe Craft license path: {provenance.get("licensePath")!r}') from exc
    if not license_file.is_file():
        raise ValueError(f'Craft license file does not exist: {provenance.get("licensePath")}')
    if craft.get("mcpServers") is not None and not isinstance(craft.get("mcpServers"), dict):
        raise ValueError(f'Craft "{name}" mcpServers must be an object')
    if plugin.get("visibility", "public") not in {"public", "hidden"}:
        raise ValueError(f'Craft "{name}" visibility must be public or hidden')


def validate_knowledge_pack(plugin: dict[str, Any], marketplace_dir: Path) -> None:
    name = plugin.get("name", "<unnamed>")
    pack = plugin.get("knowledgePack")
    if not isinstance(pack, dict):
        raise ValueError(f'Knowledge Pack "{name}" is missing its knowledgePack specification')
    if pack.get("schemaVersion") != KNOWLEDGE_PACK_SCHEMA_VERSION:
        raise ValueError(f'Knowledge Pack "{name}" must use schemaVersion {KNOWLEDGE_PACK_SCHEMA_VERSION}')

    default_root = pack.get("defaultRoot")
    if default_root is not None and (
        not isinstance(default_root, str) or not RESOURCE_ID_RE.fullmatch(default_root)
    ):
        raise ValueError(f'Knowledge Pack "{name}" defaultRoot must be a slug id')

    folders = pack.get("folders")
    if not isinstance(folders, list) or not folders:
        raise ValueError(f'Knowledge Pack "{name}" folders must be a non-empty list')
    folder_ids: set[str] = set()
    folder_template_ids: set[str] = set()
    for folder in folders:
        if not isinstance(folder, dict):
            raise ValueError(f'Knowledge Pack "{name}" folders must contain objects')
        folder_id = _require_text(folder, "id", f'Knowledge Pack "{name}" folder')
        if not RESOURCE_ID_RE.fullmatch(folder_id):
            raise ValueError(f'invalid Knowledge Pack folder id "{folder_id}"')
        if folder_id in folder_ids:
            raise ValueError(f'duplicate Knowledge Pack folder id "{folder_id}"')
        folder_ids.add(folder_id)
        _require_text(folder, "name", f'Knowledge Pack "{name}" folder "{folder_id}"')
        _require_text(folder, "description", f'Knowledge Pack "{name}" folder "{folder_id}"')
        _require_text(folder, "entityType", f'Knowledge Pack "{name}" folder "{folder_id}"')
        if folder.get("storyQuestion") is not None:
            _require_text(folder, "storyQuestion", f'Knowledge Pack "{name}" folder "{folder_id}"')
        fields = folder.get("fields")
        if not isinstance(fields, list):
            raise ValueError(f'Knowledge Pack folder "{folder_id}" fields must be a list')
        field_keys: set[str] = set()
        for field in fields:
            if not isinstance(field, dict):
                raise ValueError(f'Knowledge Pack folder "{folder_id}" fields must contain objects')
            key = _require_text(field, "key", f'Knowledge Pack folder "{folder_id}" field')
            if not FRONTMATTER_KEY_RE.fullmatch(key):
                raise ValueError(f'invalid Knowledge Pack field key "{key}"')
            if key in field_keys:
                raise ValueError(f'duplicate Knowledge Pack field key "{key}"')
            field_keys.add(key)
            _require_text(field, "label", f'Knowledge Pack folder "{folder_id}" field "{key}"')
            if field.get("description") is not None:
                _require_text(field, "description", f'Knowledge Pack folder "{folder_id}" field "{key}"')
            if field.get("options") is not None:
                _string_list(
                    field.get("options"),
                    f'Knowledge Pack folder "{folder_id}" field "{key}" options',
                )
        template_ids = _string_list(
            folder.get("templates"),
            f'Knowledge Pack folder "{folder_id}" templates',
            allow_empty=True,
        )
        folder_template_ids.update(template_ids)

    templates = pack.get("templates")
    if not isinstance(templates, list) or not templates:
        raise ValueError(f'Knowledge Pack "{name}" templates must be a non-empty list')
    template_ids: set[str] = set()
    pack_sources_root = (marketplace_dir / "pack-sources").resolve()
    for template in templates:
        if not isinstance(template, dict):
            raise ValueError(f'Knowledge Pack "{name}" templates must contain objects')
        template_id = _require_text(template, "id", f'Knowledge Pack "{name}" template')
        if not RESOURCE_ID_RE.fullmatch(template_id):
            raise ValueError(f'invalid Knowledge Pack template id "{template_id}"')
        if template_id in template_ids:
            raise ValueError(f'duplicate Knowledge Pack template id "{template_id}"')
        template_ids.add(template_id)
        folder_id = _require_text(template, "folder", f'Knowledge Pack "{name}" template "{template_id}"')
        if folder_id not in folder_ids:
            raise ValueError(f'Knowledge Pack template "{template_id}" references missing folder "{folder_id}"')
        _require_text(template, "name", f'Knowledge Pack "{name}" template "{template_id}"')
        if template.get("description") is not None:
            _require_text(template, "description", f'Knowledge Pack "{name}" template "{template_id}"')
        source_path = _safe_relative_path(
            template.get("sourcePath"),
            "Knowledge Pack template source path",
            required_prefix="pack-sources",
        )
        source_file = (marketplace_dir / Path(*source_path.parts)).resolve()
        try:
            source_file.relative_to(pack_sources_root)
        except ValueError as exc:
            raise ValueError(f'unsafe Knowledge Pack template source path: {template.get("sourcePath")!r}') from exc
        if not source_file.is_file():
            raise ValueError(f'Knowledge Pack template source file does not exist: {template.get("sourcePath")}')
    missing_folder_templates = sorted(folder_template_ids - template_ids)
    if missing_folder_templates:
        raise ValueError(
            f'Knowledge Pack "{name}" folders reference missing templates: {", ".join(missing_folder_templates)}'
        )

    skills = pack.get("skills")
    if not isinstance(skills, list) or not skills:
        raise ValueError(f'Knowledge Pack "{name}" skills must be a non-empty list')
    skill_ids: set[str] = set()
    for skill in skills:
        if not isinstance(skill, dict):
            raise ValueError(f'Knowledge Pack "{name}" skills must contain objects')
        skill_id = _require_text(skill, "id", f'Knowledge Pack "{name}" skill')
        if not RESOURCE_ID_RE.fullmatch(skill_id):
            raise ValueError(f'invalid Knowledge Pack skill id "{skill_id}"')
        if skill_id in skill_ids:
            raise ValueError(f'duplicate Knowledge Pack skill id "{skill_id}"')
        skill_ids.add(skill_id)
        source_path = _safe_relative_path(
            skill.get("sourcePath"),
            "Knowledge Pack skill source path",
            required_prefix="pack-sources",
        )
        source_file = (marketplace_dir / Path(*source_path.parts)).resolve()
        try:
            source_file.relative_to(pack_sources_root)
        except ValueError as exc:
            raise ValueError(f'unsafe Knowledge Pack skill source path: {skill.get("sourcePath")!r}') from exc
        if source_file.name != "SKILL.md" or not source_file.is_file():
            raise ValueError(f'Knowledge Pack skill source SKILL.md does not exist: {skill.get("sourcePath")}')

    workflow_ids = _string_list(pack.get("workflows", []), f'Knowledge Pack "{name}" workflows', allow_empty=True)
    for workflow_id in workflow_ids:
        if not RESOURCE_ID_RE.fullmatch(workflow_id):
            raise ValueError(f'invalid Knowledge Pack workflow id "{workflow_id}"')
        if not (ROOT / "workflows" / f"{workflow_id}.yaml").is_file():
            raise ValueError(f'Knowledge Pack workflow does not exist: workflows/{workflow_id}.yaml')


def validate_catalog(catalog: dict[str, Any], marketplace_dir: Path = MARKETPLACE) -> dict[str, Any]:
    plugins = catalog.get("plugins")
    if not isinstance(plugins, list):
        raise ValueError("Marketplace catalog plugins must be a list")
    names = [plugin.get("name") for plugin in plugins if isinstance(plugin, dict)]
    if len(names) != len(plugins) or any(not isinstance(name, str) or not name for name in names):
        raise ValueError("Every marketplace plugin needs a non-empty name")
    duplicates = sorted({name for name in names if names.count(name) > 1})
    if duplicates:
        raise ValueError(f"Duplicate marketplace plugin names: {', '.join(duplicates)}")
    plugins_by_name = {plugin["name"]: plugin for plugin in plugins}
    for plugin in plugins:
        if plugin.get("kind") == "craft":
            validate_craft(plugin, plugins_by_name, marketplace_dir)
            if plugin.get("knowledgePack") is not None:
                raise ValueError(f'Plugin "{plugin["name"]}" has Knowledge Pack metadata with kind "craft"')
        elif plugin.get("kind") == "knowledge-pack":
            validate_knowledge_pack(plugin, marketplace_dir)
            if plugin.get("craft") is not None:
                raise ValueError(f'Plugin "{plugin["name"]}" has Craft metadata with kind "knowledge-pack"')
        elif plugin.get("craft") is not None:
            raise ValueError(f'Plugin "{plugin["name"]}" has Craft metadata without kind "craft"')
        elif plugin.get("knowledgePack") is not None:
            raise ValueError(f'Plugin "{plugin["name"]}" has Knowledge Pack metadata without kind "knowledge-pack"')
    return catalog


def load_catalog(catalog_path: Path = CATALOG, marketplace_dir: Path = MARKETPLACE) -> dict[str, Any]:
    with catalog_path.open("r", encoding="utf-8") as handle:
        catalog = json.load(handle)
    return validate_catalog(catalog, marketplace_dir)


def dump_json(value: Any) -> str:
    return json.dumps(value, indent=2, sort_keys=False) + "\n"


def skill_markdown(plugin: dict[str, Any]) -> str:
    skill = plugin["skill"]
    lines = [
        "---",
        f"name: {plugin['name']}",
        f"description: {skill['description']}",
        "---",
        "",
        f"# {plugin['displayName']}",
        "",
        skill["description"],
        "",
        "## Use When",
    ]
    lines.extend(f"- {item}" for item in skill["useCases"])
    lines.extend(["", "## Guardrails"])
    lines.extend(f"- {item}" for item in skill["guardrails"])
    lines.extend(
        [
            "",
            "## Default Flow",
            "",
            "1. Confirm the user intent and whether the action is read-only or state-changing.",
            "2. Use the narrowest available tool scope and collect only the context needed for the task.",
            "3. For state-changing or external actions, stop for explicit approval before acting.",
            "4. Summarize what changed or what was learned, including relevant object IDs or links.",
            "",
        ]
    )
    return "\n".join(lines)


def prompt_markdown(prompt: dict[str, Any]) -> str:
    """One prompt-template .md — the same shape src/lib/server/prompt-scan.ts
    reads (frontmatter name/description/icon/tags + body dropped into the
    composer). Installed packs are resolved by /api/prompts at scan time."""
    lines = ["---", f"name: {prompt['name']}"]
    if prompt.get("description"):
        lines.append(f"description: {prompt['description']}")
    if prompt.get("icon"):
        lines.append(f"icon: {prompt['icon']}")
    if prompt.get("tags"):
        lines.append("tags:")
        lines.extend(f"  - {tag}" for tag in prompt["tags"])
    lines.extend(["---", "", prompt["body"].rstrip(), ""])
    return "\n".join(lines)


def craft_notice(plugin: dict[str, Any]) -> str:
    craft = plugin["craft"]
    provenance = craft["provenance"]
    lines = [
        f"# Third-party notices for {plugin['displayName']}",
        "",
        f"Upstream: {provenance['source']}",
        f"Pinned commit: {provenance['commit']}",
        f"License: {provenance['license']}",
        "",
        "## Bundled skills",
        "",
    ]
    for skill in craft["bundled"]["skills"]:
        lines.extend(
            [
                f"### {skill['id']}",
                "",
                f"- Upstream path: `{skill['upstreamPath']}`",
                f"- Adapted source content hash: `{skill['contentHash']}`",
                "- Coven modifications:",
                *(f"  - {note}" for note in skill["modifications"]),
                "",
            ]
        )
    lines.extend(
        [
            "The upstream material is redistributed under the license named above.",
            "See the pinned source repository for the complete license text.",
            "",
        ]
    )
    return "\n".join(lines)


def coven_manifest(plugin: dict[str, Any]) -> dict[str, Any]:
    manifest: dict[str, Any] = {
        "name": plugin["name"],
        "version": plugin["version"],
        "description": plugin["description"],
        "author": {"name": "OpenCoven"},
        "homepage": "https://opencoven.ai",
            "repository": "https://github.com/OpenCoven/coven-cave",
        "license": plugin.get("license", "GPL-3.0"),
        "keywords": plugin.get("keywords", []),
        "capabilities": plugin.get("capabilities", []),
        "marketplaceId": f"opencoven/{plugin['name']}",
        "x-coven": {
            "displayName": plugin["displayName"],
            "category": plugin["category"],
            "trust": plugin["trust"],
            "sourceRefs": plugin.get("sourceRefs", []),
            "roleAffinity": plugin.get("roleAffinity", []),
            "compatibility": {
                "covenCave": True,
                "covenCode": True,
                "codex": True,
                "mcp": bool(plugin.get("mcpServers")),
                "rolePatch": bool(plugin.get("roleAffinity")),
            },
        },
    }
    if plugin.get("mcpServers"):
        manifest["mcpServers"] = plugin["mcpServers"]
    if plugin.get("userConfig"):
        manifest["userConfig"] = plugin["userConfig"]
    if plugin.get("prompts"):
        manifest["prompts"] = [prompt["id"] for prompt in plugin["prompts"]]
    if plugin.get("skillTemplates"):
        manifest["skillTemplates"] = [template["id"] for template in plugin["skillTemplates"]]
    if plugin.get("kind") == "craft":
        manifest["kind"] = "craft"
        manifest["craft"] = plugin["craft"]
        if plugin["craft"].get("mcpServers"):
            manifest["mcpServers"] = plugin["craft"]["mcpServers"]
    if plugin.get("kind") == "knowledge-pack":
        manifest["kind"] = "knowledge-pack"
    return manifest


def codex_manifest(plugin: dict[str, Any]) -> dict[str, Any]:
    if plugin.get("kind") == "craft":
        craft = plugin["craft"]
        manifest: dict[str, Any] = {
            "name": plugin["name"],
            "version": plugin["version"],
            "description": plugin["description"],
            "author": {
                "name": "OpenCoven",
                "url": "https://github.com/OpenCoven",
            },
            "homepage": "https://opencoven.ai",
            "repository": "https://github.com/OpenCoven/coven-cave",
            "license": plugin.get("license", craft["provenance"]["license"]),
            "keywords": plugin.get("keywords", []),
            "skills": "./skills/",
            "interface": {
                "displayName": plugin["displayName"],
                "shortDescription": plugin["description"],
                "longDescription": plugin["description"],
                "developerName": "OpenCoven",
                "category": plugin["category"],
                "capabilities": craft["requiredCapabilities"],
                "websiteURL": "https://opencoven.ai",
                "defaultPrompt": [f"Use {plugin['displayName']} to open a bounded research direction."],
            },
        }
        if craft.get("mcpServers"):
            manifest["mcpServers"] = "./.mcp.json"
        return manifest
    return {
        "name": plugin["name"],
        "version": plugin["version"],
        "description": plugin["description"],
        "author": {"name": "OpenCoven"},
        "skills": "./skills/",
        "interface": {
            "displayName": plugin["displayName"],
            "shortDescription": plugin["description"],
            "longDescription": plugin.get("skill", {}).get("description", plugin["description"]),
            "developerName": "OpenCoven",
            "category": plugin["category"],
            "capabilities": plugin.get("keywords", []),
            "defaultPrompt": f"Help me use {plugin['displayName']} safely.",
        },
    }


def knowledge_pack_manifest(plugin: dict[str, Any]) -> dict[str, Any]:
    pack = plugin["knowledgePack"]
    manifest: dict[str, Any] = {
        "schemaVersion": pack["schemaVersion"],
        "id": plugin["name"],
        "displayName": plugin["displayName"],
        "description": plugin["description"],
        "version": plugin["version"],
    }
    if pack.get("defaultRoot"):
        manifest["defaultRoot"] = pack["defaultRoot"]
    manifest.update(
        {
            "folders": pack["folders"],
            "templates": [
                {
                    "id": template["id"],
                    "folder": template["folder"],
                    "name": template["name"],
                    **({"description": template["description"]} if template.get("description") else {}),
                    "path": f"templates/{template['id']}.md",
                }
                for template in pack["templates"]
            ],
            "skills": [skill["id"] for skill in pack["skills"]],
            "prompts": [prompt["id"] for prompt in plugin.get("prompts", [])],
            "workflows": pack.get("workflows", []),
        }
    )
    return manifest


def package_files(catalog: dict[str, Any], marketplace_dir: Path = MARKETPLACE) -> dict[Path, str]:
    files: dict[Path, str] = {}
    plugin_root = marketplace_dir / "plugins"
    for plugin in catalog["plugins"]:
        package_dir = plugin_root / plugin["name"]
        files[package_dir / "plugin.json"] = dump_json(coven_manifest(plugin))
        if plugin.get("kind") == "craft":
            craft = plugin["craft"]
            for skill in craft["bundled"]["skills"]:
                source = marketplace_dir / Path(*PurePosixPath(skill["sourcePath"]).parts)
                source_root = source.parent
                for source_file in source_root.rglob("*"):
                    # Reject symlinks during traversal so packaging never reads
                    # through links to bytes outside the source tree.
                    if source_file.is_symlink():
                        raise SystemExit(f"craft skill source contains a symlink: {source_file}")
                    if not source_file.is_file():
                        continue
                    relative = source_file.relative_to(source_root)
                    files[package_dir / "skills" / skill["id"] / relative] = source_file.read_bytes()
            for prompt in craft["bundled"].get("prompts", []):
                files[package_dir / "prompts" / f"{prompt['id']}.md"] = prompt_markdown(prompt)
            for workflow in craft["bundled"].get("workflows", []):
                files[package_dir / "workflows" / f"{workflow['id']}.json"] = dump_json(workflow)
            files[package_dir / "assets" / "craft.json"] = dump_json(craft)
            files[package_dir / "assets" / "THIRD_PARTY_NOTICES.md"] = craft_notice(plugin)
            license_source = marketplace_dir / Path(*PurePosixPath(craft["provenance"]["licensePath"]).parts)
            files[package_dir / "assets" / "UPSTREAM_LICENSE.txt"] = license_source.read_text(encoding="utf-8")
            if craft.get("mcpServers"):
                files[package_dir / ".mcp.json"] = dump_json({"mcpServers": craft["mcpServers"]})
            files[package_dir / ".codex-plugin" / "plugin.json"] = dump_json(codex_manifest(plugin))
            continue
        if plugin.get("kind") == "knowledge-pack":
            pack = plugin["knowledgePack"]
            files[package_dir / "pack.json"] = dump_json(knowledge_pack_manifest(plugin))
            for template in pack["templates"]:
                source = marketplace_dir / Path(*PurePosixPath(template["sourcePath"]).parts)
                files[package_dir / "templates" / f"{template['id']}.md"] = source.read_bytes()
            for skill in pack["skills"]:
                source = marketplace_dir / Path(*PurePosixPath(skill["sourcePath"]).parts)
                source_root = source.parent
                for source_file in source_root.rglob("*"):
                    # Reject symlinks during traversal so packaging never reads
                    # through links to bytes outside the source tree.
                    if source_file.is_symlink():
                        raise SystemExit(
                            f"knowledge-pack skill source contains a symlink: {source_file}"
                        )
                    if not source_file.is_file():
                        continue
                    relative = source_file.relative_to(source_root)
                    files[package_dir / "skills" / skill["id"] / relative] = source_file.read_bytes()
            for prompt in plugin.get("prompts", []):
                files[package_dir / "prompts" / f"{prompt['id']}.md"] = prompt_markdown(prompt)
            for template in plugin.get("skillTemplates", []):
                files[package_dir / "skill-templates" / f"{template['id']}.md"] = prompt_markdown(template)
            files[package_dir / ".codex-plugin" / "plugin.json"] = dump_json(codex_manifest(plugin))
            continue
        # Some marketplace skill packs carry hand-authored, long-form SKILL.md
        # files that should remain the source of truth. Their manifests and
        # exports are still generated from catalog.json, but sync must not
        # replace the authored skill body with the compact fallback template.
        # Prompt packs may carry no skill at all — skip the SKILL.md then.
        if plugin.get("skill") and plugin["skill"].get("managed") != "manual":
            files[package_dir / "skills" / plugin["name"] / "SKILL.md"] = skill_markdown(plugin)
        for prompt in plugin.get("prompts", []):
            files[package_dir / "prompts" / f"{prompt['id']}.md"] = prompt_markdown(prompt)
        # Skill templates share the prompt-template file shape and land in
        # skill-templates/ — merged by /api/skills/templates (cave-6ptj).
        for template in plugin.get("skillTemplates", []):
            files[package_dir / "skill-templates" / f"{template['id']}.md"] = prompt_markdown(template)
        files[package_dir / ".codex-plugin" / "plugin.json"] = dump_json(codex_manifest(plugin))
    return files


def marketplace_files(catalog: dict[str, Any], marketplace_dir: Path = MARKETPLACE) -> dict[Path, str]:
    plugins = [plugin for plugin in catalog["plugins"] if plugin.get("visibility", "public") != "hidden"]
    root_marketplace = {
        "schemaVersion": "opencoven.marketplace.v1",
        "name": catalog["name"],
        "interface": {
            "displayName": catalog["displayName"],
            "description": catalog["description"],
        },
        "plugins": [
            ({
                "name": plugin["name"],
                "displayName": plugin["displayName"],
                "category": plugin["category"],
                "source": {"source": "local", "path": f"./plugins/{plugin['name']}"},
                "policy": {
                    "installation": "AVAILABLE",
                    "authentication": "ON_INSTALL",
                },
                "trust": plugin["trust"],
                "roleAffinity": plugin.get("roleAffinity", []),
                **(
                    {"kind": "craft", "craft": plugin["craft"]}
                    if plugin.get("kind") == "craft"
                    else {"kind": "knowledge-pack"} if plugin.get("kind") == "knowledge-pack" else {}
                ),
            })
            for plugin in plugins
        ],
    }
    codex_marketplace = {
        "name": "opencoven-first-party",
        "interface": {"displayName": "OpenCoven First-Party"},
        "plugins": [
            {
                "name": plugin["name"],
                # Claude-marketplace string form, resolved inside the
                # registered marketplace root; current Codex CLIs reject
                # sources that escape the root.
                "source": f"./plugins/{plugin['name']}",
                "policy": {
                    "installation": "AVAILABLE",
                    "authentication": "ON_INSTALL",
                },
                "category": plugin["category"],
            }
            for plugin in plugins
        ],
    }
    mcp_servers: dict[str, Any] = {}
    for plugin in plugins:
        plugin_servers = plugin.get("mcpServers", {})
        if plugin.get("kind") == "craft":
            plugin_servers = plugin["craft"].get("mcpServers", {})
        for name, server in plugin_servers.items():
            mcp_servers[name] = server
    role_affinity = {
        plugin["name"]: plugin.get("roleAffinity", [])
        for plugin in plugins
        if plugin.get("roleAffinity")
    }
    return {
        marketplace_dir / "marketplace.json": dump_json(root_marketplace),
        # Current Codex CLIs only accept a marketplace root whose manifest
        # lives at .claude-plugin/marketplace.json, with plugin sources
        # resolving inside that root — so the canonical Codex registration
        # target is the marketplace/ directory itself:
        #   codex plugin marketplace add <repo>/marketplace
        marketplace_dir / ".claude-plugin" / "marketplace.json": dump_json(codex_marketplace),
        # Legacy flat export kept for older consumers of the previous layout.
        marketplace_dir / "exports" / "codex" / "marketplace.json": dump_json(codex_marketplace),
        marketplace_dir / "exports" / "mcp" / "mcp.json": dump_json({"mcpServers": mcp_servers}),
        marketplace_dir / "exports" / "roles" / "role-affinity.json": dump_json(role_affinity),
    }


def expected_files(catalog: dict[str, Any], marketplace_dir: Path = MARKETPLACE) -> dict[Path, str]:
    files = package_files(catalog, marketplace_dir)
    files.update(marketplace_files(catalog, marketplace_dir))
    return files


def managed_package_roots(catalog: dict[str, Any], marketplace_dir: Path = MARKETPLACE) -> set[Path]:
    """Craft and Knowledge Pack packages are fully generated, so their file sets are authoritative.

    Include previously generated roots no longer present in the catalog;
    their root Cave manifest identifies them without treating legacy/manual
    plugin packages as generator-owned.
    """
    plugin_root = marketplace_dir / "plugins"
    roots = {
        plugin_root / plugin["name"]
        for plugin in catalog["plugins"]
        if plugin.get("kind") in {"craft", "knowledge-pack"}
    }
    if plugin_root.is_dir():
        for candidate in plugin_root.iterdir():
            if not candidate.is_dir() or candidate.is_symlink():
                continue
            manifest_path = candidate / "plugin.json"
            try:
                manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            if isinstance(manifest, dict) and manifest.get("kind") in {"craft", "knowledge-pack"}:
                roots.add(candidate)
    return roots


def unexpected_managed_files(files: dict[Path, str], managed_roots: set[Path]) -> list[Path]:
    expected = set(files)
    unexpected: list[Path] = []
    for root in sorted(managed_roots):
        if not root.is_dir() or root.is_symlink():
            continue
        for path in root.rglob("*"):
            if (path.is_file() or path.is_symlink()) and path not in expected:
                unexpected.append(path)
    return sorted(unexpected)


def remove_unexpected_managed_files(files: dict[Path, str], managed_roots: set[Path]) -> None:
    for path in unexpected_managed_files(files, managed_roots):
        path.unlink()
    for root in sorted(managed_roots):
        if not root.is_dir() or root.is_symlink():
            continue
        directories = [path for path in root.rglob("*") if path.is_dir() and not path.is_symlink()]
        for directory in sorted(directories, key=lambda value: len(value.parts), reverse=True):
            try:
                directory.rmdir()
            except OSError as exc:
                # Cleanup is best-effort for non-empty or concurrently removed directories.
                if exc.errno not in {errno.ENOTEMPTY, errno.EEXIST, errno.ENOENT}:
                    raise
        try:
            root.rmdir()
        except OSError as exc:
            # A managed root can remain when it still contains expected generated files.
            if exc.errno not in {errno.ENOTEMPTY, errno.EEXIST, errno.ENOENT}:
                raise


def write_files(files: dict[Path, str | bytes], managed_roots: set[Path] | None = None) -> None:
    remove_unexpected_managed_files(files, managed_roots or set())
    for path, content in sorted(files.items()):
        path.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(content, bytes):
            path.write_bytes(content)
        else:
            path.write_text(content, encoding="utf-8")


def check_files(
    files: dict[Path, str],
    display_root: Path = ROOT,
    managed_roots: set[Path] | None = None,
) -> list[str]:
    problems: list[str] = []
    for path, expected in sorted(files.items()):
        try:
            display_path = path.relative_to(display_root)
        except ValueError:
            display_path = path
        if not path.exists():
            problems.append(f"missing {display_path}")
            continue
        actual = path.read_bytes()
        expected_bytes = expected if isinstance(expected, bytes) else expected.encode("utf-8")
        if actual != expected_bytes:
            problems.append(f"stale {display_path}")
    for path in unexpected_managed_files(files, managed_roots or set()):
        try:
            display_path = path.relative_to(display_root)
        except ValueError:
            display_path = path
        problems.append(f"unexpected {display_path}")
    return problems


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="verify generated marketplace files are up to date")
    parser.add_argument("--catalog", type=Path, help="catalog path (defaults to marketplace/catalog.json)")
    parser.add_argument("--marketplace-root", type=Path, help="marketplace output/source root")
    args = parser.parse_args()

    try:
        marketplace_dir = (args.marketplace_root or MARKETPLACE).resolve()
        catalog_path = (args.catalog or (marketplace_dir / "catalog.json")).resolve()
        catalog = load_catalog(catalog_path, marketplace_dir)
        files = expected_files(catalog, marketplace_dir)
        managed_roots = managed_package_roots(catalog, marketplace_dir)
        if args.check:
            problems = check_files(files, marketplace_dir.parent, managed_roots)
            if problems:
                for problem in problems:
                    print(problem, file=sys.stderr)
                return 1
            print(f"marketplace_ok files={len(files)} plugins={len(catalog['plugins'])}")
            return 0
        write_files(files, managed_roots)
        print(f"marketplace_synced files={len(files)} plugins={len(catalog['plugins'])}")
        return 0
    except Exception as exc:
        print(f"marketplace_error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
