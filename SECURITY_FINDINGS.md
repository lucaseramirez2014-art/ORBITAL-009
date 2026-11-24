# ORBITAL 007 — Security Findings Report

**Product:** Cobalix Orbital (`v0.1.0`, mission `CBX-ORB-007`)  
**Assessment Scope:** Full attack surface inspection across Companion HTTP API, Tauri 2 Rust runtime & IPC, filesystem boundaries, SQLite & CredentialStore, Chronicle, Saver, Nightwatch, Scanners, AI Service, and workspace dependencies.

---

## Summary Table

| ID | Severity | Component | Finding | Status (ORBITAL 007) |
| --- | --- | --- | --- | --- |
| SEC-001 | High | `CredentialStore` (`packages/db/src/credentials.ts`) | macOS Keychain secret passed on CLI `-w` argv (`ps` exposure); stale fallback cleanup & explicit `chmod 0600` missing | **Fixed & Verified** |
| SEC-002 | High | `AIService` & Validation (`aiService.ts`, `validation.ts`) | AI `endpoint` accepted non-HTTP(S) schemes; prompt fields beyond `diffText`/`evidence` sent unredacted | **Fixed & Verified** |
| SEC-003 | Medium | `ChronicleService` (`packages/agents/src/chronicle.ts`) | `recordEvent` lacked recursive secret redaction; `verifyIntegrity` skipped sequence contiguity checks | **Fixed & Verified** |
| SEC-004 | Medium | `FileIntelligenceService` (`packages/agents/src/fileIntelligence.ts`) | Missing symlink directory cycle guard in `walk()`; unbounded `fs.readFileSync()` buffered large files in memory | **Fixed & Verified** |
| SEC-005 | Medium | `SaverAgent` & `NightwatchAgent` (`saver.ts`, `nightwatch.ts`) | Missing per-asset/per-patch concurrency locks; uncaught verifier throw leaves dirty state; weak backup permissions & missing backup hash verification on revert | **Fixed & Verified** |
| SEC-006 | Low | `npmAudit.ts` & UI views (`ThreatCenterView`, `RemediationView`, `AgentsView`, `ChronicleView`, `ReportsView`, `SecurityGraphView`) | Unredacted `npm audit` failure message edge case; swallowed UI errors and green badge on failed scans | **Fixed & Verified** |
| SEC-007 | Low | Root `devDependencies` (`npm audit`) | 6 dev-only advisories (`vitest <= 2`, `tinypool`, `esbuild`, `vite`) vs `0` production advisories (`npm audit --omit=dev`) | Open (retained intentionally; requires `vitest@5` major bump) |
| SEC-008 | Informational | Desktop Packaging (`apps/desktop/src-tauri`) | Unsigned local macOS `.app` bundle & reliance on host `node` runtime (`node:sqlite`) | Open / Documented (awaiting signing setup) |

---

## Detailed Findings

### SEC-001 — High: macOS Keychain Secret Passed via CLI Argument Vector & Fallback File Cleanup — FIXED & VERIFIED
- **Location**: `packages/db/src/credentials.ts`
- **Issue**: `CredentialStore.setCredential()` invoked `security add-generic-password ... -w <secret>`. On multi-user/local observation (`ps`), process arguments can expose credentials briefly. Saving to Keychain also left older entries in `credentials.json`, and `fs.writeFileSync` relied solely on creation mode without explicit `fs.chmodSync(path, 0o600)`.
- **Fix & Verification**: Validated provider identifiers (`sanitizeProviderId`), piped `add-generic-password ... -X <hex>` over stdin via `security -i`, deleted stale `credentials.json` entries on Keychain write success, and enforced `fs.chmodSync(this.fallbackPath, 0o600)`. Verified with isolated `.keychain-db` test (`security -i`) and `tests/orbital007.test.ts` (`0o600` fallback permissions and path-escape provider ID rejection).

### SEC-002 — High: Unvalidated AI Endpoint Protocol & Incomplete Prompt Redaction — FIXED & VERIFIED
- **Location**: `apps/companion/src/validation.ts`, `packages/ai/src/aiService.ts`
- **Issue**:
  1. `validateAIConfigBody()` and `AIService.saveConfig()` accepted arbitrary strings in `endpoint` without checking `http:`/`https:`.
  2. `explainFileChange()` redacted `diffText` but not `deterministicSummary`; `explainFinding()` redacted `evidence` but not `title`, `description`, or `recommendedAction`.
- **Fix & Verification**: Enforced strict `http:` / `https:` URL parsing for non-empty AI `endpoint` values in both `validateAIConfigBody()` and `AIService.saveConfig()`, and applied `redactSecrets()` across `title`, `description`, `recommendedAction`, and `deterministicSummary` whenever `cfg.redactSecrets` is enabled. Verified via `tests/orbital007.test.ts` against an isolated loopback HTTP server.

### SEC-003 — Medium: Chronicle Event Unredacted Metadata & Sequence Continuity Gap — FIXED & VERIFIED
- **Location**: `packages/agents/src/chronicle.ts`
- **Issue**: `ChronicleService.recordEvent()` stored `input.summary` and `input.details` without redacting accidental secret patterns, and `verifyIntegrity()` did not assert contiguous sequence numbers (`1..N`).
- **Fix & Verification**: Recursively applied `redactSecrets()` to `summary` and all nested values in `details` (`redactEventValue()`) prior to SHA-256 chain computation/insertion, and enforced `r.sequence === expectedSequence` inside `verifyIntegrity()`. Verified in `tests/orbital007.test.ts`.

### SEC-004 — Medium: File Intelligence Symlink Loop DoS & Unbounded File Read — FIXED & VERIFIED
- **Location**: `packages/agents/src/fileIntelligence.ts`
- **Issue**: `walk()` recursively followed internal directory symlinks without tracking visited canonical directory paths, enabling symlink cycles to exhaust call stack. Separately, `fs.readFileSync(absPath)` buffered entire files in RAM before checking binary type or `512 KiB` snapshot cap.
- **Fix & Verification**: Added `visitedDirs = new Set<string>()` canonical path cycle detection in `walk()`, and replaced full-file reads in `inventoryAsset()` with `readFileHashAndSample()` streaming `64 KiB` SHA-256 chunks with bounded `8 KiB` binary sampling and `512 KiB` text snapshot retention. Verified in `tests/orbital007.test.ts` (`600 KiB` streaming hash, symlink cycle, and `chmod 000` coverage).

### SEC-005 — Medium: Missing Concurrency Guards, Uncaught Verifier Failure State & Saver Backup Hardening — FIXED & VERIFIED
- **Location**: `packages/agents/src/nightwatch.ts`, `packages/agents/src/saver.ts`
- **Issue**:
  1. Overlapping `runScan()` calls for the same asset and overlapping `applyApprovedPatch()`/`revertPatch()` calls for the same patch lacked in-process locks.
  2. Uncaught `this.verifier()` exceptions left modified disk content with DB status `'approved'`.
  3. Backup dir/files omitted `0700`/`0600` chmod; temp filenames used `Date.now()`; `revertPatch()` omitted `patch.status === 'applied'` and backup SHA-256 validation.
- **Fix & Verification**: Added per-asset (`activeAssetScans`) and per-patch (`activePatches`) `409` concurrency locks with `finally` cleanup, promoted `inaccessibleDirectories` to scan errors, wrapped `this.verifier()` in `try/catch` + `redactSecrets()`, hardened backup directory (`0700`) / file (`0600`) modes and random hex temp suffixes preserving file mode, and enforced `status === 'applied'` + backup SHA-256 matching in `revertPatch()`. Verified in `tests/orbital007.test.ts`.

### SEC-006 — Low: Error Message Redaction in `npmAudit` & Misleading UI Error/Status States — FIXED & VERIFIED
- **Location**: `packages/scanners/src/npmAudit.ts`, `apps/web/src/views/{ThreatCenterView,RemediationView,AgentsView,ChronicleView,ReportsView,SecurityGraphView}.tsx`
- **Issue**: `npmAudit` caught errors bypassed `redactSecrets()`; UI views swallowed errors or rendered `completed_with_errors`/`failed` scan headers in green.
- **Fix & Verification**: Wrapped `npmAudit` error paths in `redactSecrets()`; added loading/error banners, `Search` buttons, verification note color styling, and accurate scan status colors + Markdown export error/skipped summaries across the 6 UI views. Verified in `tests/frontend.test.tsx`.

### SEC-007 — Low: Development-Only Dependency Vulnerabilities (`npm audit`)
- **Evidence**:
  - `npm audit --omit=dev`: **`found 0 vulnerabilities`** (the workspace production runtime `@cobalix/*` and `companion.mjs` have zero third-party npm dependencies; `apps/web` runtime uses `react`, `react-dom`, `lucide-react`, `cytoscape`, `@tauri-apps/api`).
  - Full `npm audit` (including `devDependencies`): **6 advisories** (`esbuild`, `vite <= 6.4.3`, `tinypool <= 2.1.1`) tied to `vitest@2.1.8` dev/test toolchain; upgrading requires breaking major `vitest@5` bump.
- **Status**: Retained intentionally for ORBITAL 007 scope (no runtime/bundled companion impact).

### SEC-008 — Informational: Packaged App Signature & Host Node.js Dependency
- **Evidence**: `apps/desktop/src-tauri` builds unsigned macOS `.app` (`Cobalix Orbital.app`) using host Node.js (`v24+` with `node:sqlite`) rather than embedded signed Node binary.
- **Status**: Documented clearly in `README.md`; signing/notarization remains open for release engineering.
