# Test fixtures

This folder is intentionally empty in source control.

Place small open-licensed IFC files here for the IFC-engine snapshot tests.
Recommended starting set (all freely available):

- `AC20-FZK-Haus.ifc` — single-storey reference building from KIT/IFC-Wiki.
- `Duplex_A_20110907.ifc` — two-storey reference building from buildingSMART
  tutorials.

For each fixture, generate a paired `*.expected.json` by running the engine
end-to-end once and committing the result. Compare against it in tests with
`toMatchFileSnapshot` so future engine changes show up as snapshot diffs.

The license of every committed fixture must be compatible with MIT
distribution. When in doubt, download the file in a `pretest` hook instead of
committing it.
