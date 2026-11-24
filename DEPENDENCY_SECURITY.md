# Cobalix Orbital — Dependency Security Report (`SEC-007`)

**Product:** Cobalix Orbital (`v0.1.0`, mission `CBX-ORB-008`)  
**Remediation Date:** 2026-11-23  

---

## 1. Summary

**SEC-007 is RESOLVED (`0` production vulnerabilities and `0` development vulnerabilities reported by `npm audit`).**

| Check | Before ORBITAL 008 | After ORBITAL 008 |
| --- | --- | --- |
| `npm audit --omit=dev` (Production) | **`0` vulnerabilities** | **`0` vulnerabilities** |
| `npm audit` (Full Workspace incl. `devDependencies`) | **6 vulnerabilities** (`2 critical`, `1 high`, `3 moderate`) | **`0` vulnerabilities** |

---

## 2. Root Cause of Prior Advisories

Before ORBITAL 008, root `package.json` pinned `"vitest": "^2.1.8"` (`vitest@2.1.9` locked), which transitively required:
- `vitest@2.1.9` (`<=3.2.5` UI server advisory, `>=2.1.0 <4.1.11` mocker advisory)
- `@vitest/mocker@2.1.9` (redirect mock path traversal / manual mock registration advisories)
- `tinypool@1.1.1` (`<=2.1.1` prototype pollution advisories)
- `vite-node@2.1.9` (pulling older `vite`)
- Root `vite@5.4.21` + `esbuild@0.21.5` (`<=6.4.3` and `<=0.24.2` dev server advisories), duplicated alongside `apps/web`'s patched `vite@6.4.6` + `esbuild@0.25.12`.

Crucially, none of these affected the production Companion runtime (`companion.mjs` has zero runtime npm dependencies) or the production static Vite bundle (`apps/web` runtime uses only `react`, `react-dom`, `cytoscape`, `lucide-react`, `@tauri-apps/api`).

---

## 3. Remediations Applied (Without Unnecessary Breaking Migrations)

1. Upgraded root `devDependencies.vitest` in `/Users/lucasramirez/Desktop/Cobalix/package.json` from `"^2.1.8"` to **`"^4.1.12"`**:
   - Avoided migrating unnecessarily to `vitest@5` (`chai@^6` peer bump) while moving past all vulnerable Vitest `<=4.1.10`, `@vitest/mocker <=4.1.11`, `vite-node`, and `tinypool <=2.1.1` chains (`vitest@4.1.12` removes both `tinypool` and `vite-node`).
2. Ran `npm update vite && npm dedupe`:
   - Removed stale root `vite@5.4.21` / `esbuild@0.21.5` and deduplicated the entire workspace (`vitest@4.1.12`, `@vitest/mocker@4.1.12`, `@tailwindcss/vite@4.3.5`, `@vitejs/plugin-react@4.7.0`, and `@cobalix/web`) onto a single shared **`vite@6.4.6`** with **`esbuild@0.25.12`**.
   - Preserved Vite 6 compatibility (`@vitejs/plugin-react@4.7.0` supports `vite ^6.0.0`) with zero build or JSDOM regressions.

---

## 4. Verification & Ongoing Dependency Hygiene

- `npm ls vite esbuild vitest`: confirmed single deduplicated `vite@6.4.6`, `esbuild@0.25.12` under Vite, `esbuild@0.28.2` under `tsx@4.23.15`, and `vitest@4.1.12` with no peer-dependency errors.
- `npm audit`: `found 0 vulnerabilities`.
- `npm audit --omit=dev`: `found 0 vulnerabilities`.
- Full `npm run build`, `npm run typecheck`, `npm run lint`, and Vitest regression suites passed after lockfile updates.
- **Accepted Low Operational Note**: Development tools (`esbuild`, `fsevents`) retain standard native install scripts in `devDependencies`; production companion (`companion.mjs`) bundles workspace TypeScript sources and uses Node.js built-ins only.
