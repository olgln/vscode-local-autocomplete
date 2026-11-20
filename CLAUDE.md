# VS Code autocomplete extension

VS Code extension for local Tab autocomplete (inline completions) backed by llama.cpp
`llama-server` (`/infill`, FIM). Usage, settings and code layout: `README.md`.
Build and test: `npm install`, then `npm test` (compiles, runs `node --test`; no model needed).
Package: `npm run package` → `local-autocomplete-<version>.vsix` (own zip script, no vsce).

## Rules
- The repo is public: no personal data or details about the user's machine in any file.
- Zero runtime dependencies; the extension talks only to the local llama-server (no cloud,
  no telemetry). New dev dependencies only after a security review of the package; pin exact versions.
- Setting defaults live only in `package.json`; keep `src/config.ts` and the settings table in
  `README.md` in sync with it.
- Do not download models or start llama-server without the user's explicit OK.
- Git Flow: `main` = released, `develop` = integration. Work in `feature/<name>` (or
  `fix/<name>`) branched from `develop`, merge back with `--no-ff`; releases go
  `develop` → `main` with a version tag. Never commit directly to `main` or `develop`.
- Commit and merge only after the user approves; never push without being asked.
- Test completion quality on JavaScript, TypeScript and Python.
