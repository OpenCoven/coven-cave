#!/usr/bin/env python3
"""Generate Coven Cave marketplace packages and compatibility exports."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
MARKETPLACE = ROOT / "marketplace"
CATALOG = MARKETPLACE / "catalog.json"
PLUGIN_ROOT = MARKETPLACE / "plugins"
EXPORT_ROOT = MARKETPLACE / "exports"


def load_catalog() -> dict[str, Any]:
    with CATALOG.open("r", encoding="utf-8") as handle:
        catalog = json.load(handle)
    names = [plugin["name"] for plugin in catalog["plugins"]]
    duplicates = sorted({name for name in names if names.count(name) > 1})
    if duplicates:
        raise ValueError(f"Duplicate marketplace plugin names: {', '.join(duplicates)}")
    return catalog


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


def coven_manifest(plugin: dict[str, Any]) -> dict[str, Any]:
    manifest: dict[str, Any] = {
        "name": plugin["name"],
        "version": plugin["version"],
        "description": plugin["description"],
        "author": {"name": "OpenCoven"},
        "homepage": "https://opencoven.ai",
            "repository": "https://github.com/OpenCoven/coven-cave",
        "license": "GPL-3.0",
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
    return manifest


def codex_manifest(plugin: dict[str, Any]) -> dict[str, Any]:
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


def package_files(catalog: dict[str, Any]) -> dict[Path, str]:
    files: dict[Path, str] = {}
    for plugin in catalog["plugins"]:
        package_dir = PLUGIN_ROOT / plugin["name"]
        files[package_dir / "plugin.json"] = dump_json(coven_manifest(plugin))
        # Some marketplace skill packs carry hand-authored, long-form SKILL.md
        # files that should remain the source of truth. Their manifests and
        # exports are still generated from catalog.json, but sync must not
        # replace the authored skill body with the compact fallback template.
        # Prompt packs may carry no skill at all — skip the SKILL.md then.
        if plugin.get("skill") and plugin["skill"].get("managed") != "manual":
            files[package_dir / "skills" / plugin["name"] / "SKILL.md"] = skill_markdown(plugin)
        for prompt in plugin.get("prompts", []):
            files[package_dir / "prompts" / f"{prompt['id']}.md"] = prompt_markdown(prompt)
        files[package_dir / ".codex-plugin" / "plugin.json"] = dump_json(codex_manifest(plugin))
    return files


def marketplace_files(catalog: dict[str, Any]) -> dict[Path, str]:
    plugins = catalog["plugins"]
    root_marketplace = {
        "schemaVersion": "opencoven.marketplace.v1",
        "name": catalog["name"],
        "interface": {
            "displayName": catalog["displayName"],
            "description": catalog["description"],
        },
        "plugins": [
            {
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
            }
            for plugin in plugins
        ],
    }
    codex_marketplace = {
        "name": "opencoven-first-party",
        "interface": {"displayName": "OpenCoven First-Party"},
        "plugins": [
            {
                "name": plugin["name"],
                "source": {"source": "local", "path": f"../../plugins/{plugin['name']}"},
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
        for name, server in plugin.get("mcpServers", {}).items():
            mcp_servers[name] = server
    role_affinity = {
        plugin["name"]: plugin.get("roleAffinity", [])
        for plugin in plugins
        if plugin.get("roleAffinity")
    }
    return {
        MARKETPLACE / "marketplace.json": dump_json(root_marketplace),
        EXPORT_ROOT / "codex" / "marketplace.json": dump_json(codex_marketplace),
        EXPORT_ROOT / "mcp" / "mcp.json": dump_json({"mcpServers": mcp_servers}),
        EXPORT_ROOT / "roles" / "role-affinity.json": dump_json(role_affinity),
    }


def expected_files(catalog: dict[str, Any]) -> dict[Path, str]:
    files = package_files(catalog)
    files.update(marketplace_files(catalog))
    return files


def write_files(files: dict[Path, str]) -> None:
    for path, content in sorted(files.items()):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")


def check_files(files: dict[Path, str]) -> list[str]:
    problems: list[str] = []
    for path, expected in sorted(files.items()):
        if not path.exists():
            problems.append(f"missing {path.relative_to(ROOT)}")
            continue
        actual = path.read_text(encoding="utf-8")
        if actual != expected:
            problems.append(f"stale {path.relative_to(ROOT)}")
    return problems


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="verify generated marketplace files are up to date")
    args = parser.parse_args()

    try:
        catalog = load_catalog()
        files = expected_files(catalog)
        if args.check:
            problems = check_files(files)
            if problems:
                for problem in problems:
                    print(problem, file=sys.stderr)
                return 1
            print(f"marketplace_ok files={len(files)} plugins={len(catalog['plugins'])}")
            return 0
        write_files(files)
        print(f"marketplace_synced files={len(files)} plugins={len(catalog['plugins'])}")
        return 0
    except Exception as exc:
        print(f"marketplace_error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
