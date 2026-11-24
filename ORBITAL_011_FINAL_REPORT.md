# Cobalix Orbital `v0.1.0` — ORBITAL 011 Final Distribution Report

**Mission ID:** `CBX-ORB-011` — Distribution Engineering & Native macOS Qualification  
**Product:** Cobalix Orbital (`v0.1.0`, proprietary)  
**Assessment Date:** 2026-11-23  
**Final Release Assessment:** **`READY FOR DISTRIBUTION PREPARATION`**

---

## 1. Executive Summary

ORBITAL 011 hardened **Cobalix Orbital `v0.1.0`** for cross-architecture macOS packaging, verified Node.js runtime staging, Apple Developer ID signing/notarization preparation, upgrade-safe SQLite migrations, and honest native macOS qualification.

All local engineering preparation and automated validation succeeded cleanly (`14` Vitest files / `73/73` passed, `10/10` Rust Cargo tests passed, `0` npm vulnerabilities, `x86_64` `.app` rebuilt at `10.99 MiB` and smoke-tested live). Remaining steps require external Apple Developer credentials/hardware/human sign-off that cannot be simulated in software, so the exact release readiness determination is **`READY FOR DISTRIBUTION PREPARATION`**.

---

## 2. Implemented Engineering Changes

1. **Bundled Node.js Runtime Selection & Hardened Fallback ([companion.rs](file:///Users/lucasramirez/Desktop/Cobalix/apps/desktop/src-tauri/src/companion.rs))**:
   - Extracted deterministic `select_node_runtime` / `select_node_runtime_with`, added `allow_host_node_fallback` (`true` by default on desktop), and added `CompanionStatusPayload.runtime_source` (`"bundled"` or `"host"`).
   - Enforces `node_supports_sqlite()` on both bundled sidecars and host candidates, never falling back silently to an incompatible runtime, and emits combined actionable guidance if neither works.
   - Added 2 Cargo unit/integration tests verifying compatible bundled fixture execution (`runtime_source: "bundled"`) and incompatible-bundled -> compatible-host fallback + strict failure cases (`10/10` Cargo tests passing).
2. **Verified Runtime Staging & Bundled Overlay ([stage-node-runtime.mjs](file:///Users/lucasramirez/Desktop/Cobalix/scripts/stage-node-runtime.mjs), [tauri.bundled-runtime.conf.json](file:///Users/lucasramirez/Desktop/Cobalix/apps/desktop/src-tauri/tauri.bundled-runtime.conf.json))**:
   - Enforces exact `--sha256` tarball verification before extracting `bin/node` and `LICENSE`, validates Mach-O target architecture and `node:sqlite`, writes executable `node` (`0755`), `THIRD_PARTY_NOTICES.txt`, and `runtime-manifest.json`, and cleans temp dirs in `finally`.
3. **Architecture Matrix, Entitlements & CI Template ([tauri.conf.json](file:///Users/lucasramirez/Desktop/Cobalix/apps/desktop/src-tauri/tauri.conf.json), [package.json](file:///Users/lucasramirez/Desktop/Cobalix/package.json), [macos-distribution.yml](file:///Users/lucasramirez/Desktop/Cobalix/.github/workflows/macos-distribution.yml))**:
   - Added `bundle.macOS` (`minimumSystemVersion: "12.0"`, `hardenedRuntime: true`, `entitlements: "entitlements.plist"`, `signingIdentity: null`).
   - Created minimal shell [entitlements.plist](file:///Users/lucasramirez/Desktop/Cobalix/apps/desktop/src-tauri/entitlements.plist) and sidecar-scoped [entitlements.node-runtime.plist](file:///Users/lucasramirez/Desktop/Cobalix/apps/desktop/src-tauri/entitlements.node-runtime.plist).
   - Added reproducible architecture build scripts (`build:desktop:x64`, `build:desktop:arm64`, `build:desktop:x64:bundled`, `build:desktop:arm64:bundled`, `stage:node-runtime`) and manual `workflow_dispatch` CI workflow for dual `x86_64-apple-darwin` / `aarch64-apple-darwin` macOS builds.
4. **Pre-Migration SQLite Backup & Upgrade Safety ([database.ts](file:///Users/lucasramirez/Desktop/Cobalix/packages/db/src/database.ts), [migrations.ts](file:///Users/lucasramirez/Desktop/Cobalix/packages/db/src/migrations.ts))**:
   - Added `getSchemaMigrationsState` / `getPendingMigrations`; before upgrading an existing schema database with pending migrations, `openDatabase()` executes `PRAGMA wal_checkpoint(TRUNCATE)` and writes a `0600` `obsidian.sqlite.pre-migration-v<ver>-<timestamp>.bak` snapshot without touching user files, credentials, or prior backups.
   - Added 5 lifecycle/upgrade/staging tests in [orbital011.test.ts](file:///Users/lucasramirez/Desktop/Cobalix/tests/orbital011.test.ts).

---

## 3. Verification Evidence & Artifact Matrix

### Automated Pipeline Results (Post-Final Code Edit)
- **`npm run build` & `npm run build:companion:bundle`**: Exited `0`; Vite built `1598` modules; `companion.mjs` = `209.3kb`.
- **`npm run typecheck` & `npm run lint`**: `0` TypeScript errors, `0` ESLint errors.
- **`npm test` (`vitest run`)**: **`14` test files / `73 / 73` passed** (including all `5` new tests in [orbital011.test.ts](file:///Users/lucasramirez/Desktop/Cobalix/tests/orbital011.test.ts)).
- **`cargo test` (`apps/desktop/src-tauri`)**: **`10 / 10` passed** (`0` failed, `0` ignored).
- **`npm audit` & `npm audit --omit=dev`**: **`0` vulnerabilities** in both production and development dependencies.
- **Built Desktop Bundle (`npm run build:desktop:x64`)**: [Cobalix Orbital.app](file:///Users/lucasramirez/Desktop/Cobalix/apps/desktop/src-tauri/target/x86_64-apple-darwin/release/bundle/macos/Cobalix%20Orbital.app) (`10.99 MiB`, `lipo -archs`: `x86_64`, unsigned: `code object is not signed at all`).
- **Live Packaged `x86_64` `.app` Smoke Test**:
  - First launch (`PATH=/usr/bin:/bin:/usr/sbin:/sbin`, isolated `COBALIX_DATA_DIR`, preserving host PID `41326`/`41330` on `47890`): `appPid 62223` spawned `companionPid 62258` on port `54931`, `session-token` `0600`, `obsidian.sqlite` created, unauth `401`, scan `completed` (`1` finding).
  - Clean `SIGTERM` restart on port `54939`: `child1GoneOnSigterm: true`, SQLite persisted (`1` asset, `1` finding).
  - Live `SIGKILL` crash recovery (`killed 62304` -> `respawned 62336` on port `54945`): `tokenRotated: true`, old token rejected (`401`), new token accepted (`200`).
  - Final `SIGTERM` exit: `survivingChildren: 0`, `test_tmp_leftovers: []`.

### Coverage Classification (Implemented vs. Tested vs. Blocked)
| Scope Area | Status | Notes |
| --- | --- | --- |
| Core, Scanners, Saver, Chronicle, Upgrade Backup, Staging Script, `x86_64` Desktop Binary & Companion Supervision | **IMPLEMENTED & TESTED** | Verified via `14` Vitest files (`73/73`), `10/10` Cargo tests, and live `x86_64` `.app` smoke run |
| Interactive Desktop UI Rendering & Flows | **PARTIALLY TESTED** | Verified in real Chromium & JSDOM (`15/15`), while live human Cocoa/WKWebView pointer walkthrough & `Cmd+Q` remains **`MANUAL_PENDING`** (`NATIVE_MACOS_QA.md`) |
| Bundled Node 24 LTS Binary Inside Distributable | **PARTIALLY TESTED / INFRA READY** | Tested end-to-end with verified SHA-256 fixtures & `runtime_source: "bundled"`; real official Node tarball intentionally not bundled before signed CI pipeline |
| Native Apple Silicon (`aarch64-apple-darwin`) Build & Runtime | **BLOCKED (INFRA READY)** | `aarch64-apple-darwin` Rust target & Apple Silicon hardware absent on this Intel host; CI template configured for `macos-15` runner |
| Apple Developer ID Signing, Notarization & `.dmg` Gatekeeper Trust | **BLOCKED (RUNBOOK READY)** | `0 valid identities found`; requires Apple Developer Program account/credentials outside repo (`SIGNING_AND_NOTARIZATION.md`) |

---

## 4. Remaining Distribution Blockers

1. **Apple Developer ID Certificate & Notarization Credentials**: Provision Developer ID Application cert and `notarytool` API key credentials in release CI to sign (`entitlements.plist` + `entitlements.node-runtime.plist`), notarize, and staple `.app` and `.dmg`.
2. **Native Apple Silicon CI Build (`aarch64-apple-darwin`)**: Run [.github/workflows/macos-distribution.yml](./.github/workflows/macos-distribution.yml) on a macOS arm64 runner and smoke-test the resulting `.app` on native Apple Silicon hardware.
3. **Human Native macOS Cocoa / WKWebView Sign-Off**: Execute the 5-step Finder -> Right-Click -> Open -> 10-view pointer walkthrough -> `Cmd+Q` manual checklist in [NATIVE_MACOS_QA.md](./NATIVE_MACOS_QA.md).
4. **Release Decision on Bundled Node 24 LTS Sidecar**: Pass official verified Node `v24 LTS` tarball SHA-256 via `bundle_node_runtime: true` in signed release CI for zero-prerequisite DMG installation.

---

## 5. Required Deliverables Completed

- [NATIVE_MACOS_QA.md](./NATIVE_MACOS_QA.md)
- [DISTRIBUTION_ARCHITECTURE.md](./DISTRIBUTION_ARCHITECTURE.md)
- [SIGNING_AND_NOTARIZATION.md](./SIGNING_AND_NOTARIZATION.md)
- [INSTALLATION_GUIDE.md](./INSTALLATION_GUIDE.md)
- [ORBITAL_011_FINAL_REPORT.md](./ORBITAL_011_FINAL_REPORT.md)
