# Cobalix Orbital — Installation, Upgrade & First-Launch Guide (`v0.1.0`)

---

## 1. What Cobalix Orbital Does

**Cobalix Orbital** is a local-first cybersecurity monitoring, file integrity, and human-approved remediation desktop application for local code repositories and computer folders:
- **File Intelligence** tracks file inventories, SHA-256 integrity baselines, likely renames, diffs, and JS/TS import relationships.
- **Nightwatch** orchestrates built-in static inspection alongside optional external CLI scanners (`gitleaks`, `osv-scanner`, `npm audit`, `eslint`) to surface deduplicated security findings.
- **Saver** explains findings, generates exact unified diffs, requires explicit human approval before writing any file, backs up originals (`0600`), verifies fixes with the originating scanner, and supports rollback (`Revert Backup`).
- **Chronicle** records an append-only, SHA-256 hash-chained audit trail across scans, findings, approvals, baseline updates, and crashes.

---

## 2. Folder Access & Security Boundaries

Cobalix Orbital **never scans your entire computer**.
- It reads and inspects **only** folders you explicitly authorize in **Asset Explorer**.
- Symlinks pointing outside an authorized asset root are blocked (`PathBoundaryError`) and listed in skipped locations.
- Excluded patterns (default: `node_modules`, `.git`, `dist`, `build`, `.next`, `coverage`, `.turbo`, `target`) are skipped by both File Intelligence hashing and Nightwatch scanners.
- Optional AI assistance is **disabled by default** (`provider: none`). External providers receive redacted snippets only when explicitly enabled **and** consented to in **Settings**.

---

## 3. System & Runtime Prerequisites

### Supported macOS Platforms
- **Minimum macOS Version:** macOS `12.0` (configured in `tauri.conf.json`).
- **Intel Macs (`x86_64`)**: Natively built and verified (`x86_64-apple-darwin`).
- **Apple Silicon Macs (`arm64`)**: Current `v0.1.0` local build targets `x86_64` and runs via macOS **Rosetta 2** until native `aarch64-apple-darwin` CI release builds are packaged (see [DISTRIBUTION_ARCHITECTURE.md](./DISTRIBUTION_ARCHITECTURE.md)).

### Runtime Resolution Behavior (Bundled Runtime Slot + Host Node.js Fallback)
Cobalix Orbital's local companion (`companion.mjs`) uses Node's built-in `node:sqlite` module (`Node.js 22.13+` / `24 LTS` required; older `v18`/`v20` builds are rejected).

On startup, the desktop supervisor resolves Node deterministically (`select_node_runtime`):
1. **Bundled Sidecar Runtime (When Present)**: Checks `Contents/Resources/resources/runtime/node` inside the `.app` bundle and validates `node:sqlite` support. (Standard `v0.1.0` RC builds leave this slot empty to stay `~10.99 MiB`; future signed CI builds may ship a SHA-256-verified Node 24 LTS sidecar with `THIRD_PARTY_NOTICES.txt`.)
2. **Host Runtime Fallback**: If no valid bundled sidecar is present, searches:
   - `COBALIX_NODE_BIN` environment override (if set)
   - `PATH`, `/usr/local/bin/node`, `/opt/homebrew/bin/node`, `/opt/local/bin/node`
   - `~/.local/bin/node`, `~/.volta/bin/node`, `~/.fnm/aliases/default/bin/node`, and descending `~/.nvm/versions/node/*/bin/node`

To verify your Mac's Node runtime manually in Terminal:
```bash
node -v
node -e "import('node:sqlite').then(() => console.log('node:sqlite OK'))"
```

### Built-In vs. Optional CLI Scanners
- **Built-In (Work Out of the Box)**: File Intelligence SHA-256 integrity/diffs, AST dependency extraction (JS/TS), `obsidian-static-inspector`, Saver diffing/patching, and Chronicle.
- **Optional External Scanners** (detected automatically or configured in **Settings**):
  - **Gitleaks**: `brew install gitleaks`
  - **OSV-Scanner** (requires internet for `api.osv.dev` unless using offline OSV DBs): `brew install osv-scanner`
  - **npm** (`npm audit`): bundled with Node.js (queries npm registry)
  - **ESLint**: project or global `eslint`

Missing optional scanners display cleanly as **Not Installed** and never interrupt or crash scans.

---

## 4. First Launch, Project Workflow & Upgrades

### Opening Unsigned Controlled Builds
Current `v0.1.0` local bundles are **unsigned and not notarized** (`code object is not signed at all`):
1. Copy **`Cobalix Orbital.app`** into `/Applications` (or run from a trusted local folder).
2. **Right-Click (Control-click) `Cobalix Orbital.app` -> Open** -> confirm **Open** (or approve in **System Settings -> Privacy & Security**).
3. Wait for the sidebar footer to display **`Companion · Connected`** (green).

### Registering & Removing Projects
1. Open **Asset Explorer** -> enter Display Name, Type (`Repository` / `Folder`), and local path -> click **Authorize Asset**.
2. Click **Run Nightwatch** to establish initial baselines and scan files.
3. Removing an asset via the trash button opens an inline **Confirm Asset Removal** prompt requiring **Confirm Remove**; this clears tracked files, baselines, and findings for that asset in SQLite while **leaving local files on disk untouched** and preserving Chronicle history.

> **Planned Controls (`v0.1.0`)**: Per-asset **Scan on File Change** and **Custom Schedule Cron** are intentionally disabled and marked **`Planned — Not Active`**. The global **Enable Nightly Scheduled Scan** in **Settings** runs daily while the app stays open.

> **Controlled Testers**: Follow [CONTROLLED_TESTING_GUIDE.md](./CONTROLLED_TESTING_GUIDE.md) for a safe synthetic sandbox script and [TESTER_FEEDBACK_TEMPLATE.md](./TESTER_FEEDBACK_TEMPLATE.md) for reporting bugs safely.

### Upgrading or Reinstalling Without Data Loss
Upgrading or reinstalling `Cobalix Orbital.app` preserves all user data cleanly:
- Application data is stored outside the `.app` bundle under `~/Library/Application Support/cobalix-obsidian/` (or `$COBALIX_DATA_DIR`).
- Simply quit **Cobalix Orbital** (`Cmd+Q`), replace `Cobalix Orbital.app` with the newer version, and relaunch.
- Existing `obsidian.sqlite`, `backups/`, `credentials.json`, and Keychain entries are **never deleted** on upgrade or reinstall.
- Whenever a newer version adds SQLite schema migrations against an existing database, Cobalix Orbital checkpoints the WAL first (`PRAGMA wal_checkpoint(TRUNCATE)`) and writes an automatic `0600` pre-migration snapshot (`obsidian.sqlite.pre-migration-v<ver>-<timestamp>.bak`) before running transactional migrations (rolling back atomically on any SQL error).
- `session-token` (`0600`) rotates automatically on every launch and is deleted on clean exit.

---

## 5. Where Application Data Is Stored

- **macOS Path**: `~/Library/Application Support/cobalix-obsidian/` (or `$COBALIX_DATA_DIR`)
  - `obsidian.sqlite`: Local SQLite WAL database (assets, files, baselines, scans, findings, patches, Chronicle events, settings).
  - `obsidian.sqlite.pre-migration-v*.bak`: `0600` pre-upgrade snapshots created automatically before schema migrations.
  - `session-token`: Ephemeral `0600` per-session API authentication token.
  - `backups/`: `0700` directory holding `0600` pre-patch `.bak` backups.
  - `credentials.json`: `0600` fallback credential file used only if macOS Keychain is unavailable.
- **Sanitized Diagnostic Exports**: **Export Sanitized JSON** (Chronicle) and **Export Sanitized Report** (Reports) redact private local paths and secret patterns so bug reports can be shared safely while keeping full logs strictly local.

---

## 6. Troubleshooting

| Error / Symptom | Likely Cause | How to Recover |
| --- | --- | --- |
| **"Compatible Node.js runtime (v22.13+ or v24 LTS with node:sqlite) was not found"** | No bundled sidecar and Node.js is missing from `PATH`, Homebrew, nvm, Volta, and fnm. | Install **Node.js 24 LTS** (or `>= 22.13`) from `https://nodejs.org` or `brew install node`, then click **Restart Companion**. |
| **"lacks built-in node:sqlite support"** | System has an older Node.js install (`v18`/`v20`). Cobalix refuses incompatible runtimes rather than failing unpredictably. | Upgrade default Node to `24 LTS` (or set `COBALIX_NODE_BIN` to a `v24` binary) and click **Restart Companion**. |
| **"Bundled Node.js runtime unusable ... Host fallback also failed"** | Packaged `resources/runtime/node` binary failed validation and no compatible host Node exists. | Reinstall a valid `.app` build or install Node.js 24 LTS on the host and restart. |
| **"Companion status: Disconnected / Failed"** | Companion crashed unexpectedly or exhausted 3 bounded restarts. | Inspect the error banner and click **Restart Companion**. |
| **"Failed creating or accessing app data directory"** | `~/Library/Application Support/cobalix-obsidian` (or `COBALIX_DATA_DIR`) is unwritable or blocked by a file. | Fix folder permissions or point `COBALIX_DATA_DIR` to a writable directory and relaunch. |
| **External scanner shows `Not Installed`** | `gitleaks`, `osv-scanner`, or `eslint` is not installed. | Install via Homebrew/npm or specify the absolute binary path under **Settings -> External Scanner Binary Discovery**. |
