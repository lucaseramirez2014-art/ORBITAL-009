# Cobalix Orbital `v0.1.0` — ORBITAL 010 Final Validation Report

**Milestone:** `CBX-ORB-010` — Controlled User Testing & Field Reliability  
**Product:** Cobalix Orbital (`v0.1.0`)  
**Assessment Date:** 2026-11-23  
**Final Determination:** **`READY WITH DOCUMENTED RESTRICTIONS`**

---

## 1. Executive Summary

**ORBITAL 010** prepared **Cobalix Orbital `v0.1.0`** for its first controlled external technical macOS testing cohort through baseline re-verification, usability and privacy hardening, stress/edge-case field reliability testing, live packaged `.app` smoke verification, and tester onboarding documentation.

### Key Fixes Implemented in ORBITAL 010
1. **Asset Removal Confirmation Guard (`AssetExplorerView.tsx`)**: Replaced immediate single-click asset deletion with an inline **`Confirm Asset Removal`** bar (`Confirm Remove` / `Cancel`) clearly stating that local disk files remain untouched and Chronicle history is preserved.
2. **Sanitized Diagnostic Exports (`exportSanitizer.ts`, `ChronicleView.tsx`, `ReportsView.tsx`, `fileTree.ts`)**: Added browser-safe diagnostic sanitization redacting secret patterns (`ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_`, `sk-`, `sk-ant-`, `AKIA`, `Bearer`, PEM private keys, generic secret assignments) and private local host paths (`/Users/...`, `/private/var/...`, `/home/...`, `C:\Users\...`, `canonicalPath`, `backupPath`, `rootPath`) while preserving relative `src/*` project paths and clearly distinguishing sanitized exports from local SQLite logs.

---

## 2. Verified Quantitative Evidence

| Verification Gate | Exact Observed Result |
| --- | --- |
| **Dependency Security (`npm audit` & `--omit=dev`)** | **`0` vulnerabilities** (production & development) |
| **Workspace Build & Companion Bundle** | `npm run build` passed (`1598` Vite modules, `SecurityGraphView` code-split); `companion.mjs` = `207.9kb` |
| **Typecheck & ESLint** | `npm run typecheck` passed (`0` errors); `npm run lint` passed (`0` errors) |
| **Vitest Automated Suite (`npm test`)** | **`13` test files / `68 / 68` tests passed** (includes `tests/orbital010.test.ts` [`4` tests] & `tests/frontend.test.tsx` [`15` tests]) |
| **Rust Supervisor & IPC Suite (`cargo test`)** | **`8 / 8` passed** (`companion::tests::*`) |
| **macOS Desktop Bundle (`npm run build:desktop`)** | Built `Cobalix Orbital.app` (`10.99 MiB`, `Mach-O 64-bit executable x86_64`) |
| **Empty & 500-File Synthetic Stress Tests** | Empty scan `completed` (`0` files); `500` nested `.ts` files inventoried cleanly + Security Graph bounded at `150` nodes (`truncated: true`, `totalNodesAvailable >= 501`) |
| **Live Packaged `.app` Lifecycle Smoke Test** | Fresh launch (`PATH=/usr/bin:/bin:/usr/sbin:/sbin`, isolated `COBALIX_DATA_DIR`), `0600` `session-token`, SQLite persistence across `SIGTERM` restart, mid-run `SIGKILL` auto-respawn + token rotation (`401` old / `200` new), clean exit (`0` surviving children) |
| **Temporary Directory Hygiene** | `test_tmp_leftovers: []` (`os.tmpdir()` free of leaked `cobalix-*` or `orbital-*` directories) |
| **Native Cocoa / WKWebView Pointer Click-Through** | **`MANUAL_PENDING`** — Tauri lacks an automated WKWebView WebDriver server on macOS; must be executed manually by human reviewer before invite using [CONTROLLED_TESTING_GUIDE.md](./CONTROLLED_TESTING_GUIDE.md) |

---

## 3. Controlled Testing Kit Deliverables

- [CONTROLLED_TESTING_GUIDE.md](./CONTROLLED_TESTING_GUIDE.md) — Audience, requirements, Gatekeeper steps, safe synthetic sandbox script, 10-view test flow, manual WKWebView QA checklist, limitations, and safe bug reporting rules.
- [TESTER_FEEDBACK_TEMPLATE.md](./TESTER_FEEDBACK_TEMPLATE.md) — Structured feedback template with explicit warning against sharing `obsidian.sqlite`, `session-token`, `credentials.json`, or raw secrets.
- [FIELD_TEST_RESULTS.md](./FIELD_TEST_RESULTS.md) — Complete ORBITAL 010 test matrix, discovered issues, fixes applied, and live `.app` smoke evidence.
- [RELEASE_CHECKLIST.md](./RELEASE_CHECKLIST.md) — Updated release readiness checklist (`CBX-ORB-009` -> `CBX-ORB-010`).
- [INSTALLATION_GUIDE.md](./INSTALLATION_GUIDE.md) — Updated with asset removal confirmation behavior, sanitized diagnostic export behavior, and tester links.

---

## 4. Final Readiness Determination & Documented Restrictions

**Determination:** **`READY WITH DOCUMENTED RESTRICTIONS`**

Cobalix Orbital `v0.1.0` is ready for invited **controlled external testing by technical macOS testers**, subject to the following explicit restrictions:

1. **Manual Cocoa / WKWebView Sign-Off Required Before Cohort Send**: Run the quick 4-step manual Finder -> Right-Click -> Open -> 10-tab pointer click-through -> `Cmd+Q` verification described in [CONTROLLED_TESTING_GUIDE.md](./CONTROLLED_TESTING_GUIDE.md) (`MANUAL_PENDING` because WKWebView WebDriver is unavailable on macOS).
2. **Unsigned & Non-Notarized macOS App**: External testers must use Finder **Right-Click -> Open** (or Privacy & Security approval) until Apple Developer ID signing and notarization are provisioned.
3. **Host Node.js `22.13+` (`24 LTS` Recommended) Prerequisite**: Current `v0.1.0` bundle requires a compatible host `node` runtime with `node:sqlite` (bundled sidecar is deferred to signed DMG distribution).
4. **Intel `x86_64` Binary Architecture**: Apple Silicon (`arm64`) tester Macs require macOS Rosetta 2 until universal/arm64 CI builds are produced.
5. **Known `v0.1.0` Scope Boundaries Remain Active**: Per-asset `Scan on File Change` and `Custom Schedule Cron` stay disabled (`Planned — Not Active`), global Nightly Scan triggers only while the desktop app remains open, Security Graph AST extraction covers JS/TS extensions, and public/unattended consumer release requires Developer ID signing, notarization, DMG packaging, and clean-machine verification.
