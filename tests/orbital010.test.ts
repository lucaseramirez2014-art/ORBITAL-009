import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalProtectionService } from '@cobalix/agents';
import {
  sanitizeChronicleExport,
  sanitizeDiagnosticText,
  sanitizeMarkdownReport
} from '../apps/web/src/lib/exportSanitizer';
import { exportFilesMetadataJson } from '../apps/web/src/lib/fileTree';
import type { ChronicleEvent, TrackedFile } from '@cobalix/core';

const tempDirs: string[] = [];
const protectedPaths: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (protectedPaths.length > 0) {
    const p = protectedPaths.pop()!;
    try {
      fs.chmodSync(p, 0o755);
    } catch {
      // ignore if already removed
    }
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('ORBITAL 010 Field Reliability & Export Sanitization', () => {
  it('handles an empty project cleanly with zero files and valid Chronicle chain', async () => {
    const dataDir = makeTempDir('cobalix-o10-empty-data-');
    const emptyRepo = makeTempDir('cobalix-o10-empty-repo-');

    const service = new LocalProtectionService(dataDir);
    try {
      const reg = service.registerAsset({
        displayName: 'Empty Project',
        assetType: 'folder',
        path: emptyRepo
      });
      const asset = service.updateAssetConfig(reg.id, {
        enableGitleaks: false,
        enableOsvScanner: false,
        enableNpmAudit: false,
        enableEslint: false
      });

      const scan = await service.nightwatch.runScan(asset, 'manual');
      expect(scan.status).toBe('completed');
      expect(scan.filesInspected).toBe(0);
      expect(scan.findingsCreated).toBe(0);
      expect(service.fileIntel.listFiles({ assetId: asset.id })).toEqual([]);
      expect(service.nightwatch.listFindings({ assetId: asset.id })).toEqual([]);
      expect(service.chronicle.verifyIntegrity().valid).toBe(true);
    } finally {
      service.close();
    }
  });

  it('inventories 500 nested files deterministically and truncates Security Graph nodes at bounded cap', async () => {
    const dataDir = makeTempDir('cobalix-o10-large-data-');
    const largeRepo = makeTempDir('cobalix-o10-large-repo-');

    for (let dirIdx = 0; dirIdx < 10; dirIdx++) {
      const folder = path.join(largeRepo, 'src', `module-${dirIdx}`);
      fs.mkdirSync(folder, { recursive: true });
      for (let fileIdx = 0; fileIdx < 50; fileIdx++) {
        fs.writeFileSync(
          path.join(folder, `item-${fileIdx}.ts`),
          `export const item_${dirIdx}_${fileIdx} = ${dirIdx * 50 + fileIdx};\n`
        );
      }
    }

    const service = new LocalProtectionService(dataDir);
    try {
      const reg = service.registerAsset({
        displayName: 'Large Synthetic Repo (500 files)',
        assetType: 'repository',
        path: largeRepo
      });
      const asset = service.updateAssetConfig(reg.id, {
        enableGitleaks: false,
        enableOsvScanner: false,
        enableNpmAudit: false,
        enableEslint: false
      });

      const scan = await service.nightwatch.runScan(asset, 'manual');
      expect(scan.status).toBe('completed');
      expect(scan.filesInspected).toBe(500);

      const tracked = service.fileIntel.listFiles({ assetId: asset.id });
      expect(tracked).toHaveLength(500);

      const graph = service.graph.buildGraph({ assetId: asset.id });
      expect(graph.totalNodesAvailable).toBeGreaterThanOrEqual(501);
      expect(graph.nodes.length).toBe(150);
      expect(graph.truncated).toBe(true);
      expect(service.chronicle.verifyIntegrity().valid).toBe(true);
    } finally {
      service.close();
    }
  });

  it('preserves Chronicle hash chain integrity after unreadable directory errors and patch reverts', async () => {
    const dataDir = makeTempDir('cobalix-o10-chronicle-data-');
    const repoDir = makeTempDir('cobalix-o10-chronicle-repo-');
    fs.mkdirSync(path.join(repoDir, 'src'), { recursive: true });
    const tlsPath = path.join(repoDir, 'src', 'tls.ts');
    fs.writeFileSync(tlsPath, 'export const tls = { rejectUnauthorized: false };\n');

    const lockedDir = path.join(repoDir, 'locked-subdir');
    fs.mkdirSync(lockedDir);
    fs.writeFileSync(path.join(lockedDir, 'hidden.ts'), 'export const x = 1;\n');
    fs.chmodSync(lockedDir, 0o000);
    protectedPaths.push(lockedDir);

    const service = new LocalProtectionService(dataDir);
    try {
      const reg = service.registerAsset({
        displayName: 'Partial Failure Repo',
        assetType: 'repository',
        path: repoDir
      });
      const asset = service.updateAssetConfig(reg.id, {
        enableGitleaks: false,
        enableOsvScanner: false,
        enableNpmAudit: false,
        enableEslint: false
      });

      const scan = await service.nightwatch.runScan(asset, 'manual');
      expect(scan.status).toBe('completed_with_errors');
      expect(scan.errors.length).toBeGreaterThan(0);

      const tlsFinding = service.nightwatch
        .listFindings({ assetId: asset.id })
        .find((f) => f.relativePath === 'src/tls.ts');
      expect(tlsFinding).toBeDefined();

      const proposal = await service.saver.explainAndPropose(tlsFinding!.id);
      expect(proposal.patch).not.toBeNull();
      service.saver.decidePatch(proposal.patch!.id, 'approved', 'Test revert');
      const applied = await service.saver.applyApprovedPatch(proposal.patch!.id);
      expect(applied.verificationStatus).toBe('passed');

      const reverted = service.saver.revertPatch(applied.id);
      expect(reverted.status).toBe('reverted');

      const integrity = service.chronicle.verifyIntegrity();
      expect(integrity.valid).toBe(true);
      expect(integrity.brokenAtSequence).toBeNull();
    } finally {
      service.close();
    }
  });

  it('redacts private local paths and secret patterns in exported Chronicle JSON, Markdown reports, and file metadata while preserving relative paths', () => {
    const fakeGhToken = ['ghp_', 'AlphaBetaGammaDelta1234567890'].join('');
    const fakeOpenAi = ['sk-', 'AbCdEfGhIjKlMnOpQrStUvWxYz12'].join('');
    const fakeAnthropic = ['sk-ant-', 'ZzYyXxWwVvUuTtSsRrQq123456'].join('');
    const fakeAws = ['AKIA', 'IOSFODNN7EXAMPLE'].join('');
    const fakePem = ['-----BEGIN PRIVATE KEY-----', 'MIIBVQIBADANBgkqhkiG9w0', '-----END PRIVATE KEY-----'].join('\n');

    const rawText = [
      `Scanned at /Users/alice/Documents/client-secret-repo/src/tls.ts and relative src/tls.ts.`,
      `Backup created under /private/var/folders/xx/12345/T/backup.bak and C:\\Users\\alice\\work\\app.ts`,
      `Leaks: ${fakeGhToken} ${fakeOpenAi} ${fakeAnthropic} ${fakeAws} Bearer myVeryLongBearerSecretToken12345 password='super-secret-value'`,
      fakePem
    ].join('\n');

    const sanitized = sanitizeDiagnosticText(rawText);
    expect(sanitized).toContain('[REDACTED_PATH]');
    expect(sanitized).toContain('relative src/tls.ts');
    expect(sanitized).not.toContain('/Users/alice');
    expect(sanitized).not.toContain('/private/var/folders');
    expect(sanitized).not.toContain('C:\\Users\\alice');
    expect(sanitized).not.toContain(fakeGhToken);
    expect(sanitized).not.toContain(fakeOpenAi);
    expect(sanitized).not.toContain(fakeAnthropic);
    expect(sanitized).not.toContain(fakeAws);
    expect(sanitized).not.toContain('myVeryLongBearerSecretToken12345');
    expect(sanitized).not.toContain('super-secret-value');
    expect(sanitized).not.toContain('MIIBVQIBADANBgkqhkiG9w0');

    const sampleEvent: ChronicleEvent = {
      id: 'ev-1',
      sequence: 1,
      timestamp: '2026-11-24T04:00:00.000Z',
      eventType: 'patch_applied',
      source: 'saver',
      assetId: 'asset-1',
      fileId: 'file-1',
      findingId: 'finding-1',
      summary: `Applied patch to src/tls.ts inside /Users/alice/projects/payments-api using token=${fakeGhToken}`,
      details: {
        canonicalPath: '/Users/alice/projects/payments-api',
        backupPath: '/Users/alice/Library/Application Support/cobalix-obsidian/backups/patch.bak',
        relativePath: 'src/tls.ts',
        nested: {
          apiKey: fakeOpenAi,
          note: 'Patched C:\\Users\\alice\\payments\\src\\tls.ts'
        }
      },
      previousEventHash: '0'.repeat(64),
      eventHash: 'a'.repeat(64)
    };

    const exportedChronicle = sanitizeChronicleExport([sampleEvent]);
    expect(exportedChronicle.notice).toMatch(/Sanitized diagnostic export/i);
    expect(exportedChronicle.eventCount).toBe(1);
    const serializedChronicle = JSON.stringify(exportedChronicle);
    expect(serializedChronicle).not.toContain('/Users/alice');
    expect(serializedChronicle).not.toContain('C:\\\\Users\\\\alice');
    expect(serializedChronicle).not.toContain(fakeGhToken);
    expect(serializedChronicle).not.toContain(fakeOpenAi);
    expect(exportedChronicle.events[0]!.details.relativePath).toBe('src/tls.ts');
    expect(exportedChronicle.events[0]!.details.canonicalPath).toBe('[REDACTED_PATH]');
    expect(exportedChronicle.events[0]!.details.backupPath).toBe('[REDACTED_PATH]');
    expect((exportedChronicle.events[0]!.details.nested as Record<string, unknown>).apiKey).toBe('[REDACTED]');

    const mdReport = sanitizeMarkdownReport(
      `# Report\n- Inspected /Users/alice/secret/src/auth.ts\n- Relative: \`src/auth.ts\` with ${fakeAws}`
    );
    expect(mdReport).toContain('**Sanitized Diagnostic Export**');
    expect(mdReport).toContain('`src/auth.ts`');
    expect(mdReport).not.toContain('/Users/alice/secret');
    expect(mdReport).not.toContain(fakeAws);

    const trackedFile: TrackedFile = {
      id: 'f-1',
      assetId: 'a-1',
      relativePath: 'src/config.ts',
      filename: 'config.ts',
      extension: '.ts',
      category: 'config',
      isBinary: false,
      sizeBytes: 42,
      sha256: 'b'.repeat(64),
      status: 'clean',
      integrityStatus: 'baseline_established',
      importance: 'normal',
      openFindingCount: 0,
      purposeDescription: `Loaded from /Users/alice/private-repo/src/config.ts (${fakeGhToken})`,
      descriptionProvenance: 'deterministic',
      firstDiscoveredAt: '2026-11-24T04:00:00.000Z',
      lastScannedAt: '2026-11-24T04:00:00.000Z',
      lastModifiedObservedAt: '2026-11-24T04:00:00.000Z'
    };
    const metaJson = exportFilesMetadataJson([trackedFile]);
    expect(metaJson).not.toContain('/Users/alice/private-repo');
    expect(metaJson).not.toContain(fakeGhToken);
    expect(metaJson).toContain('src/config.ts');
  });
});
