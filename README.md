# Cobalix Orbital

**Version:** `v0.1.0`  
**Repository:** `cobalix/orbital`

---

## 1. Product Overview

**Cobalix Orbital** is a local-first cybersecurity monitoring, file integrity, and controlled remediation workspace built for software repositories and explicitly authorized computer folders.

All scanning, integrity tracking, event logging, and approval workflows run locally on your machine against an embedded SQLite database, with optional and explicitly gated AI explanations.

---

## 2. Core Capabilities

- **File Intelligence & Integrity Baselines**: Walks explicitly registered repositories and folders, tracks SHA-256 baselines, detects added/modified/removed files and likely SHA-256 renames, and preserves line-level diff history.
- **Nightwatch Multi-Scanner Orchestration**: Coordinates deterministic static checks (`obsidian-static-inspector`) alongside external tools (`gitleaks`, `osv-scanner`, `npm audit`, `eslint`) with canonical path normalization, symlink-escape rejection, exclusion enforcement, and finding deduplication.
- **Saver Controlled Remediation**: Generates deterministic (or optional redacted-context AI) explanations and candidate patches, enforces explicit human approval, validates file hash consistency before writing (`PatchValidationError` invalidation if changed), backs up originals, verifies fixes with the originating scanner, and synchronizes baselines only after verification succeeds.
- **Chronicle Tamper-Evident Audit Log**: Maintains an append-only, SHA-256 hash-chained SQLite audit trail across scans, file baseline changes, approvals, settings updates, and startup crash recovery.
- **Security Graph & Scan Reports**: Visualizes relationships across assets, files, findings, recommendations, patches, and events using Cytoscape.js and exports Markdown summaries.

---

## 3. Screenshots

> _Placeholder — Screenshots of the Cobalix Orbital v0.1.0 retro-space mission-control workspace are pending final desktop window capture:_
> - `[Placeholder: Command Center Telemetry Overview]`
> - `[Placeholder: File Intelligence Explorer & Integrated File History]`
> - `[Placeholder: Threat Center & Saver Patch Approval Diff Viewer]`
> - `[Placeholder: Settings & External Scanner Diagnostics]`

---

## 4. Technology Stack

- **Desktop Shell**: Tauri 2 (Rust), `ureq` loopback HTTP client
- **Companion Runtime**: Node.js (`v24+` / `v22.5+` with built-in `node:sqlite`), TypeScript ESM, `esbuild` sidecar bundler
- **Frontend**: React 18, TypeScript, Vite 6, Tailwind CSS 4, Lucide icons, Cytoscape.js
- **Database**: Local SQLite (`node:sqlite`, WAL mode, transactional versioned migrations)
- **External Security Scanners**: `gitleaks`, `osv-scanner`, `npm audit`, `eslint`

---

## 5. Architecture Overview

```text
┌──────────────────────────────────────────────────────────────────────┐
│ Tauri 2 Desktop Window (apps/desktop/src-tauri)                      │
│   └─ React + Vite Frontend (apps/web/dist)                           │
│        │ Tauri IPC: invoke("companion_request")  (no token in JS)    │
│        ▼                                                             │
│   Rust CompanionSupervisor & Proxy (companion.rs / lib.rs)           │
│     • Allocates 127.0.0.1:47890 (or free ephemeral loopback port)    │
│     • Reads 0600 session-token from app data dir per request         │
│     • Supervises health, bounded restarts (max 3), & clean shutdown  │
└────────┼─────────────────────────────────────────────────────────────┘
         │ Loopback HTTP + X-Cobalix-Token (127.0.0.1)
         ▼
┌──────────────────────────────────────────────────────────────────────┐
│ Bundled Node.js Companion (apps/companion / companion.mjs)           │
│   └─ LocalProtectionService (@cobalix/agents)                        │
│        ├── NightwatchAgent  -> @cobalix/scanners (Gitleaks, OSV,     │
│        │                       npm audit, ESLint, Static Inspector)  │
│        ├── SaverAgent       -> Backup, Diffs, Post-Patch Verifiers   │
│        ├── ChronicleService -> SHA-256 Hash-Chained Audit Events     │
│        ├── FileIntelligence -> Inventory, Baselines, Rename Correlation│
│        ├── SecurityGraph    -> Nodes & Relationships                 │
│        └── @cobalix/ai      -> Optional Gated Provider Client        │
│               │                                                      │
│               ▼                                                      │
│        SQLite DB (obsidian.sqlite) & OS Keychain / 0600 Key Store    │
└──────────────────────────────────────────────────────────────────────┘
```

During browser development (`npm run dev:web`), Vite's dev proxy injects `X-Cobalix-Token` from the local app data directory onto `/api/*` requests. In the packaged desktop runtime, the Rust `companion_request` bridge reads the `0600` session token in Rust memory and forwards requests to `127.0.0.1`, keeping the bearer token out of the WebView JavaScript context.

---

## 6. Local-First Privacy and Security Model

- **Explicit Asset Authorization**: Scans and file writes are strictly constrained within registered asset directories using canonical `realpath` boundary checks (`resolveWithinAssetRoot`, `normalizeScannerRelativePath`), blocking `..` traversal and symlink escapes.
- **Loopback-Only API & Session Authentication**: Companion binds exclusively to `127.0.0.1`, validates `Origin` and `Sec-Fetch-Site`, enforces timing-safe `X-Cobalix-Token` checks on every non-health endpoint (including `GET` routes), and keeps `/api/health` minimal.
- **Secret Protection**: External scanner outputs, error messages, and optional AI prompts pass through `redactSecrets()`. In Desktop runtime, Gitleaks runs with `dir --no-banner --redact=100`.
- **Optional AI Boundaries**: Disabled by default (`provider: 'none'`). Sending redacted diff/finding context externally requires explicit configuration and user consent; API keys are kept outside SQLite settings.
- **Process Supervision**: Startup reconciliation automatically marks stale `'running'` scans or agent runs as `'interrupted'` after crashes, and piped `stdin` EOF monitoring prevents orphaned companion processes.

---

## 7. Installation Requirements

### Required Host Dependencies

- **Node.js `v22.5+` or `v24+`** with built-in `node:sqlite` enabled (verified on `v24.21.0`). **The packaged desktop application requires a compatible host Node.js binary (`node` in `PATH`, `/usr/local/bin/node`, `/opt/homebrew/bin/node`, or `COBALIX_NODE_BIN`)** to launch the bundled companion runtime.
- **npm** (bundled with Node.js).
- **Rust toolchain (`rustc` / `cargo`) & Xcode Command Line Tools** (on macOS, required only if building the Tauri 2 desktop binary from source).

### Optional Security Scanner Binaries

Cobalix Orbital runs its built-in file integrity checks and `obsidian-static-inspector` out of the box. For full secret, dependency, and lint scanning, install:

- [`gitleaks`](https://github.com/gitleaks/gitleaks) (`v8.30.1` tested) in `PATH`, `~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin`, or configured in Settings.
- [`osv-scanner`](https://github.com/google/osv-scanner) (`v2.7.1` tested) in `PATH`, `~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin`, or configured in Settings.
- `eslint` (project or global `PATH`, or configured in Settings).
- `npm` (used for `npm audit` on repositories containing `package.json` and `package-lock.json`).

---

## 8. Development Setup

```bash
npm install
npm run build
```

Start the companion server and Vite web UI in separate terminals:

```bash
# Terminal 1 — Local companion service on 127.0.0.1:47890
npm run dev:companion

# Terminal 2 — Vite React workspace on http://localhost:5173
npm run dev:web
```

Or run the native Tauri desktop development window directly:

```bash
npx tauri dev --config apps/desktop/src-tauri/tauri.conf.json
```

---

## 9. Build Instructions

```bash
# Compile TypeScript workspaces + production Vite frontend
npm run build

# Bundle self-contained companion sidecar for Tauri packaging
npm run build:companion:bundle

# Build packaged native desktop application (.app on macOS)
npm run build:desktop
```

Packaged macOS output: `apps/desktop/src-tauri/target/release/bundle/macos/Cobalix Orbital.app`.

---

## 10. Testing Instructions

```bash
# Build workspaces first (typecheck checks compiled .d.ts outputs)
npm run build && npm run build:companion:bundle

# Static checks
npm run typecheck
npm run lint

# Vitest suite (unit, HTTP API, Chronicle, File Intel, Saver, Scanners, UI)
npm test

# Rust sidecar supervisor & proxy integration tests
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```

Live external CLI tests in `tests/milestone006b.test.ts` automatically detect `gitleaks` and `osv-scanner` (`PATH` / `~/.local/bin`) and skip clearly if a binary is not installed on the host.

---

## 11. Known Limitations

- **Host Node.js Runtime Dependency**: The desktop `.app` executes the bundled `companion.mjs` against a compatible host `node` installation rather than bundling a standalone Node.js binary inside the `.app`.
- **Unsigned macOS Application Bundle**: Current `v0.1.0` macOS `.app` builds are unsigned and not Apple-notarized (local development build).
- **OSV-Scanner Network Access**: Vulnerability lookups via `osv-scanner` require internet connectivity to `api.osv.dev` unless local offline OSV databases have been pre-downloaded.
- **Live File-System Watching & Per-Asset Cron**: `scanOnFileChange` and per-asset `scheduleCron` remain marked `Planned — Not Active` in UI; scheduled scanning currently uses the global Nightly Schedule while the companion is running.
- **License Selection Pending**: No open-source license file has been selected or added yet.

---

## 12. Current Release Status

- **Current Designation**: `v0.1.0` (Pre-release / initial desktop integration baseline).
- **Verified Platform**: macOS `x86_64` (`macOS 26.7.3`, Node `v24.21.0`, Rust `1.100.0`, Tauri `2.12.x`).
- **Pending Decisions**: Repository license selection, Git repository initialization/tagging, and Apple Developer signing/notarization for public distribution.
