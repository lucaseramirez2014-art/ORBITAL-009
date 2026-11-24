import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalProtectionService, SaverAgent } from '@cobalix/agents';
import { PatchValidationError, sha256Hex } from '@cobalix/core';
import { resolveScannerBinary } from '@cobalix/scanners';

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function makeDummySecret(): string {
  return ['ghp_', '9xK2mP7qR4tV8wZ1bN5cF3hJ6kL0nQ8rT2vY'].join('');
}

function writeVulnerableLockfile(targetPath: string): void {
  fs.writeFileSync(
    targetPath,
    JSON.stringify(
      {
        name: 'orbital009-rc-fixture',
        version: '1.0.0',
        lockfileVersion: 3,
        requires: true,
        packages: {
          '': {
            name: 'orbital009-rc-fixture',
            version: '1.0.0',
            dependencies: { lodash: '4.17.15' }
          },
          'node_modules/lodash': {
            version: '4.17.15'
          }
        }
      },
      null,
      2
    )
  );
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
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('ORBITAL 009 Agent Integration & Security/Privacy Validation', () => {
  it('validates end-to-end Nightwatch -> Saver -> Chronicle lifecycle including approval locks, failed remediation recovery, secret redaction, and AI consent gating', async () => {
    const dataDir = makeTempDir('cobalix-o9-data-');
    const repoDir = makeTempDir('cobalix-o9-repo-');
    fs.mkdirSync(path.join(repoDir, 'src'), { recursive: true });

    const dummySecret = makeDummySecret();
    const initialTlsContent = 'export const tlsConfig = { rejectUnauthorized: false };\n';
    const tlsPath = path.join(repoDir, 'src', 'tls.ts');
    const serviceFilePath = path.join(repoDir, 'src', 'service.ts');

    // Start with clean + tls + service v1 so File Intelligence establishes baseline first
    fs.writeFileSync(path.join(repoDir, 'src', 'clean.ts'), 'export const healthy = true;\n');
    fs.writeFileSync(serviceFilePath, 'export const version = 1;\n');
    fs.writeFileSync(tlsPath, initialTlsContent);

    const service = new LocalProtectionService(dataDir);
    const registered = service.registerAsset({
      displayName: 'RC Validation Project',
      assetType: 'repository',
      path: repoDir
    });
    const asset = service.updateAssetConfig(registered.id, {
      enableNpmAudit: false,
      enableEslint: false
    });

    // Establish initial baselines
    await service.fileIntel.inventoryAsset(asset);

    // Introduce modified source file + synthetic secret + vulnerable dependency lockfile
    fs.writeFileSync(serviceFilePath, 'export const version = 2;\n');
    fs.writeFileSync(path.join(repoDir, 'src', 'leaked.ts'), `export const token = "${dummySecret}";\n`);
    writeVulnerableLockfile(path.join(repoDir, 'package-lock.json'));

    // 1. Nightwatch scan detects config issue, secret (if gitleaks present), OSV vuln (if osv-scanner present), and modified file
    const scan = await service.nightwatch.runScan(asset, 'manual');
    const trackedFiles = service.fileIntel.listFiles({ assetId: asset.id });
    const modifiedServiceFile = trackedFiles.find((f) => f.relativePath === 'src/service.ts');
    expect(modifiedServiceFile?.status).toBe('modified');

    const findings = service.nightwatch.listFindings({ assetId: asset.id });
    const tlsFinding = findings.find(
      (f) => f.relativePath === 'src/tls.ts' && f.scannerSource === 'obsidian-static-inspector'
    );
    expect(tlsFinding).toBeDefined();
    expect(tlsFinding?.lineStart).toBe(1);
    expect(tlsFinding?.evidence).toContain('rejectUnauthorized: false');

    // Clean file must produce zero findings
    expect(findings.filter((f) => f.relativePath === 'src/clean.ts')).toEqual([]);

    const gitleaksBin = await resolveScannerBinary('gitleaks');
    if (gitleaksBin) {
      const secretFinding = findings.find((f) => f.scannerSource === 'gitleaks');
      expect(secretFinding).toBeDefined();
      expect(secretFinding?.relativePath).toBe('src/leaked.ts');
      expect(secretFinding?.evidence).not.toContain(dummySecret);
    }

    const osvBin = await resolveScannerBinary('osv-scanner');
    const osvExec = scan.scannerResults.find((s) => s.scanner === 'osv-scanner');
    if (osvBin && osvExec?.executed) {
      const osvFinding = findings.find((f) => f.scannerSource === 'osv-scanner');
      expect(osvFinding).toBeDefined();
      expect(osvFinding?.evidence).toContain('lodash@4.17.15');
    }

    // 2. Saver explains finding & proposes exact diff + enforces explicit approval
    const proposal1 = await service.saver.explainAndPropose(tlsFinding!.id);
    expect(proposal1.recommendation.explanation.length).toBeGreaterThan(10);
    expect(proposal1.patch).not.toBeNull();
    expect(proposal1.patch?.unifiedDiff).toContain('+export const tlsConfig = { rejectUnauthorized: true };');

    // Must refuse apply before explicit approval
    await expect(service.saver.applyApprovedPatch(proposal1.patch!.id)).rejects.toThrow(PatchValidationError);
    expect(fs.readFileSync(tlsPath, 'utf8')).toBe(initialTlsContent);

    // 3. Failed verification path: must NOT falsely mark finding resolved or advance baseline; revert recovers
    service.saver.decidePatch(proposal1.patch!.id, 'approved', 'Testing failed verifier recovery path');
    const failingSaver = new SaverAgent(
      service.db,
      service.chronicle,
      service.ai,
      service.fileIntel,
      async () => ({
        status: 'failed',
        notes: 'Simulated verification failure: policy check still failing.'
      })
    );
    const failedApply = await failingSaver.applyApprovedPatch(proposal1.patch!.id);
    expect(failedApply.status).toBe('applied');
    expect(failedApply.verificationStatus).toBe('failed');

    const findingAfterFail = service.nightwatch
      .listFindings({ assetId: asset.id })
      .find((f) => f.id === tlsFinding!.id);
    expect(findingAfterFail?.status).not.toBe('resolved');

    const detailAfterFail = service.fileIntel.getFileDetail(tlsFinding!.fileId!);
    expect(detailAfterFail.baseline?.sha256).toBe(sha256Hex(initialTlsContent));

    // Revert restores disk bytes cleanly & sets finding open again
    const reverted = failingSaver.revertPatch(failedApply.id);
    expect(reverted.status).toBe('reverted');
    expect(fs.readFileSync(tlsPath, 'utf8')).toBe(initialTlsContent);
    const findingAfterRevert = service.nightwatch
      .listFindings({ assetId: asset.id })
      .find((f) => f.id === tlsFinding!.id);
    expect(findingAfterRevert?.status).toBe('open');

    // 4. Success path: propose -> approve -> apply -> verify passed -> finding resolved -> baseline synced
    const proposal2 = await service.saver.explainAndPropose(tlsFinding!.id);
    expect(proposal2.patch).not.toBeNull();
    service.saver.decidePatch(proposal2.patch!.id, 'approved', 'Verified clean remediation');
    const appliedOk = await service.saver.applyApprovedPatch(proposal2.patch!.id);
    expect(appliedOk.status).toBe('applied');
    expect(appliedOk.verificationStatus).toBe('passed');
    expect(fs.readFileSync(tlsPath, 'utf8')).toContain('rejectUnauthorized: true');

    const resolvedFinding = service.nightwatch
      .listFindings({ assetId: asset.id })
      .find((f) => f.id === tlsFinding!.id);
    expect(resolvedFinding?.status).toBe('resolved');

    // Post-remediation inventory does not report Saver's verified fix as unexpected modification
    const postInventory = await service.fileIntel.inventoryAsset(asset);
    expect(postInventory.filesModified).toBe(0);

    // 5. Chronicle audit trail & zero raw secret exposure across all persisted/exported records
    const integrity = service.chronicle.verifyIntegrity();
    expect(integrity.valid).toBe(true);
    const events = service.chronicle.listEvents({ limit: 200 });
    const eventTypes = new Set(events.map((e) => e.eventType));
    expect(eventTypes.has('asset_registered')).toBe(true);
    expect(eventTypes.has('scan_started')).toBe(true);
    expect(eventTypes.has('scan_completed')).toBe(true);
    expect(eventTypes.has('finding_detected')).toBe(true);
    expect(eventTypes.has('recommendation_generated')).toBe(true);
    expect(eventTypes.has('patch_proposed')).toBe(true);
    expect(eventTypes.has('patch_approved')).toBe(true);
    expect(eventTypes.has('patch_verification_failed')).toBe(true);
    expect(eventTypes.has('patch_reverted')).toBe(true);
    expect(eventTypes.has('patch_applied_verified')).toBe(true);
    expect(eventTypes.has('baseline_synchronized')).toBe(true);

    // 6. AI consent boundary: enabled=true with consentToSendContext=false must transmit 0 HTTP requests
    let receivedRequests = 0;
    const mockAiServer = http.createServer((_req, res) => {
      receivedRequests++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: '{}' } }] }));
    });
    const prevDisableKeychain = process.env.COBALIX_DISABLE_KEYCHAIN;
    process.env.COBALIX_DISABLE_KEYCHAIN = '1';
    const port = await listenServer(mockAiServer);
    const dummyAiSecret = 'dummy-o9-ai-credential-never-export';

    try {
      service.ai.saveConfig({
        provider: 'openai_compatible',
        displayName: 'Mock Consent Test',
        endpoint: `http://127.0.0.1:${port}`,
        model: 'gpt-test',
        enabled: true,
        consentToSendContext: false,
        redactSecrets: true,
        apiKey: dummyAiSecret
      });

      const aiFindingOut = await service.ai.explainFinding({
        title: tlsFinding!.title,
        description: tlsFinding!.description,
        evidence: tlsFinding!.evidence,
        recommendedAction: tlsFinding!.recommendedAction
      });
      const aiDiffOut = await service.ai.explainFileChange({
        relativePath: 'src/tls.ts',
        deterministicSummary: 'Updated tls setting',
        diffText: appliedOk.unifiedDiff
      });

      expect(aiFindingOut).toBeNull();
      expect(aiDiffOut).toBeNull();
      expect(receivedRequests).toBe(0);

      // Exported reports, findings, scan logs, Chronicle events, overview telemetry, and settings must never leak raw secrets
      const overview = service.getCommandCenterOverview();
      const allChanges = service.fileIntel.listRecentChanges(100);
      const serializedTelemetryAndReports = JSON.stringify({
        openFindingsBySeverity: overview.openFindingsBySeverity,
        latestScan: overview.latestScan,
        agentLatestRuns: overview.agentLatestRuns,
        recentEvents: overview.recentEvents,
        recentChangeSummaries: allChanges.map((c) => ({
          relativePath: c.relativePath,
          changeType: c.changeType,
          detectedAt: c.detectedAt,
          deterministicSummary: c.deterministicSummary
        })),
        findings: service.nightwatch.listFindings({ assetId: asset.id }),
        scans: service.nightwatch.listScans(asset.id),
        events: service.chronicle.listEvents({ limit: 500 }),
        settings: service.getSettings()
      });
      expect(serializedTelemetryAndReports).not.toContain(dummySecret);
      expect(serializedTelemetryAndReports).not.toContain(dummyAiSecret);
    } finally {
      if (prevDisableKeychain === undefined) {
        delete process.env.COBALIX_DISABLE_KEYCHAIN;
      } else {
        process.env.COBALIX_DISABLE_KEYCHAIN = prevDisableKeychain;
      }
      await closeServer(mockAiServer);
      service.close();
    }
  });
});
