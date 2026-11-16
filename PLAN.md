# Plan

Code layout and dev commands: see `README.md`.

## Status (16.11.2026)
- Done: provider, debounce/cancel, postprocess, settings, status bar, commands.
  Dev deps (reviewed, pinned): `typescript@6.0.3`, `@types/vscode@1.144.0`.
  `npm test`: compiles clean, 11/11 pass.
- Model chosen: Qwen2.5-Coder 1.5B Q8_0 (server command in `README.md`). `/infill` checked by hand
  on JS, TS, Python: correct one-liners and small blocks, sub-second latency; idle sleep frees memory.
- Not yet: tested in real VS Code.

## Next
1. F5 (Extension Development Host): verify on JS, TS, Python; tune defaults.
2. Install into regular VS Code: copy to `~/.vscode/extensions/local.local-autocomplete-0.1.0/`
   or build a .vsix with our own zip script (no `vsce`). No auto-updates.
3. Optional (ideas from ggml-org/llama.vscode `src/completion.ts`, `src/llama-server.ts`,
   reference only): LRU cache of completions, `input_extra` chunks from other files,
   accept first line/word, compare model sizes.

## Decisions
- TypeScript; zero runtime deps; requests only to the local llama-server.
- Git Flow (`main`, `develop`, `feature/*`), local only; commit only after user approval.
- Test quality on JavaScript, TypeScript, Python; off in `markdown`, `plaintext`.
- Not published to Marketplace.

## Risks
- Small local models: good for short completions (line/block), weaker than cloud tools.
