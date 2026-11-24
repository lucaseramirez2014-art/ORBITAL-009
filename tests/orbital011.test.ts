import { execFileSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalProtectionService } from '@cobalix/agents';
import { MIGRATIONS, openDatabase, runMigrations } from '@cobalix/db';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: typeof DatabaseSyncType };

const tempDirs: string[] = [];
const activeChildren: Array<ReturnType<typeof spawn>> = [];

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function launchBundledCompanion(dataDir: string): Promise<{
  child: ReturnType<typeof spawn>;
  baseUrl: string;
  token: string;
}> {
  const bundlePath = path.resolve('apps/desktop/src-tauri/resources/companion/companion.mjs');
  const child = spawn(process.execPath, [bundlePath], {
    env: {
      ...process.env,
      COBALIX_DATA_DIR: dataDir,
      COBALIX_PORT: '0',
      COBALIX_WATCH_PARENT_STDIN: '1'
    },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  activeChildren.push(child);

  let logs = '';
  const baseUrl = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Companion startup timed out. logs=${logs}`)), 10000);
    child.stdout?.on('data', (chunk) => {
      const text = chunk.toString();
      logs += text;
      const match = logs.match(/listening on (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]!);
      }
    });
    child.stderr?.on('data', (chunk) => {
      logs += chunk.toString();
    });
    child.once('exit', (code, sig) => {
      clearTimeout(timer);
      reject(new Error(`Companion exited prematurely (code=${code}, sig=${sig}). logs=${logs}`));
    });
  });

  const token = fs.readFileSync(path.join(dataDir, 'session-token'), 'utf8').trim();
  return { child, baseUrl, token };
}

async function stopCompanionCleanly(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore
      }
      resolve();
    }, 4000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill('SIGTERM');
  });
}

afterEach(async () => {
  while (activeChildren.length > 0) {
    const child = activeChildren.pop()!;
    await stopCompanionCleanly(child);
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('ORBITAL 011 Distribution Engineering & Upgrade Reliability', () => {
  it('creates a 0600 pre-migration backup before upgrading an older schema database and preserves all existing data', () => {
    const dataDir = makeTempDir('cobalix-o11-upgrade-data-');
    const repoDir = makeTempDir('cobalix-o11-upgrade-repo-');
    const dbPath = path.join(dataDir, 'obsidian.sqlite');

    // Simulate an older v1-only installation database
    const legacyDb = new DatabaseSync(dbPath);
    legacyDb.exec('PRAGMA journal_mode = WAL;');
    legacyDb.exec('PRAGMA foreign_keys = ON;');
    runMigrations(legacyDb, [MIGRATIONS[0]!]);

    legacyDb
      .prepare(
        `INSERT INTO assets (id, display_name, asset_type, canonical_path, monitoring_status, scan_config_json, registered_at, last_scan_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        'asset-legacy-1',
        'Legacy Upgrade Asset',
        'repository',
        repoDir,
        'active',
        JSON.stringify({ exclusions: ['node_modules', '.git'] }),
        '2026-11-01T00:00:00.000Z',
        null
      );

    legacyDb
      .prepare(`INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)`)
      .run('custom_upgrade_marker', JSON.stringify('preserved-across-upgrade'), '2026-11-01T00:00:00.000Z');

    legacyDb
      .prepare(
        `INSERT INTO agent_runs (id, agent, action, status, asset_id, started_at, completed_at, summary, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        'run-legacy-1',
        'nightwatch',
        'scan:manual',
        'completed',
        'asset-legacy-1',
        '2026-11-01T00:00:00.000Z',
        '2026-11-01T00:01:00.000Z',
        'Legacy run preserved',
        null
      );
    legacyDb.close();

    // Open with current openDatabase(): must snapshot pre-migration-v1 backup and upgrade cleanly
    const upgraded = openDatabase(dataDir);
    try {
      const files = fs.readdirSync(dataDir);
      const backups = files.filter((f) => f.startsWith('obsidian.sqlite.pre-migration-v1-') && f.endsWith('.bak'));
      expect(backups).toHaveLength(1);
      const backupMode = fs.statSync(path.join(dataDir, backups[0]!)).mode & 0o777;
      expect(backupMode).toBe(0o600);

      const applied = upgraded.db
        .prepare('SELECT version FROM schema_migrations ORDER BY version ASC')
        .all() as Array<{ version: number }>;
      expect(applied.map((r) => r.version)).toEqual(MIGRATIONS.map((m) => m.version));

      const assetRow = upgraded.db
        .prepare('SELECT id, display_name FROM assets WHERE id = ?')
        .get('asset-legacy-1') as { id: string; display_name: string } | undefined;
      expect(assetRow?.display_name).toBe('Legacy Upgrade Asset');

      const markerRow = upgraded.db
        .prepare('SELECT value_json FROM settings WHERE key = ?')
        .get('custom_upgrade_marker') as { value_json: string } | undefined;
      expect(JSON.parse(markerRow!.value_json)).toBe('preserved-across-upgrade');

      const runRow = upgraded.db
        .prepare('SELECT summary FROM agent_runs WHERE id = ?')
        .get('run-legacy-1') as { summary: string } | undefined;
      expect(runRow?.summary).toBe('Legacy run preserved');
    } finally {
      upgraded.close();
    }
  });

  it('rolls back failed future schema migrations atomically without corrupting existing data', () => {
    const dataDir = makeTempDir('cobalix-o11-rollback-');
    const database = openDatabase(dataDir);
    try {
      database.db
        .prepare(`INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)`)
        .run('rollback_guard', JSON.stringify(42), '2026-11-23T00:00:00.000Z');

      const failingUpgrade = [
        ...MIGRATIONS,
        {
          version: 999,
          name: 'broken_future_migration',
          sql: `
            ALTER TABLE settings ADD COLUMN broken_col INTEGER DEFAULT 0;
            INSERT INTO nonexistent_table_for_test VALUES (1);
          `
        }
      ];

      expect(() => runMigrations(database.db, failingUpgrade)).toThrow();

      const applied = database.db
        .prepare('SELECT version FROM schema_migrations ORDER BY version ASC')
        .all() as Array<{ version: number }>;
      expect(applied.some((r) => r.version === 999)).toBe(false);

      const cols = database.db.prepare('PRAGMA table_info(settings)').all() as Array<{ name: string }>;
      expect(cols.some((c) => c.name === 'broken_col')).toBe(false);

      const guardRow = database.db
        .prepare('SELECT value_json FROM settings WHERE key = ?')
        .get('rollback_guard') as { value_json: string } | undefined;
      expect(JSON.parse(guardRow!.value_json)).toBe(42);
    } finally {
      database.close();
    }
  });

  it('preserves user SQLite data and fallback credentials across simulated reinstallation while rotating 0600 session tokens', async () => {
    const dataDir = makeTempDir('cobalix-o11-reinstall-data-');
    const repoDir = makeTempDir('cobalix-o11-reinstall-repo-');
    fs.mkdirSync(path.join(repoDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(repoDir, 'src', 'index.ts'), 'export const alive = true;\n');

    const credPath = path.join(dataDir, 'credentials.json');
    const dummyApiCred = ['cobalix_dummy_', 'reinstall_preserve_token'].join('');
    fs.writeFileSync(credPath, JSON.stringify({ openai: dummyApiCred }, null, 2), { mode: 0o600 });

    const run1 = await launchBundledCompanion(dataDir);
    const token1Mode = fs.statSync(path.join(dataDir, 'session-token')).mode & 0o777;
    expect(token1Mode).toBe(0o600);

    const regRes = await fetch(`${run1.baseUrl}/api/assets`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Cobalix-Token': run1.token
      },
      body: JSON.stringify({
        displayName: 'Reinstall Persistence Asset',
        assetType: 'repository',
        path: repoDir
      })
    });
    expect(regRes.status).toBe(201);

    await stopCompanionCleanly(run1.child);
    expect(fs.existsSync(path.join(dataDir, 'session-token'))).toBe(false);
    expect(fs.existsSync(credPath)).toBe(true);

    // Simulated reinstall / new app session opening the same dataDir
    const run2 = await launchBundledCompanion(dataDir);
    try {
      expect(run2.token).not.toBe(run1.token);
      expect(fs.statSync(path.join(dataDir, 'session-token')).mode & 0o777).toBe(0o600);

      const assetsRes = await fetch(`${run2.baseUrl}/api/assets`, {
        headers: { 'X-Cobalix-Token': run2.token }
      });
      expect(assetsRes.status).toBe(200);
      const assets = (await assetsRes.json()) as Array<{ displayName: string }>;
      expect(assets.some((a) => a.displayName === 'Reinstall Persistence Asset')).toBe(true);

      // Existing credentials file untouched
      const savedCreds = JSON.parse(fs.readFileSync(credPath, 'utf8')) as { openai?: string };
      expect(savedCreds.openai).toBe(dummyApiCred);
    } finally {
      await stopCompanionCleanly(run2.child);
    }
  });

  it('handles missing optional scanners cleanly and rejects invalid data directory cleanly', async () => {
    const dataDir = makeTempDir('cobalix-o11-noscanners-data-');
    const repoDir = makeTempDir('cobalix-o11-noscanners-repo-');
    const blockerRoot = makeTempDir('cobalix-o11-bad-dir-');
    fs.mkdirSync(path.join(repoDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(repoDir, 'src', 'tls.ts'), 'export const cfg = { rejectUnauthorized: false };\n');

    const service = new LocalProtectionService(dataDir);
    try {
      const missingBin = path.join(repoDir, 'missing-scanner-binary');
      service.updateSettings({
        scannerPaths: {
          gitleaks: missingBin,
          osvScanner: missingBin,
          eslint: missingBin
        }
      });

      const registered = service.registerAsset({
        displayName: 'Missing Scanners Fallback Repo',
        assetType: 'repository',
        path: repoDir
      });
      const asset = service.updateAssetConfig(registered.id, { enableNpmAudit: false });

      const scan = await service.nightwatch.runScan(asset, 'manual');
      expect(scan.status).toBe('completed');
      const gl = scan.scannerResults.find((s) => s.scanner === 'gitleaks');
      const osv = scan.scannerResults.find((s) => s.scanner === 'osv-scanner');
      const eslint = scan.scannerResults.find((s) => s.scanner === 'eslint');
      expect(gl?.available).toBe(false);
      expect(osv?.available).toBe(false);
      expect(eslint?.available).toBe(false);

      // Built-in deterministic static inspector still runs reliably
      const findings = service.nightwatch.listFindings({ assetId: asset.id });
      expect(findings.some((f) => f.scannerSource === 'obsidian-static-inspector')).toBe(true);
    } finally {
      service.close();
    }

    const regularFileBlocker = path.join(blockerRoot, 'file-not-dir');
    fs.writeFileSync(regularFileBlocker, 'occupied');
    expect(() => openDatabase(path.join(regularFileBlocker, 'nested'))).toThrow();
  });

  it('rejects unverified Node runtime tarballs on SHA-256 mismatch and stages verified Node fixtures with attribution and manifest', () => {
    const workDir = makeTempDir('cobalix-o11-stage-work-');
    const stageOut = path.join(workDir, 'staged-runtime');
    const pkgRoot = path.join(workDir, 'node-v24.0.0-fixture-darwin-x64');
    fs.mkdirSync(path.join(pkgRoot, 'bin'), { recursive: true });

    const fakeNodeBin = path.join(pkgRoot, 'bin', 'node');
    fs.writeFileSync(fakeNodeBin, `#!/bin/sh\nexec "${process.execPath}" "$@"\n`, { mode: 0o755 });
    fs.chmodSync(fakeNodeBin, 0o755);

    fs.writeFileSync(
      path.join(pkgRoot, 'LICENSE'),
      'Node.js MIT License Fixture\nCopyright Node.js contributors.\nPermission is hereby granted, free of charge...\n'
    );

    const tarball = path.join(workDir, 'node-fixture.tar.gz');
    execFileSync('tar', ['-czf', tarball, '-C', workDir, 'node-v24.0.0-fixture-darwin-x64']);
    const realSha = crypto.createHash('sha256').update(fs.readFileSync(tarball)).digest('hex');

    const scriptPath = path.resolve('scripts/stage-node-runtime.mjs');

    // 1. Mismatched SHA-256 must fail loudly and produce no staged output
    expect(() =>
      execFileSync(
        process.execPath,
        [
          scriptPath,
          '--tarball',
          tarball,
          '--sha256',
          '0'.repeat(64),
          '--arch',
          'x64',
          '--version',
          'v24.0.0-fixture',
          '--out-dir',
          stageOut,
          '--skip-arch-check'
        ],
        { stdio: 'pipe' }
      )
    ).toThrow();
    expect(fs.existsSync(stageOut)).toBe(false);

    // 2. Verified SHA-256 stages executable node, validates node:sqlite, writes notices and manifest
    const out = execFileSync(
      process.execPath,
      [
        scriptPath,
        '--tarball',
        tarball,
        '--sha256',
        realSha,
        '--arch',
        'x64',
        '--version',
        'v24.0.0-fixture',
        '--out-dir',
        stageOut,
        '--source-url',
        'https://nodejs.org/dist/v24.0.0/node-fixture.tar.gz',
        '--skip-arch-check'
      ],
      { encoding: 'utf8' }
    );
    const parsedOut = JSON.parse(out) as { staged: boolean; binarySha256: string };
    expect(parsedOut.staged).toBe(true);
    expect(fs.existsSync(path.join(stageOut, 'node'))).toBe(true);
    expect((fs.statSync(path.join(stageOut, 'node')).mode & 0o111) !== 0).toBe(true);

    const notices = fs.readFileSync(path.join(stageOut, 'THIRD_PARTY_NOTICES.txt'), 'utf8');
    expect(notices).toContain('Node.js v24.0.0-fixture (x64)');
    expect(notices).toContain(realSha);
    expect(notices).toContain('Node.js MIT License Fixture');

    const manifest = JSON.parse(fs.readFileSync(path.join(stageOut, 'runtime-manifest.json'), 'utf8')) as {
      tauriTargetTriple: string;
      tarballSha256: string;
      binarySha256: string;
      attributionFile: string;
    };
    expect(manifest.tauriTargetTriple).toBe('x86_64-apple-darwin');
    expect(manifest.tarballSha256).toBe(realSha);
    expect(manifest.binarySha256).toBe(parsedOut.binarySha256);
    expect(manifest.attributionFile).toBe('THIRD_PARTY_NOTICES.txt');
  });
});
