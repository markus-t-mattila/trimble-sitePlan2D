# Contributing

Thanks for considering a contribution to trimble-sitePlan2D.

## Development setup

Prerequisites: **Node 22 LTS** (the project pins `engines.node >=22.12.0`)
and `openssl` on `PATH` (used by the dev server to generate the local
self-signed cert).

```sh
npm install
npm run dev        # https://localhost:5173 with self-signed cert
npm test           # Vitest unit tests
npm run test:e2e   # Playwright (requires `npm run test:e2e:install` first)
npm run build      # production build -> /dist
```

The first run of `npm run dev` generates a self-signed certificate in
`dev-server/cert/` (gitignored). Accept it in your browser, then side-load
the extension into Trimble Connect via `https://localhost:5173/manifest.json`.

For deeper context, see:

- [docs/architecture.md](./docs/architecture.md) — runtime data flow.
- [docs/output-format.md](./docs/output-format.md) — the SVG + JSON contract.
- [docs/development.md](./docs/development.md) — dev/test/CI machinery.
- [docs/localization.md](./docs/localization.md) — adding translations.

## Code style

- TypeScript with `strict` and `exactOptionalPropertyTypes` enabled.
- Public functions and classes carry JSDoc explaining intent (the *why*),
  not just the signature.
- Styling lives in `src/styles/`; React components use class names, not
  inline `style={…}`.
- `npm run lint` and `npm run format` must pass before opening a PR.

## Tests

- New behaviour ships with unit tests in `tests/unit/<module>/`.
- Use jsdom only where you really need the DOM (per-file
  `// @vitest-environment jsdom` directive); pure logic stays in plain
  Node tests for speed.
- Coverage is checked locally with `npm run test:coverage`; aim for >70%
  on touched lines.

## Commits and PRs

- Keep commit messages descriptive: subject line ≤72 chars, body wraps to
  ~80, and a one-paragraph *why*.
- Squash WIP commits before opening a PR; reviewers should see one logical
  change per commit.
- Run `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`
  locally before pushing.

## Reporting issues

Open a GitHub issue describing:

- The Trimble Connect project layout (anonymized if needed).
- The IFC file (size, schema, source — anonymized if needed).
- Steps to reproduce, expected vs observed behavior, and any console
  output.

For security-sensitive findings, see [SECURITY.md](./SECURITY.md) instead
of filing a public issue.

## License

By contributing you agree that your code is released under the MIT license.
