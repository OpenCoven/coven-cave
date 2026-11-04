import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * Detect the optional package without evaluating any of its modules.
 *
 * Look only in this project's own node_modules, the scope Turbopack resolves
 * the aliases below in. Node's resolver would also walk parent directories,
 * so an issue worktree nested under a checkout that has the package would be
 * judged "installed" and then fail to build on aliases it cannot resolve
 * (#6312). pnpm always links a direct dependency at the project root.
 */
export function researchPackageConfig(root = process.cwd()) {
  const available = existsSync(path.join(root, 'node_modules', '@opencoven', 'research', 'package.json'));
  const aliases = {
    '@opencoven/research-runtime': available
      ? '@opencoven/research/server'
      : './src/lib/server/research-package-absent.ts',
    '@opencoven/research-client': available
      ? '@opencoven/research/client'
      : './src/components/role-surfaces/research-package-absent.tsx',
    '@opencoven/research-room': available
      ? './src/components/role-surfaces/researcher-room.ts'
      : './src/components/role-surfaces/research-package-absent.tsx',
  };
  const adapterRoot = path.join(root, 'src/lib/research-host');
  function walk(relative = '') {
    for (const entry of readdirSync(path.join(adapterRoot, relative), { withFileTypes: true })) {
      const name = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) walk(name);
      else if (name.endsWith('.ts')) aliases[`@opencoven/research-host/${name.slice(0, -3)}`] = `./src/lib/research-host/${name}`;
    }
  }
  walk();
  return { available, aliases };
}
