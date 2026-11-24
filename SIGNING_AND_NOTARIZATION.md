# Cobalix Orbital — macOS Signing, Hardened Runtime & Notarization Runbook (`v0.1.0`)

**Product:** Cobalix Orbital (`com.cobalix.obsidian`, `v0.1.0`)  
**Current Workspace Signing Status:** **UNSIGNED & NOT NOTARIZED** (`0 valid identities found` on local machine; this document defines the exact production release workflow once Apple credentials are provisioned in CI or an authorized release environment).

---

## 1. Prerequisites (External Provisioning Required)

Public macOS distribution outside technical controlled testers requires an active **Apple Developer Program** membership with:
1. A **Developer ID Application** certificate (`Developer ID Application: <Organization> (<TeamID>)`) for code signing `.app` and sidecar Mach-O binaries.
2. **App Store Connect API Key** (`key_id`, `issuer_id`, `.p8` key) OR Apple ID + App-Specific Password configured in CI secrets / ephemeral keychain (`xcrun notarytool store-credentials`).

> **Credential Safety Rule:** Never store `.p12` certificates, private keys, `.p8` API keys, Team Passwords, or notarization profiles inside this repository, `tauri.conf.json`, `obsidian.sqlite`, or diagnostic logs. Only pass them via ephemeral CI secrets/environment variables or user-local keychain profiles during an authorized release run.

---

## 2. Hardened Runtime & Entitlements Configuration

Configured in [tauri.conf.json](./apps/desktop/src-tauri/tauri.conf.json):
- `bundle.macOS.minimumSystemVersion`: `"12.0"`
- `bundle.macOS.hardenedRuntime`: `true`
- `bundle.macOS.entitlements`: `"entitlements.plist"`
- `bundle.macOS.signingIdentity`: `null` (local dev builds stay cleanly unsigned unless `APPLE_SIGNING_IDENTITY` / signing override is supplied during release packaging)

### Entitlement Split (Principle of Least Privilege)
1. **Main Desktop Shell — [entitlements.plist](./apps/desktop/src-tauri/entitlements.plist)**:
   - Intentionally minimal (`<dict/>` with no JIT or unsigned memory exemptions), because macOS `WKWebView` runs page JavaScript inside Apple's own WebKit XPC helper (`com.apple.WebKit.WebContent`).
2. **Optional Bundled Node 24 LTS Sidecar — [entitlements.node-runtime.plist](./apps/desktop/src-tauri/entitlements.node-runtime.plist)**:
   - Applies **only** if signing a staged `Contents/Resources/resources/runtime/node` Mach-O executable:
     - `com.apple.security.cs.allow-jit` = `true` (required by Node/V8 JIT under Hardened Runtime)
     - `com.apple.security.cs.allow-unsigned-executable-memory` = `true` (required for V8 dynamic code generation)
     - `com.apple.security.cs.disable-library-validation` = `false` (kept disabled because `companion.mjs` is pure ESM + built-in `node:sqlite` and loads no external unsigned `.node` native addons)

---

## 3. Inside-Out Signing Sequence (Release Environment)

Apple Developer ID signing with nested executables requires signing **inside-out** before creating/signing the `.dmg` installer:

1. **Stage & Verify Architecture-Matched Runtime (if shipping bundled build)**:
   ```bash
   node scripts/stage-node-runtime.mjs \
     --tarball "node-${NODE_VERSION}-darwin-${NODE_ARCH}.tar.gz" \
     --sha256 "${EXPECTED_OFFICIAL_SHA256}" \
     --arch "${NODE_ARCH}" \
     --version "${NODE_VERSION}" \
     --source-url "https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-darwin-${NODE_ARCH}.tar.gz"
   ```
   Confirm `Contents/Resources/resources/runtime/THIRD_PARTY_NOTICES.txt` and `runtime-manifest.json` exist alongside `node`.

2. **Build Target Bundle (`.app` first so sidecar can be signed cleanly)**:
   - Set `APPLE_SIGNING_IDENTITY` (or pass `--no-sign` first if signing manually inside-out before creating `.dmg`).
   - Using Tauri CLI:
     ```bash
     # Sign any nested Mach-O binary inside Contents/Resources first (if bundled runtime present):
     codesign --force --options runtime --timestamp \
       --entitlements apps/desktop/src-tauri/entitlements.node-runtime.plist \
       --sign "${APPLE_SIGNING_IDENTITY}" \
       "apps/desktop/src-tauri/target/${RUST_TARGET}/release/bundle/macos/Cobalix Orbital.app/Contents/Resources/resources/runtime/node"

     # Sign the .app bundle with main shell entitlements and Hardened Runtime:
     codesign --force --deep --options runtime --timestamp \
       --entitlements apps/desktop/src-tauri/entitlements.plist \
       --sign "${APPLE_SIGNING_IDENTITY}" \
       "apps/desktop/src-tauri/target/${RUST_TARGET}/release/bundle/macos/Cobalix Orbital.app"
     ```
     *(Verify `companion.mjs` is plain UTF-8 JavaScript resource data sealed inside the `.app` code resources directory — not a Mach-O executable requiring separate entitlements.)*

3. **Create & Sign Distributable `.dmg` Archive**:
   ```bash
   hdiutil create -volname "Cobalix Orbital" \
     -srcfolder "apps/desktop/src-tauri/target/${RUST_TARGET}/release/bundle/macos/Cobalix Orbital.app" \
     -ov -format UDZO \
     "Cobalix-Orbital-v0.1.0-${NODE_ARCH}.dmg"

   codesign --force --timestamp \
     --sign "${APPLE_SIGNING_IDENTITY}" \
     "Cobalix-Orbital-v0.1.0-${NODE_ARCH}.dmg"
   ```

---

## 4. Apple Notarization, Stapling & Verification

4. **Submit `.dmg` (and optionally zipped `.app`) for Notarization**:
   ```bash
   xcrun notarytool submit "Cobalix-Orbital-v0.1.0-${NODE_ARCH}.dmg" \
     --key "${NOTARY_P8_PATH}" \
     --key-id "${NOTARY_KEY_ID}" \
     --issuer "${NOTARY_ISSUER_ID}" \
     --wait
   ```
   *(If `Invalid`, inspect exact rejection log via `xcrun notarytool log <submission-id>` before retrying.)*

5. **Staple Notarization Ticket for Offline Gatekeeper Verification**:
   ```bash
   xcrun stapler staple "Cobalix-Orbital-v0.1.0-${NODE_ARCH}.dmg"
   ```

6. **Verify Signature, Gatekeeper Acceptance & Distribution Checksums**:
   ```bash
   # Verify signature structure & Hardened Runtime flags
   codesign --verify --deep --strict --verbose=4 \
     "apps/desktop/src-tauri/target/${RUST_TARGET}/release/bundle/macos/Cobalix Orbital.app"
   codesign -dv --verbose=4 "Cobalix-Orbital-v0.1.0-${NODE_ARCH}.dmg"

   # Mount DMG and test Gatekeeper policy assessment on a clean volume
   spctl --assess --type open --context context:primary-signature -vvv "Cobalix-Orbital-v0.1.0-${NODE_ARCH}.dmg"
   spctl --assess --type exec -vvv "/Volumes/Cobalix Orbital/Cobalix Orbital.app"

   # Record publication SHA-256 artifact checksums
   shasum -a 256 "Cobalix-Orbital-v0.1.0-${NODE_ARCH}.dmg" > "Cobalix-Orbital-v0.1.0-${NODE_ARCH}.dmg.sha256"
   ```

---

## 5. Third-Party Runtime Attribution Checklist

Whenever `resources/runtime/node` is included in a distributable build:
- Keep `Contents/Resources/resources/runtime/THIRD_PARTY_NOTICES.txt` generated directly from Node.js's extracted `LICENSE` file by `scripts/stage-node-runtime.mjs`.
- Keep `Contents/Resources/resources/runtime/runtime-manifest.json` recording exact Node version, target architecture, download source URL, archive SHA-256, and staged binary SHA-256.
