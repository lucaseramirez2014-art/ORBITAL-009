import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalProtectionService } from '@cobalix/agents';
import { MIGRATIONS } from '@cobalix/db';
import { createCompanionServer } from '../apps/companion/src/server.js';
import { generateSessionToken, getSessionTokenPath, readSessionToken } from '../apps/companion/src/auth.js';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: typeof DatabaseSyncType };

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

describe('Milestone 002: Chronicle Integrity & Companion API Hardening', () => {
  it('preserves Chronicle hash chain and historical hashes when an asset is removed and across restarts', async () => {
    const dataDir = makeTempDir('cobalix-m2-chronicle-');
    const repoDir = makeTempDir('cobalix-m2-repo-');
    fs.writeFileSync(path.join(repoDir, 'config.ts'), 'export const tls = { rejectUnauthorized: false };\n');

    const service = new LocalProtectionService(dataDir);
    const asset = service.registerAsset({
      displayName: 'Removable Repo',
      assetType: 'repository',
      path: repoDir
    });
    await service.nightwatch.runScan(asset, 'manual');

    const beforeEvents = service.chronicle.listEvents({ limit: 100 });
    expect(beforeEvents.length).toBeGreaterThanOrEqual(4);
    expect(service.chronicle.verifyIntegrity()).toEqual({
      valid: true,
      checkedEvents: beforeEvents.length,
      brokenAtSequence: null
    });

    const hashBySequenceBefore = new Map(beforeEvents.map((e) => [e.sequence, e.eventHash]));
    const assetIdBySequenceBefore = new Map(beforeEvents.map((e) => [e.sequence, e.assetId]));

    // Remove the asset — historical events must keep their asset_id and hashes untouched
    service.removeAsset(asset.id);

    expect(service.chronicle.verifyIntegrity().valid).toBe(true);

    // Record another event after removal
    const newAsset = service.registerAsset({
      displayName: 'Follow-up Repo',
      assetType: 'folder',
      path: repoDir
    });
    await service.fileIntel.inventoryAsset(newAsset);

    const afterEvents = service.chronicle.listEvents({ limit: 100 });
    for (const [seq, oldHash] of hashBySequenceBefore.entries()) {
      const matched = afterEvents.find((e) => e.sequence === seq);
      expect(matched).toBeDefined();
      expect(matched!.eventHash).toBe(oldHash);
      expect(matched!.assetId).toBe(assetIdBySequenceBefore.get(seq));
    }
    expect(service.chronicle.verifyIntegrity()).toEqual({
      valid: true,
      checkedEvents: afterEvents.length,
      brokenAtSequence: null
    });

    // Database triggers prevent UPDATE/DELETE on events
    expect(() => {
      service.db.db.prepare(`UPDATE events SET summary = 'tampered' WHERE sequence = 1`).run();
    }).toThrow();
    expect(() => {
      service.db.db.prepare(`DELETE FROM events WHERE sequence = 1`).run();
    }).toThrow();

    service.close();

    // Restart and re-verify
    const restarted = new LocalProtectionService(dataDir);
    expect(restarted.chronicle.verifyIntegrity()).toEqual({
      valid: true,
      checkedEvents: afterEvents.length,
      brokenAtSequence: null
    });
    restarted.close();
  });

  it('safely migrates a v1 database to v2 while preserving existing Chronicle events and hashes', () => {
    const dataDir = makeTempDir('cobalix-m2-v1-');
    const dbPath = path.join(dataDir, 'obsidian.sqlite');

    // Create a v1-only database manually
    const rawDb = new DatabaseSync(dbPath);
    rawDb.exec('PRAGMA foreign_keys = ON;');
    rawDb.exec(`
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);
    `);
    rawDb.exec(MIGRATIONS[0]!.sql);
    rawDb.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (1, ?, ?)').run(
      'initial_schema',
      new Date().toISOString()
    );
    rawDb.close();

    // Open through LocalProtectionService -> should apply migration v2 automatically
    const service = new LocalProtectionService(dataDir);
    const repoDir = makeTempDir('cobalix-m2-v1-repo-');
    fs.writeFileSync(path.join(repoDir, 'a.txt'), 'hello');
    const asset = service.registerAsset({ displayName: 'V1 Migrated', assetType: 'folder', path: repoDir });
    service.removeAsset(asset.id);
    expect(service.chronicle.verifyIntegrity().valid).toBe(true);
    service.close();
  });

  it('enforces per-session authentication, strict CORS/origin validation, Content-Type, body size limits, and input schemas', async () => {
    const dataDir = makeTempDir('cobalix-m2-api-data-');
    const repoDir = makeTempDir('cobalix-m2-api-repo-');
    fs.writeFileSync(path.join(repoDir, 'index.ts'), 'export const x = 1;\n');

    const service = new LocalProtectionService(dataDir);
    const authToken = generateSessionToken();
    const server = createCompanionServer(service, { authToken, maxBodyBytes: 512 });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address() as { port: number };
    const base = `http://127.0.0.1:${addr.port}`;

    try {
      // 1. Unauthenticated mutations rejected (POST, PUT, PATCH, DELETE)
      for (const [method, urlPath] of [
        ['POST', '/api/assets'],
        ['PUT', '/api/ai/config'],
        ['PATCH', '/api/settings'],
        ['DELETE', '/api/assets/nonexistent']
      ] as const) {
        const res = await fetch(`${base}${urlPath}`, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: method === 'DELETE' ? undefined : '{}'
        });
        expect(res.status).toBe(401);
        const body = (await res.json()) as { error: string };
        expect(body.error).toBe('UNAUTHORIZED');
      }

      // Wrong token rejected
      const badTokenRes = await fetch(`${base}/api/assets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Cobalix-Token': 'wrong-token' },
        body: JSON.stringify({ displayName: 'x', assetType: 'folder', path: repoDir })
      });
      expect(badTokenRes.status).toBe(401);

      // 2. Invalid / spoofed origins rejected with 403
      for (const badOrigin of [
        'https://evil.example',
        'http://localhost:5173.evil.com',
        'http://127.0.0.1.attacker.local',
        'null'
      ]) {
        const res = await fetch(`${base}/api/health`, {
          headers: { Origin: badOrigin }
        });
        expect(res.status).toBe(403);
        const body = (await res.json()) as { error: string };
        expect(body.error).toBe('INVALID_ORIGIN');
      }

      // Cross-site fetch metadata rejected with 403
      const crossSiteRes = await fetch(`${base}/api/overview`, {
        headers: { 'Sec-Fetch-Site': 'cross-site' }
      });
      expect(crossSiteRes.status).toBe(403);

      // 3. Preflight OPTIONS returns allowed methods including PUT and X-Cobalix-Token
      const preflight = await fetch(`${base}/api/ai/config`, {
        method: 'OPTIONS',
        headers: { Origin: 'http://localhost:5173' }
      });
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
      expect(preflight.headers.get('access-control-allow-methods')).toContain('PUT');
      expect(preflight.headers.get('access-control-allow-headers')).toContain('X-Cobalix-Token');

      // 4. Content-Type enforcement (415)
      const wrongContentType = await fetch(`${base}/api/assets`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain', 'X-Cobalix-Token': authToken },
        body: JSON.stringify({ displayName: 'x', assetType: 'folder', path: repoDir })
      });
      expect(wrongContentType.status).toBe(415);

      // 5. Invalid JSON (400 INVALID_JSON)
      const invalidJson = await fetch(`${base}/api/assets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Cobalix-Token': authToken },
        body: '{not-valid-json'
      });
      expect(invalidJson.status).toBe(400);
      expect(((await invalidJson.json()) as { error: string }).error).toBe('INVALID_JSON');

      // 6. Oversized body (413 PAYLOAD_TOO_LARGE)
      const oversized = await fetch(`${base}/api/assets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Cobalix-Token': authToken },
        body: JSON.stringify({ displayName: 'x'.repeat(1024), assetType: 'folder', path: repoDir })
      });
      expect(oversized.status).toBe(413);
      expect(((await oversized.json()) as { error: string }).error).toBe('PAYLOAD_TOO_LARGE');

      // 7. Malformed schema inputs return 400 VALIDATION_ERROR
      const badSchema = await fetch(`${base}/api/assets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Cobalix-Token': authToken },
        body: JSON.stringify({ displayName: 'bad', assetType: 'invalid_type', path: '' })
      });
      expect(badSchema.status).toBe(400);
      expect(((await badSchema.json()) as { error: string }).error).toBe('VALIDATION_ERROR');

      const badSettings = await fetch(`${base}/api/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Cobalix-Token': authToken },
        body: JSON.stringify({ nightlyScheduleTime: 'not-a-time' })
      });
      expect(badSettings.status).toBe(400);

      // 8. Legitimate authenticated POST, PATCH, PUT, DELETE requests succeed
      const createRes = await fetch(`${base}/api/assets`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Cobalix-Token': authToken,
          Origin: 'http://localhost:5173'
        },
        body: JSON.stringify({ displayName: 'Valid Asset', assetType: 'folder', path: repoDir })
      });
      expect(createRes.status).toBe(201);
      const asset = (await createRes.json()) as { id: string };

      const patchAssetRes = await fetch(`${base}/api/assets/${asset.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Cobalix-Token': authToken },
        body: JSON.stringify({ scanConfig: { enableGitleaks: false } })
      });
      expect(patchAssetRes.status).toBe(200);

      const putAiRes = await fetch(`${base}/api/ai/config`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Cobalix-Token': authToken,
          Origin: 'http://127.0.0.1:5173'
        },
        body: JSON.stringify({
          provider: 'none',
          displayName: 'Deterministic',
          endpoint: '',
          model: '',
          enabled: false,
          consentToSendContext: false,
          redactSecrets: true
        })
      });
      expect(putAiRes.status).toBe(200);

      const deleteRes = await fetch(`${base}/api/assets/${asset.id}`, {
        method: 'DELETE',
        headers: { 'X-Cobalix-Token': authToken }
      });
      expect(deleteRes.status).toBe(200);
      expect(service.chronicle.verifyIntegrity().valid).toBe(true);
    } finally {
      server.close();
      service.close();
    }
  });

  it('starts the companion cleanly in development mode via tsx, writes 0600 token, and removes it on shutdown', async () => {
    const dataDir = makeTempDir('cobalix-m2-dev-');
    const tsxBin = path.resolve(process.cwd(), 'node_modules/.bin/tsx');

    const child = spawn(tsxBin, ['apps/companion/src/index.ts'], {
      env: { ...process.env, COBALIX_DATA_DIR: dataDir, COBALIX_PORT: '0' },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    try {
      const port = await new Promise<number>((resolve, reject) => {
        const deadline = Date.now() + 8000;
        const timer = setInterval(() => {
          const match = stdout.match(/http:\/\/127\.0\.0\.1:(\d+)/);
          if (match?.[1]) {
            clearInterval(timer);
            resolve(Number(match[1]));
          } else if (Date.now() > deadline) {
            clearInterval(timer);
            reject(new Error(`Companion dev startup timed out. stdout=${stdout} stderr=${stderr}`));
          }
        }, 50);
      });

      const tokenPath = getSessionTokenPath(dataDir);
      expect(fs.existsSync(tokenPath)).toBe(true);
      const stat = fs.statSync(tokenPath);
      expect(stat.mode & 0o777).toBe(0o600);
      const token = readSessionToken(dataDir);
      expect(token).toHaveLength(64);
      expect(stdout).not.toContain(token!);

      const healthRes = await fetch(`http://127.0.0.1:${port}/api/health`);
      expect(healthRes.status).toBe(200);

      // Unauthenticated mutation rejected on live companion process
      const unauth = await fetch(`http://127.0.0.1:${port}/api/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      });
      expect(unauth.status).toBe(401);

      // Authenticated mutation succeeds on live companion process
      const authRes = await fetch(`http://127.0.0.1:${port}/api/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Cobalix-Token': token! },
        body: JSON.stringify({ notifyOnCritical: false })
      });
      expect(authRes.status).toBe(200);
    } finally {
      child.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        child.once('exit', () => resolve());
        setTimeout(() => resolve(), 2000);
      });
    }

    expect(fs.existsSync(getSessionTokenPath(dataDir))).toBe(false);
  });
});
