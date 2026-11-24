# Cobalix Orbital `v0.1.0` — Native macOS Qualification Report (`CBX-ORB-011`)

**Verified Build Artifact:** `apps/desktop/src-tauri/target/x86_64-apple-darwin/release/bundle/macos/Cobalix Orbital.app` (`10.99 MiB`, `Mach-O 64-bit x86_64`)  
**Signing State:** Unsigned (`code object is not signed at all`; Hardened Runtime + `entitlements.plist` prepared in `tauri.conf.json`)  
**Host OS Verified:** macOS `26.7.3` (`Darwin 25.6.0` `x86_64`)  

---

## 1. Verification Layer Separation (Strict Honesty Policy)

| Layer | What Was Executed & Observed | Status |
| --- | --- | --- |
| **1. Automated Chromium & JSDOM UI** | `tests/frontend.test.tsx` (`15/15` tests passing in Vitest + JSDOM) and ORBITAL 009 Chromium E2E across all 10 views (`1280x800` responsive layout, DiffViewer, History/Relationships, Threat Center -> Saver flow, Settings, ErrorBoundary recovery, inline Remove confirmation, sanitized Chronicle/Markdown exports). | **PASS** |
| **2. Packaged `.app` Runtime, IPC & Lifecycle Smoke** | Rebuilt `x86_64-apple-darwin` `Cobalix Orbital.app` (`10.99 MiB`) and executed `cobalix-obsidian` under stripped GUI environment (`PATH=/usr/bin:/bin:/usr/sbin:/sbin`, isolated `COBALIX_DATA_DIR`), plus `cargo test` (`10/10`) and `tests/orbital011.test.ts` (`5/5`). Verified first launch (`0600` `session-token`, SQLite init), unauth `401`, scan `completed`, persistence across `SIGTERM` restart, mid-run `SIGKILL` crash respawn + token rotation, pre-migration `0600` backup & rollback, bundled Node fixture (`runtime_source: "bundled"`) & fallback (`runtime_source: "host"`), and `0` surviving children. | **PASS** |
| **3. Native Cocoa / WKWebView Interactive Pointer Walkthrough** | Human pointer clicking, resizing, scrolling, Finder **Right-Click -> Open**, and native menu **`Cmd+Q`** inside the visible macOS Cocoa desktop window (`tauri-driver` does not support macOS WKWebView). | **MANUAL_PENDING** |
| **4. Native Apple Silicon (`arm64`) Execution & Signed Gatekeeper** | Building native `aarch64-apple-darwin` (`rustup` `aarch64-apple-darwin` target not installed locally; no Apple Silicon hardware) and `spctl --assess -vvv` Gatekeeper acceptance (requires Apple Developer ID cert & notarization). | **BLOCKED** |

---

## 2. Native macOS Qualification Checklist

| # | Verification Item | Expected Outcome | Result | Scope / Evidence |
| --- | --- | --- | --- | --- |
| **1** | **Finder Application Launch (Unsigned)** | App launches via Right-Click -> Open cleanly without quarantine hang after user trust approval | **MANUAL_PENDING** | Human Finder QA step required on target Mac before external invite |
| **2** | **First-Launch Data & Token Initialization** | Creates `COBALIX_DATA_DIR`, `obsidian.sqlite`, and `0600` `session-token`; rejects unauthenticated requests (`401`) | **PASS** | Verified live on `x86_64` `.app` (`port 54931`, `tokenMode: 600`, `401` unauth) |
| **3** | **Bundled Node Fixture vs Host Runtime Discovery** | Prefers valid `resources/runtime/node` (`runtime_source: "bundled"`), validates `node:sqlite`, falls back cleanly only to compatible host Node, surfaces clear errors when incompatible | **PASS** | Verified in `cargo test` (`10/10`: `uses_compatible_bundled_node_runtime_fixture...` & `falls_back_from_incompatible_bundled_runtime...`) |
| **4** | **All 10 Views Rendered & Interactive (Chromium/JSDOM)** | Command Center, Asset Explorer, File Intelligence, AI Agents, Threat Center, Remediation, Security Graph, Chronicle, Reports, Settings render accurately without console crashes or layout overflow | **PASS** | Verified in Chromium E2E + `tests/frontend.test.tsx` (`15/15` passed) |
| **5** | **All 10 Views Pointer Click, Resize (`1024x700`–`1440x900`) & Scroll in Cocoa WKWebView** | Live trackpad scrolling, window resize bounds, button hovers, modal dialogs, and CSS inside macOS WKWebView render identically | **MANUAL_PENDING** | Must be walked manually in macOS Cocoa window before cohort send |
| **6** | **Destructive Confirmation Dialogs & Exports** | `AssetExplorer` requires `Confirm Remove` before asset deletion (disk untouched); Chronicle/Reports export `[REDACTED_PATH]` / `[REDACTED:*]` sanitized copies | **PASS** | Verified in `tests/frontend.test.tsx` & `tests/orbital010.test.ts` |
| **7** | **Normal Shutdown (`SIGTERM` / `Cmd+Q`) & Clean Child Exit** | Companion terminates cleanly with `session-token` removed and `0` surviving child processes | **PASS** (`SIGTERM`) / **MANUAL_PENDING** (`Cmd+Q`) | `SIGTERM` clean exit (`survivingChildren: 0`) verified live; `Cmd+Q` menu exit requires human check |
| **8** | **Relaunch After Shutdown & SQLite Persistence** | Relaunching app against existing `dataDir` preserves assets, files, findings, Chronicle hash chain, and `0600` credentials while rotating `session-token` | **PASS** | Verified live on `x86_64` `.app` (`relaunchPort: 54939`, `persistedAssets: 1`) & `tests/orbital011.test.ts` |
| **9** | **Mid-Run Companion Crash Recovery (`SIGKILL`)** | Rust supervisor detects dead child, respawns companion cleanly, rotates `session-token`, invalidates stale token (`401` -> `200`) | **PASS** | Verified live (`killed 62304` -> `respawned 62336`, `tokenRotated: true`) & `cargo test` |
| **10** | **Schema Upgrade & Rollback Safety** | Opening older schema DB checkpoints WAL and creates `obsidian.sqlite.pre-migration-v*-*.bak` (`0600`) before applying migrations; broken migration rolls back atomically | **PASS** | Verified in `tests/orbital011.test.ts` (`5/5` passed) |
| **11** | **Native `aarch64-apple-darwin` Build & Verification** | Native Apple Silicon binary compiles and runs natively without Rosetta 2 | **BLOCKED** | Local Intel host lacks `aarch64-apple-darwin` target & Apple Silicon hardware; CI matrix template added |
| **12** | **Developer ID Signing, Notarization & Gatekeeper (`spctl`)** | `codesign --verify`, `xcrun notarytool submit`, `xcrun stapler staple`, `spctl --assess -vvv` pass | **BLOCKED** | Zero Developer ID certificates on host (`0 valid identities found`) |

---

## 3. Manual Native macOS QA Procedure (Required Pre-Release Step)

Perform these steps directly inside macOS Finder / the native window on a clean test macOS account:

1. Locate [Cobalix Orbital.app](file:///Users/lucasramirez/Desktop/Cobalix/apps/desktop/src-tauri/target/x86_64-apple-darwin/release/bundle/macos/Cobalix%20Orbital.app).
2. Right-click (Control-click) -> **Open** -> confirm Gatekeeper prompt.
3. Verify the native Cocoa window opens at `1440x900`, resize cleanly down to `1024x700`, and confirm the sidebar footer turns green: **`Companion · Connected`**.
4. Register a synthetic sandbox project (see [CONTROLLED_TESTING_GUIDE.md](./CONTROLLED_TESTING_GUIDE.md)), run Nightwatch, inspect all **10 views** (`Command Center`, `Asset Explorer`, `File Intelligence`, `AI Agents`, `Threat Center`, `Remediation`, `Security Graph`, `Chronicle`, `Reports`, `Settings`), test DiffViewer mode toggles, Approve/Apply/Revert a patch, test **Confirm Remove / Cancel**, and test sanitized JSON/Markdown exports.
5. Press **`Cmd+Q`** to quit, then check Terminal:
   ```bash
   ps aux | grep companion.mjs | grep -v grep
   ```
   Confirm no companion process survives, then relaunch from Finder and verify all saved assets/findings remain visible.
