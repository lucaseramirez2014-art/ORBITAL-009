import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalProtectionService } from '@cobalix/agents';
import {
  normalizeEslintResults,
  normalizeGitleaksFindings,
  normalizeOsvOutput,
  normalizeScannerRelativePath,
  runEslintScanner
} from '@cobalix/scanners';
import { generateSessionToken } from '../apps/companion/src/auth.js';
import { createCompanionServer } from '../apps/companion/src/server.js';

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function listenServer(server: http.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve(typeof addr === 'object' && addr ? addr.port : 0);
    });
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('Milestone 006A Hardening & Fidelity Cleanup', () => {
  it('requires X-Cobalix-Token on all non-health GET endpoints while keeping /api/health public and minimal', async () => {
    const dataDir = makeTempDir('cobalix-m6a-data-');
    const repoDir = makeTempDir('cobalix-m6a-repo-');
    fs.mkdirSync(path.join(repoDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(repoDir, 'src', 'app.ts'), 'export const value = 1;\n');

    const service = new LocalProtectionService(dataDir);
    const asset = service.registerAsset({
      displayName: 'Auth Test Repo',
      assetType: 'repository',
      path: repoDir
    });
    await service.fileIntel.inventoryAsset(asset);
    const trackedFiles = service.fileIntel.listFiles({ assetId: asset.id });
    expect(trackedFiles.length).toBeGreaterThan(0);
    const fileId = trackedFiles[0]!.id;

    const authToken = generateSessionToken();
    const server = createCompanionServer(service, { authToken });
    const port = await listenServer(server);
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      // /api/health remains public and minimal
      const healthRes = await fetch(`${baseUrl}/api/health`);
      expect(healthRes.status).toBe(200);
      const healthJson = (await healthRes.json()) as Record<string, unknown>;
      expect(healthJson).toEqual({
        ok: true,
        service: 'cobalix-obsidian-companion',
        version: '0.1.0'
      });

      const protectedGetEndpoints = [
        '/api/overview',
        '/api/assets',
        `/api/assets/${encodeURIComponent(asset.id)}`,
        '/api/files',
        `/api/files/${encodeURIComponent(fileId)}`,
        '/api/file-changes',
        '/api/scans',
        '/api/findings',
        '/api/patches',
        '/api/recommendations',
        '/api/graph',
        '/api/chronicle',
        '/api/chronicle/integrity',
        '/api/agents/runs',
        '/api/settings',
        '/api/ai/config'
      ];

      for (const route of protectedGetEndpoints) {
        const noTokenRes = await fetch(`${baseUrl}${route}`);
        expect(noTokenRes.status, `expected 401 without token on GET ${route}`).toBe(401);
        const noTokenBody = (await noTokenRes.json()) as { error: string };
        expect(noTokenBody.error).toBe('UNAUTHORIZED');

        const wrongTokenRes = await fetch(`${baseUrl}${route}`, {
          headers: { 'X-Cobalix-Token': 'incorrect-session-token' }
        });
        expect(wrongTokenRes.status, `expected 401 with wrong token on GET ${route}`).toBe(401);
        const wrongTokenBody = (await wrongTokenRes.json()) as { error: string };
        expect(wrongTokenBody.error).toBe('UNAUTHORIZED');

        const validRes = await fetch(`${baseUrl}${route}`, {
          headers: { 'X-Cobalix-Token': authToken }
        });
        expect(validRes.status, `expected 200 with valid token on GET ${route}`).toBe(200);
      }

      // Origin & Sec-Fetch-Site protections stay intact alongside GET auth
      const evilOriginRes = await fetch(`${baseUrl}/api/overview`, {
        headers: {
          'X-Cobalix-Token': authToken,
          Origin: 'https://evil.example'
        }
      });
      expect(evilOriginRes.status).toBe(403);

      const crossSiteRes = await fetch(`${baseUrl}/api/settings`, {
        headers: {
          'X-Cobalix-Token': authToken,
          'Sec-Fetch-Site': 'cross-site'
        }
      });
      expect(crossSiteRes.status).toBe(403);

      // Mutating routes still require valid X-Cobalix-Token
      const unauthPatch = await fetch(`${baseUrl}/api/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aiRedactSecrets: true })
      });
      expect(unauthPatch.status).toBe(401);

      const authPatch = await fetch(`${baseUrl}/api/settings`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Cobalix-Token': authToken
        },
        body: JSON.stringify({ aiRedactSecrets: true })
      });
      expect(authPatch.status).toBe(200);
    } finally {
      await closeServer(server);
      service.close();
    }
  });

  it('normalizes scanner paths canonically across symlinked roots and /var vs /private/var while rejecting outside paths', async () => {
    const parent = makeTempDir('cobalix-m6a-norm-');
    const realRepo = path.join(parent, 'real-repo');
    const outsideDir = path.join(parent, 'outside');
    fs.mkdirSync(path.join(realRepo, 'src', 'nested'), { recursive: true });
    fs.mkdirSync(outsideDir, { recursive: true });

    const insideFile = path.join(realRepo, 'src', 'nested', 'vuln.js');
    const outsideFile = path.join(outsideDir, 'secret.js');
    fs.writeFileSync(insideFile, "const user = 'test';\n");
    fs.writeFileSync(outsideFile, "const secret = 'nope';\n");

    const symlinkRepo = path.join(parent, 'symlink-repo');
    fs.symlinkSync(realRepo, symlinkRepo);

    const escapedLink = path.join(realRepo, 'src', 'escape-link.js');
    fs.symlinkSync(outsideFile, escapedLink);

    const canonicalRoot = fs.realpathSync(realRepo);
    const canonicalInsideFile = fs.realpathSync(insideFile);

    // Valid relative, canonical, symlink-alias, and root-self paths
    expect(normalizeScannerRelativePath(realRepo, 'src/nested/vuln.js')).toEqual({
      valid: true,
      relativePath: 'src/nested/vuln.js'
    });
    expect(normalizeScannerRelativePath(realRepo, 'src\\nested\\vuln.js')).toEqual({
      valid: true,
      relativePath: 'src/nested/vuln.js'
    });
    expect(normalizeScannerRelativePath(symlinkRepo, canonicalInsideFile)).toEqual({
      valid: true,
      relativePath: 'src/nested/vuln.js'
    });
    expect(normalizeScannerRelativePath(canonicalRoot, path.join(symlinkRepo, 'src/nested/vuln.js'))).toEqual({
      valid: true,
      relativePath: 'src/nested/vuln.js'
    });
    expect(normalizeScannerRelativePath(symlinkRepo, '')).toEqual({
      valid: true,
      relativePath: null
    });
    expect(normalizeScannerRelativePath(symlinkRepo, undefined)).toEqual({
      valid: true,
      relativePath: null
    });

    // Reject root '.', outside, traversal, symlink-escape, and NUL paths
    expect(normalizeScannerRelativePath(symlinkRepo, '.')).toEqual({
      valid: false,
      relativePath: null
    });
    expect(normalizeScannerRelativePath(symlinkRepo, outsideFile)).toEqual({ valid: false, relativePath: null });
    expect(normalizeScannerRelativePath(symlinkRepo, '../outside/secret.js')).toEqual({
      valid: false,
      relativePath: null
    });
    expect(normalizeScannerRelativePath(symlinkRepo, escapedLink)).toEqual({
      valid: false,
      relativePath: null
    });
    expect(normalizeScannerRelativePath(symlinkRepo, 'src/bad\0file.js')).toEqual({
      valid: false,
      relativePath: null
    });

    // All three normalizers drop outside paths and emit clean repo-relative paths without traversal prefixes
    const eslintRaw = JSON.stringify([
      {
        filePath: canonicalInsideFile,
        messages: [{ ruleId: 'no-eval', severity: 2, message: 'Avoid eval', line: 1, endLine: 1 }]
      },
      {
        filePath: outsideFile,
        messages: [{ ruleId: 'no-eval', severity: 2, message: 'Should be ignored', line: 1 }]
      }
    ]);
    const eslintFindings = normalizeEslintResults(symlinkRepo, eslintRaw);
    expect(eslintFindings).toHaveLength(1);
    expect(eslintFindings[0]!.relativePath).toBe('src/nested/vuln.js');
    expect(eslintFindings[0]!.relativePath).not.toContain('..');

    const gitleaksFindings = normalizeGitleaksFindings(symlinkRepo, [
      {
        RuleID: 'generic-api-key',
        Description: 'Secret in canonical path',
        File: canonicalInsideFile,
        StartLine: 1,
        EndLine: 1,
        Match: 'sample-redacted-match'
      },
      {
        RuleID: 'generic-api-key',
        Description: 'Outside file secret',
        File: '../outside/secret.js',
        StartLine: 1,
        Match: 'outside'
      }
    ]);
    expect(gitleaksFindings).toHaveLength(1);
    expect(gitleaksFindings[0]!.relativePath).toBe('src/nested/vuln.js');

    const osvFindings = normalizeOsvOutput(symlinkRepo, {
      results: [
        {
          source: { path: path.join(canonicalRoot, 'package-lock.json') },
          packages: [
            {
              package: { name: 'example-pkg', version: '1.0.0', ecosystem: 'npm' },
              vulnerabilities: [{ id: 'OSV-2026-0001', summary: 'Vuln inside repo' }]
            }
          ]
        },
        {
          source: { path: outsideFile },
          packages: [
            {
              package: { name: 'outside-pkg', version: '1.0.0', ecosystem: 'npm' },
              vulnerabilities: [{ id: 'OSV-2026-0002', summary: 'Should be rejected' }]
            }
          ]
        }
      ]
    });
    expect(osvFindings).toHaveLength(1);
    expect(osvFindings[0]!.relativePath).toBe('package-lock.json');

    // Execute real local eslint binary against symlinked asset root (macOS /var vs /private/var equivalence)
    fs.writeFileSync(
      path.join(realRepo, 'eslint.config.mjs'),
      "export default [{ rules: { 'no-eval': 'error' } }];\n"
    );
    fs.writeFileSync(path.join(realRepo, 'src', 'eval.js'), "const x = eval('1 + 1');\nexport default x;\n");

    const localEslint = path.resolve('node_modules/.bin/eslint');
    const cliResult = await runEslintScanner(symlinkRepo, [], {
      binaryPath: localEslint,
      targetFiles: ['src/eval.js']
    });
    expect(cliResult.execution.executed).toBe(true);
    expect(cliResult.findings.length).toBeGreaterThanOrEqual(1);
    expect(cliResult.findings[0]!.relativePath).toBe('src/eval.js');
    expect(cliResult.findings[0]!.relativePath).not.toMatch(/^(\.\.|\/)/);
  });

  it('reconciles interrupted scans and agent runs on startup idempotently while keeping Chronicle valid', async () => {
    const dataDir = makeTempDir('cobalix-m6a-recov-data-');
    const repoDir = makeTempDir('cobalix-m6a-recov-repo-');
    fs.mkdirSync(path.join(repoDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(repoDir, 'src', 'index.ts'), 'export const ok = true;\n');

    const service1 = new LocalProtectionService(dataDir);
    const asset = service1.registerAsset({
      displayName: 'Recovery Repo',
      assetType: 'repository',
      path: repoDir,
      scanConfig: {
        enableGitleaks: false,
        enableOsvScanner: false,
        enableNpmAudit: false,
        enableEslint: false
      }
    });
    const baselineScan = await service1.nightwatch.runScan(asset, 'manual');
    expect(baselineScan.status).toBe('completed');

    // Verify migration v3 is applied and agent_runs schema supports 'interrupted'
    const migration3 = service1.db.db
      .prepare('SELECT version, name FROM schema_migrations WHERE version = 3')
      .get() as { version: number; name: string } | undefined;
    expect(migration3).toEqual({ version: 3, name: 'add_interrupted_agent_run_status' });

    // Inject interrupted rows simulating an abrupt termination before clean completion
    const staleScanId = 'scan-stale-001';
    const staleRunId = 'run-stale-001';
    const finishedRunId = 'run-failed-001';
    const ts = '2026-11-23T10:00:00.000Z';

    service1.db.db
      .prepare(
        `INSERT INTO scans (id, asset_id, trigger, status, started_at, completed_at, scanner_results_json, errors_json, skipped_locations_json)
         VALUES (?, ?, 'manual', 'running', ?, NULL, '[]', '[]', '[]')`
      )
      .run(staleScanId, asset.id, ts);

    service1.db.db
      .prepare(
        `INSERT INTO agent_runs (id, agent, action, status, asset_id, started_at, completed_at, summary, error)
         VALUES (?, 'nightwatch', 'run_scan', 'running', ?, ?, NULL, 'Running scan before crash', NULL)`
      )
      .run(staleRunId, asset.id, ts);

    service1.db.db
      .prepare(
        `INSERT INTO agent_runs (id, agent, action, status, asset_id, started_at, completed_at, summary, error)
         VALUES (?, 'saver', 'propose_fix', 'failed', ?, ?, ?, 'Previous failed run', 'Model offline')`
      )
      .run(finishedRunId, asset.id, ts, ts);

    service1.close();

    // First restart: startup reconciliation should mark stale rows interrupted and log Chronicle events
    const service2 = new LocalProtectionService(dataDir);
    const scansAfterFirstRestart = service2.nightwatch.listScans(asset.id);
    const recoveredScan = scansAfterFirstRestart.find((s) => s.id === staleScanId);
    const intactBaselineScan = scansAfterFirstRestart.find((s) => s.id === baselineScan.id);

    expect(recoveredScan).toBeDefined();
    expect(recoveredScan!.status).toBe('interrupted');
    expect(recoveredScan!.completedAt).toBeTruthy();
    expect(recoveredScan!.errors.join(' ')).toContain('Interrupted by companion restart');
    expect(intactBaselineScan!.status).toBe('completed');

    const runsAfterFirstRestart = service2.listAgentRuns();
    const recoveredRun = runsAfterFirstRestart.find((r) => r.id === staleRunId);
    const intactFailedRun = runsAfterFirstRestart.find((r) => r.id === finishedRunId);

    expect(recoveredRun).toBeDefined();
    expect(recoveredRun!.status).toBe('interrupted');
    expect(recoveredRun!.completedAt).toBeTruthy();
    expect(recoveredRun!.error).toContain('Interrupted by companion restart');
    expect(intactFailedRun!.status).toBe('failed');
    expect(intactFailedRun!.error).toBe('Model offline');

    const scanInterruptedEvents = service2.chronicle.listEvents({ eventType: 'scan_interrupted' });
    const runInterruptedEvents = service2.chronicle.listEvents({ eventType: 'agent_run_interrupted' });
    expect(scanInterruptedEvents).toHaveLength(1);
    expect(scanInterruptedEvents[0]!.assetId).toBe(asset.id);
    expect(runInterruptedEvents).toHaveLength(1);
    expect(runInterruptedEvents[0]!.assetId).toBe(asset.id);
    expect(service2.chronicle.verifyIntegrity().valid).toBe(true);

    service2.close();

    // Second restart: recovery must be idempotent with no duplicate events or status churn
    const service3 = new LocalProtectionService(dataDir);
    expect(service3.reconcileInterruptedRuns()).toEqual({ scansInterrupted: 0, agentRunsInterrupted: 0 });
    expect(service3.chronicle.listEvents({ eventType: 'scan_interrupted' })).toHaveLength(1);
    expect(service3.chronicle.listEvents({ eventType: 'agent_run_interrupted' })).toHaveLength(1);
    expect(service3.chronicle.verifyIntegrity().valid).toBe(true);

    // Subsequent normal scans still succeed cleanly after recovery
    const postRecoveryScan = await service3.nightwatch.runScan(asset, 'manual');
    expect(postRecoveryScan.status).toBe('completed');

    service3.close();
  });
});
