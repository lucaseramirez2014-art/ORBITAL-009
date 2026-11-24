# ORBITAL 007 — Core Test & Verification Matrix

**Product:** Cobalix Orbital (`v0.1.0`, mission `CBX-ORB-007`)  
**Execution Date:** 2026-11-23  

---

## Automated Build, Static Analysis & Test Runs

| Check / Suite | Command | Result | Scope / Count |
| --- | --- | --- | --- |
| Workspace Build | `npm run build` | Passed | 7 workspaces (`core`, `db`, `scanners`, `ai`, `agents`, `companion`, `web`) |
| Companion Sidecar Bundle | `npm run build:companion:bundle` | Passed | Self-contained `companion.mjs` (`207.9kb`) |
| Workspace Typecheck | `npm run typecheck` | Passed | `tsc --noEmit -p tsconfig.json` |
| Workspace Lint | `npm run lint` | Passed | ESLint across `packages`, `apps/companion`, `apps/web` (0 errors/warnings) |
| Vitest Regression Suite | `npm test` (`vitest run`) | **Passed** | **10 test files, 56/56 tests passed** |
| Rust / Tauri Supervisor Tests | `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` | **Passed** | **5/5 Cargo unit/integration tests passed** |
| Production Dependency Audit | `npm audit --omit=dev` | **Passed** | `0` production vulnerabilities (`6` dev-only advisories in `vitest@2` toolchain) |
| macOS `.app` Desktop Bundle | `npm run build:desktop` | **Passed** | Built `Cobalix Orbital.app` (`10.98 MiB`) |
| Packaged App Runtime Smoke | Spawn `cobalix-obsidian` inside `Cobalix Orbital.app` | **Passed** | Auth (`0600` token, 401/200), SQLite DB, scanner status under stripped `PATH`, clean `SIGTERM` stop |

---

## Vitest Suite Breakdown (`56/56`)

| Test File | Passed | Focus / Subsystems Covered |
| --- | --- | --- |
| `tests/obsidian.test.ts` | 4 / 4 | Asset boundaries, Nightwatch static scans, Saver approval-locked patching & revert, Chronicle chain & tamper detection |
| `tests/milestone002.test.ts` | 4 / 4 | File Intelligence inventory, baseline comparison, diffs, JS/TS dependency edges, AI availability modes |
| `tests/milestone003.test.ts` | 6 / 6 | Saver-FileIntel synchronization, ESLint/Gitleaks/OSV/npm-audit exclusions & normalization, post-patch originating-scanner verification |
| `tests/milestone004a.test.ts` | 5 / 5 | SHA-256 rename correlation (distinct, duplicates, ambiguous), hierarchical file tree builder |
| `tests/milestone004b.test.ts` | 2 / 2 | Per-file chronological history API/chronicle integration, Security Graph deterministic builder |
| `tests/milestone006a.test.ts` | 3 / 3 | Authenticated GET/POST/PATCH/DELETE API routes, path traversal & symlink escape defenses, startup interrupted-run reconciliation |
| `tests/milestone006b.test.ts` | 9 / 9 | Live Gitleaks `8.30.1` & OSV-Scanner `2.7.1` CLI execution, exclusion parity, timeout/exit fidelity, isolated Nightwatch failures |
| `tests/milestone006c.test.ts` | 3 / 3 | Scanner binary discovery, `/api/scanners/status`, bundled `companion.mjs` persistence & stdin-EOF shutdown |
| `tests/frontend.test.tsx` | 12 / 12 | `DiffViewer`, `ErrorBoundary`, `FileIntelligenceView`, `AssetExplorerView`, `SettingsView`, Tauri IPC mocks, and ORBITAL 007 UI error/status states across `ThreatCenterView`, `RemediationView`, `AgentsView`, `ChronicleView`, `ReportsView` |
| `tests/orbital007.test.ts` | 8 / 8 | Symlink directory cycles, `>512 KiB` streaming hash, `chmod 000` dir incomplete coverage, concurrent `409` scan lock, uncaught verifier crash recovery & secret redaction, `0700`/`0600` backups & `revertPatch` state/hash checks, Chronicle recursive redaction & sequence gaps, AI protocol validation & full prompt redaction, `CredentialStore` `0600` fallback & ID validation |

---

## Rust / Tauri Unit & Integration Tests (`5/5`)

| Test | Status | Verified Behavior |
| --- | --- | --- |
| `companion::tests::validates_paths_and_redacts_tokens_from_errors` | Passed | Companion path validation & token redaction in error strings |
| `companion::tests::allocates_alternate_port_when_preferred_is_busy` | Passed | Port collision fallback from `47890` to alternate loopback port |
| `companion::tests::enforces_startup_timeout_without_orpaning_process` | Passed | Clean process termination on startup timeout |
| `companion::tests::starts_real_companion_proxies_authenticated_requests_persists_sqlite_and_cleans_up` | Passed | Real `companion.mjs` startup, IPC proxying with `X-Cobalix-Token`, SQLite restart persistence, shutdown cleanup |
| `companion::tests::detects_unexpected_crash_and_enforces_bounded_restart_limit` | Passed | Supervision recovery & bounded `max_restarts = 3` limit |
