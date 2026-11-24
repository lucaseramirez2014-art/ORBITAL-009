import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalProtectionService } from '@cobalix/agents';
import { getScannerDiagnostics, resolveScannerBinaryWithSource } from '@cobalix/scanners';
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

describe('Milestone 006C: Desktop Integration & Production Companion Runtime', () => {
  it('discovers scanner binaries with source metadata and safely reports configured overrides & missing paths', async () => {
    const workDir = makeTempDir('cobalix-m6c-diag-');
    const customGitleaks = path.join(workDir, 'custom-gitleaks');
    fs.writeFileSync(customGitleaks, '#!/usr/bin/env node\nconsole.log("9.9.9-test");\n', { mode: 0o755 });
    fs.chmodSync(customGitleaks, 0o755);

    const configuredRes = await resolveScannerBinaryWithSource('gitleaks', customGitleaks);
    expect(configuredRes).toEqual({ resolvedPath: customGitleaks, source: 'configured' });

    const missingPath = path.join(workDir, 'missing-scanner');
    const missingRes = await resolveScannerBinaryWithSource('osv-scanner', missingPath);
    expect(missingRes).toEqual({ resolvedPath: null, source: 'missing' });

    const diagnostics = await getScannerDiagnostics({
      gitleaks: customGitleaks,
      osvScanner: missingPath
    });
    const glDiag = diagnostics.find((d) => d.scanner === 'gitleaks');
    const osvDiag = diagnostics.find((d) => d.scanner === 'osv-scanner');
    const npmDiag = diagnostics.find((d) => d.scanner === 'npm-audit');

    expect(glDiag).toMatchObject({
      scanner: 'gitleaks',
      available: true,
      resolvedPath: customGitleaks,
      source: 'configured',
      version: '9.9.9-test',
      error: null
    });
    expect(osvDiag).toMatchObject({
      scanner: 'osv-scanner',
      available: false,
      resolvedPath: null,
      source: 'missing'
    });
    expect(osvDiag?.error).toContain('missing or not executable');
    expect(npmDiag?.scanner).toBe('npm-audit');
  });

  it('exposes authenticated GET /api/scanners/status, validates scannerPaths, and persists across restarts', async () => {
    const dataDir = makeTempDir('cobalix-m6c-api-data-');
    const binDir = makeTempDir('cobalix-m6c-api-bins-');
    const customGl = path.join(binDir, 'gitleaks');
    fs.writeFileSync(customGl, '#!/usr/bin/env node\nconsole.log("8.30.1-stub");\n', { mode: 0o755 });
    fs.chmodSync(customGl, 0o755);

    const service1 = new LocalProtectionService(dataDir);
    const authToken = generateSessionToken();
    const server = createCompanionServer(service1, { authToken });
    const port = await listenServer(server);
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      const unauthStatus = await fetch(`${baseUrl}/api/scanners/status`);
      expect(unauthStatus.status).toBe(401);

      const badPatch = await fetch(`${baseUrl}/api/settings`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Cobalix-Token': authToken
        },
        body: JSON.stringify({ scannerPaths: { gitleaks: '/bad\0path' } })
      });
      expect(badPatch.status).toBe(400);

      const patchRes = await fetch(`${baseUrl}/api/settings`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Cobalix-Token': authToken
        },
        body: JSON.stringify({ scannerPaths: { gitleaks: customGl } })
      });
      expect(patchRes.status).toBe(200);

      const diagRes = await fetch(`${baseUrl}/api/scanners/status`, {
        headers: { 'X-Cobalix-Token': authToken }
      });
      expect(diagRes.status).toBe(200);
      const diagList = (await diagRes.json()) as Array<{ scanner: string; resolvedPath: string | null; source: string; version: string | null }>;
      const gl = diagList.find((d) => d.scanner === 'gitleaks');
      expect(gl).toMatchObject({
        scanner: 'gitleaks',
        resolvedPath: customGl,
        source: 'configured',
        version: '8.30.1-stub'
      });
    } finally {
      await closeServer(server);
      service1.close();
    }

    // Reload LocalProtectionService on same SQLite DB and verify persistence
    const service2 = new LocalProtectionService(dataDir);
    expect(service2.getSettings().scannerPaths?.gitleaks).toBe(customGl);
    service2.close();
  });

  it('runs bundled production companion.mjs with 0600 session-token auth, full CRUD, SQLite persistence, and parent-stdin EOF shutdown', async () => {
    const bundlePath = path.resolve('apps/desktop/src-tauri/resources/companion/companion.mjs');
    expect(fs.existsSync(bundlePath)).toBe(true);

    const dataDir = makeTempDir('cobalix-m6c-bundle-data-');
    const repoDir = makeTempDir('cobalix-m6c-bundle-repo-');
    fs.mkdirSync(path.join(repoDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(repoDir, 'src', 'index.ts'), 'export const safe = true;\n');

    async function launchBundledCompanion(): Promise<{
      child: ReturnType<typeof spawn>;
      baseUrl: string;
      token: string;
      getLogs: () => string;
    }> {
      const child = spawn(process.execPath, [bundlePath], {
        env: {
          ...process.env,
          COBALIX_DATA_DIR: dataDir,
          COBALIX_PORT: '0',
          COBALIX_WATCH_PARENT_STDIN: '1'
        },
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let logs = '';
      const baseUrl = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Bundled companion startup timeout. logs=${logs}`)), 10000);
        child.stdout?.on('data', (chunk) => {
          const text = chunk.toString();
          logs += text;
          const m = logs.match(/listening on (http:\/\/127\.0\.0\.1:\d+)/);
          if (m) {
            clearTimeout(timer);
            resolve(m[1]!);
          }
        });
        child.stderr?.on('data', (chunk) => {
          logs += chunk.toString();
        });
        child.once('exit', (code) => {
          clearTimeout(timer);
          reject(new Error(`Bundled companion exited early (${code}). logs=${logs}`));
        });
      });

      const tokenPath = path.join(dataDir, 'session-token');
      expect(fs.existsSync(tokenPath)).toBe(true);
      const mode = fs.statSync(tokenPath).mode & 0o777;
      expect(mode).toBe(0o600);
      const token = fs.readFileSync(tokenPath, 'utf8').trim();
      expect(token.length).toBeGreaterThanOrEqual(32);

      return { child, baseUrl, token, getLogs: () => logs };
    }

    // First bundled session
    const run1 = await launchBundledCompanion();
    let assetId = '';
    try {
      const health = await fetch(`${run1.baseUrl}/api/health`);
      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({
        ok: true,
        service: 'cobalix-obsidian-companion',
        version: '0.1.0'
      });

      // Unauthenticated GET blocked
      const unauthGet = await fetch(`${run1.baseUrl}/api/overview`);
      expect(unauthGet.status).toBe(401);

      // Authenticated POST, GET, PATCH, PUT, DELETE
      const createRes = await fetch(`${run1.baseUrl}/api/assets`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Cobalix-Token': run1.token
        },
        body: JSON.stringify({
          displayName: 'Bundled Sidecar Repo',
          assetType: 'repository',
          path: repoDir
        })
      });
      expect(createRes.status).toBe(201);
      assetId = ((await createRes.json()) as { id: string }).id;

      const patchRes = await fetch(`${run1.baseUrl}/api/assets/${encodeURIComponent(assetId)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Cobalix-Token': run1.token
        },
        body: JSON.stringify({ scanConfig: { enableEslint: false } })
      });
      expect(patchRes.status).toBe(200);

      const putAiRes = await fetch(`${run1.baseUrl}/api/ai/config`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Cobalix-Token': run1.token
        },
        body: JSON.stringify({
          provider: 'none',
          displayName: 'Local',
          endpoint: '',
          model: '',
          enabled: false,
          consentToSendContext: false,
          redactSecrets: true
        })
      });
      expect(putAiRes.status).toBe(200);

      const scannerStatusRes = await fetch(`${run1.baseUrl}/api/scanners/status`, {
        headers: { 'X-Cobalix-Token': run1.token }
      });
      expect(scannerStatusRes.status).toBe(200);

      // Verify token never leaks in stdout/stderr logs
      expect(run1.getLogs()).not.toContain(run1.token);

      // Trigger parent-stdin EOF shutdown (anti-orphan mechanism used by Tauri sidecar)
      const exitPromise = new Promise<number | null>((resolve) => {
        run1.child.once('exit', (code) => resolve(code));
      });
      run1.child.stdin?.end();
      const exitCode = await exitPromise;
      expect(exitCode).toBe(0);
      expect(fs.existsSync(path.join(dataDir, 'session-token'))).toBe(false);
    } finally {
      if (run1.child.exitCode === null) {
        run1.child.kill('SIGTERM');
      }
    }

    // Second bundled launch on same dataDir verifies SQLite persistence + rotated token + DELETE
    const run2 = await launchBundledCompanion();
    try {
      expect(run2.token).not.toBe(run1.token);
      const assetsRes = await fetch(`${run2.baseUrl}/api/assets`, {
        headers: { 'X-Cobalix-Token': run2.token }
      });
      expect(assetsRes.status).toBe(200);
      const assets = (await assetsRes.json()) as Array<{ id: string; displayName: string }>;
      expect(assets.some((a) => a.id === assetId && a.displayName === 'Bundled Sidecar Repo')).toBe(true);

      const delRes = await fetch(`${run2.baseUrl}/api/assets/${encodeURIComponent(assetId)}`, {
        method: 'DELETE',
        headers: { 'X-Cobalix-Token': run2.token }
      });
      expect(delRes.status).toBe(200);
    } finally {
      const exitPromise = new Promise<number | null>((resolve) => {
        run2.child.once('exit', (code) => resolve(code));
      });
      run2.child.kill('SIGTERM');
      await exitPromise;
      expect(fs.existsSync(path.join(dataDir, 'session-token'))).toBe(false);
    }
  });
});
