import { createRequire } from 'node:module';
import { readdirSync } from 'node:fs';
import path from 'node:path';

/** Resolve the optional package without evaluating any of its modules. */
export function researchPackageConfig(root = process.cwd()) {
  const require = createRequire(path.join(root, 'package.json'));
  let available = false;
  try {
    require.resolve('@opencoven/research/package.json');
    available = true;
  } catch (error) {
    if (error?.code !== 'MODULE_NOT_FOUND') throw error;
  }
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
