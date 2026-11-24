# Cobalix Orbital `v0.1.0` — Known Product Limitations

This document accurately records all active scope boundaries and known technical limitations verified in Cobalix Orbital `v0.1.0` (`CBX-ORB-009`).

---

## 1. Platform, Packaging & Runtime Limitations

1. **Host Node.js Requirement (`>= 22.13` / `24 LTS`)**: The `v0.1.0` bundle relies on a compatible host `node` runtime with `node:sqlite` (bundled sidecar slot `resources/runtime/node` is wired in Rust, not populated in the `10.98 MiB` build).
2. **Unsigned & Non-Notarized macOS `.app`**: Built binary lacks Apple Developer ID code signing and notarization; macOS Gatekeeper requires explicit local trust / Right-Click -> Open.
3. **Architecture**: Locally built binary targets Intel `x86_64`; Apple Silicon (`arm64`) execution uses Rosetta 2 unless cross-compiled in CI (`aarch64-apple-darwin` / `universal-apple-darwin`).
4. **Windows & Linux Desktop Packages Not Built/Verified**: Tauri/Rust desktop bundles were built and runtime-tested on macOS only.

---

## 2. Features Marked Planned — Not Active (Intentionally Inactive in `v0.1.0`)

- **Per-Asset File Watching (`scanOnFileChange`)**: Disabled in **Asset Explorer** and explicitly marked **`Planned — Not Active`**. File modifications are detected when you run Nightwatch or inventory manually (or via global Nightly Scan).
- **Per-Asset Cron Scheduling (`scheduleCron`)**: Disabled in **Asset Explorer** and explicitly marked **`Planned — Not Active`**.
- **Global Nightly Scheduled Scans (`nightlyScheduleEnabled`)**: Runs inside the companion process at the configured local time **only while Cobalix Orbital remains open** (no OS background LaunchAgent/daemon is installed in `v0.1.0`).
- **Auto-Updater / Hosted Sync**: Manual application updates only; no telemetry, cloud storage, or update servers exist.

---

## 3. Scanner & Language Coverage Boundaries

- **External Scanners Optional & Host-Dependent**: Deterministic scanning (`obsidian-static-inspector`), File Intelligence, Saver diffing/patching, and Chronicle run cleanly without external CLIs, while Gitleaks, OSV-Scanner, and ESLint require those tools on the host (or configured in **Settings**).
- **Network Dependency for Live CVE Lookups**: `osv-scanner` (`api.osv.dev`) and `npm audit` require internet connectivity unless local OSV offline vulnerability databases are configured.
- **AST Dependency Graph Scope (`languageSupport`)**: Import/relationship extraction inside `FileIntelligenceService` and `SecurityGraphView` parses **JavaScript/TypeScript source extensions** (`languageSupport: 'supported'`); non-JS/TS languages report `'unsupported'` rather than fabricated graph edges.
- **`GraphNode` Union vs Active Graph Builder**: Graph builder currently constructs `asset`, `file`, `dependency`, `finding`, and `patch` nodes/edges cleanly; `folder`, `agent`, and `event` types are reserved in the core type union.

---

## 4. Storage, Diff & QA Scope Notes

- **Local Diff Snapshots vs Redacted Telemetry**: To power exact code review in File Intelligence's `DiffViewer`, authorized local text files (`<= 512 KiB`) are snapshotted locally inside `obsidian.sqlite` (`file_baselines` / `file_changes`). **Findings, scan logs, Chronicle events, exported report summaries, and optional consented AI prompts** redact detected secret patterns (`redactSecrets()`, Gitleaks `--redact=100`).
- **Automated Mac WKWebView Driving**: Automated interactive UI verification ran against real Chromium (`http://localhost:5173`) + bundled `companion.mjs` and Cargo/live `.app` API lifecycle tests; direct Cocoa `WKWebView` mouse driving requires human manual QA sign-off (`NATIVE_MACOS_QA.md`).
