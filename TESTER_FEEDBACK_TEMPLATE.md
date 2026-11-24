# Cobalix Orbital `v0.1.0` — Tester Feedback Template

Use this template when submitting bug reports, usability feedback, or crash reports from the controlled external testing cohort.

> **IMPORTANT SECURITY & PRIVACY WARNING**  
> **NEVER** attach or paste raw `obsidian.sqlite`, `session-token`, `credentials.json`, backup `.bak` files from protected repos, real passwords/API keys, or private proprietary source code.  
> Only attach **Sanitized Reports** (`Export Sanitized Report`), **Sanitized Chronicle JSON** (`Export Sanitized JSON`), or screenshots/log snippets that you have verified contain no secrets or sensitive file paths.

---

## 1. Environment & System Details

- **Cobalix Orbital Build / Version:** `v0.1.0` (`CBX-ORB-010`)
- **macOS Version (`sw_vers -productVersion`):** 
- **CPU Architecture (`uname -m` — Intel `x86_64` or Apple Silicon `arm64` via Rosetta 2):** 
- **Node.js Version (`node -v`):** 
- **Optional Scanners Present (check all that appeared in `Settings -> External Scanner Binary Discovery`):**
  - [ ] `gitleaks` (version: )
  - [ ] `osv-scanner` (version: )
  - [ ] `npm` / `npm audit` (version: )
  - [ ] `eslint` (version: )

---

## 2. Installation & First-Launch Result

- **Gatekeeper / Launch Method:** `[ ] Right-Click -> Open` / `[ ] Privacy & Security Allow` / `[ ] Blocked / Failed`
- **Companion Connection Status on Launch:** `[ ] Companion · Connected` / `[ ] Restarting` / `[ ] Disconnected / Failed`
- **Startup Error Banner Text (if any):**

---

## 3. Workflow & Screen Tested

Check all views/workflows involved in this report:
- [ ] Command Center
- [ ] Asset Explorer (Register / Scan / Configure / Confirm Remove)
- [ ] File Intelligence (Tree / DiffViewer / History / Relationships / Baseline Accept)
- [ ] AI Agents
- [ ] Threat Center
- [ ] Remediation (Ask Saver / Diff / Approve / Apply / Revert)
- [ ] Security Graph
- [ ] Chronicle (Verify Chain / Export Sanitized JSON)
- [ ] Reports (Export Sanitized Report)
- [ ] Settings
- [ ] Quit (`Cmd+Q`) & Restart Persistence

---

## 4. Issue Summary & Severity

- **Short Title:** 
- **Severity:**
  - [ ] **Blocker** — App fails to launch, crashes repeatedly, corrupts/loses user data, or leaves orphan companion processes
  - [ ] **High** — Major workflow broken (`Run Nightwatch`, Saver apply/revert, persistence, security boundary) with no clear workaround
  - [ ] **Medium** — Secondary feature broken, confusing error message, or unexpected scan/UI state
  - [ ] **Low** — Minor edge case with simple workaround
  - [ ] **UX Polish** — Wording, layout spacing, button clarity, or documentation improvement

---

## 5. Expected vs. Actual Behavior

- **Expected Behavior:**  
  _Describe clearly what you expected Cobalix Orbital to do._

- **Actual Behavior:**  
  _Describe exactly what happened instead, including any exact status badge, banner, or error text._

---

## 6. Exact Steps to Reproduce

1. _Starting state (e.g., synthetic sandbox vs local git repo, number of files):_
2. _Action 1:_
3. _Action 2:_
4. _Observed result:_

**Frequency:** `[ ] Always (100%)` / `[ ] Intermittent` / `[ ] Happened once`

---

## 7. Screenshots & Sanitized Diagnostics (Optional)

- **Window Size / Display (e.g., 1440x900, 1280x800 Retina):** 
- **Attached Sanitized Files (check before attaching):**
  - [ ] Verified no raw `obsidian.sqlite`, `session-token`, or `credentials.json` attached
  - [ ] Verified screenshots/snippets show no proprietary secrets or private credentials
- **Sanitized Chronicle / Markdown Snippet or Companion Error Message:**
  ```text
  Paste sanitized snippet here (replace any private folder names if needed)
  ```
