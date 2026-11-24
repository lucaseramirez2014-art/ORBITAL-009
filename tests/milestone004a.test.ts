import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CobalixError, sha256Hex } from '@cobalix/core';
import { LocalProtectionService } from '@cobalix/agents';
import { createCompanionServer } from '../apps/companion/src/server.js';
import { generateSessionToken } from '../apps/companion/src/auth.js';
import {
  buildFileTree,
  exportFilesMetadataJson,
  filterFilesForExplorer,
  getBreadcrumbs,
  getFolderByPath
} from '../apps/web/src/lib/fileTree.js';

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

describe('Milestone 004A: Rename Detection, Folder Navigation & Bulk Actions', () => {
  it('detects ordinary 1-to-1 SHA-256 renames without creating unrelated add/remove changes', async () => {
    const dataDir = makeTempDir('cobalix-m4a-rename-data-');
    const repoDir = makeTempDir('cobalix-m4a-rename-repo-');
    fs.mkdirSync(path.join(repoDir, 'src'), { recursive: true });
    const oldFile = path.join(repoDir, 'src', 'session.ts');
    const newFile = path.join(repoDir, 'src', 'auth-session.ts');
    const content = 'export function validateSession(id: string) { return id.length > 0; }\n';
    fs.writeFileSync(oldFile, content);

    const service = new LocalProtectionService(dataDir);
    const asset = service.registerAsset({ displayName: 'Rename Repo', assetType: 'repository', path: repoDir });
    await service.fileIntel.inventoryAsset(asset);

    const initialFiles = service.fileIntel.listFiles({ assetId: asset.id });
    expect(initialFiles).toHaveLength(1);
    const originalId = initialFiles[0]!.id;
    service.fileIntel.updateFilePurpose(originalId, 'User-authored session validation description.');

    fs.renameSync(oldFile, newFile);
    const renameSummary = await service.fileIntel.inventoryAsset(asset);
    expect(renameSummary.filesRenamed).toBe(1);
    expect(renameSummary.filesAdded).toBe(0);
    expect(renameSummary.filesRemoved).toBe(0);

    const afterFiles = service.fileIntel.listFiles({ assetId: asset.id });
    expect(afterFiles).toHaveLength(1);
    expect(afterFiles[0]!.id).toBe(originalId);
    expect(afterFiles[0]!.relativePath).toBe('src/auth-session.ts');
    expect(afterFiles[0]!.purposeDescription).toBe('User-authored session validation description.');

    const detail = service.fileIntel.getFileDetail(originalId);
    expect(detail.baseline?.relativePath).toBe('src/auth-session.ts');
    expect(detail.baseline?.sha256).toBe(sha256Hex(content));
    expect(detail.changes[0]?.changeType).toBe('renamed');
    expect(detail.changes[0]?.deterministicSummary).toContain('src/session.ts');
    expect(detail.changes[0]?.deterministicSummary).toContain('src/auth-session.ts');
    expect(detail.changes[0]?.confidence).toBe('high');

    const renameEvents = service.chronicle.listEvents({ eventType: 'file_renamed' });
    expect(renameEvents).toHaveLength(1);
    expect(renameEvents[0]!.details.previousPath).toBe('src/session.ts');
    expect(renameEvents[0]!.details.newPath).toBe('src/auth-session.ts');
    expect(service.chronicle.verifyIntegrity().valid).toBe(true);

    // Re-running inventory with no further changes emits no duplicate changes
    const repeat = await service.fileIntel.inventoryAsset(asset);
    expect(repeat.filesRenamed).toBe(0);
    expect(repeat.filesModified).toBe(0);
    service.close();
  });

  it('handles duplicate hashes cautiously and refuses certain renames in ambiguous multi-file scenarios', async () => {
    const dataDir = makeTempDir('cobalix-m4a-dup-data-');
    const repoDir = makeTempDir('cobalix-m4a-dup-repo-');
    const sharedContent = 'export const SHARED_CONSTANT = 42;\n';
    fs.writeFileSync(path.join(repoDir, 'copyA.ts'), sharedContent);
    fs.writeFileSync(path.join(repoDir, 'copyB.ts'), sharedContent);

    const service = new LocalProtectionService(dataDir);
    const asset = service.registerAsset({ displayName: 'Dup Repo', assetType: 'repository', path: repoDir });
    await service.fileIntel.inventoryAsset(asset);

    // Case 1: copyA stays active while copyB is renamed to copyB-moved.ts -> medium confidence rename
    fs.renameSync(path.join(repoDir, 'copyB.ts'), path.join(repoDir, 'copyB-moved.ts'));
    const dupRename = await service.fileIntel.inventoryAsset(asset);
    expect(dupRename.filesRenamed).toBe(1);
    expect(dupRename.filesAdded).toBe(0);
    expect(dupRename.filesRemoved).toBe(0);

    const movedFile = service.fileIntel.listFiles({ assetId: asset.id }).find((f) => f.relativePath === 'copyB-moved.ts')!;
    const movedDetail = service.fileIntel.getFileDetail(movedFile.id);
    expect(movedDetail.changes[0]?.changeType).toBe('renamed');
    expect(movedDetail.changes[0]?.confidence).toBe('medium');
    expect(movedDetail.changes[0]?.deterministicSummary).toContain('other active file');

    // Case 2: Ambiguous — both copyA and copyB-moved are removed and 1 new file with same hash is added
    fs.rmSync(path.join(repoDir, 'copyA.ts'));
    fs.rmSync(path.join(repoDir, 'copyB-moved.ts'));
    fs.writeFileSync(path.join(repoDir, 'consolidated.ts'), sharedContent);

    const ambiguous = await service.fileIntel.inventoryAsset(asset);
    expect(ambiguous.filesRenamed).toBe(0);
    expect(ambiguous.filesRemoved).toBe(2);
    expect(ambiguous.filesAdded).toBe(1);

    const consolidated = service.fileIntel
      .listFiles({ assetId: asset.id })
      .find((f) => f.relativePath === 'consolidated.ts')!;
    const consolidatedDetail = service.fileIntel.getFileDetail(consolidated.id);
    expect(consolidatedDetail.changes[0]?.changeType).toBe('added');
    expect(consolidatedDetail.changes[0]?.deterministicSummary).toContain('ambiguous');
    service.close();
  });

  it('handles empty directories and skips unreadable subdirectories without crashing', async () => {
    const dataDir = makeTempDir('cobalix-m4a-empty-data-');
    const emptyDir = makeTempDir('cobalix-m4a-empty-repo-');

    const service = new LocalProtectionService(dataDir);
    const emptyAsset = service.registerAsset({ displayName: 'Empty Folder', assetType: 'folder', path: emptyDir });
    const emptySummary = await service.fileIntel.inventoryAsset(emptyAsset);
    expect(emptySummary.filesInspected).toBe(0);
    expect(emptySummary.errors).toEqual([]);

    const restrictedDir = path.join(emptyDir, 'restricted');
    fs.mkdirSync(restrictedDir, { recursive: true });
    fs.writeFileSync(path.join(restrictedDir, 'secret.txt'), 'locked');
    fs.writeFileSync(path.join(emptyDir, 'visible.txt'), 'ok');

    if (typeof process.getuid === 'function' && process.getuid() !== 0) {
      fs.chmodSync(restrictedDir, 0o000);
      try {
        const res = await service.fileIntel.inventoryAsset(emptyAsset);
        expect(res.filesInspected).toBe(1);
        expect(res.skippedLocations.some((s) => s.includes('restricted'))).toBe(true);
      } finally {
        fs.chmodSync(restrictedDir, 0o755);
      }
    }

    service.close();
  });

  it('builds hierarchical folder trees, breadcrumbs, explorer filters, and JSON metadata exports', async () => {
    const dataDir = makeTempDir('cobalix-m4a-tree-data-');
    const repoDir = makeTempDir('cobalix-m4a-tree-repo-');
    fs.mkdirSync(path.join(repoDir, 'src', 'auth'), { recursive: true });
    fs.mkdirSync(path.join(repoDir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(repoDir, 'package.json'), '{"name":"tree-test"}');
    fs.writeFileSync(path.join(repoDir, 'src', 'index.ts'), 'export const app = true;\n');
    fs.writeFileSync(path.join(repoDir, 'src', 'auth', 'tls.ts'), 'export const tls = { rejectUnauthorized: false };\n');
    fs.writeFileSync(path.join(repoDir, 'docs', 'README.md'), '# Tree Test\n');

    const service = new LocalProtectionService(dataDir);
    const asset = service.registerAsset({ displayName: 'Tree Repo', assetType: 'repository', path: repoDir });
    await service.nightwatch.runScan(asset, 'manual');

    const files = service.fileIntel.listFiles({ assetId: asset.id });
    const tree = buildFileTree(files);
    expect(tree.fileCount).toBe(4);
    expect(tree.findingCount).toBe(1);

    const srcNode = getFolderByPath(tree, 'src');
    expect(srcNode).not.toBeNull();
    expect(srcNode!.fileCount).toBe(2);
    expect(srcNode!.findingCount).toBe(1);

    const crumbs = getBreadcrumbs('src/auth');
    expect(crumbs).toEqual([
      { label: 'Root', path: '' },
      { label: 'src', path: 'src' },
      { label: 'auth', path: 'src/auth' }
    ]);

    const directRootOnly = filterFilesForExplorer(files, {
      folderPath: '',
      includeSubfolders: false,
      search: '',
      status: 'all',
      category: 'all',
      hasFindingsOnly: false
    });
    expect(directRootOnly.map((f) => f.relativePath)).toEqual(['package.json']);

    const findingFilesInSrc = filterFilesForExplorer(files, {
      folderPath: 'src',
      includeSubfolders: true,
      search: 'tls',
      status: 'all',
      category: 'source',
      hasFindingsOnly: true
    });
    expect(findingFilesInSrc.map((f) => f.relativePath)).toEqual(['src/auth/tls.ts']);

    const exported = JSON.parse(exportFilesMetadataJson(findingFilesInSrc)) as Array<{ relativePath: string }>;
    expect(exported).toHaveLength(1);
    expect(exported[0]!.relativePath).toBe('src/auth/tls.ts');
    service.close();
  });

  it('enforces confirmation, cross-asset safety, and finding guards in bulk baseline acceptance and API', async () => {
    const dataDir = makeTempDir('cobalix-m4a-bulk-data-');
    const repoA = makeTempDir('cobalix-m4a-bulk-repoA-');
    const repoB = makeTempDir('cobalix-m4a-bulk-repoB-');

    fs.writeFileSync(path.join(repoA, 'clean.ts'), 'export const a = 1;\n');
    fs.writeFileSync(path.join(repoA, 'risky.ts'), 'export const tls = { rejectUnauthorized: false };\n');
    fs.writeFileSync(path.join(repoB, 'other.ts'), 'export const b = 1;\n');

    const service = new LocalProtectionService(dataDir);
    const assetA = service.registerAsset({ displayName: 'Repo A', assetType: 'repository', path: repoA });
    const assetB = service.registerAsset({ displayName: 'Repo B', assetType: 'repository', path: repoB });

    await service.nightwatch.runScan(assetA, 'manual');
    await service.fileIntel.inventoryAsset(assetB);

    const filesA = service.fileIntel.listFiles({ assetId: assetA.id });
    const cleanFile = filesA.find((f) => f.relativePath === 'clean.ts')!;
    const riskyFile = filesA.find((f) => f.relativePath === 'risky.ts')!;
    const otherFile = service.fileIntel.listFiles({ assetId: assetB.id })[0]!;

    // 1. Unconfirmed bulk request rejected
    expect(() =>
      service.fileIntel.acceptFilesBaselineBulk({ fileIds: [cleanFile.id], confirm: false })
    ).toThrow(CobalixError);

    // 2. Cross-asset bulk selection rejected
    expect(() =>
      service.fileIntel.acceptFilesBaselineBulk({ fileIds: [cleanFile.id, otherFile.id], confirm: true })
    ).toThrow(CobalixError);

    // 3. Companion HTTP endpoint requires auth and safely skips risky file while accepting clean file
    const authToken = generateSessionToken();
    const server = createCompanionServer(service, { authToken });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    const base = `http://127.0.0.1:${port}`;

    try {
      const unauth = await fetch(`${base}/api/files/bulk/accept-baseline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileIds: [cleanFile.id], confirm: true })
      });
      expect(unauth.status).toBe(401);

      const res = await fetch(`${base}/api/files/bulk/accept-baseline`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Cobalix-Token': authToken
        },
        body: JSON.stringify({ fileIds: [cleanFile.id, riskyFile.id], confirm: true })
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        accepted: Array<{ id: string; status: string; integrityStatus: string }>;
        skipped: Array<{ fileId: string; relativePath: string; reason: string }>;
      };

      expect(body.accepted).toHaveLength(1);
      expect(body.accepted[0]!.id).toBe(cleanFile.id);
      expect(body.accepted[0]!.status).toBe('unchanged');
      expect(body.accepted[0]!.integrityStatus).toBe('verified');

      expect(body.skipped).toHaveLength(1);
      expect(body.skipped[0]!.fileId).toBe(riskyFile.id);
      expect(body.skipped[0]!.reason).toContain('open security finding');

      // Risky file remained unaccepted
      expect(service.fileIntel.getFileDetail(riskyFile.id).file.integrityStatus).toBe('new');

      const baselineEvents = service.chronicle.listEvents({ eventType: 'baseline_accepted' });
      expect(baselineEvents.some((e) => e.fileId === cleanFile.id && e.details.bulkOperation === true)).toBe(true);
      expect(service.chronicle.verifyIntegrity().valid).toBe(true);
    } finally {
      server.close();
      service.close();
    }
  });
});
