# Cobalix Orbital `v0.1.0` — Release Candidate Checklist

**Milestones:** `CBX-ORB-009` -> `CBX-ORB-010` (`v0.1.0`)  

---

## A. Completed for Controlled External Testing (`v0.1.0`)

- [x] **Core Integrity & Hardening (ORBITAL 007)**: Symlink cycle guard, `64 KiB` streaming hashing, per-asset/per-patch concurrency locks, `0700`/`0600` backups & hash-checked revert, Chronicle recursive redaction & sequence contiguity checks, AI protocol/redaction validation, macOS Keychain `security -i` stdin write & `0600` fallback.
- [x] **Dependency Security (`SEC-007`)**: Upgraded `vitest` to `^4.1.12` and deduplicated `vite@6.4.6`; verified **`npm audit` = `0` vulnerabilities** and **`npm audit --omit=dev` = `0` vulnerabilities**.
- [x] **Workspace Build & Static Verification**: `npm run build`, `npm run build:companion:bundle` (`207.9kb`), `npm run typecheck`, `npm run lint` (`0` errors).
- [x] **ORBITAL 010 Field Reliability & Tester Safety**:
  - [x] Added explicit inline confirmation guard (`confirmRemoveId`) for destructive asset removal in `AssetExplorerView.tsx` (disk files untouched, Chronicle history preserved).
  - [x] Added browser-safe diagnostic export sanitizer (`exportSanitizer.ts`) redacting private host paths (`/Users/...`, `/private/var/...`, `/home/...`, `C:\Users\...`) and secret patterns across Chronicle JSON (`Export Sanitized JSON`), Markdown reports (`Export Sanitized Report`), and file metadata exports, with explicit notices distinguishing sanitized exports from local SQLite logs.
  - [x] Verified empty project handling, `500`-file nested project inventory + `150`-node Security Graph truncation (`truncated: true`), and Chronicle integrity preservation after unreadable-directory errors and patch reverts (`tests/orbital010.test.ts`).
- [x] **Full Automated Test Suites**:
  - [x] `npm test` (`vitest run`): **`13` test files / `68 / 68` tests passed** (including `tests/orbital010.test.ts` and `15` UI interaction tests in `tests/frontend.test.tsx`).
  - [x] `cargo test`: **`8 / 8` Rust Cargo tests passed** (supervision, port fallback, IPC bridge, token redaction, false-`Ready` fix, missing/incompatible Node & unwritable dir guidance, `SIGKILL` recovery).
- [x] **Desktop UI Layout & Consistency Polish**:
  - [x] Fixed `INFO` severity pill fit at `1280x800` inside `CommandCenterView` (zero tile overflow verified in real Chromium).
  - [x] Accurate color/icon states across all 10 views (`failed`/`completed_with_errors`/`interrupted`/`running`/`completed`).
  - [x] Inactive features (`Scan on File Change`, `Custom Schedule Cron`) explicitly labeled `Planned — Not Active`.
- [x] **Packaged `Cobalix Orbital.app` Live Verification**:
  - [x] Rebuilt `Cobalix Orbital.app` (`10.99 MiB`, `Mach-O 64-bit x86_64`).
  - [x] Verified fresh launch (`COBALIX_DATA_DIR`, stripped `PATH`), `0600` `session-token`, SQLite creation, authenticated & unauthenticated routes, scan execution, SQLite persistence across `SIGTERM` restart, live `SIGKILL` companion respawn + token rotation, clean shutdown (`0` surviving child processes), and clean `os.tmpdir()` (`test_tmp_leftovers: []`).
- [x] **User, Release & Controlled Testing Documentation Completed**:
  - [x] `INSTALLATION_GUIDE.md`
  - [x] `CONTROLLED_TESTING_GUIDE.md`
  - [x] `TESTER_FEEDBACK_TEMPLATE.md`
  - [x] `FIELD_TEST_RESULTS.md`
  - [x] `ORBITAL_010_FINAL_REPORT.md`
  - [x] `RELEASE_CANDIDATE_REPORT.md`
  - [x] `NATIVE_MACOS_QA.md`
  - [x] `DISTRIBUTION_ARCHITECTURE.md`
  - [x] `PRODUCT_LIMITATIONS.md`

---

## B. Remaining Gates Before Broad Public / Commercial Distribution

- [ ] **Human Native Cocoa / WKWebView Window Walkthrough**: Manual Finder launch -> click through all 10 tabs in macOS WKWebView -> verify `Cmd+Q` leaves zero companion processes.
- [ ] **Apple Developer ID Signing & Hardened Runtime**: Enroll/provision Developer ID Application certificate, sign `Cobalix Orbital.app` (and any bundled runtime).
- [ ] **Apple Notarization & Stapling**: Run `xcrun notarytool submit` and `xcrun stapler staple`; verify `spctl --assess -vvv` acceptance.
- [ ] **Architecture-Matched Bundled Node 24 LTS Sidecar**: Bundle `resources/runtime/node` (`arm64` & `x86_64`) + attribution `THIRD_PARTY_NOTICES.txt` if targeting users without Node pre-installed.
- [ ] **DMG Packaging & Clean Machine Verification**: Package `--bundles dmg,app` (`hdiutil` / Tauri DMG) and verify Gatekeeper launch on both clean Apple Silicon (`arm64`) and Intel (`x86_64`) Macs.
