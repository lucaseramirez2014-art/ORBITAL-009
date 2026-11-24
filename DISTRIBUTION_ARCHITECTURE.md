# Cobalix Orbital — Distribution Architecture (`v0.1.0`)

**Project:** Cobalix Orbital (`v0.1.0`, proprietary)  
**Target Platforms:** macOS Intel (`x86_64-apple-darwin`) and Apple Silicon (`aarch64-apple-darwin`)

---

## 1. Current Verified Baseline Artifacts

| Component | Path / Target | Observed Build Output & Status |
| --- | --- | --- |
| **macOS Intel Desktop `.app`** | `apps/desktop/src-tauri/target/x86_64-apple-darwin/release/bundle/macos/Cobalix Orbital.app` | **`10.99 MiB`**, `Mach-O 64-bit executable x86_64` (`lipo -archs`: `x86_64`), **verified live** |
| **Companion ESM Sidecar** | `Contents/Resources/resources/companion/companion.mjs` | **`209.3kb`** bundled via `scripts/bundle-companion.mjs` (esbuild, external `node:*` built-ins only, zero npm runtime deps) |
| **Bundled Node Runtime Slot** | `Contents/Resources/resources/runtime/node` | Lookup + validation + SHA-256 staging script **implemented & tested**; binary omitted from host-runtime builds until release CI signs & stages verified Node 24 LTS |
| **Apple Silicon (`aarch64-apple-darwin`)** | `build:desktop:arm64` / CI workflow | Scripts & `.github/workflows/macos-distribution.yml` **prepared**; unbuilt locally (`aarch64-apple-darwin` Rust target & Apple Silicon hardware absent on this host) |
| **Signing / Notarization** | `entitlements.plist`, `entitlements.node-runtime.plist`, `tauri.conf.json` (`bundle.macOS`) | **Prepared** (`hardenedRuntime: true`, `minimumSystemVersion: "12.0"`, `signingIdentity: null`); **unsigned** locally (`0 valid identities found`) |

---

## 2. Architecture Support Strategy (`x86_64` & `aarch64`)

Cobalix Orbital uses **architecture-matched native macOS builds** (`x86_64-apple-darwin` for Intel Macs and `aarch64-apple-darwin` for Apple Silicon Macs), avoiding Universal fat-binary bloat if bundling a `~115 MiB` per-arch Node runtime (vs `~236 MiB` Universal `/usr/local/bin/node`):

- **Intel (`x86_64-apple-darwin`)**: Built and runtime-verified directly on `macOS 26.7.3` (`x86_64`). Runs on Intel natively and on Apple Silicon under macOS Rosetta 2.
- **Apple Silicon (`aarch64-apple-darwin`)**: Configured in [package.json](./package.json) (`build:desktop:arm64`, `build:desktop:arm64:bundled`) and [.github/workflows/macos-distribution.yml](./.github/workflows/macos-distribution.yml) (`macos-15` native arm64 runner). Never claim Apple Silicon native verification without running `build:desktop:arm64` and smoke-testing on arm64 hardware.
- **Native Dependencies Check**: Companion packages (`@cobalix/core`, `db`, `scanners`, `ai`, `agents`) use pure TypeScript/ESM and Node built-in `node:sqlite` — **zero custom native `.node` C++ addons**, simplifying cross-arch builds and allowing `com.apple.security.cs.disable-library-validation` to remain `false`.

---

## 3. Runtime Selection & Bundled Node.js Strategy

Runtime selection lives in `apps/desktop/src-tauri/src/lib.rs` (`resolve_bundled_node_binary`) and `apps/desktop/src-tauri/src/companion.rs` (`select_node_runtime` / `resolve_node_binary`):

1. **Bundled Sidecar First**: Probes `Contents/Resources/resources/runtime/node` (and legacy `Contents/Resources/runtime/node`).
2. **Mandatory `node:sqlite` Capability Probe**: Every candidate runtime MUST pass `node -e "import('node:sqlite')..."` (`node_supports_sqlite`) before selection — Cobalix Orbital **never silently executes on an incompatible Node 18/20 binary**.
3. **Hardened Host Fallback**: When `resources/runtime/node` is absent (default host-runtime dev/RC build) or unusable while `allow_host_node_fallback` is enabled, `resolve_node_binary()` checks `COBALIX_NODE_BIN`, `PATH`, `/usr/local/bin/node`, `/opt/homebrew/bin/node`, `/opt/local/bin/node`, `~/.local/bin/node`, `~/.volta/bin/node`, `~/.fnm/aliases/default/bin/node`, and descending `~/.nvm/versions/node/*/bin/node`.
4. **Actionable Errors**: Missing or older Node installs surface clear recovery guidance listing the failing path and `Node.js 22.13+` / `24 LTS` requirement without spawning broken children or marking state `Ready`.
5. **Runtime Telemetry**: `CompanionStatusPayload.runtimeSource` reports `"bundled"` or `"host"` for diagnostics.

### Staging Verified Node.js Binaries (`scripts/stage-node-runtime.mjs`)
- Official Node.js `v24 LTS` `.tar.gz`/`.tar.xz` archives must be verified against official `nodejs.org` `SHASUMS256.txt` via `--sha256` before extraction.
- Mismatched checksums abort immediately with zero files written.
- On success, stages executable `node` (`0755`), extracts Node's `LICENSE` into `THIRD_PARTY_NOTICES.txt` (MIT + OpenSSL/V8/zlib/ICU attribution), checks Mach-O target architecture (`file`) and `node:sqlite`, and writes `runtime-manifest.json` inside `apps/desktop/src-tauri/resources/runtime/`.
- Build using [tauri.bundled-runtime.conf.json](./apps/desktop/src-tauri/tauri.bundled-runtime.conf.json) alongside `tauri.conf.json`.

---

## 4. Companion Lifecycle & Upgrade Persistence

- **Startup & Auth**: Rust `CompanionSupervisor` creates/validates `COBALIX_DATA_DIR` (default `~/Library/Application Support/cobalix-obsidian`), clears any stale `session-token`, allocates loopback port `47890` (falling back safely to an ephemeral `127.0.0.1` port if busy), spawns `node companion.mjs` with stdin watch enabled (`COBALIX_WATCH_PARENT_STDIN=1`), waits for `0600` `session-token` + `GET /api/health` (`200`), and proxies WebView IPC (`companion_request`) with `X-Cobalix-Token`.
- **Crash Recovery**: Health-check / exit monitoring respawns up to `max_restarts: 3` times cleanly, rotating `session-token` (`401` on old tokens) and reconciling stale `running` scans/runs as `interrupted`.
- **Upgrades & Schema Migrations (`packages/db/src/database.ts`)**:
  - Replacing `Cobalix Orbital.app` never modifies `~/Library/Application Support/cobalix-obsidian/`.
  - Before applying any pending SQLite migration against an existing installation DB, `openDatabase()` runs `PRAGMA wal_checkpoint(TRUNCATE)` and writes an automatic `0600` backup (`obsidian.sqlite.pre-migration-v<ver>-<stamp>.bak`), then executes each pending migration inside a `BEGIN` / `COMMIT` / `ROLLBACK` transaction.

---

## 5. Reproducible Build Commands

| Command | Purpose |
| --- | --- |
| `npm run build` | Build all TypeScript packages (`core`, `db`, `scanners`, `ai`, `agents`, `companion`) + Vite web UI |
| `npm run build:companion:bundle` | Produce zero-dep ESM `apps/desktop/src-tauri/resources/companion/companion.mjs` (`209.3kb`) |
| `npm run build:desktop:x64` | Build macOS Intel (`x86_64-apple-darwin`) `.app` using host Node runtime discovery |
| `npm run build:desktop:arm64` | Build macOS Apple Silicon (`aarch64-apple-darwin`) `.app` using host Node runtime (requires `aarch64-apple-darwin` Rust target) |
| `npm run stage:node-runtime -- --tarball <tb> --sha256 <hex> --arch <x64\|arm64> --version <v24.x.y>` | Verify and stage Node 24 LTS + `THIRD_PARTY_NOTICES.txt` + manifest into `apps/desktop/src-tauri/resources/runtime/` |
| `npm run build:desktop:x64:bundled` | Package `x86_64-apple-darwin` `.app` including staged `resources/runtime/*` |
| `npm run build:desktop:arm64:bundled` | Package `aarch64-apple-darwin` `.app` including staged `resources/runtime/*` |
