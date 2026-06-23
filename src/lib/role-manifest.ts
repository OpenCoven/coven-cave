/**
 * Pure text transforms for ROLE.md list fields (skills, tools, plugins,
 * workflows). Mirrors the parsing in `src/app/api/roles/route.ts` so writes
 * stay readable by the existing roles GET. Everything outside the targeted
 * list block — frontmatter, prose, other lists — is preserved byte-for-byte.
 */

function listBlockPattern(field: string): RegExp {
  return new RegExp(`(^|\\n)${field}:\\s*\\n((?:\\s*-[^\\n]*\\n?)*)`);
}

/** Values of a `field:` dash-list block, or [] when absent. */
export function parseRoleListField(text: string, field: string): string[] {
  const match = text.match(listBlockPattern(field));
  if (!match) return [];
  return match[2].match(/- (.+)/g)?.map((m) => m.slice(2).trim()) ?? [];
}

/** MCP bindings have appeared under a few role-manifest spellings. Keep all
 * readable while the canonical field is `mcpServers:`. */
export function parseRoleMcpServers(text: string): string[] {
  const seen = new Set<string>();
  const servers: string[] = [];
  for (const field of ["mcpServers", "mcp", "mcp_servers"]) {
    for (const server of parseRoleListField(text, field)) {
      if (seen.has(server)) continue;
      seen.add(server);
      servers.push(server);
    }
  }
  return servers;
}

function renderBlock(field: string, values: string[], prefix = "\n"): string {
  return `${prefix}${field}:\n${values.map((value) => `- ${value}`).join("\n")}\n`;
}

/**
 * Replace (or insert) the `field:` dash-list block with `values`. An empty
 * `values` removes the block entirely. Returns the input string unchanged
 * (referentially) when the edit is a no-op.
 */
export function setRoleListField(text: string, field: string, values: string[]): string {
  const pattern = listBlockPattern(field);
  const match = text.match(pattern);
  let next: string;
  if (match) {
    const replacement = values.length > 0 ? renderBlock(field, values, match[1]) : match[1] || "";
    next = text.replace(pattern, replacement).replace(/\n{3,}/g, "\n\n");
  } else if (values.length > 0) {
    const base = text.endsWith("\n") ? text : `${text}\n`;
    next = `${base}${renderBlock(field, values)}`;
  } else {
    return text;
  }
  return next === text ? text : next;
}
