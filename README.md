# Local Autocomplete

VS Code extension: Tab autocomplete (inline/ghost-text completions) from a local
[llama.cpp](https://github.com/ggml-org/llama.cpp) `llama-server` via its `/infill` (FIM) endpoint.
No cloud, no telemetry, no runtime dependencies. Requests go only to `localAutocomplete.endpoint`
(default `http://127.0.0.1:8012`).

## Layout

```
src/
├── extension.ts          activate(): wires provider, status bar, commands, settings listener
├── config.ts             localAutocomplete.* settings (defaults live in package.json)
├── commands.ts           Toggle On/Off, Check Server; server health → status bar
├── completion/
│   ├── provider.ts       InlineCompletionItemProvider: debounce, cancellation, logging
│   ├── context.ts        cursor + document → FIM request (pure, unit-tested)
│   └── postprocess.ts    cleans model output (pure, unit-tested)
├── llama/
│   └── client.ts         POST /infill, GET /health via built-in fetch
└── ui/
    └── status-bar.ts     on/off, server state, spinner; click toggles
test/                     mirrors src/; `node --test` against compiled out/ (fake server, no model)
```

## Develop

```sh
npm install        # dev-only: typescript, @types/vscode (pinned, scripts disabled via .npmrc)
npm test           # compile + unit tests
```

Debug: open this folder in VS Code and press F5 — an "Extension Development Host" window opens
with the extension loaded. Per-request timings: Output panel → "Local Autocomplete", set the log
level to Debug.

Server (downloads model weights on first run):

```sh
llama-server --fim-qwen-1.5b-default   # listens on 127.0.0.1:8012
```

## Usage

- Ghost text appears after a short pause; Tab accepts, Esc dismisses.
- Trigger manually: `Alt+\` (VS Code's built-in "Trigger Inline Suggestion").
- Commands: "Local Autocomplete: Toggle On/Off", "Local Autocomplete: Check Server".
- Off by default in `markdown` and `plaintext` (`localAutocomplete.disabledLanguages`).
