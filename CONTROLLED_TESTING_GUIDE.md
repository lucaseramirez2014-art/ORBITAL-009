# Cobalix Orbital `v0.1.0` — Controlled External Testing Guide

**Milestone:** `CBX-ORB-010`  
**Audience:** Invited technical macOS testers (developers, security engineers, early cohort evaluators)

---

## 1. Who Should Participate in Controlled Testing

This `v0.1.0` cohort build is intended for **technical macOS testers** who are comfortable:
- Approving an unsigned, non-notarized local macOS `.app` bundle via Finder (**Right-Click -> Open**).
- Verifying or installing **Node.js `22.13+` (`24 LTS` recommended)** with built-in `node:sqlite`.
- Testing against **safe synthetic or disposable local projects** before connecting important repositories.

It is **not yet packaged** for non-technical consumer plug-and-play installation (broad distribution awaits Apple Developer ID signing, notarization, DMG packaging, and a bundled Node runtime sidecar).

---

## 2. System Requirements

- **OS:** macOS on Intel (`x86_64`) or Apple Silicon (`arm64` with macOS **Rosetta 2** installed; tested on macOS `26.7.3` `x86_64`).
- **Required Runtime:** Node.js **`v22.13+` or `24 LTS`** with built-in `node:sqlite`. Check in Terminal:
  ```bash
  node -v
  node -e "import('node:sqlite').then(() => console.log('node:sqlite OK'))"
  ```
- **Optional CLI Scanners** (not required for core functionality):
  - `gitleaks` (`brew install gitleaks`) — secret detection
  - `osv-scanner` (`brew install osv-scanner`) — dependency vulnerability scanning (queries `api.osv.dev` unless local offline DBs are configured)
  - `npm` (`npm audit`) — repository advisory check (requires network)
  - `eslint` — static JavaScript/TypeScript analysis

---

## 3. Installation & First Launch

1. Copy **`Cobalix Orbital.app`** (`v0.1.0`) into `/Applications` (or keep it in an accessible local folder).
2. Because this `v0.1.0` bundle is **unsigned and not notarized**, do not double-click blindly if Gatekeeper blocks it:
   - Right-click (or Control-click) **`Cobalix Orbital.app`** -> select **Open** -> confirm **Open** in the macOS dialog (or allow via **System Settings -> Privacy & Security**).
3. Wait a few seconds for the native window (`1440x900`) to open and check the bottom-left sidebar badge:
   - Expected: **`Companion · Connected`** (green).
   - If you see an error banner about Node.js or `node:sqlite`, install Node.js 24 LTS (or configure `COBALIX_NODE_BIN`) and click **Restart Companion**.

---

## 4. Safe Synthetic Test Project Setup (Recommended First Run)

**Important Safety Rule:** For your initial test session, use a **disposable synthetic folder** — **never** test unfamiliar remediation or file-manipulation workflows for the first time on unbacked-up production repositories or folders containing sensitive personal secrets.

Run the commands below in Terminal to create a safe, deterministic synthetic test repo (`~/cobalix-test-sandbox`) that works cleanly offline (even without external CLIs installed):

```bash
mkdir -p ~/cobalix-test-sandbox/src

cat <<'EOF' > ~/cobalix-test-sandbox/src/tls.ts
export const tlsConfig = {
  rejectUnauthorized: false
};
EOF

cat <<'EOF' > ~/cobalix-test-sandbox/src/service.ts
import { tlsConfig } from './tls';

export function getServiceStatus() {
  return { secure: !tlsConfig.rejectUnauthorized };
}
EOF
```

Clean up `~/cobalix-test-sandbox` whenever you finish testing (`rm -rf ~/cobalix-test-sandbox`).

---

## 5. Recommended Step-by-Step Testing Workflow

1. **Command Center**: Confirm clean initial KPI counters, compact **`INFO`** pill layout, and **`Hash Chain Verified`** status in Chronicle Integrity.
2. **Asset Explorer**:
   - Register `~/cobalix-test-sandbox` (`Repository`).
   - Click **Run Nightwatch** and confirm the scan finishes cleanly (`completed`).
   - Click **Configure** to inspect exclusions, toggle settings, and confirm **`Scan on File Change`** and **`Custom Schedule Cron`** display **`Planned — Not Active`** and remain disabled.
3. **File Intelligence**:
   - Browse the folder tree and click `src/tls.ts`.
   - Inspect its SHA-256 baseline, **Relationships** (`./tls` imported by `src/service.ts`), and **History** timeline.
   - Modify `~/cobalix-test-sandbox/src/service.ts` externally (e.g., append `// modified` in an editor), return to **Asset Explorer -> Run Nightwatch**, and verify `DiffViewer` (Unified and Side-by-Side modes) shows the exact change.
4. **Threat Center -> Remediation (Saver)**:
   - Open **Threat Center**, locate the `rejectUnauthorized: false` finding on `src/tls.ts`, and click **Ask Saver**.
   - Inside **Remediation**, inspect the unified/side-by-side diff (`rejectUnauthorized: false` -> `true`).
   - Click **Approve Patch** (verify disk file has **not** changed yet), then click **Apply Approved Patch**.
   - Verify status shows **`Verification: passed`**, the file on disk now has `rejectUnauthorized: true`, and test **Revert Backup** if you want to confirm rollback restores the original file cleanly.
5. **Security Graph, AI Agents, Reports & Chronicle**:
   - Open **Security Graph**, locate `src/tls.ts`, and test pan/zoom/Reset View.
   - Open **AI Agents** to confirm Nightwatch/Saver/Chronicle boundaries and recent agent runs.
   - Open **Reports** and click **Export Sanitized Report** -> verify the downloaded Markdown contains the sanitized-export privacy notice and no private `/Users/...` path.
   - Open **Chronicle** -> verify **`Hash Chain Verified`** and click **Export Sanitized JSON** -> verify private host paths/secret patterns are redacted and a clear notice distinguishes the sanitized export from local SQLite records.
6. **Settings & Restart Persistence**:
   - Open **Settings** -> verify AI Provider defaults to **`None (Disabled — Deterministic Only)`** and inspect **External Scanner Binary Discovery**.
   - Quit **Cobalix Orbital** (`Cmd+Q`), relaunch the app, and confirm registered assets, findings, and Chronicle history persist from SQLite.
7. **Safe Asset Removal Confirmation**:
   - Back in **Asset Explorer**, click the **Trash (`Remove from monitoring`)** icon -> confirm an inline **`Confirm Asset Removal`** banner appears first -> click **Cancel** (verify nothing removed) -> click **Trash** again -> click **Confirm Remove** (verify monitoring stops while files on disk remain untouched and Chronicle retains audit history).

---

## 6. Human Native macOS Manual QA Checklist

Tauri does not provide an automated WKWebView WebDriver server (`tauri-driver`) on macOS, so automated Chromium/JSDOM UI checks and headless packaged `.app` API lifecycle tests cannot replace a brief human Cocoa window walkthrough before external cohort distribution:

1. Launch `Cobalix Orbital.app` from Finder (**Right-Click -> Open** if unsigned).
2. Confirm window opens cleanly (`1440x900`), resizes smoothly down to `1024x700` without horizontal scrollbar or overlapping text, and shows **`Companion · Connected`**.
3. Click through all **10 tabs** (`Command Center`, `Asset Explorer`, `File Intelligence`, `AI Agents`, `Threat Center`, `Remediation`, `Security Graph`, `Chronicle`, `Reports`, `Settings`) using real pointer clicks and trackpad scrolling.
4. Confirm modals, inline confirmation banners, buttons, text inputs, and checkboxes respond smoothly.
5. Quit via menu bar or **`Cmd+Q`**, then verify in Terminal that zero child companion processes survive:
   ```bash
   ps aux | grep companion.mjs | grep -v grep
   ```
   (Expected: empty output.)

---

## 7. Known Limitations in `v0.1.0`

- **Unsigned macOS Binary**: No Apple Developer ID signature or notarization yet.
- **Node.js Required on Host**: Needs host Node.js `22.13+` (`24 LTS` recommended).
- **Intel `x86_64` Build**: Runs under Rosetta 2 on Apple Silicon Macs.
- **Planned Per-Asset Watch/Cron Controls**: Marked **`Planned — Not Active`**; manual **Run Nightwatch** or global in-app Nightly Scan are active.
- **JS/TS AST Scope**: Security Graph / import extraction supports JS/TS extensions (`languageSupport: 'supported'`); other file types report `'unsupported'`.
- **Optional External AI & Live CVE Network Calls**: AI defaults to disabled (`none`); `osv-scanner` / `npm audit` require network access for online advisory queries.

---

## 8. How to Report Bugs Safely

Use [TESTER_FEEDBACK_TEMPLATE.md](./TESTER_FEEDBACK_TEMPLATE.md) for every bug report or UX observation.

**Privacy & Credential Warning:**
- Always share exports created with **Export Sanitized Report** or **Export Sanitized JSON** (or manually redact private usernames/paths).
- **NEVER** attach raw `obsidian.sqlite`, `session-token`, `credentials.json`, unredacted `.env` files, or real API keys/secrets to feedback issues or emails.
