import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PathBoundaryError, PatchValidationError, resolveWithinAssetRoot, sha256Hex } from '@cobalix/core';
import { LocalProtectionService } from '@cobalix/agents';
import { createCompanionServer } from '../apps/companion/src/server.js';

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

describe('Cobalix Obsidian Core & End-to-End Protection', () => {
  it('enforces canonical path boundaries and blocks traversal & symlink escapes', () => {
    const root = makeTempDir('cobalix-root-');
    const outside = makeTempDir('cobalix-outside-');
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'outside');
    fs.writeFileSync(path.join(root, 'inside.txt'), 'inside');
    fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'escape-link.txt'));

    expect(resolveWithinAssetRoot(root, 'inside.txt')).toBe(fs.realpathSync(path.join(root, 'inside.txt')));
    expect(() => resolveWithinAssetRoot(root, '../outside/secret.txt')).toThrow(PathBoundaryError);
    expect(() => resolveWithinAssetRoot(root, 'escape-link.txt')).toThrow(PathBoundaryError);
  });

  it('tracks file additions, modifications, removals, exclusions, and prevents duplicate unchanged events', async () => {
    const dataDir = makeTempDir('cobalix-data-');
    const repoDir = makeTempDir('cobalix-repo-');

    fs.mkdirSync(path.join(repoDir, 'src'), { recursive: true });
    fs.mkdirSync(path.join(repoDir, 'node_modules', 'pkg'), { recursive: true });
    fs.writeFileSync(path.join(repoDir, 'src', 'app.ts'), 'export const version = 1;\n');
    fs.writeFileSync(path.join(repoDir, 'node_modules', 'pkg', 'index.js'), 'ignored');
    fs.writeFileSync(path.join(repoDir, 'logo.bin'), Buffer.from([0x00, 0x01, 0x02, 0x03]));

    const service = new LocalProtectionService(dataDir);
    const asset = service.registerAsset({
      displayName: 'Test Repo',
      assetType: 'repository',
      path: repoDir
    });

    const first = await service.fileIntel.inventoryAsset(asset);
    expect(first.filesInspected).toBe(2); // node_modules excluded
    expect(first.filesAdded).toBe(2);

    // Re-running inventory with no changes must NOT create duplicate modifications
    const second = await service.fileIntel.inventoryAsset(asset);
    expect(second.filesAdded).toBe(0);
    expect(second.filesModified).toBe(0);
    expect(second.filesRemoved).toBe(0);

    // Modify src/app.ts and remove logo.bin
    fs.writeFileSync(path.join(repoDir, 'src', 'app.ts'), 'export const version = 2;\nexport const ok = true;\n');
    fs.rmSync(path.join(repoDir, 'logo.bin'));

    const third = await service.fileIntel.inventoryAsset(asset);
    expect(third.filesModified).toBe(1);
    expect(third.filesRemoved).toBe(1);

    const files = service.fileIntel.listFiles({ assetId: asset.id });
    const appFile = files.find((f) => f.relativePath === 'src/app.ts')!;
    const detail = service.fileIntel.getFileDetail(appFile.id);
    expect(detail.changes[0]?.diffText).toContain('+export const version = 2;');
    expect(detail.changes[0]?.linesAdded).toBe(2);
    expect(detail.changes[0]?.linesRemoved).toBe(1);

    // Persist across restart
    service.close();
    const restarted = new LocalProtectionService(dataDir);
    const persistedFiles = restarted.fileIntel.listFiles({ assetId: asset.id });
    expect(persistedFiles.length).toBe(2);
    expect(restarted.chronicle.verifyIntegrity().valid).toBe(true);
    restarted.close();
  });

  it('runs Nightwatch, deduplicates findings, and enforces Saver approval, invalidation, apply, verify, and revert', async () => {
    const dataDir = makeTempDir('cobalix-data-');
    const repoDir = makeTempDir('cobalix-repo-');

    const targetFile = path.join(repoDir, 'tls-config.ts');
    fs.writeFileSync(targetFile, 'export const tls = { rejectUnauthorized: false };\n');

    const service = new LocalProtectionService(dataDir);
    const asset = service.registerAsset({
      displayName: 'TLS Test Repo',
      assetType: 'repository',
      path: repoDir
    });

    const scan1 = await service.nightwatch.runScan(asset, 'manual');
    expect(scan1.findingsCreated).toBe(1);

    // Second scan deduplicates
    const scan2 = await service.nightwatch.runScan(asset, 'manual');
    expect(scan2.findingsCreated).toBe(0);
    expect(scan2.findingsUpdated).toBe(1);

    const findings = service.nightwatch.listFindings({ assetId: asset.id });
    expect(findings.length).toBe(1);
    expect(findings[0]!.occurrenceCount).toBe(2);

    // Saver proposes patch
    const { patch } = await service.saver.explainAndPropose(findings[0]!.id);
    expect(patch).not.toBeNull();
    expect(patch!.status).toBe('proposed');

    // Unapproved patch cannot be applied
    await expect(service.saver.applyApprovedPatch(patch!.id)).rejects.toThrow(PatchValidationError);

    // Approve patch
    const approved = service.saver.decidePatch(patch!.id, 'approved', 'Looks safe');
    expect(approved.status).toBe('approved');

    // If underlying file changes after approval, apply must invalidate and refuse
    fs.writeFileSync(targetFile, 'export const tls = { rejectUnauthorized: false, extra: true };\n');
    await expect(service.saver.applyApprovedPatch(patch!.id)).rejects.toThrow(PatchValidationError);
    expect(service.saver.getPatch(patch!.id).status).toBe('invalidated');

    // Generate a fresh patch on updated file, approve, and apply
    const { patch: freshPatch } = await service.saver.explainAndPropose(findings[0]!.id);
    expect(freshPatch).not.toBeNull();
    service.saver.decidePatch(freshPatch!.id, 'approved');
    const applied = await service.saver.applyApprovedPatch(freshPatch!.id);
    expect(applied.status).toBe('applied');
    expect(applied.verificationStatus).toBe('passed');
    expect(fs.readFileSync(targetFile, 'utf8')).toContain('rejectUnauthorized: true');

    // Revert from backup
    const reverted = service.saver.revertPatch(freshPatch!.id);
    expect(reverted.status).toBe('reverted');
    expect(fs.readFileSync(targetFile, 'utf8')).toContain('rejectUnauthorized: false');

    // Chronicle integrity holds
    const integrity = service.chronicle.verifyIntegrity();
    expect(integrity.valid).toBe(true);
    expect(integrity.checkedEvents).toBeGreaterThan(4);
    service.close();
  });

  it('serves real data over the Companion HTTP API without requiring AI', async () => {
    const dataDir = makeTempDir('cobalix-api-data-');
    const repoDir = makeTempDir('cobalix-api-repo-');
    fs.writeFileSync(path.join(repoDir, 'index.ts'), 'export const hello = "world";\n');

    const service = new LocalProtectionService(dataDir);
    const authToken = 'test-session-token-obsidian';
    const server = createCompanionServer(service, { authToken });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address() as { port: number };
    const base = `http://127.0.0.1:${addr.port}`;

    try {
      const health = await fetch(`${base}/api/health`).then((r) => r.json());
      expect(health.ok).toBe(true);

      const created = await fetch(`${base}/api/assets`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Cobalix-Token': authToken
        },
        body: JSON.stringify({ displayName: 'API Repo', assetType: 'repository', path: repoDir })
      }).then((r) => r.json());
      expect(created.canonicalPath).toBe(fs.realpathSync(repoDir));

      const scan = await fetch(`${base}/api/assets/${created.id}/scan`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Cobalix-Token': authToken
        }
      }).then((r) => r.json());
      expect(scan.filesInspected).toBe(1);

      const graph = await fetch(`${base}/api/graph?assetId=${created.id}`, {
        headers: { 'X-Cobalix-Token': authToken }
      }).then((r) => r.json());
      expect(graph.nodes.length).toBeGreaterThanOrEqual(2);
      expect(sha256Hex('test')).toHaveLength(64);
    } finally {
      server.close();
      service.close();
    }
  });
});
