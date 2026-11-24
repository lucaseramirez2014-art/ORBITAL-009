# ORBITAL 007 — Core Integrity System Audit

**Product:** Cobalix Orbital (`v0.1.0`, mission `CBX-ORB-007`)  
**Audit Date:** 2026-11-23  
**Audit Method:** Direct source inspection across `packages/*`, `apps/*`, `tests/*`, live dependency audit, and runtime verification baseline from Milestone 006C / ORBITAL 001.

---

## Executive Summary

Cobalix Orbital's foundational architecture — loopback Companion API authentication (`X-Cobalix-Token`), Rust IPC session-token bridge (`companion_request`), canonical `realpath` boundary checks, SHA-256 Chronicle hash chaining, Saver approval-hash locking, and live Gitleaks/OSV-Scanner execution — was audited across all 15 subsystems under mission `CBX-ORB-007`. All confirmed High, Medium, and Low reliability/security/UI-feedback defects discovered in the pre-fix audit were remediated in Phases 2–3 and verified in Phase 4 (`56/56` Vitest tests across `10` files, `5/5` Rust Cargo tests, clean JS/TS build/typecheck/lint, Tauri `.app` release build, and live `Cobalix Orbital.app` runtime smoke test). Remaining non-blocking items (`devDependencies` advisories on `vitest@2`, unsigned local macOS `.app`, host Node `v24+` dependency, non-JS/TS AST graph edge scope) remain explicitly documented as known limitations.

---

## Subsystem Inventory (15 Systems)

### 1. Nightwatch (`packages/agents/src/nightwatch.ts`)
- **Works**: Orchestrates deterministic `obsidian-static-inspector` alongside external scanners (`gitleaks`, `osv-scanner`, `npm-audit`, `eslint`); isolates per-scanner errors via `runIsolatedScanner`; deduplicates findings via deterministic SHA-256 fingerprints; persists `scans`, `findings`, `agent_runs`, and Chronicle `scan_started`/`scan_completed`/`scan_failed` events.
- **Hardened in ORBITAL 007**:
  - Added per-asset concurrency lock (`activeAssetScans`) throwing `CobalixError('SCAN_IN_PROGRESS', ..., 409)` on overlapping scans for the same asset and always releasing in `finally`.
  - Promoted `inventory.inaccessibleDirectories` (`chmod 000` / unreadable folders) into `errors` so incomplete scans conclude with `status = 'completed_with_errors'` instead of `'completed'`, and redacted unexpected scan error strings with `redactSecrets()`.
- **Dependencies**: `FileIntelligenceService`, `@cobalix/scanners`, `ChronicleService`, `ObsidianDatabase`.
- **Verification**: `tests/obsidian.test.ts` (4), `tests/milestone006b.test.ts` (9), `tests/orbital007.test.ts` (concurrency lock + unreadable directory scan tests).

### 2. Saver (`packages/agents/src/saver.ts`)
- **Works**: Deterministic & gated-AI remediation explanations; hash-bound patch approvals (`approvals.patch_hash`); disk SHA-256 revalidation before approval and before application (`invalidatePatch()` on drift); originating-scanner verification (`verifyWithOriginatingScanner`); File Intelligence synchronization; backup restoration (`revertPatch()`).
- **Hardened in ORBITAL 007**:
  - Added per-patch concurrency lock (`activePatches`) across `applyApprovedPatch()` and `revertPatch()` (`409` `PATCH_IN_PROGRESS`).
  - Locked `backups/` directory (`0700`) and `.bak` backup files (`0600`), switched atomic temp files to random hex suffixes (`crypto.randomBytes(6)`), and preserved original file mode on rename.
  - Wrapped `this.verifier()` in `try/catch` with `redactSecrets()` so unexpected verifier throws transition cleanly to `verificationStatus = 'failed'` and `patch_verification_failed` Chronicle events rather than leaving dirty DB state.
  - Enforced `patch.status === 'applied'` and verified `sha256Hex(backupBuffer) === patch.targetFileSha256Before` inside `revertPatch()` before touching disk files.
- **Dependencies**: `FileIntelligenceService`, `ChronicleService`, `AIService`, `@cobalix/scanners`, `ObsidianDatabase`.
- **Verification**: `tests/milestone003.test.ts` (6), `tests/orbital007.test.ts` (verifier exception redaction, backup permissions, `revertPatch` state & integrity checks).

### 3. Chronicle (`packages/agents/src/chronicle.ts`)
- **Works**: Monotonic `sequence` allocation; SHA-256 linking `previous_event_hash -> event_hash`; decoupling FK migration v2 preserving events after asset deletion; append-only SQLite `UPDATE`/`DELETE` `RAISE(ABORT)` triggers; `verifyIntegrity()` chain validation.
- **Hardened in ORBITAL 007**:
  - Applied `redactSecrets()` to `input.summary` and recursively across all strings inside `input.details` (`redactEventValue`) prior to hashing and DB insertion.
  - Added contiguous sequence validation (`r.sequence !== expectedSequence`) in `verifyIntegrity()` so sequence gaps fail integrity checks even when hash pointers align.
- **Known Limitation**: SQLite triggers block `UPDATE`/`DELETE` statements inside SQLite connections but cannot prevent out-of-band binary modification of `obsidian.sqlite` on disk while idle (detected post-hoc via `verifyIntegrity()`).
- **Verification**: `tests/obsidian.test.ts`, `tests/milestone006b.test.ts`, `tests/orbital007.test.ts` (recursive redaction & sequence gap detection).

### 4. File Intelligence (`packages/agents/src/fileIntelligence.ts`)
- **Works**: Canonical root walk, symlink escape rejection (`isPathInside`), SHA-256 rename correlation (distinct 1-to-1 vs ambiguous duplicates), unreadable-directory protection (`!isUnderInaccessibleDir()` prevents marking inaccessible files removed), line diffs, import/dependency relationship extraction, bulk/single baseline acceptance.
- **Hardened in ORBITAL 007**:
  - Added canonical `visitedDirs` set inside `walk()` to break internal symlink directory cycles safely without stack overflow and record loops in `skippedLocations`.
  - Replaced unbounded `fs.readFileSync()` in `inventoryAsset()` with `readFileHashAndSample()`, streaming `64 KiB` chunks for SHA-256 hashing while keeping at most `8 KiB` for binary detection and `<= 512 KiB` (`MAX_SNAPSHOT_BYTES`) for text snapshots.
- **Known Limitation**: Non-JS/TS languages report `language_support: 'unsupported'` for AST dependency graph edges (documented limitation).
- **Verification**: `tests/milestone002.test.ts` (4), `tests/milestone004a.test.ts` (5), `tests/milestone004b.test.ts` (2), `tests/orbital007.test.ts` (symlink cycle, >512 KiB streaming hash, `chmod 000` directory coverage).

### 5. Asset Explorer (`apps/web/src/views/AssetExplorerView.tsx`)
- **Works**: Register asset with type (`repository` / `folder`), display error/status feedback, manual scan & inventory buttons, scan config editing with high-impact confirmation modal, disabled `Planned — Not Active` labels for `scanOnFileChange` & `scheduleCron`, asset removal.
- **Status**: Verified in `tests/frontend.test.tsx`.

### 6. Threat Center (`apps/web/src/views/ThreatCenterView.tsx`)
- **Works**: Filter findings by severity/status/search, change finding status, trigger `Ask Saver`, display `occurrenceCount`, `scannerSource`, and redacted evidence.
- **Hardened in ORBITAL 007**: Added `loading` indicator, `error` banner with `try/catch` around `load()`, `handleRemediate()`, and `handleStatusChange()`, and an explicit `Search` button.
- **Verification**: `tests/frontend.test.tsx`.

### 7. Remediation Workspace (`apps/web/src/views/RemediationView.tsx`)
- **Works**: Displays proposed/approved/applied/rejected/invalidated/reverted patches with `DiffViewer` (Unified & Side-by-Side + large-diff guard), approval/reject/apply/revert buttons, verification notes.
- **Hardened in ORBITAL 007**: Added `loading` state and error banner on failed fetches/reverts, and color-coded `verificationStatus` and `verificationNotes` (`passed` green, `failed` red, `not_run`/`pending` amber).
- **Verification**: `tests/frontend.test.tsx`.

### 8. Security Graph (`apps/web/src/views/SecurityGraphView.tsx` & `packages/agents/src/graph.ts`)
- **Works**: Lazy-loaded Cytoscape graph wrapped in `ErrorBoundary`, builds bounded graph (`20–500` nodes) across assets, files, dependencies, findings, and patches, node search & inspector navigation.
- **Hardened in ORBITAL 007**: Added `loading` state, error banner, and `Refresh` disabled/spinner state in `loadGraph()`.
- **Known Limitation**: `GraphNode` type includes `folder`/`agent`/`event`, while `buildGraph()` populates `asset`, `file`, `dependency`, `finding`, and `patch` nodes cleanly.

### 9. Reports (`apps/web/src/views/ReportsView.tsx`)
- **Works**: Displays recent scans with `Executed`/`Failed`/`Skipped`/`Not Installed` per-scanner cards and exports Markdown reports (`cobalix-orbital-report-*.md`).
- **Hardened in ORBITAL 007**: Added `loading` and `error` banner replacing `.catch(() => {})`, color-coded `scan.status` (`completed` green, `completed_with_errors` amber, `failed` red, `running` blue), rendered scan `errors` and `skippedLocations`, and included error/skipped counts in Markdown exports.
- **Verification**: `tests/frontend.test.tsx`.

### 10. Settings (`apps/web/src/views/SettingsView.tsx` & `AgentsView.tsx` & `ChronicleView.tsx`)
- **Works**: General scan schedule/exclusions, External Scanner Binary Discovery cards (`gitleaks`, `osv-scanner`, `eslint`, `npm-audit`) + custom overrides (`scannerPaths`), optional AI provider config + live availability check, explicit error & saved banners.
- **Hardened in ORBITAL 007**: Updated `AgentsView.tsx` (loading/error banner + colored run status) and `ChronicleView.tsx` (loading/error banner + `Search` button) for full UI consistency across views.
- **Verification**: `tests/frontend.test.tsx` (covers `SettingsView`, `AgentsView`, `ChronicleView`).

### 11. Companion Service (`apps/companion/src/{index,server,auth,validation}.ts`)
- **Works**: Strict loopback binding (`127.0.0.1`), `0600` per-session random 32-byte token removed on exit, timing-safe token verification on all non-health routes, strict Origin (`localhost`/`127.0.0.1`/`tauri://localhost`) & `Sec-Fetch-Site` blocking, `application/json` `Content-Type` enforcement, `1 MiB` max JSON body size, structured schema validators, parent `stdin` EOF clean shutdown.
- **Hardened in ORBITAL 007**: Restricted non-empty AI `endpoint` URLs in `validateAIConfigBody()` to strict `http:` or `https:` schemes.
- **Verification**: `tests/milestone006a.test.ts` (3), `tests/milestone006c.test.ts` (3), `tests/orbital007.test.ts`.

### 12. Tauri 2 Desktop Runtime (`apps/desktop/src-tauri/src/{lib,companion}.rs`, `apps/web/src/api/client.ts`)
- **Works**: Self-contained `companion.mjs` sidecar bundle (`207.9kb`), collision-resistant loopback port allocation (`47890` -> OS `:0`), `/api/health` + `session-token` readiness gate, `Condvar` supervision thread with bounded restarts (`max_restarts = 3`), Rust IPC API bridge (`companion_request`) keeping `X-Cobalix-Token` out of WebView JS, `SIGTERM`/`SIGKILL`/kernel pipe EOF orphan prevention, GUI `PATH` augmentation.
- **Known Limitations**: Built macOS `.app` (`Cobalix Orbital.app`, `10.98 MiB`) uses compatible host `node` (`v22.5+`/`v24+` with `node:sqlite`) and is unsigned/non-notarized; native OS WKWebView pointer driving is not automated (Tauri IPC/event contracts tested via Vitest mocks, Cargo supervision tests, and live packaged binary runtime smoke check).
- **Verification**: `cargo test` (`5/5` passed), `npm run build:desktop`, live `Cobalix Orbital.app` runtime smoke test under stripped `PATH=/usr/bin:/bin:/usr/sbin:/sbin`.

### 13. SQLite Persistence & Credential Store (`packages/db/src/{database,migrations,credentials}.ts`)
- **Works**: `node:sqlite` WAL mode, foreign keys enforced, `busy_timeout = 5000`, transactional `withTransaction()`, versioned migrations `1..3` preserving Chronicle and allowing `'interrupted'` status.
- **Hardened in ORBITAL 007**:
  - `CredentialStore` now validates provider IDs (`sanitizeProviderId`), pipes macOS Keychain passwords via `security -i` stdin (`add-generic-password ... -X <hex>`) instead of CLI `-w` argv, removes stale entries in `credentials.json` upon Keychain write success, and enforces `0o600` fallback file permissions with `fs.chmodSync()`.
- **Verification**: `tests/orbital007.test.ts`, isolated macOS `security -i` `.keychain-db` test.

### 14. Scanner Integrations (`packages/scanners/src/*.ts`)
- **Works**: `execFile` array invocation (no shell), `canonicalizePathWithAncestors` + `normalizeScannerRelativePath` blocking traversal & symlink escapes, bounded `60s` timeout & `10 MiB` buffer, `0700` private temp dirs & `--redact=100` for Gitleaks, exit code fidelity (`2` leaks / `1` fatal for Gitleaks; `0` clean / `1` vulns / `128` empty / `127` offline for OSV), GUI path lookup (`PATH`, `~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin`).
- **Hardened in ORBITAL 007**: Wrapped `npmAudit` caught execution errors in `redactSecrets()`.
- **Known Limitation**: Live OSV checks require internet reachability to `api.osv.dev` unless local offline DBs are cached.
- **Verification**: `tests/milestone006b.test.ts` (9) including real Gitleaks `8.30.1` & OSV-Scanner `2.7.1` CLI execution.

### 15. AI Provider Integrations (`packages/ai/src/aiService.ts`)
- **Works**: Opt-in disabled by default (`provider: 'none'`), explicit consent gate (`consentToSendContext`), lightweight probe (`checkAvailability`) distinguishing `disabled`/`unconfigured`/`available`/`offline`/`unauthorized`/`timeout`/`error`, error sanitization stripping active API key, request metadata logging without storing prompt/credential bodies.
- **Hardened in ORBITAL 007**: Enforced `http:`/`https:` scheme validation inside `AIService.saveConfig()`, and applied `redactSecrets()` across `title`, `description`, `recommendedAction`, and `deterministicSummary` alongside `diffText`/`evidence` before provider transmission.
- **Verification**: `tests/milestone003.test.ts`, `tests/orbital007.test.ts` (protocol rejection & full-field prompt redaction against loopback mock endpoint).
