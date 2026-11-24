#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (!flag.startsWith('--')) continue;
    const key = flag.slice(2);
    if (key === 'skip-arch-check' || key === 'skip-sqlite-check' || key === 'help') {
      args[key] = true;
    } else if (i + 1 < argv.length) {
      args[key] = argv[++i];
    } else {
      throw new Error(`Missing value for --${key}`);
    }
  }
  return args;
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex').toLowerCase();
}

function findExtractedNodeAndLicense(extractRoot) {
  let nodePath = null;
  let licensePath = null;

  const walk = (dir, depth = 0) => {
    if (depth > 4) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
      } else if (entry.isFile()) {
        const rel = path.relative(extractRoot, full).replace(/\\/g, '/');
        if (rel.endsWith('/bin/node') || rel === 'bin/node') {
          nodePath = full;
        } else if (entry.name === 'LICENSE' && depth <= 2) {
          licensePath = full;
        }
      }
    }
  };

  walk(extractRoot);
  return { nodePath, licensePath };
}

function usage() {
  console.log(`Usage: node scripts/stage-node-runtime.mjs \\
  --tarball <path-to-node-darwin-tar.gz|xz> \\
  --sha256 <expected-64-hex-sha256> \\
  --arch <x64|arm64> \\
  --version <v24.x.y> \\
  [--out-dir <apps/desktop/src-tauri/resources/runtime>] \\
  [--source-url <https://nodejs.org/dist/...>] \\
  [--skip-arch-check] [--skip-sqlite-check]`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  const tarball = args.tarball;
  const expectedSha = typeof args.sha256 === 'string' ? args.sha256.trim().toLowerCase() : '';
  const arch = typeof args.arch === 'string' ? args.arch.trim() : '';
  const version = typeof args.version === 'string' ? args.version.trim() : '';
  const outDir = args['out-dir']
    ? path.resolve(args['out-dir'])
    : path.join(repoRoot, 'apps', 'desktop', 'src-tauri', 'resources', 'runtime');
  const sourceUrl = typeof args['source-url'] === 'string' ? args['source-url'].trim() : 'local-verified-tarball';

  if (!tarball || !expectedSha || !arch || !version) {
    usage();
    throw new Error('Required arguments: --tarball, --sha256, --arch, --version');
  }
  if (!/^[a-f0-9]{64}$/.test(expectedSha)) {
    throw new Error(`Invalid --sha256 checksum format: "${expectedSha}" (expected 64 hex chars).`);
  }
  if (arch !== 'x64' && arch !== 'arm64') {
    throw new Error(`Unsupported --arch "${arch}". Expected "x64" or "arm64".`);
  }
  const absTarball = path.resolve(tarball);
  if (!fs.existsSync(absTarball)) {
    throw new Error(`Tarball does not exist: ${absTarball}`);
  }

  const actualSha = sha256File(absTarball);
  if (actualSha !== expectedSha) {
    throw new Error(
      `SHA-256 verification failed for ${absTarball}: expected ${expectedSha}, got ${actualSha}. Refusing to stage unverified runtime.`
    );
  }

  const tempExtractDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cobalix-stage-node-'));
  try {
    execFileSync('tar', ['-xf', absTarball, '-C', tempExtractDir], { stdio: 'pipe' });
    const { nodePath, licensePath } = findExtractedNodeAndLicense(tempExtractDir);
    if (!nodePath) {
      throw new Error(`Extracted archive did not contain bin/node: ${absTarball}`);
    }
    if (!licensePath) {
      throw new Error(`Extracted archive did not contain LICENSE for third-party attribution: ${absTarball}`);
    }

    if (!args['skip-arch-check']) {
      const fileOut = execFileSync('file', [nodePath], { encoding: 'utf8' });
      const expectedArchToken = arch === 'x64' ? 'x86_64' : 'arm64';
      if (!fileOut.includes('Mach-O') || !fileOut.includes(expectedArchToken)) {
        throw new Error(
          `Mach-O architecture check failed for bundled node binary. Expected ${expectedArchToken}, got: ${fileOut.trim()}`
        );
      }
    }

    fs.chmodSync(nodePath, 0o755);

    if (!args['skip-sqlite-check']) {
      execFileSync(
        nodePath,
        ['-e', "import('node:sqlite').then(() => process.exit(0)).catch(() => process.exit(1))"],
        { stdio: 'pipe' }
      );
    }

    fs.mkdirSync(outDir, { recursive: true });
    const stagedBinary = path.join(outDir, 'node');
    fs.copyFileSync(nodePath, stagedBinary);
    fs.chmodSync(stagedBinary, 0o755);

    const licenseText = fs.readFileSync(licensePath, 'utf8');
    const noticesContent = [
      'Cobalix Orbital — Third-Party Runtime Attribution',
      `Bundled Runtime: Node.js ${version} (${arch})`,
      `Verified Source: ${sourceUrl}`,
      `Archive SHA-256: ${actualSha}`,
      '',
      'Node.js is redistributed in compliance with the Node.js MIT license and its bundled dependency notices below:',
      '================================================================================',
      '',
      licenseText.trimEnd(),
      ''
    ].join('\n');
    const noticesPath = path.join(outDir, 'THIRD_PARTY_NOTICES.txt');
    fs.writeFileSync(noticesPath, noticesContent, { mode: 0o644 });

    const binarySha = sha256File(stagedBinary);
    const manifest = {
      product: 'Cobalix Orbital',
      runtime: 'nodejs',
      version,
      arch,
      tauriTargetTriple: arch === 'x64' ? 'x86_64-apple-darwin' : 'aarch64-apple-darwin',
      sourceUrl,
      tarballSha256: actualSha,
      binarySha256: binarySha,
      stagedAt: new Date().toISOString(),
      attributionFile: 'THIRD_PARTY_NOTICES.txt'
    };
    const manifestPath = path.join(outDir, 'runtime-manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o644 });

    console.log(
      JSON.stringify(
        {
          staged: true,
          stagedBinary,
          noticesPath,
          manifestPath,
          binarySha256: binarySha
        },
        null,
        2
      )
    );
  } finally {
    fs.rmSync(tempExtractDir, { recursive: true, force: true });
  }
}

main();
