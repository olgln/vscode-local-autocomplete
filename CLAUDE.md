# VS Code autocomplete extension

VS Code extension for local Tab autocomplete (inline completions) backed by llama.cpp
`llama-server` (`/infill`, FIM). Code layout: `README.md`. Status and next steps: `PLAN.md`.

## Rules
- The repo will be public: no personal data or details about the user's machine in any file.
- Zero runtime dependencies; the extension talks only to the local llama-server (no cloud,
  no telemetry). New dev dependencies only after quarantine review per the global CLAUDE.md.
- Do not download models or start llama-server without the user's explicit OK.
- Git Flow: `main` = released, `develop` = integration. Work in `feature/<name>` (or
  `fix/<name>`) branched from `develop`, merge back with `--no-ff`; releases go
  `develop` → `main` with a version tag. Never commit directly to `main` or `develop`.
- Commit and merge only after the user approves; never push without being asked.
- Test completion quality on JavaScript, TypeScript and Python.
