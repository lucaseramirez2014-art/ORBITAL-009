// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { emit } from '@tauri-apps/api/event';
import type {
  AgentRun,
  Asset,
  ChronicleEvent,
  CommandCenterOverview,
  FileChangeRecord,
  Finding,
  PatchRecord,
  Recommendation,
  ScanRecord,
  TrackedFile
} from '@cobalix/core';
import { DiffViewer } from '../apps/web/src/components/DiffViewer';
import { ErrorBoundary } from '../apps/web/src/components/ErrorBoundary';
import { AgentsView } from '../apps/web/src/views/AgentsView';
import { ChronicleView } from '../apps/web/src/views/ChronicleView';
import { CommandCenterView } from '../apps/web/src/views/CommandCenterView';
import { FileIntelligenceView } from '../apps/web/src/views/FileIntelligenceView';
import { AssetExplorerView } from '../apps/web/src/views/AssetExplorerView';
import { RemediationView } from '../apps/web/src/views/RemediationView';
import { ReportsView } from '../apps/web/src/views/ReportsView';
import { SettingsView } from '../apps/web/src/views/SettingsView';
import { ThreatCenterView } from '../apps/web/src/views/ThreatCenterView';
import { api, isTauriRuntime } from '../apps/web/src/api/client';

afterEach(() => {
  cleanup();
  clearMocks();
  vi.restoreAllMocks();
});

const SAMPLE_ASSET: Asset = {
  id: 'asset-1',
  displayName: 'Demo Repo',
  assetType: 'repository',
  canonicalPath: '/tmp/demo-repo',
  monitoringStatus: 'active',
  scanConfig: {
    exclusions: ['node_modules', '.git'],
    enableGitleaks: true,
    enableOsvScanner: true,
    enableNpmAudit: true,
    enableEslint: true,
    enableIntegrityCheck: true,
    scheduleCron: null,
    scanOnFileChange: false
  },
  registeredAt: '2026-11-23T08:00:00.000Z',
  lastScanAt: '2026-11-23T09:00:00.000Z',
  fileCount: 2,
  openFindingCount: 1
};

const FILE_SRC: TrackedFile = {
  id: 'file-1',
  assetId: 'asset-1',
  relativePath: 'src/auth.ts',
  filename: 'auth.ts',
  extension: '.ts',
  category: 'source',
  isBinary: false,
  sizeBytes: 128,
  mtimeIso: '2026-11-23T09:00:00.000Z',
  sha256: 'aaaa111122223333444455556666777788889999aaaabbbbccccddddeeeeffff',
  status: 'modified',
  integrityStatus: 'changed',
  purposeDescription: 'Handles TLS configuration.',
  descriptionProvenance: 'deterministic',
  importance: 'high',
  firstDiscoveredAt: '2026-11-23T08:00:00.000Z',
  lastScannedAt: '2026-11-23T09:00:00.000Z',
  lastModifiedObservedAt: '2026-11-23T09:00:00.000Z',
  openFindingCount: 1
};

const FILE_DOCS: TrackedFile = {
  id: 'file-2',
  assetId: 'asset-1',
  relativePath: 'docs/README.md',
  filename: 'README.md',
  extension: '.md',
  category: 'documentation',
  isBinary: false,
  sizeBytes: 64,
  mtimeIso: '2026-11-23T09:00:00.000Z',
  sha256: 'bbbb111122223333444455556666777788889999aaaabbbbccccddddeeeeffff',
  status: 'added',
  integrityStatus: 'new',
  purposeDescription: 'Project documentation.',
  descriptionProvenance: 'deterministic',
  importance: 'low',
  firstDiscoveredAt: '2026-11-23T08:00:00.000Z',
  lastScannedAt: '2026-11-23T09:00:00.000Z',
  lastModifiedObservedAt: '2026-11-23T08:30:00.000Z',
  openFindingCount: 0
};

const SAMPLE_FINDING: Finding = {
  id: 'finding-1',
  fingerprint: 'fp-1',
  assetId: 'asset-1',
  fileId: 'file-1',
  relativePath: 'src/auth.ts',
  scanId: 'scan-1',
  title: 'TLS Certificate Verification Disabled',
  description: 'rejectUnauthorized is false',
  severity: 'high',
  confidence: 'high',
  category: 'insecure_configuration',
  scannerSource: 'obsidian-static-inspector',
  evidence: 'rejectUnauthorized: false',
  lineStart: 1,
  lineEnd: 1,
  status: 'open',
  recommendedAction: 'Set rejectUnauthorized to true.',
  occurrenceCount: 1,
  firstDetectedAt: '2026-11-23T08:30:00.000Z',
  lastDetectedAt: '2026-11-23T09:00:00.000Z'
};

const SAMPLE_REC: Recommendation = {
  id: 'rec-1',
  findingId: 'finding-1',
  assetId: 'asset-1',
  summary: 'TLS Certificate Verification Disabled',
  explanation: 'Disablement exposes connections to MITM.',
  recommendedFix: 'Enable rejectUnauthorized: true.',
  provenance: 'deterministic',
  createdAt: '2026-11-23T08:35:00.000Z'
};

const SAMPLE_PATCH: PatchRecord = {
  id: 'patch-12345678',
  findingId: 'finding-1',
  recommendationId: 'rec-1',
  assetId: 'asset-1',
  fileId: 'file-1',
  relativePath: 'src/auth.ts',
  patchHash: 'phash',
  targetFileSha256Before: FILE_SRC.sha256,
  unifiedDiff: '--- a/src/auth.ts\n+++ b/src/auth.ts\n@@ -1,1 +1,1 @@\n-rejectUnauthorized: false\n+rejectUnauthorized: true',
  originalContent: 'rejectUnauthorized: false',
  proposedContent: 'rejectUnauthorized: true',
  status: 'proposed',
  verificationStatus: 'pending',
  verificationNotes: null,
  backupPath: null,
  createdAt: '2026-11-23T08:36:00.000Z',
  updatedAt: '2026-11-23T08:36:00.000Z'
};

const SAMPLE_EVENT: ChronicleEvent = {
  id: 'evt-1',
  sequence: 1,
  timestamp: '2026-11-23T08:40:00.000Z',
  eventType: 'file_modified',
  source: 'file_intelligence',
  assetId: 'asset-1',
  fileId: 'file-1',
  findingId: null,
  summary: 'Modified file detected: src/auth.ts',
  details: {},
  previousEventHash: '0'.repeat(64),
  eventHash: '1'.repeat(64)
};

describe('Milestone 004B Frontend Interactions', () => {
  beforeEach(() => {
    vi.spyOn(api, 'listFiles').mockResolvedValue([FILE_SRC, FILE_DOCS]);
    vi.spyOn(api, 'getFileDetail').mockResolvedValue({
      file: FILE_SRC,
      baseline: null,
      changes: [
        {
          id: 'chg-1',
          assetId: 'asset-1',
          fileId: 'file-1',
          relativePath: 'src/auth.ts',
          changeType: 'modified',
          previousSha256: '0000',
          currentSha256: FILE_SRC.sha256,
          previousSizeBytes: 100,
          currentSizeBytes: 128,
          linesAdded: 1,
          linesRemoved: 1,
          deterministicSummary: '1 line(s) added, 1 line(s) removed.',
          aiExplanation: 'TLS check altered.',
          potentialImpact: 'Certificate validation affected.',
          confidence: 'medium',
          diffText: '--- a/src/auth.ts\n+++ b/src/auth.ts\n@@ -1,1 +1,1 @@\n-const tls = false;\n+const tls = true;',
          previousSnapshot: 'const tls = false;',
          currentSnapshot: 'const tls = true;',
          isBinary: false,
          detectedAt: '2026-11-23T08:31:00.000Z'
        }
      ],
      relationships: [
        {
          id: 'rel-1',
          assetId: 'asset-1',
          sourceFileId: 'file-1',
          sourcePath: 'src/auth.ts',
          targetPath: 'node:https',
          targetFileId: null,
          relationshipType: 'imports',
          languageSupport: 'supported'
        }
      ],
      findings: [SAMPLE_FINDING],
      recommendations: [SAMPLE_REC],
      patches: [SAMPLE_PATCH],
      events: [SAMPLE_EVENT],
      languageSupport: 'supported'
    });
  });

  it('switches DiffViewer between Unified and Side-by-Side modes and enforces large-diff safeguards', async () => {
    const user = userEvent.setup();
    const manyLines = Array.from({ length: 450 }, (_, i) => `+line ${i + 1}`).join('\n');
    const diff = `--- a/big.ts\n+++ b/big.ts\n@@ -1,1 +1,450 @@\n-oldLine\n${manyLines}`;

    render(
      <DiffViewer
        unifiedDiff={diff}
        filePath="big.ts"
        changeType="modified"
        linesAdded={450}
        linesRemoved={1}
        previousSha256="aaaa1111"
        currentSha256="bbbb2222"
      />
    );

    expect(screen.getByText(/Large diff truncated to 400/)).toBeTruthy();
    expect(screen.queryByText('+line 449')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Show Full Diff' }));
    expect(screen.getByText(/\+line 449/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Side-by-Side' }));
    expect(screen.getByText('Previous')).toBeTruthy();
    expect(screen.getByText('Current')).toBeTruthy();
    expect(screen.getByText('oldLine')).toBeTruthy();
  });

  it('navigates folders and breadcrumbs, filters, handles bulk confirmation, and displays integrated file history', async () => {
    const user = userEvent.setup();
    const bulkMock = vi.spyOn(api, 'acceptFilesBaselineBulk').mockResolvedValue({
      accepted: [{ ...FILE_DOCS, status: 'unchanged', integrityStatus: 'verified' }],
      skipped: []
    });
    const onOpenInGraph = vi.fn();
    const onNavigateTab = vi.fn();

    render(
      <FileIntelligenceView
        assets={[SAMPLE_ASSET]}
        onNavigateTab={onNavigateTab}
        onOpenInGraph={onOpenInGraph}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('src/auth.ts')).toBeTruthy();
      expect(screen.getByText('docs/README.md')).toBeTruthy();
    });

    // Click 'docs' folder in tree
    await user.click(screen.getByText('docs'));
    expect(screen.queryByText('src/auth.ts')).toBeNull();
    expect(screen.getByText('docs/README.md')).toBeTruthy();

    // Return to Root via breadcrumb
    const rootButtons = screen.getAllByRole('button', { name: /Root/i });
    await user.click(rootButtons[0]!);
    expect(screen.getByText('src/auth.ts')).toBeTruthy();

    // Filter via search input
    const searchInput = screen.getByPlaceholderText(/Search by filename/i);
    await user.type(searchInput, 'README');
    expect(screen.queryByText('src/auth.ts')).toBeNull();
    expect(screen.getByText('docs/README.md')).toBeTruthy();
    await user.clear(searchInput);

    // Select README.md row checkbox and test bulk baseline confirmation
    const docRow = screen.getByText('docs/README.md').closest('tr')!;
    await user.click(within(docRow).getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Accept Baseline' }));
    expect(screen.getByText(/Confirm Bulk Baseline Acceptance/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Confirm Baseline Acceptance' }));

    await waitFor(() => {
      expect(bulkMock).toHaveBeenCalledWith(['file-2'], true);
    });

    // Inspect src/auth.ts integrated History & Relationships
    await user.click(screen.getByText('src/auth.ts'));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'History' })).toBeTruthy();
    });

    await user.click(screen.getByRole('button', { name: 'History' }));
    expect(screen.getByText('Snapshot captured')).toBeTruthy();
    expect(screen.getByText('TLS Certificate Verification Disabled')).toBeTruthy();
    expect(screen.getByText(/Chronicle #1: file_modified/)).toBeTruthy();
    expect(screen.getByText(/Patch patch-12/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Relationships' }));
    expect(screen.getByText('Parser Supported')).toBeTruthy();
    expect(screen.getByText('node:https')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Inspect in Security Graph' }));
    expect(onOpenInGraph).toHaveBeenCalledWith('asset-1', 'file:file-1');
  });

  it('displays API errors cleanly in FileIntelligenceView', async () => {
    vi.spyOn(api, 'listFiles').mockRejectedValueOnce(new Error('Companion unreachable'));
    render(<FileIntelligenceView assets={[SAMPLE_ASSET]} />);

    await waitFor(() => {
      expect(screen.getByText('Companion unreachable')).toBeTruthy();
    });
  });

  it('edits and saves per-asset scan configuration in AssetExplorerView with confirmation guard', async () => {
    const user = userEvent.setup();
    const updateMock = vi.spyOn(api, 'updateAssetConfig').mockResolvedValue(SAMPLE_ASSET);
    const onRefresh = vi.fn().mockResolvedValue(undefined);

    render(<AssetExplorerView assets={[SAMPLE_ASSET]} onRefresh={onRefresh} />);

    await user.click(screen.getByRole('button', { name: 'Configure' }));
    expect(screen.getByText(/Per-Asset Scan Configuration — Demo Repo/)).toBeTruthy();

    // Toggle ESLint checkbox off and save
    const eslintCheckbox = screen.getByLabelText('ESLint Static Analysis');
    await user.click(eslintCheckbox);
    await user.click(screen.getByRole('button', { name: 'Save Configuration' }));

    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledWith(
        'asset-1',
        expect.objectContaining({ enableEslint: false })
      );
    });

    // Re-open, clear exclusions, verify high-impact confirmation guard triggers before saving
    await user.click(screen.getByRole('button', { name: 'Configure' }));
    const exclInput = screen.getByLabelText(/File & Folder Exclusions/);
    await user.clear(exclInput);
    await user.click(screen.getByRole('button', { name: 'Save Configuration' }));

    expect(screen.getByText('Confirm High-Impact Configuration')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Confirm & Save' }));

    await waitFor(() => {
      expect(updateMock).toHaveBeenLastCalledWith(
        'asset-1',
        expect.objectContaining({ exclusions: [] })
      );
    });
  });

  it('marks scanOnFileChange and scheduleCron as Planned — Not Active, disables them, and preserves stored values', async () => {
    const user = userEvent.setup();
    const assetWithStoredPlanned: Asset = {
      ...SAMPLE_ASSET,
      scanConfig: {
        ...SAMPLE_ASSET.scanConfig,
        scanOnFileChange: true,
        scheduleCron: '0 3 * * *'
      }
    };
    const updateMock = vi.spyOn(api, 'updateAssetConfig').mockResolvedValue(assetWithStoredPlanned);
    const onRefresh = vi.fn().mockResolvedValue(undefined);

    render(<AssetExplorerView assets={[assetWithStoredPlanned]} onRefresh={onRefresh} />);

    await user.click(screen.getByRole('button', { name: 'Configure' }));
    expect(screen.getAllByText(/Planned — Not Active/i).length).toBeGreaterThanOrEqual(2);

    const fileChangeInput = screen.getByLabelText(/Scan on File Change/i) as HTMLInputElement;
    const cronInput = screen.getByLabelText(/Custom Schedule Cron/i) as HTMLInputElement;

    expect(fileChangeInput.disabled).toBe(true);
    expect(fileChangeInput.checked).toBe(true);
    expect(cronInput.disabled).toBe(true);
    expect(cronInput.value).toBe('0 3 * * *');

    // Toggle an active control and save; stored planned config fields must remain preserved untouched
    const eslintCheckbox = screen.getByLabelText('ESLint Static Analysis');
    await user.click(eslintCheckbox);
    await user.click(screen.getByRole('button', { name: 'Save Configuration' }));

    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledWith(
        'asset-1',
        expect.objectContaining({
          enableEslint: false,
          scanOnFileChange: true,
          scheduleCron: '0 3 * * *'
        })
      );
    });
  });

  it('catches rendering failures in ErrorBoundary and recovers on Retry', async () => {
    const user = userEvent.setup();
    let shouldThrow = true;

    function FaultyGraph() {
      if (shouldThrow) throw new Error('Cytoscape WebGL context lost');
      return <div>Graph Recovered</div>;
    }

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary fallbackTitle="Security Graph failed to load">
        <FaultyGraph />
      </ErrorBoundary>
    );

    expect(screen.getByText('Security Graph failed to load')).toBeTruthy();
    expect(screen.getByText('Cytoscape WebGL context lost')).toBeTruthy();

    shouldThrow = false;
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(screen.getByText('Graph Recovered')).toBeTruthy();
    consoleSpy.mockRestore();
  });

  it('lazy-loads SecurityGraphView via Suspense when navigating to Security Graph', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'getOverview').mockResolvedValue({
      protectedAssetsCount: 1,
      monitoredFilesCount: 2,
      modifiedFilesCount: 1,
      openFindingsBySeverity: { critical: 0, high: 1, medium: 0, low: 0, informational: 0 },
      pendingApprovalsCount: 0,
      latestScan: null,
      nextScheduledScanAt: null,
      agentLatestRuns: { nightwatch: null, saver: null, chronicle: null },
      recentChanges: [],
      recentEvents: [],
      chronicleIntegrity: { valid: true, checkedEvents: 1, brokenAtSequence: null }
    });
    vi.spyOn(api, 'listAssets').mockResolvedValue([SAMPLE_ASSET]);
    vi.spyOn(api, 'getGraph').mockResolvedValue({
      nodes: [],
      edges: [],
      truncated: false,
      totalNodesAvailable: 0
    });

    const { App } = await import('../apps/web/src/App');
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Command Center')).toBeTruthy();
    });

    await user.click(screen.getByRole('button', { name: 'Security Graph' }));
    expect(
      screen.queryByText('Loading Security Graph engine...') || screen.queryByText('Node Inspector')
    ).toBeTruthy();
  });

  it('routes production desktop API requests via Tauri IPC companion_request without touching JS fetch or exposing tokens', async () => {
    const ipcCalls: Array<{ cmd: string; args: Record<string, unknown> }> = [];
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    mockIPC((cmd, args) => {
      ipcCalls.push({ cmd, args: (args ?? {}) as Record<string, unknown> });
      if (cmd === 'companion_request') {
        const req = args as { method: string; path: string };
        if (req.path === '/api/overview') {
          return {
            status: 200,
            body: JSON.stringify({ protectedAssetsCount: 2 })
          };
        }
        return {
          status: 200,
          body: JSON.stringify({ id: 'asset-99', ok: true, deleted: true })
        };
      }
      return null;
    });

    expect(isTauriRuntime()).toBe(true);
    const ov = await api.getOverview();
    expect(ov.protectedAssetsCount).toBe(2);

    await api.registerAsset({ displayName: 'Desk', assetType: 'repository', path: '/tmp/desk' });
    await api.updateSettings({ notifyOnCritical: false });
    await api.saveAIConfig({
      provider: 'none',
      displayName: 'Deterministic',
      endpoint: '',
      model: '',
      enabled: false,
      consentToSendContext: false,
      redactSecrets: true
    });
    await api.removeAsset('asset-99');

    expect(fetchSpy).not.toHaveBeenCalled();
    const methods = ipcCalls
      .filter((c) => c.cmd === 'companion_request')
      .map((c) => c.args.method);
    expect(methods).toEqual(['GET', 'POST', 'PATCH', 'PUT', 'DELETE']);
    expect(JSON.stringify(ipcCalls)).not.toContain('X-Cobalix-Token');
  });

  it('displays Tauri companion lifecycle states and supports bounded manual restart recovery', async () => {
    const user = userEvent.setup();
    const companionCalls: string[] = [];

    mockIPC(
      (cmd, args) => {
        if (cmd === 'get_companion_status') {
          companionCalls.push('get_companion_status');
          return {
            state: 'failed',
            endpoint: null,
            port: null,
            localOnly: true,
            restartCount: 3,
            maxRestarts: 3,
            lastError: 'Companion exited unexpectedly (3 restarts exceeded)',
            pid: null
          };
        }
        if (cmd === 'restart_companion') {
          companionCalls.push('restart_companion');
          return {
            state: 'ready',
            endpoint: 'http://127.0.0.1:47890',
            port: 47890,
            localOnly: true,
            restartCount: 0,
            maxRestarts: 3,
            lastError: null,
            pid: 9999
          };
        }
        if (cmd === 'companion_request') {
          const req = args as { path: string };
          companionCalls.push(req.path);
          if (req.path === '/api/overview') {
            return {
              status: 200,
              body: JSON.stringify({
                protectedAssetsCount: 1,
                monitoredFilesCount: 0,
                modifiedFilesCount: 0,
                openFindingsBySeverity: { critical: 0, high: 0, medium: 0, low: 0, informational: 0 },
                pendingApprovalsCount: 0,
                latestScan: null,
                nextScheduledScanAt: null,
                agentLatestRuns: { nightwatch: null, saver: null, chronicle: null },
                recentChanges: [],
                recentEvents: [],
                chronicleIntegrity: { valid: true, checkedEvents: 0, brokenAtSequence: null }
              })
            };
          }
          if (req.path === '/api/assets') {
            return { status: 200, body: '[]' };
          }
        }
        return null;
      },
      { shouldMockEvents: true }
    );

    const { App } = await import('../apps/web/src/App');
    render(<App />);

    // Does not call companion /api/overview while Failed and exposes Restart button
    await waitFor(() => {
      expect(screen.getByText('Failed')).toBeTruthy();
      expect(screen.getByText(/Companion exited unexpectedly/)).toBeTruthy();
    });
    expect(companionCalls.filter((c) => c === '/api/overview')).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Restart Companion' }));
    await waitFor(() => {
      expect(screen.getByText('Connected')).toBeTruthy();
      expect(companionCalls).toContain('/api/overview');
    });

    // Live status event transitions to Disconnected cleanly
    await emit('companion-status', {
      state: 'disconnected',
      endpoint: null,
      port: null,
      localOnly: true,
      restartCount: 1,
      maxRestarts: 3,
      lastError: 'Health check failed',
      pid: null
    });
    await waitFor(() => {
      expect(screen.getByText('Disconnected')).toBeTruthy();
      expect(screen.getByText(/Health check failed/)).toBeTruthy();
    });
  });

  it('displays external scanner diagnostics and saves custom binary paths in SettingsView', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'getSettings').mockResolvedValue({
      defaultExclusions: ['node_modules', '.git'],
      nightlyScheduleEnabled: false,
      nightlyScheduleTime: '02:00',
      scanOnFileChange: false,
      eventRetentionDays: 365,
      maxSnapshotSizeBytes: 512 * 1024,
      notifyOnCritical: true,
      notifyOnFileChange: true,
      scannerPaths: {}
    });
    vi.spyOn(api, 'getAIConfig').mockResolvedValue({
      config: {
        id: 'ai-1',
        provider: 'none',
        displayName: 'Local',
        endpoint: '',
        model: '',
        enabled: false,
        consentToSendContext: false,
        redactSecrets: true,
        hasCredential: false,
        updatedAt: '2026-11-23T00:00:00.000Z'
      },
      status: {
        configured: false,
        available: false,
        provider: 'none',
        model: '',
        consentToSendContext: false,
        reason: 'Disabled'
      }
    });
    const diagSpy = vi.spyOn(api, 'getScannerDiagnostics').mockResolvedValue([
      {
        scanner: 'gitleaks',
        available: true,
        resolvedPath: '/Users/test/.local/bin/gitleaks',
        source: 'local_bin',
        version: '8.30.1',
        error: null
      },
      {
        scanner: 'eslint',
        available: false,
        resolvedPath: null,
        source: 'missing',
        version: null,
        error: null
      }
    ]);
    const updateSettingsSpy = vi.spyOn(api, 'updateSettings').mockResolvedValue({
      defaultExclusions: ['node_modules', '.git'],
      nightlyScheduleEnabled: false,
      nightlyScheduleTime: '02:00',
      scanOnFileChange: false,
      eventRetentionDays: 365,
      maxSnapshotSizeBytes: 512 * 1024,
      notifyOnCritical: true,
      notifyOnFileChange: true,
      scannerPaths: { gitleaks: '/custom/bin/gitleaks', osvScanner: null, eslint: null }
    });

    render(<SettingsView />);

    await waitFor(() => {
      expect(screen.getByText('External Scanner Binary Discovery')).toBeTruthy();
    });
    expect(screen.getByText('gitleaks')).toBeTruthy();
    expect(screen.getByText(/8\.30\.1/)).toBeTruthy();
    expect(screen.getByText('Available')).toBeTruthy();
    expect(screen.getByText('Not Installed')).toBeTruthy();

    const glInput = screen.getByLabelText('Custom Gitleaks Binary Path');
    await user.type(glInput, '/custom/bin/gitleaks');
    await user.click(screen.getByRole('button', { name: 'Save General Settings' }));

    await waitFor(() => {
      expect(updateSettingsSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          scannerPaths: {
            gitleaks: '/custom/bin/gitleaks',
            osvScanner: null,
            eslint: null
          }
        })
      );
      expect(diagSpy).toHaveBeenCalledTimes(2);
    });
  });
});

describe('ORBITAL 007 UI Consistency & Error States', () => {
  it('renders visible error banners instead of silent failures on ThreatCenter, Agents, Chronicle, and Reports views', async () => {
    vi.spyOn(api, 'listFindings').mockRejectedValue(new Error('Threat Center API unavailable'));
    render(<ThreatCenterView onOpenRemediation={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText('Threat Center API unavailable')).toBeTruthy();
    });
    cleanup();

    vi.spyOn(api, 'listAgentRuns').mockRejectedValue(new Error('Agent telemetry fetch failed'));
    render(<AgentsView />);
    await waitFor(() => {
      expect(screen.getByText('Agent telemetry fetch failed')).toBeTruthy();
    });
    cleanup();

    vi.spyOn(api, 'listChronicle').mockRejectedValue(new Error('Chronicle query rejected'));
    vi.spyOn(api, 'verifyChronicleIntegrity').mockResolvedValue({
      valid: true,
      checkedEvents: 0,
      brokenAtSequence: null
    });
    render(<ChronicleView />);
    await waitFor(() => {
      expect(screen.getByText('Chronicle query rejected')).toBeTruthy();
    });
    cleanup();

    vi.spyOn(api, 'listScans').mockRejectedValue(new Error('Reports endpoint failed'));
    vi.spyOn(api, 'listFileChanges').mockResolvedValue([]);
    render(<ReportsView />);
    await waitFor(() => {
      expect(screen.getByText('Reports endpoint failed')).toBeTruthy();
    });
  });

  it('displays error banner on RemediationView failure and renders color-coded verification status and scan warnings on ReportsView', async () => {
    vi.spyOn(api, 'listPatches').mockRejectedValueOnce(new Error('Patch store error'));
    vi.spyOn(api, 'listRecommendations').mockResolvedValueOnce([]);

    render(<RemediationView />);
    await waitFor(() => {
      expect(screen.getByText('Patch store error')).toBeTruthy();
    });
    cleanup();

    const failedPatch: PatchRecord = {
      id: 'patch-fail-1234',
      findingId: 'finding-1',
      recommendationId: 'rec-1',
      assetId: 'asset-1',
      fileId: 'file-1',
      relativePath: 'src/tls.ts',
      patchHash: 'abcdef1234567890abcdef1234567890',
      targetFileSha256Before: '1111222233334444',
      unifiedDiff: '--- a/src/tls.ts\n+++ b/src/tls.ts\n@@ -1 +1 @@\n-false\n+true',
      originalContent: 'false',
      proposedContent: 'true',
      status: 'applied',
      verificationStatus: 'failed',
      verificationNotes: 'Verifier flagged remaining issue.',
      backupPath: '/tmp/backup.bak',
      createdAt: '2026-11-23T09:00:00.000Z',
      updatedAt: '2026-11-23T09:05:00.000Z'
    };

    vi.spyOn(api, 'listPatches').mockResolvedValueOnce([failedPatch]);
    vi.spyOn(api, 'listRecommendations').mockResolvedValueOnce([]);
    render(<RemediationView />);
    await waitFor(() => {
      expect(screen.getByText('Verification: Verifier flagged remaining issue.')).toBeTruthy();
    });
    const verificationNoteEl = screen.getByText('Verification: Verifier flagged remaining issue.');
    expect(verificationNoteEl.className).toContain('#EA4335');
    cleanup();

    const scanWithErrors: ScanRecord = {
      id: 'scan-warn-0001',
      assetId: 'asset-1',
      trigger: 'manual',
      status: 'completed_with_errors',
      startedAt: '2026-11-23T09:00:00.000Z',
      completedAt: '2026-11-23T09:00:05.000Z',
      filesInspected: 4,
      filesAdded: 1,
      filesModified: 0,
      filesRemoved: 0,
      findingsCreated: 0,
      findingsUpdated: 0,
      scannerResults: [],
      errors: ['Inaccessible directory: locked'],
      skippedLocations: ['bad-symlink']
    };
    const emptyChanges: FileChangeRecord[] = [];
    const emptyRuns: AgentRun[] = [];
    expect(emptyRuns).toHaveLength(0);

    vi.spyOn(api, 'listScans').mockResolvedValueOnce([scanWithErrors]);
    vi.spyOn(api, 'listFileChanges').mockResolvedValueOnce(emptyChanges);
    render(<ReportsView />);
    await waitFor(() => {
      expect(screen.getByText('completed_with_errors')).toBeTruthy();
      expect(screen.getByText('Inaccessible directory: locked')).toBeTruthy();
      expect(screen.getByText(/Skipped locations \(1\): bad-symlink/)).toBeTruthy();
    });
    const statusBadge = screen.getByText('completed_with_errors');
    expect(statusBadge.className).toContain('#FBBC05');
  });

  it('renders compact info severity badge and accurate non-green scan and agent status colors in CommandCenterView', () => {
    const overviewWithFailure: CommandCenterOverview = {
      protectedAssetsCount: 1,
      monitoredFilesCount: 2,
      modifiedFilesCount: 1,
      openFindingsBySeverity: { critical: 0, high: 1, medium: 0, low: 0, informational: 1 },
      pendingApprovalsCount: 1,
      latestScan: {
        id: 'scan-failed-001',
        assetId: 'asset-1',
        trigger: 'manual',
        status: 'failed',
        startedAt: '2026-11-23T09:00:00.000Z',
        completedAt: '2026-11-23T09:00:05.000Z',
        filesInspected: 2,
        filesAdded: 0,
        filesModified: 1,
        filesRemoved: 0,
        findingsCreated: 0,
        findingsUpdated: 0,
        scannerResults: [],
        errors: ['Scanner failure'],
        skippedLocations: []
      },
      nextScheduledScanAt: null,
      agentLatestRuns: {
        nightwatch: {
          id: 'run-nw-1',
          agent: 'nightwatch',
          action: 'scan:manual',
          status: 'failed',
          assetId: 'asset-1',
          startedAt: '2026-11-23T09:00:00.000Z',
          completedAt: '2026-11-23T09:00:05.000Z',
          summary: 'Scan aborted due to error.',
          error: 'Scanner failed'
        },
        saver: {
          id: 'run-sv-1',
          agent: 'saver',
          action: 'propose',
          status: 'completed',
          assetId: 'asset-1',
          startedAt: '2026-11-23T09:01:00.000Z',
          completedAt: '2026-11-23T09:01:02.000Z',
          summary: 'Proposed fix.',
          error: null
        },
        chronicle: null
      },
      recentChanges: [],
      recentEvents: [],
      chronicleIntegrity: { valid: true, checkedEvents: 3, brokenAtSequence: null }
    };

    render(<CommandCenterView overview={overviewWithFailure} onNavigate={vi.fn()} />);

    const infoPill = screen.getByTitle('informational');
    expect(infoPill.textContent).toBe('info');
    expect(infoPill.className).toContain('text-[11px]');

    const scanStatusEl = screen.getAllByText('failed')[0]!;
    expect(scanStatusEl.className).toContain('#EA4335');

    const agentFailedStatus = screen.getAllByText('failed')[1]!;
    expect(agentFailedStatus.className).toContain('#EA4335');

    const agentCompletedStatus = screen.getByText('completed');
    expect(agentCompletedStatus.className).toContain('#34A853');
  });

  it('requires explicit inline confirmation before removing an asset in AssetExplorerView and supports Cancel', async () => {
    const user = userEvent.setup();
    const removeMock = vi.spyOn(api, 'removeAsset').mockResolvedValue({ deleted: true });
    const onRefresh = vi.fn().mockResolvedValue(undefined);

    render(<AssetExplorerView assets={[SAMPLE_ASSET]} onRefresh={onRefresh} />);

    // First click on Remove must show inline confirmation without calling api.removeAsset
    await user.click(screen.getByRole('button', { name: 'Remove asset' }));
    expect(removeMock).not.toHaveBeenCalled();
    expect(screen.getByText(/Confirm Asset Removal — Demo Repo/)).toBeTruthy();
    expect(screen.getByText(/Your local files on disk are not deleted/i)).toBeTruthy();

    // Cancel aborts removal cleanly
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(removeMock).not.toHaveBeenCalled();
    expect(screen.queryByText(/Confirm Asset Removal — Demo Repo/)).toBeNull();

    // Second confirmation actually invokes api.removeAsset
    await user.click(screen.getByRole('button', { name: 'Remove asset' }));
    await user.click(screen.getByRole('button', { name: 'Confirm Remove' }));

    await waitFor(() => {
      expect(removeMock).toHaveBeenCalledTimes(1);
      expect(removeMock).toHaveBeenCalledWith('asset-1');
      expect(onRefresh).toHaveBeenCalledTimes(1);
    });
  });

  it('exports sanitized Chronicle JSON and Markdown reports without exposing private local paths or secrets', async () => {
    const user = userEvent.setup();
    const fakeSecret = ['ghp_', 'ExportLeakTest123456789012345'].join('');
    const blobs: Blob[] = [];
    const origCreateObjectUrl = URL.createObjectURL;
    const origRevokeObjectUrl = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn((blob: Blob) => {
      blobs.push(blob);
      return 'blob:cobalix-test';
    });
    URL.revokeObjectURL = vi.fn();

    const readBlobText = (blob: Blob): Promise<string> =>
      new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ''));
        reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
        reader.readAsText(blob);
      });

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    try {
      const ev: ChronicleEvent = {
        id: 'ev-san-1',
        sequence: 1,
        timestamp: '2026-11-24T04:00:00.000Z',
        eventType: 'finding_detected',
        source: 'nightwatch',
        assetId: 'asset-1',
        fileId: 'file-1',
        findingId: 'find-1',
        summary: `Secret detected in /Users/tester/private-repo/src/env.ts: ${fakeSecret}`,
        details: { canonicalPath: '/Users/tester/private-repo', relativePath: 'src/env.ts' },
        previousEventHash: '0'.repeat(64),
        eventHash: 'f'.repeat(64)
      };

      vi.spyOn(api, 'listChronicle').mockResolvedValueOnce([ev]);
      vi.spyOn(api, 'verifyChronicleIntegrity').mockResolvedValueOnce({
        valid: true,
        checkedEvents: 1,
        brokenAtSequence: null
      });

      render(<ChronicleView />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Export Sanitized JSON' })).toBeTruthy();
      });
      await user.click(screen.getByRole('button', { name: 'Export Sanitized JSON' }));

      expect(blobs).toHaveLength(1);
      const chronicleJsonText = await readBlobText(blobs[0]!);
      expect(chronicleJsonText).toContain('Sanitized diagnostic export');
      expect(chronicleJsonText).not.toContain('/Users/tester/private-repo');
      expect(chronicleJsonText).not.toContain(fakeSecret);
      expect(chronicleJsonText).toContain('src/env.ts');

      vi.spyOn(api, 'listScans').mockResolvedValueOnce([
        {
          id: 'scan-san-1',
          assetId: 'asset-1',
          trigger: 'manual',
          status: 'completed_with_errors',
          startedAt: '2026-11-24T04:00:00.000Z',
          completedAt: '2026-11-24T04:00:02.000Z',
          filesInspected: 2,
          filesAdded: 0,
          filesModified: 0,
          filesRemoved: 0,
          findingsCreated: 0,
          findingsUpdated: 0,
          scannerResults: [],
          errors: [`Failed in /Users/tester/private-repo`],
          skippedLocations: []
        }
      ]);
      vi.spyOn(api, 'listFileChanges').mockResolvedValueOnce([
        {
          id: 'chg-1',
          scanId: 'scan-san-1',
          assetId: 'asset-1',
          fileId: 'file-1',
          relativePath: 'src/env.ts',
          changeType: 'modified',
          previousSha256: 'a'.repeat(64),
          newSha256: 'b'.repeat(64),
          diffSummary: null,
          linesAdded: 1,
          linesRemoved: 0,
          deterministicSummary: `Updated near /Users/tester/private-repo (${fakeSecret})`,
          detectedAt: '2026-11-24T04:00:01.000Z'
        }
      ]);

      render(<ReportsView />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Export Sanitized Report' })).toBeTruthy();
      });
      await user.click(screen.getByRole('button', { name: 'Export Sanitized Report' }));

      expect(blobs).toHaveLength(2);
      const reportMdText = await readBlobText(blobs[1]!);
      expect(reportMdText).toContain('Sanitized Diagnostic Export');
      expect(reportMdText).not.toContain('/Users/tester/private-repo');
      expect(reportMdText).not.toContain(fakeSecret);
      expect(reportMdText).toContain('`src/env.ts`');
    } finally {
      clickSpy.mockRestore();
      URL.createObjectURL = origCreateObjectUrl;
      URL.revokeObjectURL = origRevokeObjectUrl;
    }
  });
});
