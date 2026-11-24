import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalProtectionService, NightwatchAgent } from '@cobalix/agents';
import {
  normalizeGitleaksFindings,
  normalizeOsvOutput,
  resolveOsvSeverity,
  resolveScannerBinary,
  runGitleaksScanner,
  runOsvScanner
} from '@cobalix/scanners';

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function makeDummyGitHubToken(suffix = '9xK2mP7qR4tV8wZ1bN5cF3hJ6kL0nQ8rT2vY'): string {
  return ['ghp_', suffix].join('');
}

function createNodeStubBinary(dir: string, filename: string, scriptBody: string): string {
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, `#!/usr/bin/env node\n${scriptBody}\n`, { encoding: 'utf8', mode: 0o755 });
  fs.chmodSync(filePath, 0o755);
  return filePath;
}

function writeLodashLockfile(targetPath: string, version: string): void {
  fs.writeFileSync(
    targetPath,
    JSON.stringify(
      {
        name: 'synthetic-osv-fixture',
        version: '1.0.0',
        lockfileVersion: 3,
        requires: true,
        packages: {
          '': {
            name: 'synthetic-osv-fixture',
            version: '1.0.0',
            dependencies: { lodash: version }
          },
          'node_modules/lodash': {
            version
          }
        }
      },
      null,
      2
    )
  );
}

function writeCleanMsLockfile(targetPath: string): void {
  fs.writeFileSync(
    targetPath,
    JSON.stringify(
      {
        name: 'clean-osv-fixture',
        version: '1.0.0',
        lockfileVersion: 3,
        requires: true,
        packages: {
          '': {
            name: 'clean-osv-fixture',
            version: '1.0.0',
            dependencies: { ms: '2.1.3' }
          },
          'node_modules/ms': {
            version: '2.1.3'
          }
        }
      },
      null,
      2
    )
  );
}

const liveGitleaksBin = await resolveScannerBinary('gitleaks');
const liveOsvBin = await resolveScannerBinary('osv-scanner');

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('Milestone 006B: Unit & Normalization Tests', () => {
  it('resolves explicit binary paths strictly and verifies executability', async () => {
    const stubDir = makeTempDir('cobalix-m6b-stub-');
    const exe = createNodeStubBinary(stubDir, 'fake-tool', 'process.exit(0);');
    const nonExe = path.join(stubDir, 'not-executable');
    fs.writeFileSync(nonExe, 'echo nope', { mode: 0o644 });

    expect(await resolveScannerBinary('gitleaks', exe)).toBe(exe);
    expect(await resolveScannerBinary('gitleaks', nonExe)).toBeNull();
    expect(await resolveScannerBinary('gitleaks', path.join(stubDir, 'missing-bin'))).toBeNull();
  });

  it('normalizes Gitleaks findings canonically, redacts secrets, enforces symlink boundaries, and filters exclusions', () => {
    const parent = makeTempDir('cobalix-m6b-gl-unit-');
    const realRepo = path.join(parent, 'repo');
    const outsideDir = path.join(parent, 'outside');
    const symlinkRepo = path.join(parent, 'symlink-repo');
    fs.mkdirSync(path.join(realRepo, 'src'), { recursive: true });
    fs.mkdirSync(path.join(realRepo, 'excluded'), { recursive: true });
    fs.mkdirSync(outsideDir, { recursive: true });
    fs.symlinkSync(realRepo, symlinkRepo);

    const insideFile = path.join(realRepo, 'src', 'auth.ts');
    const outsideFile = path.join(outsideDir, 'secret.ts');
    const escapeLink = path.join(realRepo, 'src', 'escape.ts');
    fs.writeFileSync(insideFile, '// placeholder\n');
    fs.writeFileSync(outsideFile, '// outside\n');
    fs.symlinkSync(outsideFile, escapeLink);

    const dummySecret = makeDummyGitHubToken();
    const findings = normalizeGitleaksFindings(
      symlinkRepo,
      [
        {
          RuleID: 'github-pat',
          Description: `Detected token ${dummySecret}`,
          File: fs.realpathSync(insideFile),
          StartLine: 4,
          EndLine: 4,
          Match: `token="${dummySecret}"`
        },
        {
          RuleID: 'github-pat',
          Description: 'In excluded folder',
          File: path.join(realRepo, 'excluded', 'test.ts'),
          StartLine: 1,
          Match: dummySecret
        },
        {
          RuleID: 'github-pat',
          Description: 'Escaped via symlink',
          File: escapeLink,
          StartLine: 1,
          Match: dummySecret
        }
      ],
      ['excluded']
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]!.relativePath).toBe('src/auth.ts');
    expect(findings[0]!.scannerSource).toBe('gitleaks');
    expect(findings[0]!.description).not.toContain(dummySecret);
    expect(findings[0]!.evidence).not.toContain(dummySecret);
    expect(findings[0]!.evidence).toContain('[REDACTED');
  });

  it('normalizes OSV severity scores, labels, exclusions, and outside paths accurately', () => {
    expect(resolveOsvSeverity({ id: 'GHSA-crit' }, [{ ids: ['GHSA-crit'], max_severity: '9.8' }])).toBe('critical');
    expect(resolveOsvSeverity({ id: 'GHSA-high' }, [{ ids: ['GHSA-high'], max_severity: '7.5' }])).toBe('high');
    expect(resolveOsvSeverity({ id: 'GHSA-med' }, [{ ids: ['GHSA-med'], max_severity: '5.3' }])).toBe('medium');
    expect(resolveOsvSeverity({ id: 'GHSA-low' }, [{ ids: ['GHSA-low'], max_severity: '2.5' }])).toBe('low');
    expect(resolveOsvSeverity({ id: 'GHSA-mod', database_specific: { severity: 'MODERATE' } })).toBe('medium');
    expect(resolveOsvSeverity({ id: 'GHSA-fallback' })).toBe('high');

    const parent = makeTempDir('cobalix-m6b-osv-unit-');
    const repo = path.join(parent, 'repo');
    const outside = path.join(parent, 'outside');
    fs.mkdirSync(path.join(repo, 'vendor'), { recursive: true });
    fs.mkdirSync(outside, { recursive: true });

    const out = normalizeOsvOutput(
      repo,
      {
        results: [
          {
            source: { path: path.join(fs.realpathSync(repo), 'package-lock.json') },
            packages: [
              {
                package: { name: 'lodash', version: '4.17.15', ecosystem: 'npm' },
                groups: [{ ids: ['GHSA-29mw-wpgm-hmr9'], max_severity: '5.3' }],
                vulnerabilities: [{ id: 'GHSA-29mw-wpgm-hmr9', summary: 'ReDoS in lodash' }]
              }
            ]
          },
          {
            source: { path: path.join(repo, 'vendor', 'package-lock.json') },
            packages: [
              {
                package: { name: 'ignored', version: '1.0.0', ecosystem: 'npm' },
                vulnerabilities: [{ id: 'GHSA-ignored' }]
              }
            ]
          },
          {
            source: { path: path.join(outside, 'package-lock.json') },
            packages: [
              {
                package: { name: 'escaped', version: '1.0.0', ecosystem: 'npm' },
                vulnerabilities: [{ id: 'GHSA-escaped' }]
              }
            ]
          }
        ]
      },
      ['vendor']
    );

    expect(out).toHaveLength(1);
    expect(out[0]!.relativePath).toBe('package-lock.json');
    expect(out[0]!.severity).toBe('medium');
    expect(out[0]!.scannerSource).toBe('osv-scanner');
    expect(out[0]!.evidence).toBe('npm: lodash@4.17.15 (GHSA-29mw-wpgm-hmr9)');
  });
});

describe('Milestone 006B: Mocked Adapter Tests (Isolated Stubs)', () => {
  it('handles missing executables cleanly without throwing or fabricating findings', async () => {
    const repoDir = makeTempDir('cobalix-m6b-missing-repo-');
    const missingBin = path.join(repoDir, 'does-not-exist');

    const glRes = await runGitleaksScanner(repoDir, [], { binaryPath: missingBin });
    expect(glRes.execution.available).toBe(false);
    expect(glRes.execution.executed).toBe(false);
    expect(glRes.execution.error).toBeNull();
    expect(glRes.findings).toEqual([]);

    const osvRes = await runOsvScanner(repoDir, [], { binaryPath: missingBin });
    expect(osvRes.execution.available).toBe(false);
    expect(osvRes.execution.executed).toBe(false);
    expect(osvRes.execution.error).toBeNull();
    expect(osvRes.findings).toEqual([]);
  });

  it('handles execution timeouts, malformed output, nonzero failure exits, and secret redaction safely', async () => {
    const workDir = makeTempDir('cobalix-m6b-mocks-');
    const repoDir = path.join(workDir, 'repo');
    fs.mkdirSync(repoDir, { recursive: true });
    writeLodashLockfile(path.join(repoDir, 'package-lock.json'), '4.17.15');

    const dummySecret = makeDummyGitHubToken();

    // 1. Timeout stubs
    const hangStub = createNodeStubBinary(workDir, 'hang.js', 'setTimeout(() => {}, 10000);');
    const glTimeout = await runGitleaksScanner(repoDir, [], { binaryPath: hangStub, timeoutMs: 150 });
    expect(glTimeout.execution.available).toBe(true);
    expect(glTimeout.execution.executed).toBe(false);
    expect(glTimeout.execution.error).toContain('timed out');

    const osvTimeout = await runOsvScanner(repoDir, [], { binaryPath: hangStub, timeoutMs: 150 });
    expect(osvTimeout.execution.available).toBe(true);
    expect(osvTimeout.execution.executed).toBe(false);
    expect(osvTimeout.execution.error).toContain('timed out');

    // 2. Malformed JSON stubs
    const badGlStub = createNodeStubBinary(
      workDir,
      'bad-gitleaks.js',
      `
      const fs = require('node:fs');
      const idx = process.argv.indexOf('--report-path');
      if (idx !== -1) fs.writeFileSync(process.argv[idx + 1], '{not-valid-json');
      process.exit(0);
      `
    );
    const glMalformed = await runGitleaksScanner(repoDir, [], { binaryPath: badGlStub });
    expect(glMalformed.execution.available).toBe(true);
    expect(glMalformed.execution.executed).toBe(false);
    expect(glMalformed.execution.error).toContain('Failed to parse gitleaks JSON report');

    const badOsvStub = createNodeStubBinary(
      workDir,
      'bad-osv.js',
      `process.stdout.write('{"unexpected": true}'); process.exit(0);`
    );
    const osvMalformed = await runOsvScanner(repoDir, [], { binaryPath: badOsvStub });
    expect(osvMalformed.execution.available).toBe(true);
    expect(osvMalformed.execution.executed).toBe(false);
    expect(osvMalformed.execution.error).toContain('OSV-Scanner JSON output missing results array');

    // 3. Nonzero exit code with no report & secret redaction in error output
    const leakStderrStub = createNodeStubBinary(
      workDir,
      'err-gitleaks.js',
      `process.stderr.write(${JSON.stringify(`fatal config error near ${dummySecret}`)}); process.exit(1);`
    );
    const glFail = await runGitleaksScanner(repoDir, [], { binaryPath: leakStderrStub });
    expect(glFail.execution.available).toBe(true);
    expect(glFail.execution.executed).toBe(false);
    expect(glFail.execution.error).not.toContain(dummySecret);
    expect(glFail.execution.error).toContain('[REDACTED:GITHUB_TOKEN]');

    const missingReportCode2 = createNodeStubBinary(workDir, 'no-report-2.js', 'process.exit(2);');
    const glMissingRep = await runGitleaksScanner(repoDir, [], { binaryPath: missingReportCode2 });
    expect(glMissingRep.execution.executed).toBe(false);
    expect(glMissingRep.execution.error).toContain('Command failed');

    // 4. OSV exit 127 offline DB error even when stdout has empty JSON
    const osvOfflineStub = createNodeStubBinary(
      workDir,
      'offline-osv.js',
      `
      process.stdout.write('{"results":[]}');
      process.stderr.write('unable to fetch OSV database: offline');
      process.exit(127);
      `
    );
    const osvOffline = await runOsvScanner(repoDir, [], { binaryPath: osvOfflineStub });
    expect(osvOffline.execution.available).toBe(true);
    expect(osvOffline.execution.executed).toBe(false);
    expect(osvOffline.execution.error).toContain('unable to fetch OSV database');

    // 5. OSV exit 128 ("no package sources") is treated cleanly as 0 vulns executed
    const osvNoSourcesStub = createNodeStubBinary(workDir, 'empty-osv.js', 'process.exit(128);');
    const osvNoSources = await runOsvScanner(repoDir, [], { binaryPath: osvNoSourcesStub });
    expect(osvNoSources.execution.available).toBe(true);
    expect(osvNoSources.execution.executed).toBe(true);
    expect(osvNoSources.execution.error).toBeNull();
    expect(osvNoSources.findings).toEqual([]);
  });

  it('isolates scanner failures inside Nightwatch so other scanners still run and findings persist', async () => {
    const dataDir = makeTempDir('cobalix-m6b-iso-data-');
    const repoDir = makeTempDir('cobalix-m6b-iso-repo-');
    fs.writeFileSync(path.join(repoDir, 'tls.ts'), 'export const tls = { rejectUnauthorized: false };\n');

    const dummySecret = makeDummyGitHubToken();
    const service = new LocalProtectionService(dataDir);
    try {
      const asset = service.registerAsset({
        displayName: 'Isolation Test Repo',
        assetType: 'repository',
        path: repoDir,
        scanConfig: {
          enableGitleaks: true,
          enableOsvScanner: true,
          enableNpmAudit: false,
          enableEslint: false
        }
      });

      const isolatedNightwatch = new NightwatchAgent(service.db, service.chronicle, service.fileIntel, {
        gitleaks: async () => {
          throw new Error(`Unexpected gitleaks crash leaking ${dummySecret}`);
        },
        osvScanner: async () => ({
          execution: {
            scanner: 'osv-scanner',
            available: true,
            executed: true,
            durationMs: 5,
            findingCount: 1,
            error: null,
            notes: null
          },
          findings: [
            {
              relativePath: 'tls.ts',
              title: 'OSV-MOCK-1 in mock@1.0.0',
              description: 'Mock isolation finding',
              severity: 'high',
              confidence: 'high',
              category: 'dependency_vulnerability',
              scannerSource: 'osv-scanner',
              evidence: 'npm: mock@1.0.0',
              lineStart: null,
              lineEnd: null,
              recommendedAction: 'Upgrade mock.'
            }
          ]
        })
      });

      const scan = await isolatedNightwatch.runScan(asset, 'manual');
      expect(scan.status).toBe('completed_with_errors');
      expect(scan.errors.join(' ')).not.toContain(dummySecret);
      expect(scan.errors.join(' ')).toContain('[REDACTED:GITHUB_TOKEN]');

      const glExec = scan.scannerResults.find((s) => s.scanner === 'gitleaks');
      const osvExec = scan.scannerResults.find((s) => s.scanner === 'osv-scanner');
      const npmExec = scan.scannerResults.find((s) => s.scanner === 'npm-audit');
      const staticExec = scan.scannerResults.find((s) => s.scanner === 'obsidian-static-inspector');

      expect(glExec?.executed).toBe(false);
      expect(glExec?.error).toContain('[REDACTED:GITHUB_TOKEN]');
      expect(osvExec?.executed).toBe(true);
      expect(osvExec?.findingCount).toBe(1);
      expect(staticExec?.executed).toBe(true);
      expect(npmExec?.executed).toBe(false);
      expect(npmExec?.error).toBeNull();
      expect(npmExec?.notes).toContain('Skipped');

      const findings = isolatedNightwatch.listFindings({ assetId: asset.id });
      expect(findings.some((f) => f.scannerSource === 'obsidian-static-inspector')).toBe(true);
      expect(findings.some((f) => f.scannerSource === 'osv-scanner')).toBe(true);
    } finally {
      service.close();
    }
  });
});

describe('Milestone 006B: Real CLI Integration Tests', () => {
  it.skipIf(!liveGitleaksBin)(
    'executes real Gitleaks CLI, detects synthetic secret pattern, respects exclusions & symlinks, and handles clean repos',
    async () => {
      expect(liveGitleaksBin).toBeTruthy();

      const parent = makeTempDir('cobalix-m6b-live-gl-');
      const repoDir = path.join(parent, 'repo');
      const outsideDir = path.join(parent, 'outside');
      const cleanDir = path.join(parent, 'clean-repo');
      fs.mkdirSync(path.join(repoDir, 'src'), { recursive: true });
      fs.mkdirSync(path.join(repoDir, 'excluded_secrets'), { recursive: true });
      fs.mkdirSync(outsideDir, { recursive: true });
      fs.mkdirSync(path.join(cleanDir, 'src'), { recursive: true });

      const activeDummySecret = makeDummyGitHubToken('9xK2mP7qR4tV8wZ1bN5cF3hJ6kL0nQ8rT2vY');
      const excludedDummySecret = makeDummyGitHubToken('3mN8pQ2wK7xV5bZ9cD4fH6jL1nR0tW8yA5eC');
      const outsideDummySecret = makeDummyGitHubToken('7vB2nM9qW4xZ8cK1fH5jP3rT6yL0dS8aF2gE');

      const targetSecretFile = path.join(repoDir, 'src', 'app-config.ts');
      fs.writeFileSync(targetSecretFile, `export const token = "${activeDummySecret}";\n`);
      fs.writeFileSync(
        path.join(repoDir, 'excluded_secrets', 'ignored.ts'),
        `export const excludedToken = "${excludedDummySecret}";\n`
      );

      const outsideFile = path.join(outsideDir, 'outside-secret.ts');
      fs.writeFileSync(outsideFile, `export const outside = "${outsideDummySecret}";\n`);
      fs.symlinkSync(outsideFile, path.join(repoDir, 'src', 'escape-symlink.ts'));

      const result = await runGitleaksScanner(repoDir, ['excluded_secrets', '.git', 'node_modules']);
      expect(result.execution.available).toBe(true);
      expect(result.execution.executed).toBe(true);
      expect(result.execution.error).toBeNull();
      expect(result.findings).toHaveLength(1);

      const finding = result.findings[0]!;
      expect(finding.scannerSource).toBe('gitleaks');
      expect(finding.relativePath).toBe('src/app-config.ts');
      expect(finding.relativePath).not.toMatch(/^(\.\.|\/)/);
      expect(finding.title).toContain('github-pat');
      expect(finding.evidence).not.toContain(activeDummySecret);
      expect(finding.description).not.toContain(activeDummySecret);

      // Single-file target verification mode (used by SaverAgent)
      const singleFileRes = await runGitleaksScanner(repoDir, [], { targetPath: targetSecretFile });
      expect(singleFileRes.execution.executed).toBe(true);
      expect(singleFileRes.findings).toHaveLength(1);
      expect(singleFileRes.findings[0]!.relativePath).toBe('src/app-config.ts');

      // Clean repository generates zero findings
      fs.writeFileSync(path.join(cleanDir, 'src', 'index.ts'), 'export const hello = "safe";\n');
      const cleanRes = await runGitleaksScanner(cleanDir);
      expect(cleanRes.execution.available).toBe(true);
      expect(cleanRes.execution.executed).toBe(true);
      expect(cleanRes.execution.error).toBeNull();
      expect(cleanRes.findings).toEqual([]);
    }
  );

  it.skipIf(!liveOsvBin)(
    'executes real OSV-Scanner CLI, detects known lodash@4.17.15 vulnerabilities, respects exclusions, and handles clean & lockfile-less repos',
    async () => {
      expect(liveOsvBin).toBeTruthy();

      const parent = makeTempDir('cobalix-m6b-live-osv-');
      const repoDir = path.join(parent, 'repo');
      const cleanDir = path.join(parent, 'clean-repo');
      const emptyDir = path.join(parent, 'empty-repo');
      fs.mkdirSync(path.join(repoDir, 'vendor'), { recursive: true });
      fs.mkdirSync(cleanDir, { recursive: true });
      fs.mkdirSync(emptyDir, { recursive: true });

      const rootLockfile = path.join(repoDir, 'package-lock.json');
      writeLodashLockfile(rootLockfile, '4.17.15');
      writeLodashLockfile(path.join(repoDir, 'vendor', 'package-lock.json'), '4.17.15');

      const result = await runOsvScanner(repoDir, ['vendor', 'node_modules', '.git']);
      expect(result.execution.available).toBe(true);
      expect(result.execution.executed).toBe(true);
      expect(result.execution.error).toBeNull();
      expect(result.findings.length).toBeGreaterThanOrEqual(1);

      for (const f of result.findings) {
        expect(f.scannerSource).toBe('osv-scanner');
        expect(f.relativePath).toBe('package-lock.json');
        expect(f.relativePath).not.toContain('vendor');
        expect(f.evidence).toContain('npm: lodash@4.17.15');
        expect(['critical', 'high', 'medium', 'low']).toContain(f.severity);
      }

      // Single-lockfile verification mode (-L, used by SaverAgent)
      const singleFileRes = await runOsvScanner(repoDir, [], { targetPath: rootLockfile });
      expect(singleFileRes.execution.executed).toBe(true);
      expect(singleFileRes.findings.length).toBeGreaterThanOrEqual(1);
      expect(singleFileRes.findings[0]!.relativePath).toBe('package-lock.json');

      // Clean lockfile fixture generates zero vulnerabilities
      writeCleanMsLockfile(path.join(cleanDir, 'package-lock.json'));
      const cleanRes = await runOsvScanner(cleanDir);
      expect(cleanRes.execution.available).toBe(true);
      expect(cleanRes.execution.executed).toBe(true);
      expect(cleanRes.execution.error).toBeNull();
      expect(cleanRes.findings).toEqual([]);

      // Empty repository (exit 128) completes cleanly without crashing or failing
      fs.writeFileSync(path.join(emptyDir, 'README.md'), '# No lockfiles here\n');
      const emptyRes = await runOsvScanner(emptyDir);
      expect(emptyRes.execution.available).toBe(true);
      expect(emptyRes.execution.executed).toBe(true);
      expect(emptyRes.execution.error).toBeNull();
      expect(emptyRes.findings).toEqual([]);
    }
  );

  it.skipIf(!liveGitleaksBin || !liveOsvBin)(
    'integrates real Gitleaks and OSV-Scanner end-to-end through Nightwatch with deduplication and Chronicle safety',
    async () => {
      const dataDir = makeTempDir('cobalix-m6b-e2e-data-');
      const repoDir = makeTempDir('cobalix-m6b-e2e-repo-');
      fs.mkdirSync(path.join(repoDir, 'src'), { recursive: true });
      fs.mkdirSync(path.join(repoDir, 'excluded'), { recursive: true });

      const dummySecret = makeDummyGitHubToken('9xK2mP7qR4tV8wZ1bN5cF3hJ6kL0nQ8rT2vY');
      const excludedDummy = makeDummyGitHubToken('3mN8pQ2wK7xV5bZ9cD4fH6jL1nR0tW8yA5eC');
      fs.writeFileSync(path.join(repoDir, 'src', 'creds.ts'), `export const api = "${dummySecret}";\n`);
      fs.writeFileSync(path.join(repoDir, 'excluded', 'ignored.ts'), `export const skipped = "${excludedDummy}";\n`);
      writeLodashLockfile(path.join(repoDir, 'package-lock.json'), '4.17.15');
      writeLodashLockfile(path.join(repoDir, 'excluded', 'package-lock.json'), '4.17.15');

      const service = new LocalProtectionService(dataDir);
      try {
        const asset = service.registerAsset({
          displayName: 'Live Scanner E2E Repo',
          assetType: 'repository',
          path: repoDir,
          scanConfig: {
            exclusions: ['excluded', 'node_modules', '.git'],
            enableGitleaks: true,
            enableOsvScanner: true,
            enableNpmAudit: false,
            enableEslint: false
          }
        });

        const scan1 = await service.nightwatch.runScan(asset, 'manual');
        expect(scan1.status).toBe('completed');
        expect(scan1.errors).toEqual([]);
        expect(scan1.findingsCreated).toBeGreaterThanOrEqual(2);

        const gitleaksExec = scan1.scannerResults.find((s) => s.scanner === 'gitleaks');
        const osvExec = scan1.scannerResults.find((s) => s.scanner === 'osv-scanner');
        const npmExec = scan1.scannerResults.find((s) => s.scanner === 'npm-audit');
        const eslintExec = scan1.scannerResults.find((s) => s.scanner === 'eslint');
        expect(gitleaksExec).toMatchObject({ scanner: 'gitleaks', available: true, executed: true, findingCount: 1, error: null });
        expect(osvExec?.available).toBe(true);
        expect(osvExec?.executed).toBe(true);
        expect(osvExec?.findingCount).toBeGreaterThanOrEqual(1);
        expect(npmExec).toMatchObject({ scanner: 'npm-audit', executed: false, error: null });
        expect(eslintExec).toMatchObject({ scanner: 'eslint', executed: false, error: null });

        const persistedFindings = service.nightwatch.listFindings({ assetId: asset.id });
        const glFindings = persistedFindings.filter((f) => f.scannerSource === 'gitleaks');
        const osvFindings = persistedFindings.filter((f) => f.scannerSource === 'osv-scanner');
        expect(glFindings).toHaveLength(1);
        expect(glFindings[0]!.relativePath).toBe('src/creds.ts');
        expect(osvFindings.length).toBeGreaterThanOrEqual(1);
        expect(osvFindings.every((f) => f.relativePath === 'package-lock.json')).toBe(true);
        expect(persistedFindings.some((f) => f.relativePath?.startsWith('excluded/'))).toBe(false);

        // Second scan must deduplicate findings cleanly
        const scan2 = await service.nightwatch.runScan(asset, 'manual');
        expect(scan2.status).toBe('completed');
        expect(scan2.findingsCreated).toBe(0);
        expect(scan2.findingsUpdated).toBe(scan1.findingsCreated);

        const afterSecondScan = service.nightwatch.listFindings({ assetId: asset.id });
        expect(afterSecondScan).toHaveLength(persistedFindings.length);
        expect(afterSecondScan.every((f) => f.occurrenceCount === 2)).toBe(true);

        // Chronicle must remain intact and free of raw secrets
        expect(service.chronicle.verifyIntegrity().valid).toBe(true);
        const serializedChronicle = JSON.stringify(service.chronicle.listEvents({ assetId: asset.id }));
        const serializedFindings = JSON.stringify(afterSecondScan);
        expect(serializedChronicle).not.toContain(dummySecret);
        expect(serializedChronicle).not.toContain(excludedDummy);
        expect(serializedFindings).not.toContain(dummySecret);
      } finally {
        service.close();
      }
    }
  );
});
