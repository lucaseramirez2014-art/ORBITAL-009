import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalProtectionService } from '@cobalix/agents';

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

describe('Milestone 004B: Integrated File Detail, Inaccessible Coverage & Asset Config Persistence', () => {
  it('preserves files inside temporarily inaccessible directories instead of marking them removed and reports incomplete coverage', async () => {
    const dataDir = makeTempDir('cobalix-m4b-inacc-data-');
    const repoDir = makeTempDir('cobalix-m4b-inacc-repo-');
    const subDir = path.join(repoDir, 'restricted');
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(path.join(repoDir, 'root.ts'), 'export const root = true;\n');
    fs.writeFileSync(path.join(subDir, 'inside.ts'), 'export const inside = true;\n');

    const service = new LocalProtectionService(dataDir);
    const asset = service.registerAsset({ displayName: 'Coverage Repo', assetType: 'repository', path: repoDir });

    const initial = await service.fileIntel.inventoryAsset(asset);
    expect(initial.filesInspected).toBe(2);
    expect(initial.incompleteCoverage).toBe(false);
    expect(initial.inaccessibleDirectories).toEqual([]);

    if (typeof process.getuid === 'function' && process.getuid() !== 0) {
      fs.chmodSync(subDir, 0o000);
      try {
        const second = await service.fileIntel.inventoryAsset(asset);
        expect(second.incompleteCoverage).toBe(true);
        expect(second.inaccessibleDirectories).toContain('restricted');
        expect(second.filesRemoved).toBe(0);

        const insideFile = service.fileIntel
          .listFiles({ assetId: asset.id })
          .find((f) => f.relativePath === 'restricted/inside.ts')!;
        expect(insideFile.status).not.toBe('removed');

        const incompleteEvents = service.chronicle.listEvents({ eventType: 'inventory_incomplete' });
        expect(incompleteEvents).toHaveLength(1);
      } finally {
        fs.chmodSync(subDir, 0o755);
      }

      const restored = await service.fileIntel.inventoryAsset(asset);
      expect(restored.incompleteCoverage).toBe(false);
      expect(restored.filesInspected).toBe(2);
    }

    service.close();
  });

  it('returns integrated findings, recommendations, patches, Chronicle events, and language support in getFileDetail', async () => {
    const dataDir = makeTempDir('cobalix-m4b-detail-data-');
    const repoDir = makeTempDir('cobalix-m4b-detail-repo-');
    fs.mkdirSync(path.join(repoDir, 'src'), { recursive: true });
    const tlsPath = path.join(repoDir, 'src', 'tls.ts');
    fs.writeFileSync(tlsPath, 'export const tls = { rejectUnauthorized: false };\n');
    fs.writeFileSync(path.join(repoDir, 'README.md'), '# Notes\n');

    const service = new LocalProtectionService(dataDir);
    const asset = service.registerAsset({ displayName: 'Integrated Repo', assetType: 'repository', path: repoDir });
    await service.nightwatch.runScan(asset, 'manual');

    const files = service.fileIntel.listFiles({ assetId: asset.id });
    const tlsFile = files.find((f) => f.relativePath === 'src/tls.ts')!;
    const readmeFile = files.find((f) => f.relativePath === 'README.md')!;

    const finding = service.nightwatch.listFindings({ assetId: asset.id })[0]!;
    const { patch } = await service.saver.explainAndPropose(finding.id);
    service.saver.decidePatch(patch!.id, 'approved');
    await service.saver.applyApprovedPatch(patch!.id);

    const tlsDetail = service.fileIntel.getFileDetail(tlsFile.id);
    expect(tlsDetail.languageSupport).toBe('supported');
    expect(tlsDetail.findings).toHaveLength(1);
    expect(tlsDetail.recommendations).toHaveLength(1);
    expect(tlsDetail.patches).toHaveLength(1);
    expect(tlsDetail.events.length).toBeGreaterThanOrEqual(4);
    expect(tlsDetail.changes.length).toBeGreaterThanOrEqual(2);

    const readmeDetail = service.fileIntel.getFileDetail(readmeFile.id);
    expect(readmeDetail.languageSupport).toBe('unsupported');
    expect(readmeDetail.findings).toHaveLength(0);

    // Per-asset config persists across restart
    service.updateAssetConfig(asset.id, {
      enableEslint: false,
      exclusions: ['node_modules', 'custom_cache']
    });
    service.close();

    const restarted = new LocalProtectionService(dataDir);
    const reloaded = restarted.getAsset(asset.id);
    expect(reloaded.scanConfig.enableEslint).toBe(false);
    expect(reloaded.scanConfig.exclusions).toEqual(['node_modules', 'custom_cache']);
    restarted.close();
  });
});
