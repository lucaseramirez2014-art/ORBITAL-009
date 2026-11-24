# Cobalix Orbital `v0.1.0` — Release Candidate Report (`CBX-ORB-009`)

**Product:** Cobalix Orbital (`v0.1.0`)  
**Repository Target:** `cobalix/orbital` (proprietary)  
**Assessment Date:** 2026-11-23  
**Verdict:** **APPROVED FOR CONTROLLED EXTERNAL TESTING** (developer/early-tester cohort with Node.js `22.13+` / `24 LTS`); **NOT YET READY FOR PUBLIC UNATTENDED DISTRIBUTION** (awaiting Apple Developer ID signing, notarization, native arm64/Universal CI build, and self-contained runtime packaging).

---

## 1. Executive Assessment

Across **ORBITAL 007** (core security & concurrency integrity), **ORBITAL 008** (desktop runtime & SEC-007 dependency remediation), and **ORBITAL 009** (release candidate validation):

- **Core Integrity & Security**: Zero known dependency vulnerabilities (`npm audit` = `0`, `npm audit --omit=dev` = `0`). Loopback-only Companion API enforces `X-Cobalix-Token` (`0600`), Origin/Fetch-Site guards, canonical `realpath` boundary checks, redaction of detected secret patterns across findings/Chronicle/logs/exported report summaries/AI requests, explicit human approval + post-write hash verification + backup rollback in Saver, and explicit AI consent gating (`consentToSendContext`).
- **Desktop Reliability & Supervision**: Built native `Cobalix Orbital.app` (`10.98 MiB`, Intel `x86_64`) bundles self-contained `companion.mjs` (`207.9 KB`), discovers compatible `node:sqlite` runtimes across macOS paths and version managers, enforces `COBALIX_DATA_DIR` permissions/errors cleanly, never reports false `Connected` / `Ready` states when restarts fail, reconciles interrupted operations after crashes, rotates session tokens cleanly on `SIGKILL` recovery, and terminates cleanly with zero surviving children on `SIGTERM`.
- **UI Quality & Accuracy**: Fixed Command Center severity tile overflow at `1280x800` (`INFO` compact pill with `title="informational"`), unified accurate color/icon status indicators across `CommandCenterView`, `ThreatCenterView`, `RemediationView`, `AgentsView`, `ChronicleView`, `ReportsView`, and `SecurityGraphView`, and verified inactive controls (`Scan on File Change`, `Custom Schedule Cron`) stay explicitly marked `Planned — Not Active`.

---

## 2. Summary of Verification Evidence

| Verification Track | Method | Result |
| --- | --- | --- |
| Workspace Dependencies (`npm audit` & `--omit=dev`) | Automated CLI | **`0` production & `0` dev vulnerabilities** |
| Workspace Build, Bundle, Typecheck & ESLint | Automated CLI | **Passed (0 errors/warnings)** |
| Vitest Automated Suite (`vitest run`) | Automated (`node` + `jsdom`) | **`12` test files / `62 / 62` passed** |
| Rust Supervisor & IPC Suite (`cargo test`) | Automated Rust | **`8 / 8` passed** |
| Agent Integration & Privacy Suite (`tests/orbital009.test.ts`) | Automated integration (with real Gitleaks `8.30.1` & OSV-Scanner `2.7.1`) | **Passed** (clean, modified, dummy secret, `lodash@4.17.15`, TLS config, approval lock, failed verifier -> revert recovery, passed verify -> resolved, Chronicle hash chain, AI consent gate = `0` calls) |
| Browser End-to-End & `1280x800` Layout QA | Real Chromium (`http://localhost:5173` + bundled `companion.mjs`) | **Passed** (all 10 views interactive + empty/offline/`Retry` recovery + zero `1280x800` tile overflow) |
| Packaged `Cobalix Orbital.app` Lifecycle E2E | Live packaged macOS `.app` execution (`PATH=/usr/bin:/bin:/usr/sbin:/sbin`) | **Passed** (first launch `0600` token + SQLite, asset scan, persistence across `SIGTERM` restart, mid-run `SIGKILL` respawn + token rotation, clean shutdown `0` orphans) |
| Native Cocoa / WKWebView Pointer Click-Through | Not automated (no macOS WKWebView WebDriver) | **Manual QA required before public release** |

---

## 3. Remaining Release Blockers (For Public / General Release)

1. **Apple Code Signing & Notarization**: No Developer ID certificate (`security find-identity`: 0 identities); `Cobalix Orbital.app` is unsigned and un-notarized (requires Gatekeeper Right-Click -> Open on external Macs).
2. **Self-Contained Node.js Runtime Decision**: End users without Node.js `22.13+` / `24 LTS` cannot launch the companion until an architecture-matched `resources/runtime/node` sidecar (+ attribution notices) is included in signed DMG builds.
3. **Native Apple Silicon (`arm64` / `universal-apple-darwin`) Binary**: Current build targets `x86_64`; Apple Silicon Macs require Rosetta 2 unless built for `universal-apple-darwin` or `aarch64-apple-darwin`.
4. **Human Native macOS Window Click-Through Sign-Off**: Final manual walkthrough inside the native macOS Cocoa window via Finder/Dock before distributing externally.
