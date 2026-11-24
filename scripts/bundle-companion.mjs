import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const require = createRequire(import.meta.url);
let esbuild;
try {
  esbuild = require('esbuild');
} catch {
  const webRequire = createRequire(path.join(repoRoot, 'apps', 'web', 'package.json'));
  esbuild = webRequire('esbuild');
}

const outFile = path.join(repoRoot, 'apps', 'desktop', 'src-tauri', 'resources', 'companion', 'companion.mjs');
fs.mkdirSync(path.dirname(outFile), { recursive: true });

await esbuild.build({
  entryPoints: [path.join(repoRoot, 'apps', 'companion', 'src', 'index.ts')],
  outfile: outFile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['node:*'],
  alias: {
    '@cobalix/core': path.join(repoRoot, 'packages', 'core', 'src', 'index.ts'),
    '@cobalix/db': path.join(repoRoot, 'packages', 'db', 'src', 'index.ts'),
    '@cobalix/scanners': path.join(repoRoot, 'packages', 'scanners', 'src', 'index.ts'),
    '@cobalix/ai': path.join(repoRoot, 'packages', 'ai', 'src', 'index.ts'),
    '@cobalix/agents': path.join(repoRoot, 'packages', 'agents', 'src', 'index.ts')
  },
  sourcemap: false,
  logLevel: 'info'
});
