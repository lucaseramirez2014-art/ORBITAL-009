# Cobalix Orbital — Desktop Test & Reliability Matrix

**Product:** Cobalix Orbital (`v0.1.0`, mission `CBX-ORB-008`)  
**Verification Date:** 2026-11-23  
**Host Environment:** macOS `26.7.3` (`Darwin 25.6.0` `x86_64`), Node `v24.21.0`, Gitleaks `8.30.1`, OSV-Scanner `2.7.1`, npm `11.19.0`  

---

## 1. Interactive Real Browser E2E (`http://localhost:5173` + Bundled `companion.mjs`)

Verified against the real Vite frontend + bundled Node companion (`companion.mjs` on port `47899`, isolated `COBALIX_DATA_DIR`, isolated synthetic repo containing `src/insecure.ts`) using real Chromium browser interaction via the browser subagent:

| Workflow Step | Verified Action & Evidence | Status |
| --- | --- | --- |
| App Launch & Command Center | `Cobalix Orbital` (`ORBITAL // v0.1.0`) rendered all 10 nav tabs, `Companion · Connected`, initial 0 telemetry cards, zero console/network errors | **Passed** |
| Asset Explorer | Registered `Orbital E2E Repo` (`repository`); green confirmation banner; card displayed `1 files · 1 open findings` after scan | **Passed** |
| Nightwatch Scan | Triggered `Run Nightwatch` from Asset Explorer; completed (`inspected 1 files, 1 new findings`) | **Passed** |
| File Intelligence | Navigated `Root -> src -> insecure.ts`; inspected Current/Baseline SHA-256 (`fd58fb...`), `added`/`new` badges, metadata, and file History events | **Passed** |
| Threat Center | Viewed `TLS Certificate Verification Disabled` (`HIGH`, `high conf.`, `obsidian-static-inspector`, evidence block); triggered `Ask Saver` | **Passed** |
| Saver Remediation | Auto-navigated to Remediation Workspace; displayed explanation, `PROPOSED src/insecure.ts` (`Patch ID: 743f6976`), unified diff (`rejectUnauthorized: false` -> `true`), `Approve Patch`/`Reject` controls | **Passed** |
| Chronicle | Displayed `Hash Chain Verified (7)` badge and chronological events `#1..#7` | **Passed** |
| Security Graph | Rendered Cytoscape canvas (`738x520`, 4 nodes, 3 edges) without `ErrorBoundary` fallback; tested `Locate node...` (`insecure`), Zoom, Fit, Refresh | **Passed** |
| Reports | Verified `Scan 90e1fd0f` (`COMPLETED`), scanner status cards, and downloaded `cobalix-orbital-report-2026-11-24.md` | **Passed** |
| Settings | Viewed scanner diagnostics (`gitleaks 8.30.1`, `osv-scanner 2.7.1`, `eslint Not Installed`, `npm-audit 11.19.0`); saved settings (`General, schedule, and scanner settings saved.`) | **Passed** |
| Companion Disconnect Recovery | Stopped `companion.mjs`; UI transitioned cleanly from `Connected` to red `Offline` badge + `Local Companion service is unreachable...` banner + `Retry` + Threat Center `Request failed (500)` error banner; restarted companion with rotated session token, clicked `Retry`, and confirmed recovery back to `Connected` with persisted data (`1` asset, `1` file, `1` finding) | **Passed** |

*Visual Polish Note*: At `1280x800`, the `INFORMATIONAL` pill label in Command Center's 5-column `Open Findings by Severity` card slightly extends past the right border of its narrow tile container.

---

## 2. Live Packaged `Cobalix Orbital.app` Lifecycle & Crash-Recovery Smoke

Executed directly against `/Users/lucasramirez/Desktop/Cobalix/apps/desktop/src-tauri/target/release/bundle/macos/Cobalix Orbital.app/Contents/MacOS/cobalix-obsidian` with an isolated fresh `COBALIX_DATA_DIR` and stripped `PATH=/usr/bin:/bin:/usr/sbin:/sbin`:

| Scenario | Observed Result | Status |
| --- | --- | --- |
| Fresh First Launch (`COBALIX_DATA_DIR`) | Created `obsidian.sqlite` + `0600` `session-token` cleanly under stripped `PATH`; bound companion on loopback (`port 65224` fallback cleanly avoiding busy `47890`) | **Passed** |
| Loopback Auth & Diagnostics | `/api/health` returned `200`; `/api/overview` returned `401` unauthenticated and `200` with `X-Cobalix-Token`; `/api/scanners/status` reported `4` scanners accurately | **Passed** |
| Mid-Run `SIGKILL` Crash Recovery | Killed companion child PID (`48216`); Rust `CompanionSupervisor` detected exit, respawned new companion PID (`48274`), rotated `session-token` (`token2 !== token1`), rejected stale `token1` (`401`), and served `/api/overview` (`200`) with `token2` | **Passed** |
| Clean Shutdown (`SIGTERM`) | Sent `SIGTERM` to packaged `.app`; exited cleanly, terminated all tracked companion child processes (`aliveAfterStop: []`), removed `session-token`, and removed temporary test data | **Passed** |

---

## 3. Automated Test Suites

| Suite | Count / Outcome | Scope Covered |
| --- | --- | --- |
| Rust `cargo test` (`apps/desktop/src-tauri/src/companion.rs`) | **8 / 8 Passed** | Port fallback, API path validation & token redaction, real `companion.mjs` startup + SQLite persistence + token rotation, startup timeout orphan cleanup, bounded crash restart (`max_restarts`), **zero false `Ready` events during failed retries**, **missing/incompatible Node & unwritable `data_dir` guidance**, **mid-request `SIGKILL` recovery** |
| `tests/orbital008.test.ts` | **4 / 4 Passed** | Fresh `COBALIX_DATA_DIR` first launch + missing scanner reporting, unreadable `chmod 000` folders & invalid DB directory path errors, abrupt `SIGKILL` mid-scan interruption reconciliation + token rotation, scanner timeout/malformed JSON + `cobalix-gitleaks-*` temp cleanup |
| `tests/orbital007.test.ts` | **8 / 8 Passed** | Symlink directory cycles, streaming `>512 KiB` hashes, `409` scan concurrency locks, Saver verifier crash redaction & `0700`/`0600` backups, Chronicle recursive redaction & sequence gaps, AI endpoint scheme & prompt redaction, `CredentialStore` `0600` fallback |
| `tests/frontend.test.tsx` (JSDOM + Tauri mocks) | **12 / 12 Passed** | `DiffViewer`, `ErrorBoundary`, `FileIntelligenceView`, `AssetExplorerView`, `SettingsView`, Tauri IPC proxy & lifecycle UI states, and error/status rendering across `ThreatCenterView`, `RemediationView`, `AgentsView`, `ChronicleView`, `ReportsView` |
| Earlier Regression Suites (`obsidian`, `milestone002..006c`) | **36 / 36 Passed** | End-to-end Nightwatch/Saver/Chronicle/FileIntel workflows, real Gitleaks `8.30.1` & OSV-Scanner `2.7.1` execution, Companion auth & security boundaries, bundled companion lifecycle |

---

## 4. Known Testing Boundaries (What Remains Manual-Only)

- **Native macOS WKWebView UI Driver**: Neither `playwright` nor `tauri-driver` is installed on this host (and Tauri does not currently provide a `WKWebView` WebDriver server on macOS comparable to `tauri-driver` on Linux/Windows). Therefore:
  - **Web UI rendering & DOM interactivity** were verified in real Chromium (`http://localhost:5173`) against the real companion API.
  - **Tauri IPC bridge (`companion_request`), process supervision, crash recovery, and native app launch/shutdown** were verified in Rust Cargo tests + live execution of `Cobalix Orbital.app` binary.
  - **Manual GUI window click-through inside macOS WKWebView** (opening `.app` via Finder/Gatekeeper right-click and clicking through the native Cocoa window) remains a manual pre-release QA verification step.
