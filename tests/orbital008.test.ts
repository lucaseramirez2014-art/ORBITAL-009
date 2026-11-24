import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalProtectionService } from '@cobalix/agents';
import { openDatabase } from '@cobalix/db';
import { runGitleaksScanner, runOsvScanner } from '@cobalix/scanners';

const tempDirs: string[] = [];
const chmodRestores: Array<{ target: string; mode: number }> = [];
const activeChildren: Array<ReturnType<typeof spawn>> = [];

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function createNodeStub(dir: string, filename: string, body: string): string {
  const binPath = path.join(dir, filename);
  fs.writeFileSync(binPath, `#!/usr/bin/env node\n${body}\n`, { mode: 0o755 });
  fs.chmodSync(binPath, 0o755);
  return binPath;
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
      reject(new Error(`Companion exited unexpectedly (code=${code}, sig=${sig}). logs=${logs}`));
    });
  });

  const tokenPath = path.join(dataDir, 'session-token');
  const token = fs.readFileSync(tokenPath, 'utf8').trim();
  return { child, baseUrl, token };
}

async function stopCompanionCleanly(child: ReturnType<typeof spawn>): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve({ code: child.exitCode, signal: child.signalCode });
      return;
    }
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore
      }
    }, 4000);
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
    child.kill('SIGTERM');
  });
}

afterEach(async () => {
  while (activeChildren.length > 0) {
    const child = activeChildren.pop()!;
    if (child.exitCode === null && child.signalCode === null) {
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore
      }
    }
  }
  while (chmodRestores.length > 0) {
    const entry = chmodRestores.pop()!;
    try {
      fs.chmodSync(entry.target, entry.mode);
    } catch {
      // ignore
    }
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('ORBITAL 008 First-Launch, Installation & Crash-Recovery Regressions', () => {
  it('initializes fresh COBALIX_DATA_DIR cleanly with 0600 token, SQLite schema, missing-scanner reporting, and clean SIGTERM stop', async () => {
    const parent = makeTempDir('cobalix-o8-fresh-');
    const freshDataDir = path.join(parent, 'brand-new-data-dir');
    const repoDir = makeTempDir('cobalix-o8-fresh-repo-');
    fs.writeFileSync(path.join(repoDir, 'app.ts'), 'export const tls = { rejectUnauthorized: false };\n');

    const { child, baseUrl, token } = await launchBundledCompanion(freshDataDir);
    const tokenPath = path.join(freshDataDir, 'session-token');
    const dbPath = path.join(freshDataDir, 'obsidian.sqlite');

    expect(fs.existsSync(dbPath)).toBe(true);
    expect(fs.statSync(tokenPath).mode & 0o777).toBe(0o600);

    // Health is public & minimal; overview requires auth
    const health = await fetch(`${baseUrl}/api/health`);
    expect(health.status).toBe(200);
    expect(await fetch(`${baseUrl}/api/overview`).then((r) => r.status)).toBe(401);

    // Configure missing custom scanner paths and verify diagnostics + static scan still work
    const updateRes = await fetch(`${baseUrl}/api/settings`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-Cobalix-Token': token
      },
      body: JSON.stringify({
        scannerPaths: {
          gitleaks: path.join(parent, 'missing-gitleaks'),
          osvScanner: path.join(parent, 'missing-osv'),
          eslint: path.join(parent, 'missing-eslint')
        }
      })
    });
    expect(updateRes.status).toBe(200);

    const diagRes = await fetch(`${baseUrl}/api/scanners/status`, {
      headers: { 'X-Cobalix-Token': token }
    });
    expect(diagRes.status).toBe(200);
    const diags = (await diagRes.json()) as Array<{ scanner: string; available: boolean }>;
    expect(diags.find((d) => d.scanner === 'gitleaks')?.available).toBe(false);
    expect(diags.find((d) => d.scanner === 'osv-scanner')?.available).toBe(false);
    expect(diags.find((d) => d.scanner === 'eslint')?.available).toBe(false);

    const assetRes = await fetch(`${baseUrl}/api/assets`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Cobalix-Token': token
      },
      body: JSON.stringify({
        displayName: 'Fresh First-Launch Repo',
        assetType: 'repository',
        path: repoDir
      })
    });
    expect(assetRes.status).toBe(201);
    const asset = (await assetRes.json()) as { id: string };

    const scanRes = await fetch(`${baseUrl}/api/assets/${encodeURIComponent(asset.id)}/scan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Cobalix-Token': token
      },
      body: '{}'
    });
    expect(scanRes.status).toBe(200);
    const scan = (await scanRes.json()) as { status: string; findingsCreated: number };
    expect(scan.findingsCreated).toBeGreaterThanOrEqual(1);
    expect(['completed', 'completed_with_errors']).toContain(scan.status);

    await stopCompanionCleanly(child);
    expect(fs.existsSync(tokenPath)).toBe(false);
  });

  it('handles unreadable project folders and invalid/unwritable database paths without hanging', async () => {
    const work = makeTempDir('cobalix-o8-perms-');
    const blockerFile = path.join(work, 'regular-file');
    fs.writeFileSync(blockerFile, 'not a directory\n');
    expect(() => openDatabase(path.join(blockerFile, 'nested-data'))).toThrow();

    const dataDir = makeTempDir('cobalix-o8-perm-data-');
    const repoDir = makeTempDir('cobalix-o8-perm-repo-');
    const lockedSubdir = path.join(repoDir, 'no-access');
    fs.mkdirSync(lockedSubdir, { recursive: true });
    fs.writeFileSync(path.join(lockedSubdir, 'secret.txt'), 'locked\n');
    fs.writeFileSync(path.join(repoDir, 'readable.ts'), 'export const tls = { rejectUnauthorized: false };\n');

    fs.chmodSync(lockedSubdir, 0o000);
    chmodRestores.push({ target: lockedSubdir, mode: 0o755 });

    const service = new LocalProtectionService(dataDir);
    const asset = service.registerAsset({
      displayName: 'Partial Access Repo',
      assetType: 'repository',
      path: repoDir
    });
    const scan = await service.nightwatch.runScan(asset, 'manual');

    if (process.getuid?.() !== 0) {
      expect(scan.status).toBe('completed_with_errors');
      expect(scan.errors.some((e) => e.includes('no-access'))).toBe(true);
    }
    service.close();
  });

  it('reconciles interrupted scans after an abrupt SIGKILL crash, rotates session-token, and leaves zero orphan state', async () => {
    const dataDir = makeTempDir('cobalix-o8-crash-data-');
    const repoDir = makeTempDir('cobalix-o8-crash-repo-');
    fs.writeFileSync(path.join(repoDir, 'main.ts'), 'export const ok = true;\n');

    // Simulate an interrupted scan / agent run + leftover stale session-token
    const preDb = openDatabase(dataDir);
    const assetId = 'asset-interrupted-1';
    const scanId = 'scan-interrupted-1';
    const runId = 'run-interrupted-1';
    const now = new Date().toISOString();
    preDb.db
      .prepare(
        `INSERT INTO assets (id, display_name, asset_type, canonical_path, scan_config_json, monitoring_status, registered_at)
         VALUES (?, 'Crash Repo', 'repository', ?, '{}', 'active', ?)`
      )
      .run(assetId, fs.realpathSync(repoDir), now);
    preDb.db
      .prepare(
        `INSERT INTO scans (id, asset_id, trigger, status, started_at, errors_json)
         VALUES (?, ?, 'manual', 'running', ?, '[]')`
      )
      .run(scanId, assetId, now);
    preDb.db
      .prepare(
        `INSERT INTO agent_runs (id, agent, action, status, asset_id, started_at, summary)
         VALUES (?, 'nightwatch', 'scan:manual', 'running', ?, ?, 'In progress')`
      )
      .run(runId, assetId, now);
    preDb.close();

    const staleToken = 'stale'.padEnd(64, '0');
    const tokenPath = path.join(dataDir, 'session-token');
    fs.writeFileSync(tokenPath, staleToken, { mode: 0o600 });

    const run1 = await launchBundledCompanion(dataDir);
    expect(run1.token).not.toBe(staleToken);

    // Stale token rejected
    expect(
      await fetch(`${run1.baseUrl}/api/scans`, {
        headers: { 'X-Cobalix-Token': staleToken }
      }).then((r) => r.status)
    ).toBe(401);

    // Startup reconciled stale running scan + agent run cleanly
    const scansRes = await fetch(`${run1.baseUrl}/api/scans`, {
      headers: { 'X-Cobalix-Token': run1.token }
    });
    expect(scansRes.status).toBe(200);
    const scans = (await scansRes.json()) as Array<{ id: string; status: string; errors: string[] }>;
    const reconciled = scans.find((s) => s.id === scanId);
    expect(reconciled?.status).toBe('interrupted');
    expect(reconciled?.errors.some((e) => e.toLowerCase().includes('interrupted'))).toBe(true);

    // Simulate sudden SIGKILL while running
    const crashPid = run1.child.pid!;
    const crashExit = new Promise<void>((resolve) => run1.child.once('exit', () => resolve()));
    run1.child.kill('SIGKILL');
    await crashExit;
    expect(() => process.kill(crashPid, 0)).toThrow();

    // Restart recovers cleanly and rotates session token
    const run2 = await launchBundledCompanion(dataDir);
    expect(run2.token).not.toBe(run1.token);
    const overview2 = await fetch(`${run2.baseUrl}/api/overview`, {
      headers: { 'X-Cobalix-Token': run2.token }
    });
    expect(overview2.status).toBe(200);

    await stopCompanionCleanly(run2.child);
    expect(fs.existsSync(tokenPath)).toBe(false);
  });

  it('recovers from scanner timeouts and malformed output while leaving zero temporary gitleaks files behind', async () => {
    const work = makeTempDir('cobalix-o8-scan-');
    const isolatedTmp = path.join(work, 'tmp');
    fs.mkdirSync(isolatedTmp, { recursive: true });
    const repoDir = path.join(work, 'repo');
    fs.mkdirSync(repoDir, { recursive: true });
    fs.writeFileSync(path.join(repoDir, 'index.ts'), 'export const a = 1;\n');

    const hangStub = createNodeStub(work, 'hang-bin', 'setTimeout(() => {}, 10000);');
    const badJsonStub = createNodeStub(
      work,
      'bad-json-bin',
      `
      const fs = require('node:fs');
      const idx = process.argv.indexOf('--report-path');
      if (idx !== -1) fs.writeFileSync(process.argv[idx + 1], '{corrupt json');
      process.stdout.write('{corrupt json');
      process.exit(0);
      `
    );

    const tmpSpy = vi.spyOn(os, 'tmpdir').mockReturnValue(isolatedTmp);
    try {
      const glTimeout = await runGitleaksScanner(repoDir, [], { binaryPath: hangStub, timeoutMs: 150 });
      expect(glTimeout.execution.executed).toBe(false);
      expect(glTimeout.execution.error).toContain('timed out');

      const glBad = await runGitleaksScanner(repoDir, [], { binaryPath: badJsonStub });
      expect(glBad.execution.executed).toBe(false);
      expect(glBad.execution.error).toBeTruthy();
      expect(glBad.findings).toEqual([]);

      const osvBad = await runOsvScanner(repoDir, [], { binaryPath: badJsonStub });
      expect(osvBad.execution.executed).toBe(false);
      expect(osvBad.execution.error).toBeTruthy();
      expect(osvBad.findings).toEqual([]);

      expect(fs.readdirSync(isolatedTmp)).toEqual([]);
    } finally {
      tmpSpy.mockRestore();
    }
  });
});
