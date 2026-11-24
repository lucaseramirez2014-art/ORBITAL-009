import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalProtectionService, SaverAgent } from '@cobalix/agents';
import { CobalixError, PatchValidationError, sha256Hex } from '@cobalix/core';
import { CredentialStore } from '@cobalix/db';
import { validateAIConfigBody } from '../apps/companion/src/validation.js';

const tempDirs: string[] = [];
const restoreChmodTargets: Array<{ target: string; mode: number }> = [];

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
  while (restoreChmodTargets.length > 0) {
    const entry = restoreChmodTargets.pop()!;
    try {
      fs.chmodSync(entry.target, entry.mode);
    } catch {
      // ignore if already removed
    }
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('ORBITAL 007 Core Integrity & Hardening Regressions', () => {
  it('survives symlink directory cycles cleanly in FileIntelligenceService without infinite recursion', async () => {
    const dataDir = makeTempDir('cobalix-o7-cycle-data-');
    const repoDir = makeTempDir('cobalix-o7-cycle-repo-');
    fs.mkdirSync(path.join(repoDir, 'sub', 'deep'), { recursive: true });
    fs.writeFileSync(path.join(repoDir, 'sub', 'file.ts'), 'export const safe = true;\n');

    // Directory symlink pointing back to an ancestor inside the asset root
    fs.symlinkSync(repoDir, path.join(repoDir, 'sub', 'loop'), 'dir');

    const service = new LocalProtectionService(dataDir);
    const asset = service.registerAsset({
      displayName: 'Cycle Repo',
      assetType: 'repository',
      path: repoDir
    });

    const summary = await service.fileIntel.inventoryAsset(asset);
    expect(summary.filesInspected).toBeGreaterThanOrEqual(1);
    const tracked = service.fileIntel.listFiles({ assetId: asset.id });
    expect(tracked.some((f) => f.relativePath === 'sub/file.ts')).toBe(true);
  });

  it('streams SHA-256 hash accurately for files >512 KiB while leaving snapshotContent null', async () => {
    const dataDir = makeTempDir('cobalix-o7-stream-data-');
    const repoDir = makeTempDir('cobalix-o7-stream-repo-');
    const largePath = path.join(repoDir, 'large.txt');
    const largePayload = Buffer.alloc(600 * 1024, 'a');
    fs.writeFileSync(largePath, largePayload);
    const expectedHash = sha256Hex(largePayload);

    const service = new LocalProtectionService(dataDir);
    const asset = service.registerAsset({
      displayName: 'Streaming Repo',
      assetType: 'repository',
      path: repoDir
    });

    const summary = await service.fileIntel.inventoryAsset(asset);
    expect(summary.filesInspected).toBe(1);
    expect(summary.errors).toEqual([]);

    const tracked = service.fileIntel.listFiles({ assetId: asset.id });
    expect(tracked).toHaveLength(1);
    expect(tracked[0]!.sha256).toBe(expectedHash);
    expect(tracked[0]!.sizeBytes).toBe(600 * 1024);
    expect(tracked[0]!.isBinary).toBe(false);

    const detail = service.fileIntel.getFileDetail(tracked[0]!.id);
    expect(detail.baseline?.snapshotContent).toBeNull();
  });

  it('reports inaccessible chmod 000 subdirectories and surfaces incomplete coverage as completed_with_errors in Nightwatch', async () => {
    const dataDir = makeTempDir('cobalix-o7-perm-data-');
    const repoDir = makeTempDir('cobalix-o7-perm-repo-');
    const lockedDir = path.join(repoDir, 'locked');
    fs.mkdirSync(lockedDir, { recursive: true });
    fs.writeFileSync(path.join(lockedDir, 'hidden.txt'), 'unreachable\n');
    fs.writeFileSync(path.join(repoDir, 'ok.ts'), 'export const ok = 1;\n');

    fs.chmodSync(lockedDir, 0o000);
    restoreChmodTargets.push({ target: lockedDir, mode: 0o755 });

    const service = new LocalProtectionService(dataDir);
    const asset = service.registerAsset({
      displayName: 'Locked Subdir Repo',
      assetType: 'repository',
      path: repoDir
    });

    const inventory = await service.fileIntel.inventoryAsset(asset);
    if (process.getuid?.() !== 0) {
      expect(inventory.incompleteCoverage).toBe(true);
      expect(inventory.inaccessibleDirectories).toContain('locked');

      const scan = await service.nightwatch.runScan(asset, 'manual');
      expect(scan.status).toBe('completed_with_errors');
      expect(scan.errors.some((e) => e.includes('Inaccessible directory: locked'))).toBe(true);
    }
  });

  it('rejects concurrent Nightwatch runScan() calls for the same asset with 409 and releases the lock in finally', async () => {
    const dataDir = makeTempDir('cobalix-o7-lock-data-');
    const repoDir = makeTempDir('cobalix-o7-lock-repo-');
    fs.writeFileSync(path.join(repoDir, 'index.ts'), 'export const v = 1;\n');

    const service = new LocalProtectionService(dataDir);
    const registered = service.registerAsset({
      displayName: 'Concurrency Repo',
      assetType: 'repository',
      path: repoDir
    });
    const asset = service.updateAssetConfig(registered.id, {
      enableGitleaks: false,
      enableOsvScanner: false,
      enableNpmAudit: false,
      enableEslint: false
    });

    const originalInventory = service.fileIntel.inventoryAsset.bind(service.fileIntel);
    let releasePause!: () => void;
    let enteredPause!: () => void;
    const paused = new Promise<void>((resolve) => {
      enteredPause = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      releasePause = resolve;
    });

    service.fileIntel.inventoryAsset = async (targetAsset) => {
      enteredPause();
      await gate;
      return originalInventory(targetAsset);
    };

    try {
      const firstRunPromise = service.nightwatch.runScan(asset, 'manual');
      await paused;

      await expect(service.nightwatch.runScan(asset, 'manual')).rejects.toMatchObject({
        code: 'SCAN_IN_PROGRESS',
        statusCode: 409
      });

      releasePause();
      const firstScan = await firstRunPromise;
      expect(firstScan.status).toBe('completed');
    } finally {
      service.fileIntel.inventoryAsset = originalInventory;
    }

    // Subsequent scan must succeed once lock is released in finally
    const secondScan = await service.nightwatch.runScan(asset, 'manual');
    expect(secondScan.status).toBe('completed');
  });

  it('catches and redacts uncaught verifier exceptions, enforces backup permissions, and validates revertPatch state and backup hashes', async () => {
    const dataDir = makeTempDir('cobalix-o7-saver-data-');
    const repoDir = makeTempDir('cobalix-o7-saver-repo-');
    const filePath = path.join(repoDir, 'tls.ts');
    fs.writeFileSync(filePath, 'export const tls = { rejectUnauthorized: false };\n');

    const service = new LocalProtectionService(dataDir);
    const asset = service.registerAsset({
      displayName: 'Saver Hardening Repo',
      assetType: 'repository',
      path: repoDir
    });
    await service.nightwatch.runScan(asset, 'manual');

    const finding = service.nightwatch.listFindings({ assetId: asset.id })[0]!;
    const { patch } = await service.saver.explainAndPropose(finding.id);
    expect(patch).not.toBeNull();

    // Proposed (non-applied) patch must not be revertable
    expect(() => service.saver.revertPatch(patch!.id)).toThrow(PatchValidationError);

    service.saver.decidePatch(patch!.id, 'approved');

    const dummySecret = ['Bearer ', 'synthetic_verifier_secret_token_99999'].join('');
    const throwingSaver = new SaverAgent(
      service.db,
      service.chronicle,
      service.ai,
      service.fileIntel,
      async () => {
        throw new Error(`Verifier exploded while checking ${dummySecret}`);
      }
    );

    const applied = await throwingSaver.applyApprovedPatch(patch!.id);
    expect(applied.status).toBe('applied');
    expect(applied.verificationStatus).toBe('failed');
    expect(applied.verificationNotes).toContain('[REDACTED:BEARER_TOKEN]');
    expect(applied.verificationNotes).not.toContain('synthetic_verifier_secret_token_99999');

    // Backups directory (0700) and backup file (0600) permissions
    const backupsDir = path.join(dataDir, 'backups');
    expect(fs.statSync(backupsDir).mode & 0o777).toBe(0o700);
    expect(applied.backupPath).toBeTruthy();
    expect(fs.statSync(applied.backupPath!).mode & 0o777).toBe(0o600);

    // Corrupted backup must abort revertPatch before mutating target file
    const contentBeforeBadRevert = fs.readFileSync(filePath, 'utf8');
    fs.writeFileSync(applied.backupPath!, 'corrupted-backup-data', { mode: 0o600 });
    expect(() => throwingSaver.revertPatch(applied.id)).toThrow(PatchValidationError);
    expect(fs.readFileSync(filePath, 'utf8')).toBe(contentBeforeBadRevert);
  });

  it('redacts secrets recursively in Chronicle before hashing and detects sequence gaps', () => {
    const dataDir = makeTempDir('cobalix-o7-chronicle-data-');
    const service = new LocalProtectionService(dataDir);

    const bearerSecret = ['Bearer ', 'synthetic_chronicle_token_12345678'].join('');
    const keySecret = ['password', '="', 'super_secret_pw_999', '"'].join('');
    const ev1 = service.chronicle.recordEvent({
      eventType: 'audit_test',
      source: 'local_protection_service',
      summary: `Failure using ${bearerSecret}`,
      details: {
        nested: { note: `Config had ${keySecret}` },
        list: [bearerSecret]
      }
    });

    expect(ev1.summary).toContain('[REDACTED:BEARER_TOKEN]');
    expect(ev1.summary).not.toContain('synthetic_chronicle_token_12345678');
    const detailsText = JSON.stringify(ev1.details);
    expect(detailsText).toContain('[REDACTED]');
    expect(detailsText).toContain('[REDACTED:BEARER_TOKEN]');
    expect(detailsText).not.toContain('super_secret_pw_999');
    expect(detailsText).not.toContain('synthetic_chronicle_token_12345678');
    expect(service.chronicle.verifyIntegrity().valid).toBe(true);

    // Insert a validly hash-chained row at sequence + 2 to simulate a skipped sequence gap
    const gapSeq = ev1.sequence + 2;
    const gapId = 'gap-event-id-001';
    const gapTimestamp = new Date().toISOString();
    const gapSummary = 'Row inserted after a sequence gap';
    const gapDetailsJson = JSON.stringify({});
    const gapHash = sha256Hex(
      JSON.stringify({
        id: gapId,
        sequence: gapSeq,
        timestamp: gapTimestamp,
        eventType: 'audit_test_gap',
        source: 'user',
        assetId: null,
        fileId: null,
        findingId: null,
        summary: gapSummary,
        detailsJson: gapDetailsJson,
        previousEventHash: ev1.eventHash
      })
    );
    service.db.db
      .prepare(
        `INSERT INTO events (
          id, sequence, timestamp, event_type, source,
          asset_id, file_id, finding_id, summary, details_json,
          previous_event_hash, event_hash
        ) VALUES (?, ?, ?, 'audit_test_gap', 'user', NULL, NULL, NULL, ?, ?, ?, ?)`
      )
      .run(gapId, gapSeq, gapTimestamp, gapSummary, gapDetailsJson, ev1.eventHash, gapHash);

    const check = service.chronicle.verifyIntegrity();
    expect(check.valid).toBe(false);
    expect(check.brokenAtSequence).toBe(gapSeq);
  });

  it('enforces http/https protocols on AI endpoints and redacts title/description/recommendedAction in AI prompts', async () => {
    expect(() =>
      validateAIConfigBody({
        provider: 'openai_compatible',
        displayName: 'Invalid Scheme',
        endpoint: 'file:///etc/passwd',
        model: 'gpt-test',
        enabled: true,
        consentToSendContext: true,
        redactSecrets: true
      })
    ).toThrow(CobalixError);

    const dataDir = makeTempDir('cobalix-o7-ai-data-');
    const service = new LocalProtectionService(dataDir);

    expect(() =>
      service.ai.saveConfig({
        provider: 'openai_compatible',
        displayName: 'Bad Scheme',
        endpoint: 'javascript:alert(1)',
        model: 'gpt-test',
        enabled: true,
        consentToSendContext: true,
        redactSecrets: true
      })
    ).toThrow(CobalixError);

    const capturedBodies: string[] = [];
    const mockServer = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        capturedBodies.push(Buffer.concat(chunks).toString('utf8'));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    explanation: 'Safe redacted explanation.',
                    recommendedFix: 'Rotate token.',
                    potentialImpact: 'Low impact.'
                  })
                }
              }
            ]
          })
        );
      });
    });

    const prevDisableKeychain = process.env.COBALIX_DISABLE_KEYCHAIN;
    process.env.COBALIX_DISABLE_KEYCHAIN = '1';
    const port = await listenServer(mockServer);

    try {
      service.ai.saveConfig({
        provider: 'openai_compatible',
        displayName: 'Local Mock OpenAI',
        endpoint: `http://127.0.0.1:${port}`,
        model: 'gpt-test',
        enabled: true,
        consentToSendContext: true,
        redactSecrets: true,
        apiKey: 'dummy-local-provider-key'
      });

      const tokTitle = ['Bearer ', 'secret_in_title_token_11111'].join('');
      const tokDesc = ['password', '="', 'secret_in_desc_pw_22222', '"'].join('');
      const tokAction = ['Bearer ', 'secret_in_action_tok_33333'].join('');
      const tokSummary = ['Bearer ', 'secret_in_summary_tok_44444'].join('');

      await service.ai.explainFinding({
        title: `Finding ${tokTitle}`,
        description: `Description with ${tokDesc}`,
        evidence: 'rejectUnauthorized: false',
        recommendedAction: `Replace ${tokAction}`
      });

      await service.ai.explainFileChange({
        relativePath: 'src/config.ts',
        deterministicSummary: `Summary containing ${tokSummary}`,
        diffText: '- export const ok = false;\n+ export const ok = true;\n'
      });

      expect(capturedBodies).toHaveLength(2);
      const joined = capturedBodies.join('\n');
      expect(joined).toContain('[REDACTED:BEARER_TOKEN]');
      expect(joined).toContain('[REDACTED]');
      expect(joined).not.toContain('secret_in_title_token_11111');
      expect(joined).not.toContain('secret_in_desc_pw_22222');
      expect(joined).not.toContain('secret_in_action_tok_33333');
      expect(joined).not.toContain('secret_in_summary_tok_44444');
    } finally {
      if (prevDisableKeychain === undefined) {
        delete process.env.COBALIX_DISABLE_KEYCHAIN;
      } else {
        process.env.COBALIX_DISABLE_KEYCHAIN = prevDisableKeychain;
      }
      await closeServer(mockServer);
    }
  });

  it('writes CredentialStore fallback file with 0600 permissions and rejects unsafe provider IDs', () => {
    const dataDir = makeTempDir('cobalix-o7-cred-data-');
    const prevDisableKeychain = process.env.COBALIX_DISABLE_KEYCHAIN;
    process.env.COBALIX_DISABLE_KEYCHAIN = '1';

    try {
      const store = new CredentialStore(dataDir);
      expect(() => store.setCredential('../escape', 'dummy-val')).toThrow();

      store.setCredential('default', 'dummy-secret-for-test');
      const credsPath = path.join(dataDir, 'credentials.json');
      expect(fs.existsSync(credsPath)).toBe(true);
      expect(fs.statSync(credsPath).mode & 0o777).toBe(0o600);
      expect(store.getCredential('default')).toBe('dummy-secret-for-test');
    } finally {
      if (prevDisableKeychain === undefined) {
        delete process.env.COBALIX_DISABLE_KEYCHAIN;
      } else {
        process.env.COBALIX_DISABLE_KEYCHAIN = prevDisableKeychain;
      }
    }
  });
});
