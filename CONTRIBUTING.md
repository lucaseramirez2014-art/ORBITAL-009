# Contributing to Cobalix Orbital

Thank you for your interest in **Cobalix Orbital** (`cobalix/orbital`).

## Workspace Structure

- `packages/core` — Domain types, path boundary validation, SHA-256 helpers, secret redaction
- `packages/db` — Local SQLite database (`node:sqlite`), migrations, credential storage
- `packages/scanners` — Gitleaks, OSV-Scanner, npm audit, ESLint, and deterministic static inspector adapters
- `packages/ai` — Provider-neutral, opt-in AI interface
- `packages/agents` — `LocalProtectionService`, `NightwatchAgent`, `SaverAgent`, `ChronicleService`, `FileIntelligenceService`, `SecurityGraphService`
- `apps/companion` — Authenticated `127.0.0.1` HTTP companion server
- `apps/web` — React + TypeScript + Vite + Tailwind UI
- `apps/desktop/src-tauri` — Tauri 2 Rust supervisor, IPC API bridge, and desktop packaging
- `tests/` — Vitest regression, mocked adapter, live scanner CLI, and frontend tests

## Local Checks Before Submitting Changes

All contributions must preserve security boundaries, secret redaction, Chronicle hash-chain integrity, and pass:

```bash
npm run build
npm run build:companion:bundle
npm run typecheck
npm run lint
npm test
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```

## Security & Data Hygiene Guidelines

- Never commit real credentials, dummy secrets outside isolated runtime test fixtures, `session-token` files, `.env*` files (except `.env.example`), or local SQLite databases.
- Never execute shell commands with untrusted path interpolation or run arbitrary scripts from scanned repositories.
- Do not bundle third-party scanner executables into the repository without documented license compatibility review.

## Licensing Notice

Repository licensing is currently pending formal maintainer selection. Please check with the maintainers before submitting external contributions.
