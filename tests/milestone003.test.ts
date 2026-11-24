import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { sha256Hex } from '@cobalix/core';
import { LocalProtectionService, SaverAgent } from '@cobalix/agents';
import {
  normalizeEslintResults,
  normalizeGitleaksFindings,
  normalizeOsvOutput,
  runEslintScanner,
  runNpmAuditScanner
} from '@cobalix/scanners';

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('Milestone 003: Remediation Integrity, Scanner Fidelity & AI Availability', () => {
  it('synchronizes File Intelligence baselines on Saver patch application and rollback while preserving history', async () => {
    const dataDir = makeTempDir('cobalix-m3-sync-data-');
    const repoDir = makeTempDir('cobalix-m3-sync-repo-');
    const targetFile = path.join(repoDir, 'tls.ts');
    const initialContent = 'export const tls = { rejectUnauthorized: false };\n';
    fs.writeFileSync(targetFile, initialContent);
    const initialHash = sha256Hex(initialContent);

    const service = new LocalProtectionService(dataDir);
    const asset = service.registerAsset({ displayName: 'Sync Repo', assetType: 'repository', path: repoDir });
    await service.nightwatch.runScan(asset, 'manual');

    const finding = service.nightwatch.listFindings({ assetId: asset.id })[0]!;
    const { patch } = await service.saver.explainAndPropose(finding.id);
    expect(patch).not.toBeNull();
    service.saver.decidePatch(patch!.id, 'approved');

    const applied = await service.saver.applyApprovedPatch(patch!.id);
    expect(applied.verificationStatus).toBe('passed');

    const patchedHash = sha256Hex(fs.readFileSync(targetFile, 'utf8'));
    expect(patchedHash).not.toBe(initialHash);

    // Subsequent File Intelligence inventory must NOT report Saver's fix as an unexpected modification
    const postApplyInventory = await service.fileIntel.inventoryAsset(asset);
    expect(postApplyInventory.filesModified).toBe(0);

    const fileDetail = service.fileIntel.getFileDetail(patch!.fileId);
    expect(fileDetail.file.sha256).toBe(patchedHash);
    expect(fileDetail.file.status).toBe('unchanged');
    expect(fileDetail.file.integrityStatus).toBe('verified');
    expect(fileDetail.baseline?.sha256).toBe(patchedHash);
    expect(fileDetail.changes[0]?.previousSha256).toBe(initialHash);
    expect(fileDetail.changes[0]?.currentSha256).toBe(patchedHash);
    expect(fileDetail.changes[0]?.diffText).toContain('+export const tls = { rejectUnauthorized: true };');

    const syncEvent = service.chronicle.listEvents({ eventType: 'baseline_synchronized' })[0];
    expect(syncEvent).toBeDefined();
    expect(syncEvent!.details.previousSha256).toBe(initialHash);
    expect(syncEvent!.details.currentSha256).toBe(patchedHash);

    // Revert patch and confirm File Intelligence baseline also rolls back cleanly
    const reverted = service.saver.revertPatch(patch!.id);
    expect(reverted.status).toBe('reverted');

    const postRevertInventory = await service.fileIntel.inventoryAsset(asset);
    expect(postRevertInventory.filesModified).toBe(0);

    const revertedDetail = service.fileIntel.getFileDetail(patch!.fileId);
    expect(revertedDetail.file.sha256).toBe(initialHash);
    expect(revertedDetail.baseline?.sha256).toBe(initialHash);
    expect(service.chronicle.listEvents({ eventType: 'baseline_reverted' })).toHaveLength(1);
    expect(service.chronicle.verifyIntegrity().valid).toBe(true);
    service.close();
  });

  it('reports baseline synchronization failures honestly without marking the finding resolved', async () => {
    const dataDir = makeTempDir('cobalix-m3-fail-sync-data-');
    const repoDir = makeTempDir('cobalix-m3-fail-sync-repo-');
    const targetFile = path.join(repoDir, 'tls.ts');
    fs.writeFileSync(targetFile, 'export const tls = { rejectUnauthorized: false };\n');

    const service = new LocalProtectionService(dataDir);
    const asset = service.registerAsset({ displayName: 'Fail Sync Repo', assetType: 'repository', path: repoDir });
    await service.nightwatch.runScan(asset, 'manual');

    const finding = service.nightwatch.listFindings({ assetId: asset.id })[0]!;
    const { patch } = await service.saver.explainAndPropose(finding.id);
    service.saver.decidePatch(patch!.id, 'approved');

    // Simulate missing baseline row so syncFileAfterControlledWrite fails
    service.db.db.prepare('DELETE FROM file_baselines WHERE file_id = ?').run(patch!.fileId);

    const applied = await service.saver.applyApprovedPatch(patch!.id);
    expect(applied.verificationStatus).toBe('failed');
    expect(applied.verificationNotes).toContain('Baseline synchronization failed');

    const refreshedFinding = service.nightwatch.listFindings({ assetId: asset.id })[0]!;
    expect(refreshedFinding.status).not.toBe('resolved');

    expect(service.chronicle.listEvents({ eventType: 'baseline_sync_failed' })).toHaveLength(1);
    service.close();
  });

  it('normalizes ESLint output, respects exclusions, and handles unavailable ESLint executable gracefully', async () => {
    const repoDir = makeTempDir('cobalix-m3-eslint-');
    const sampleReport = JSON.stringify([
      {
        filePath: path.join(repoDir, 'src', 'eval.ts'),
        messages: [
          { ruleId: 'no-eval', severity: 2, message: 'eval can be harmful.', line: 4, endLine: 4 },
          { ruleId: 'semi', severity: 1, message: 'Missing semicolon.', line: 5, endLine: 5 }
        ]
      },
      {
        filePath: path.join(repoDir, 'dist', 'bundle.js'),
        messages: [{ ruleId: 'no-eval', severity: 2, message: 'eval in generated dist', line: 1 }]
      }
    ]);

    const normalized = normalizeEslintResults(repoDir, sampleReport, ['dist']);
    expect(normalized).toHaveLength(2);
    expect(normalized[0]!.severity).toBe('high');
    expect(normalized[0]!.category).toBe('code_security');
    expect(normalized[0]!.scannerSource).toBe('eslint');
    expect(normalized[1]!.severity).toBe('low');
    expect(normalized[1]!.category).toBe('code_quality');

    const unavailable = await runEslintScanner(repoDir, ['dist'], {
      binaryPath: path.join(repoDir, 'nonexistent-eslint-binary')
    });
    expect(unavailable.execution.available).toBe(false);
    expect(unavailable.execution.executed).toBe(false);
    expect(unavailable.findings).toEqual([]);
  });

  it('applies configured exclusions consistently across Gitleaks, OSV, and npm audit normalization', async () => {
    const repoDir = makeTempDir('cobalix-m3-exclusions-');

    const gitleaksFindings = normalizeGitleaksFindings(
      repoDir,
      [
        { File: 'src/config.ts', RuleID: 'aws-access-token', StartLine: 3, Match: 'AKIA1234567890ABCDEF' },
        { File: 'fixtures/fake.ts', RuleID: 'aws-access-token', StartLine: 1, Match: 'AKIA1234567890ABCDEF' }
      ],
      ['fixtures']
    );
    expect(gitleaksFindings).toHaveLength(1);
    expect(gitleaksFindings[0]!.relativePath).toBe('src/config.ts');

    const osvFindings = normalizeOsvOutput(
      repoDir,
      {
        results: [
          {
            source: { path: path.join(repoDir, 'package-lock.json') },
            packages: [{ package: { name: 'lodash', version: '4.17.20', ecosystem: 'npm' }, vulnerabilities: [{ id: 'GHSA-1' }] }]
          },
          {
            source: { path: path.join(repoDir, 'vendor', 'package-lock.json') },
            packages: [{ package: { name: 'old', version: '1.0.0', ecosystem: 'npm' }, vulnerabilities: [{ id: 'GHSA-2' }] }]
          }
        ]
      },
      ['vendor']
    );
    expect(osvFindings).toHaveLength(1);
    expect(osvFindings[0]!.relativePath).toBe('package-lock.json');

    fs.writeFileSync(path.join(repoDir, 'package.json'), '{"name":"t"}');
    fs.writeFileSync(path.join(repoDir, 'package-lock.json'), '{"name":"t","lockfileVersion":3}');
    const npmOut = await runNpmAuditScanner(repoDir, ['package-lock.json']);
    expect(npmOut.execution.executed).toBe(false);
    expect(npmOut.execution.notes).toContain('excluded');
  });

  it('verifies Saver patches using the originating scanner and distinguishes verified vs unverified vs failed', async () => {
    const dataDir = makeTempDir('cobalix-m3-verify-data-');
    const repoDir = makeTempDir('cobalix-m3-verify-repo-');
    const targetFile = path.join(repoDir, 'app.ts');
    fs.writeFileSync(targetFile, 'eval("1+1");\n');

    const service = new LocalProtectionService(dataDir);
    const asset = service.registerAsset({ displayName: 'Verify Repo', assetType: 'repository', path: repoDir });
    await service.fileIntel.inventoryAsset(asset);
    const fileRec = service.fileIntel.listFiles({ assetId: asset.id })[0]!;

    const scanId = crypto.randomUUID();
    const now = new Date().toISOString();
    service.db.db
      .prepare(`INSERT INTO scans (id, asset_id, trigger, status, started_at, completed_at) VALUES (?, ?, 'manual', 'completed', ?, ?)`)
      .run(scanId, asset.id, now, now);

    // Insert an ESLint-originated finding (NOT obsidian-static-inspector)
    const findingId = crypto.randomUUID();
    service.db.db
      .prepare(
        `INSERT INTO findings (
          id, fingerprint, asset_id, file_id, relative_path, scan_id,
          title, description, severity, confidence, category, scanner_source,
          evidence, line_start, line_end, status, recommended_action,
          occurrence_count, first_detected_at, last_detected_at
        ) VALUES (?, ?, ?, ?, 'app.ts', ?, 'ESLint no-eval: eval can be harmful.', 'Avoid eval', 'high', 'high', 'code_security', 'eslint', 'app.ts:1 [no-eval]', 1, 1, 'open', 'Remove eval', 1, ?, ?)`
      )
      .run(findingId, sha256Hex('eslint-finding-1'), asset.id, fileRec.id, scanId, now, now);

    // 1. Unavailable ESLint verifier -> must remain unverified ('not_run'), NOT falsely passed via static inspector!
    const unverifiedSaver = new SaverAgent(
      service.db,
      service.chronicle,
      service.ai,
      service.fileIntel,
      async ({ scannerSource }) => ({
        status: 'not_run',
        notes: `Unverified: ${scannerSource} CLI unavailable.`
      })
    );
    const { patch: p1 } = await unverifiedSaver.explainAndPropose(findingId, 'export const safe = 2;\n');
    unverifiedSaver.decidePatch(p1!.id, 'approved');
    const appliedUnverified = await unverifiedSaver.applyApprovedPatch(p1!.id);

    expect(appliedUnverified.status).toBe('applied');
    expect(appliedUnverified.verificationStatus).toBe('not_run');
    // Baseline must NOT be updated before verification passes; finding must NOT be resolved
    expect(service.fileIntel.getFileDetail(fileRec.id).baseline?.sha256).toBe(sha256Hex('eval("1+1");\n'));
    expect(service.nightwatch.listFindings({ assetId: asset.id })[0]!.status).toBe('awaiting_approval');
    expect(service.chronicle.listEvents({ eventType: 'patch_applied_unverified' })).toHaveLength(1);

    // 2. Originating scanner verifier passing -> marks resolved and updates baseline
    fs.writeFileSync(targetFile, 'eval("2+2");\n');
    await service.fileIntel.inventoryAsset(asset);
    const verifiedSaver = new SaverAgent(
      service.db,
      service.chronicle,
      service.ai,
      service.fileIntel,
      async ({ scannerSource }) => ({
        status: 'passed',
        notes: `Verified with ${scannerSource}`
      })
    );
    const { patch: p2 } = await verifiedSaver.explainAndPropose(findingId, 'export const safe = 4;\n');
    verifiedSaver.decidePatch(p2!.id, 'approved');
    const appliedVerified = await verifiedSaver.applyApprovedPatch(p2!.id);

    expect(appliedVerified.verificationStatus).toBe('passed');
    expect(service.nightwatch.listFindings({ assetId: asset.id })[0]!.status).toBe('resolved');
    expect(service.fileIntel.getFileDetail(fileRec.id).baseline?.sha256).toBe(sha256Hex('export const safe = 4;\n'));
    service.close();
  });

  it('performs real lightweight AI availability checks for offline, unauthorized, timeout, and healthy providers without leaking keys', async () => {
    const dataDir = makeTempDir('cobalix-m3-ai-');
    const service = new LocalProtectionService(dataDir);
    const testSecret = 'sk-test-secret-key-999999999999';

    try {
      // 1. Offline endpoint (reserve closed port by listening and closing immediately)
      const closedServer = http.createServer();
      await new Promise<void>((r) => closedServer.listen(0, '127.0.0.1', r));
      const closedPort = (closedServer.address() as { port: number }).port;
      await new Promise<void>((r) => closedServer.close(() => r()));

      service.ai.saveConfig({
        provider: 'openai_compatible',
        displayName: 'Offline Test',
        endpoint: `http://127.0.0.1:${closedPort}/v1`,
        model: 'gpt-test',
        enabled: true,
        consentToSendContext: false,
        redactSecrets: true,
        apiKey: testSecret
      });
      const offlineStatus = await service.ai.checkAvailability({ timeoutMs: 1000 });
      expect(offlineStatus.available).toBe(false);
      expect(offlineStatus.state).toBe('offline');
      expect(offlineStatus.reason).not.toContain(testSecret);

      // 2. Unauthorized (401) mock server
      let seenAuthHeader = '';
      let seenBodyBytes = 0;
      const authServer = http.createServer((req, res) => {
        seenAuthHeader = req.headers.authorization ?? '';
        req.on('data', (chunk) => {
          seenBodyBytes += chunk.length;
        });
        req.on('end', () => {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end('{"error":"invalid_api_key"}');
        });
      });
      await new Promise<void>((r) => authServer.listen(0, '127.0.0.1', r));
      const authPort = (authServer.address() as { port: number }).port;

      try {
        service.ai.saveConfig({
          provider: 'openai_compatible',
          displayName: 'Mock Auth',
          endpoint: `http://127.0.0.1:${authPort}/v1`,
          model: 'gpt-test',
          enabled: true,
          consentToSendContext: true,
          redactSecrets: true,
          apiKey: testSecret
        });
        const unauthStatus = await service.ai.checkAvailability({ timeoutMs: 1000 });
        expect(unauthStatus.available).toBe(false);
        expect(unauthStatus.state).toBe('unauthorized');
        expect(seenAuthHeader).toBe(`Bearer ${testSecret}`);
        expect(seenBodyBytes).toBe(0);
        expect(unauthStatus.reason).not.toContain(testSecret);
      } finally {
        authServer.close();
      }

      // 3. Timeout mock server
      const stallSockets = new Set<import('node:net').Socket>();
      const stallServer = http.createServer((_req, _res) => {
        // intentionally never respond
      });
      stallServer.on('connection', (sock) => {
        stallSockets.add(sock);
        sock.on('close', () => stallSockets.delete(sock));
      });
      await new Promise<void>((r) => stallServer.listen(0, '127.0.0.1', r));
      const stallPort = (stallServer.address() as { port: number }).port;

      try {
        service.ai.saveConfig({
          provider: 'ollama',
          displayName: 'Stalled Ollama',
          endpoint: `http://127.0.0.1:${stallPort}`,
          model: 'llama3',
          enabled: true,
          consentToSendContext: false,
          redactSecrets: true
        });
        const timeoutStatus = await service.ai.checkAvailability({ timeoutMs: 120 });
        expect(timeoutStatus.available).toBe(false);
        expect(timeoutStatus.state).toBe('timeout');
      } finally {
        for (const s of stallSockets) s.destroy();
        stallServer.close();
      }

      // 4. Healthy mock server
      const okServer = http.createServer((req, res) => {
        expect(req.method).toBe('GET');
        expect(req.url).toBe('/api/tags');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"models":[]}');
      });
      await new Promise<void>((r) => okServer.listen(0, '127.0.0.1', r));
      const okPort = (okServer.address() as { port: number }).port;

      try {
        service.ai.saveConfig({
          provider: 'ollama',
          displayName: 'Healthy Ollama',
          endpoint: `http://127.0.0.1:${okPort}`,
          model: 'llama3',
          enabled: true,
          consentToSendContext: false,
          redactSecrets: true
        });
        const okStatus = await service.ai.checkAvailability({ timeoutMs: 1000 });
        expect(okStatus.available).toBe(true);
        expect(okStatus.state).toBe('available');
      } finally {
        okServer.close();
      }

      // Ensure no logged AI request ever recorded the secret
      const logs = service.db.db.prepare('SELECT error_message FROM ai_request_logs').all() as Array<{
        error_message: string | null;
      }>;
      for (const row of logs) {
        if (row.error_message) {
          expect(row.error_message).not.toContain(testSecret);
        }
      }
    } finally {
      service.close();
    }
  });
});
