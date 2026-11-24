# Security Policy

## Local-First Security Architecture

Cobalix Orbital (`cobalix/orbital`) is designed as a local-only security workspace:

- The companion HTTP API binds strictly to loopback (`127.0.0.1`).
- Every non-health companion endpoint requires a per-session `X-Cobalix-Token` (`0600` file permissions) plus strict `Origin` and `Sec-Fetch-Site` validation.
- In the Tauri 2 desktop runtime, session tokens are read on demand inside Rust (`companion_request` IPC bridge) and are never exposed to the WebView JavaScript environment.
- Asset scanning, inventory, and controlled patches enforce canonical `realpath` boundary checks against explicitly registered roots.
- External CLI arguments use array-based process execution (`execFile`), secret patterns are redacted before persistence/logging, and third-party AI integration is opt-in and disabled by default.

## Supported Versions

| Version | Supported |
| --- | --- |
| `0.1.x` | Active development baseline |

## Reporting a Vulnerability

If you discover a security vulnerability in Cobalix Orbital:

1. **Do not** open a public GitHub issue containing exploit details, credentials, or private data.
2. Report privately through GitHub Security Advisories for `cobalix/orbital` (once enabled on the repository) or contact the project maintainers directly.
3. Include reproduction steps, affected component (`apps/desktop`, `apps/companion`, `packages/*`, `apps/web`), and potential impact.

Please allow reasonable time to investigate and prepare a fix before public disclosure.
