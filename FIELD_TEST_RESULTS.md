# Cobalix Orbital `v0.1.0` — Field Test Results & Stabilization Log (`CBX-ORB-010`)

**Assessment Date:** 2026-11-23  
**Build Under Test:** `Cobalix Orbital.app` (`10.99 MiB`, `Mach-O 64-bit executable x86_64`)  
**Host Environment:** macOS `26.7.3` (`Darwin 25.6.0`, `x86_64`), Node `v24.21.0`, npm `11.19.0`, `gitleaks` `8.30.1` (`~/.local/bin/gitleaks`), `osv-scanner` `2.7.1` (`~/.local/bin/osv-scanner`)

---

## 1. Issues Discovered & Fixes Implemented During ORBITAL 010

| ID | Category | Finding / Risk Before Fix | Root Fix Implemented & Verified |
| --- | --- | --- | --- |
| **O10-UX-01** | Destructive Action Safety (`AssetExplorerView`) | Clicking the trash icon (`Remove from monitoring`) removed an asset immediately in one click with no confirmation, clearing tracked files, baselines, and findings unexpectedly. | Added inline `confirmRemoveId` guard in `AssetExplorerView.tsx` explaining that local disk files remain untouched and Chronicle history is preserved, with `Cancel` and `Confirm Remove` buttons plus confirmation status text. Covered by UI regression test in `tests/frontend.test.tsx`. |
| **O10-SEC-01** | Tester Privacy in Bug-Report Exports (`ChronicleView`, `ReportsView`, `fileTree`) | Chronicle JSON exports dumped raw `events` containing private host paths (`/Users/...`, `/private/var/...`, `canonicalPath`, `backupPath`), and Markdown/metadata exports lacked a client-side diagnostic sanitizer and sanitized-export notice. | Added browser-safe `apps/web/src/lib/exportSanitizer.ts` (`sanitizeDiagnosticText`, `sanitizeDiagnosticValue`, `sanitizeChronicleExport`, `sanitizeMarkdownReport`). Wired sanitized exports into `ChronicleView.tsx` (`Export Sanitized JSON`), `ReportsView.tsx` (`Export Sanitized Report`), and `fileTree.ts` (`exportFilesMetadataJson`) with explicit notices distinguishing sanitized exports from local SQLite logs. Verified in `tests/orbital010.test.ts` and `tests/frontend.test.tsx`. |

---

## 2. Complete ORBITAL 010 Test Matrix

| Test / Validation Case | Scope & Method | Result | Evidence / Notes |
| --- | --- | --- | --- |
| **Workspace Dependency Audit** | `npm audit` & `npm audit --omit=dev` | **PASS** | `0` vulnerabilities (production and development) both pre-edit and post-edit. |
| **Full Monorepo Build & Bundle** | `npm run build`, `npm run build:companion:bundle`, `npm run typecheck`, `npm run lint` | **PASS** | Zero TS/Vite/ESLint errors; `companion.mjs` bundled cleanly (`207.9kb`); Vite frontend built cleanly (`1598` modules, `SecurityGraphView` code-split). |
| **Desktop Bundle Build** | `npm run build:desktop` (`npx tauri build --bundles app`) | **PASS** | Rebuilt `apps/desktop/src-tauri/target/release/bundle/macos/Cobalix Orbital.app` (`10.99 MiB`, `Mach-O 64-bit x86_64`). |
| **Vitest Full Regression Suite** | `npm test` (`vitest run`) | **PASS** | **`13` test files / `68 / 68` tests passed** across Core, DB, File Intelligence, Nightwatch, Saver, Chronicle, Scanners, AI, Security, Frontend UI, and Field Reliability. |
| **Rust Supervisor & IPC Suite** | `cargo test` (`apps/desktop/src-tauri`) | **PASS** | **`8 / 8` Cargo tests passed** (`companion::tests::*`, covering port fallback, path validation, token redaction, false-`Ready` guard, missing/legacy Node guidance, unwritable data dir, `SIGKILL` recovery & token rotation). |
| **Empty Project Lifecycle (`orbital010.test.ts`)** | Automated integration | **PASS** | Register empty folder -> `nightwatch.runScan()` -> `status: 'completed'`, `filesInspected: 0`, `findingsCreated: 0`, Chronicle `verifyIntegrity().valid === true`. |
| **Large Synthetic Repo (`500` Nested Files)** | Automated integration (`orbital010.test.ts`) | **PASS** | `500` nested `.ts` files inventoried cleanly in `1.22s`; `SecurityGraphService.buildGraph()` enforces bounded cap (`nodes.length === 150`, `totalNodesAvailable >= 501`, `truncated === true`). |
| **Chronicle Integrity After Partial Failures & Revert** | Automated integration (`orbital010.test.ts`) | **PASS** | Unreadable `chmod 000` subdir yields `completed_with_errors` cleanly; Saver apply + `revertPatch` completes; `chronicle.verifyIntegrity()` returns `{ valid: true, brokenAtSequence: null }`. |
| **Export Sanitization Coverage** | Unit + JSDOM UI button tests (`orbital010.test.ts`, `frontend.test.tsx`) | **PASS** | Dummy `ghp_`, `sk-`, `sk-ant-`, `AKIA`, `Bearer`, PEM keys, `/Users/...`, `/private/var/...`, `/home/...`, `C:\Users\...`, `canonicalPath`, `backupPath` all redacted while preserving relative `src/*` paths and adding diagnostic notice. |
| **Asset Removal Inline Confirmation Guard** | JSDOM UI interaction (`frontend.test.tsx`) | **PASS** | First Remove click opens inline `Confirm Asset Removal` without calling `api.removeAsset`; `Cancel` aborts cleanly; `Confirm Remove` executes removal once. |
| **Live Packaged `.app` First Launch (`stripped PATH`)** | Packaged `Cobalix Orbital.app/Contents/MacOS/cobalix-obsidian` + isolated `COBALIX_DATA_DIR`, `PATH=/usr/bin:/bin:/usr/sbin:/sbin` | **PASS** | App PID `59797` spawned companion PID `59844` on alternate free port `53855` (preserving host PID `41330` on `47890`), created `0600` `session-token` and `obsidian.sqlite`, rejected unauthenticated `GET /api/assets` (`401`), ran Nightwatch scan (`completed`, `1` finding). |
| **Live `.app` Restart Persistence (`SIGTERM`)** | Packaged `.app` restart reusing `COBALIX_DATA_DIR` | **PASS** | `SIGTERM` stopped companion cleanly (`child1GoneOnSigterm: true`); relaunch on port `53863` returned persisted `1` asset & `1` finding from SQLite. |
| **Live `.app` Mid-Run `SIGKILL` Crash Recovery** | Killed companion PID `59895` (`SIGKILL`) while `.app` stayed open | **PASS** | Rust supervisor auto-respawned companion PID `59929` on port `53870`, rotated `session-token` (`tokenRotated: true`), rejected stale token (`401`), and served requests with new token (`200`). |
| **Live `.app` Clean Exit & Temp Hygiene** | `SIGTERM` shutdown + `os.tmpdir()` audit | **PASS** | `survivingChildren: 0`; `test_tmp_leftovers: []` (only Apple WebKit's own `$TMPDIR/com.cobalix.obsidian/WebKit` directory exists when WKWebView runs). |
| **Real External Scanners (`gitleaks`, `osv-scanner`)** | `tests/milestone006b.test.ts` & `tests/orbital009.test.ts` | **PASS** | Verified real Gitleaks `8.30.1` and OSV-Scanner `2.7.1` detection, exclusions, symlink containment, redaction, and clean-repo runs. |
| **Human Native Cocoa / WKWebView Pointer Click-Through** | Manual Finder launch -> click all 10 views -> `Cmd+Q` | **MANUAL_PENDING** | Not automated (`tauri-driver` does not support macOS WKWebView). Checklist documented in `CONTROLLED_TESTING_GUIDE.md` & `NATIVE_MACOS_QA.md`. |

---

## 3. Outstanding Risks & Honest Scope Boundaries

1. **Human Native Window Click-Through Pending Final Cohort Sign-Off (`MANUAL_PENDING`)**: Interactive UI behavior is verified in Chromium and JSDOM (`15/15` UI tests), and live desktop process/API/IPC behavior is verified in the packaged `.app`, while human Cocoa/WKWebView pointer testing remains a pre-invite manual step.
2. **Unsigned & Un-notarized Binary (`x86_64`)**: External testers must use **Right-Click -> Open** (and **Rosetta 2** on Apple Silicon Macs).
3. **Host Node.js Prerequisite (`22.13+` / `24 LTS`)**: Testers must have a compatible Node runtime installed until signed DMG releases bundle a signed Node sidecar (`resources/runtime/node`).
4. **In-App Nightly Scheduler**: Global Nightly Scan executes only while **Cobalix Orbital** stays running; per-asset file watching & cron fields stay disabled (`Planned — Not Active`).
