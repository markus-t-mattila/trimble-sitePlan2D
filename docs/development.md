# Development guide

A short tour of the dev/test/deploy machinery. For the runtime architecture,
see [architecture.md](./architecture.md).

## Prerequisites

- **Node 22 LTS** (the `engines` field in `package.json` pins
  `>=22.12.0`). 22 is the active LTS line through April 2027; we track the
  current LTS rather than the "Current" line so CI stays predictable.
- **`openssl`** on `PATH` (the dev server uses it to generate a self-signed
  certificate on first run).
- **A Trimble Connect project** with at least one IFC file, and an account
  that can add extensions to that project — required to test the end-to-end
  flow.

## Install

```sh
npm install
```

The `prepare` lifecycle hook copies `web-ifc.wasm` (and the multi-threaded
variant when present) out of `node_modules/web-ifc/` into `public/wasm/`,
where Vite serves it from. If the copy fails on first install (network
race), running `npm install` a second time fixes it.

## Dev server (`npm run dev`)

`dev-server/server.ts` is a single Node script that:

1. Generates `dev-server/cert/{key.pem,cert.pem}` via `openssl` on first
   run (`SAN: localhost, 127.0.0.1, ::1`, valid for one year).
2. Spawns `vite` (or `vite preview` with `--preview`) on the internal port
   from `vite.config.ts` (`5174` for dev, `4174` for preview).
3. Listens on `https://localhost:5173`. Every request **except**
   `GET /manifest.json` is proxied to Vite with WebSocket upgrades
   forwarded so HMR keeps working over HTTPS.
4. For `GET /manifest.json`, reads the on-disk manifest, replaces the
   production base URL with the local URL, and returns it with `Cache-Control: no-store` and permissive CORS.

The first time you open the dev URL, accept the self-signed cert in the
browser. Then in Trimble Connect, add the extension using
`https://localhost:5173/manifest.json`.

### Configuration

| Env var               | Default                              |
|-----------------------|--------------------------------------|
| `DEV_HOST`            | `localhost`                          |
| `DEV_PORT`            | `5173`                               |
| `DEV_INTERNAL_PORT`   | `5174` (dev) / `4174` (preview)      |
| `DEV_PROD_BASE_URL`   | derived from on-disk `manifest.json` |

Killing the dev server forwards `SIGINT` / `SIGTERM` to the Vite child so
both processes exit cleanly.

## Build (`npm run build`)

`tsc -b` runs the TypeScript project references for type-check, then
`vite build` produces `/dist`:

- `dist/index.html` — entry, no relative-path traps (`base: "./"`).
- `dist/assets/index-<hash>.js` — main bundle (~120 KB gzipped).
- `dist/assets/ifc-worker-<hash>.js` — IFC worker (~3.5 MB; contains
  web-ifc + polygon-clipping).
- `dist/assets/index-<hash>.css` — design tokens + component styles.
- `dist/wasm/web-ifc-<hash>.wasm` — long-cache hashed WASM.

`npm run preview` serves `/dist` over the same HTTPS dev server pipeline
on `https://localhost:4173`.

## Tests

### Vitest (`npm test`)

Vitest covers unit + integration code. Some tests opt into `jsdom`
(annotated via `@vitest-environment jsdom` or the `environmentMatchGlobs`
config); the rest run in plain Node.

```sh
npm test                # one shot
npm run test:watch      # watch mode
npm run test:coverage   # v8 coverage report
```

The test suite includes:

- Trimble Workspace + Core API client (mocked `fetch`).
- IFC geometry math (triangle/plane intersection, polygon ring chaining).
- Snap engine query semantics.
- SVG output: structure, viewBox, label placement, CSS-variable contract.
- i18n locale detection + translation parity.

### Playwright (`npm run test:e2e`)

E2E tests bundle the app and load `/dist` through `vite preview`. The
`smoke.spec.ts` test confirms the production bundle mounts; richer scenarios
(file picker → generate → upload to a stubbed Trimble host) are the
natural extension point.

First-time setup downloads the Chromium browser:

```sh
npm run test:e2e:install
npm run test:e2e
```

## CI / CD

- `.github/workflows/ci.yml` runs `npm ci` → `lint` → `typecheck` → `test`
  → `build` on every push and PR. The built `dist/` is uploaded as an
  artifact for inspection.
- `.github/workflows/deploy.yml` runs on pushes to `main`: same checks,
  then `cp manifest.json dist/manifest.json` and publishes `dist/` to
  GitHub Pages via `actions/deploy-pages`.

## Common gotchas

- **Browser-cached cert** — if you regenerate `dev-server/cert/`, restart
  the browser to flush the cached certificate.
- **Vite optimised-deps cache** — after upgrading `web-ifc`, run
  `rm -rf node_modules/.vite` to force re-optimisation.
- **`prepare` not running** — `npm install` (not `npm ci`) runs the
  `prepare` lifecycle script; if you skipped it for any reason, run
  `node scripts/copy-wasm.mjs` manually.
- **`navigator.language` in tests** — the locale detection test runs in
  jsdom which reports `"en-US"`; assertions that assume a specific locale
  must mock `navigator` explicitly.
- **Worker not found in production preview** — check that the
  `assetFileNames` rule in `vite.config.ts` is still routing `*.wasm` to
  `/wasm/` and that the WASM file exists in `dist/wasm/`.
