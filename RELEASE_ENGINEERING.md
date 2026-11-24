# Cobalix Orbital — Release Engineering Report

**Product:** Cobalix Orbital (`v0.1.0`, mission `CBX-ORB-008`)  
**Target Platform Focus:** macOS (Intel `x86_64` verified; Apple Silicon compatibility analyzed)  
**Assessment Date:** 2026-11-23  

---

## 1. Node.js Runtime Strategy Evaluation (Bundled vs. Host Runtime)

Cobalix Orbital's security companion (`companion.mjs`, `207.9 KB` bundled JS sidecar) relies on Node.js built-in modules including `node:sqlite`, `node:crypto`, `node:http`, and `node:child_process`.

### Technical Evaluation

| Criterion | Current Host Runtime (+ Fallback Discovery) | Bundled Node.js Sidecar (`resources/runtime/node`) |
| --- | --- | --- |
| **Version & `node:sqlite` Compatibility** | Depends on host install; `resolve_node_binary()` now verifies `node_supports_sqlite()` on each candidate (`PATH`, `/usr/local/bin/node`, `/opt/homebrew/bin/node`, `/opt/local/bin/node`, `~/.local/bin/node`, `~/.volta`, `~/.fnm`, descending `~/.nvm`) and reports actionable recovery guidance if only legacy Node (`<22.5` / without `node:sqlite`) exists. | Guaranteed compatible Node 24 LTS (`node:sqlite` built-in); zero mismatch with older developer toolchains (e.g. Node 18/20). |
| **macOS Intel `x86_64` Support** | Works natively with existing Intel or Universal macOS Node installs (`v24.21.0` verified). | Requires shipping either an `x86_64` slice (~115–120 MB) matching an `x86_64` app build or a Universal `x86_64`+`arm64` binary (~236 MB measured for host `/usr/local/bin/node`). |
| **Packaging Size Impact** | Current `Cobalix Orbital.app` bundle is **`10.98 MiB`**. | Increases `.app` / `.dmg` download footprint by ~120 MB (single-arch) to ~240 MB (Universal). |
| **Licensing & Redistribution** | No third-party runtime binary redistributed inside `.app`. | Node.js core is MIT-licensed, but the compiled binary statically includes V8, OpenSSL, ICU, zlib, libuv, and nghttp2, requiring inclusion of Node.js `LICENSE` / third-party attribution notices inside the distributed bundle. |
| **Tauri Integration & Fallback** | Implemented in `apps/desktop/src-tauri/src/lib.rs` and `companion.rs` (`resolve_bundled_node_binary` + host `resolve_node_binary` fallback). | `lib.rs` now automatically prefers `Contents/Resources/resources/runtime/node` (or `runtime/node`) when present and falls back cleanly to host Node discovery when omitted. |
| **Security Maintenance & Updates** | End users receive Node/OpenSSL patches through OS/Homebrew/nvm upgrades without rebuilding Orbital. | Every OpenSSL/Node CVE requires rebuilding and redistributing Cobalix Orbital, plus code-signing & notarizing the embedded runtime executable. |
| **Startup Latency** | Adds one `node -e "import('node:sqlite')..."` probe (~30–50ms once per companion launch). | Similar or slightly slower first launch due to macOS Gatekeeper / notarization verification on a large embedded executable. |

### Engineering Recommendation

1. **Retain the hardened host-discovery runtime for `v0.1.0` source/developer builds**, keeping `Cobalix Orbital.app` lightweight (`10.98 MiB`) while enforcing `node:sqlite` compatibility (`node_supports_sqlite`) and multi-path GUI discovery (`COBALIX_NODE_BIN`, `PATH`, system paths, Volta, fnm, nvm).
2. **Adopt a release-pipeline-only bundled Node 24 LTS sidecar (`resources/runtime/node`) for public end-user DMG releases** once Apple Developer ID code-signing and automated CI builds are in place:
   - `lib.rs` (`resolve_bundled_node_binary`) is already wired to consume `resources/runtime/node` automatically without losing host-runtime compatibility when absent.
   - Ship architecture-matched bundles (`x86_64-apple-darwin` DMG and `aarch64-apple-darwin` DMG) rather than a 236 MB Universal fat runtime where practical, alongside Node's `LICENSE` attribution file.

---

## 2. macOS Distribution Readiness Assessment

### Host & Artifact Observations
- **Built Host**: macOS `26.7.3` (`Darwin Kernel 25.6.0`, `RELEASE_X86_64`).
- **Built Application Bundle**: `apps/desktop/src-tauri/target/release/bundle/macos/Cobalix Orbital.app` (`10.98 MiB`).
- **Main Executable Architecture**: `file` confirms `Contents/MacOS/cobalix-obsidian` is `Mach-O 64-bit executable x86_64`.
- **Bundled Sidecar**: `Contents/Resources/resources/companion/companion.mjs` (`207.9 KB` ESM bundle, zero external npm dependencies).

### Checklist Status

| Release Requirement | Current Status | Notes & Gaps |
| --- | --- | --- |
| **Apple Developer ID Certificate** | **Missing (Blocker)** | `security find-identity -v -p codesigning` reports `0 valid identities found`. |
| **Code Signing (`codesign`)** | **Unsigned (Blocker)** | `codesign -dvvv "Cobalix Orbital.app"` reports `code object is not signed at all`. |
| **Apple Notarization (`notarytool`)** | **Not Run (Blocker)** | Unsigned `.app` cannot be notarized or stapled; Gatekeeper will block first launch from internet downloads until signed & notarized. |
| **Intel macOS (`x86_64`) Support** | **Verified Native** | Compiled binary is native `x86_64`; host Node `v24.21.0` is Universal (`x86_64` + `arm64`). Runs on Apple Silicon only via Rosetta 2 unless cross-compiled with `--target universal-apple-darwin` or `aarch64-apple-darwin`. |
| **Tauri Bundle Config (`tauri.conf.json`)** | **Configured (`v0.1.0`)** | `productName: "Cobalix Orbital"`, `version: "0.1.0"`, resources include `companion.mjs`, window min size `1024x700` (default `1440x900`). |
| **Internal Identifiers (`cobalix-obsidian`)** | **Preserved** | App bundle identifier (`com.cobalix.obsidian`), binary name (`cobalix-obsidian`), and data dir (`~/Library/Application Support/cobalix-obsidian`) intentionally retain Obsidian-era identifiers for database & Keychain compatibility. |
| **Application Icons (`apps/desktop/src-tauri/icons`)** | **Complete** | Includes `icon.icns` (`208,707 B`, `ic14` retina slots), `icon.ico` (`35,865 B`), `icon.png` (`512x512`), `128x128@2x.png`, `128x128.png`, `32x32.png`, `64x64.png`, and mobile/store variants. |
| **Installer Format** | **`.app` only in dev script** | `package.json` `build:desktop` runs `--bundles app`; change to `--bundles dmg,app` when producing signed installers. |
| **Auto-Update Strategy** | **Manual replacement** | No `tauri-plugin-updater` endpoint or signing keys exist in `v0.1.0` (consistent with strict zero-hosted-infrastructure policy). |

---

## 3. Unresolved Release Blockers (Before Public Distribution)

1. **Developer ID Application Certificate & Hardened Runtime Signing** (`codesign --options runtime` for both `.app` and any future bundled `node` sidecar with appropriate entitlements).
2. **Apple Notarization & Stapling** (`xcrun notarytool submit` + `xcrun stapler staple`).
3. **End-User Node.js Bundling Decision**: Public non-developer macOS downloads should either include a signed `resources/runtime/node` (`v24 LTS`) sidecar or clearly gate installation/launch on the macOS `.pkg`/Homebrew Node 24 LTS prerequisite documented in `INSTALLATION_GUIDE.md`.
4. **Native Apple Silicon (`aarch64-apple-darwin` / Universal) CI Build** if native arm64 execution without Rosetta 2 is required.
