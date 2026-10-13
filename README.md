# surf.ai

A DeepWiki-style wiki generator for public GitHub repositories — pure frontend (vanilla JS + CSS), no backend, no build step. State (settings and generated wikis) is cached entirely in your browser's `localStorage`.

## How it works

1. Paste a public GitHub repo URL. The app fetches its file tree and README directly from `api.github.com` / `raw.githubusercontent.com` (unauthenticated, 60 requests/hour).
2. It filters out noise (binaries, lockfiles, `node_modules`, etc.) and groups the remaining files into modules by top-level directory.
3. **Pass 1**: an LLM call per module produces a short structured summary.
4. **Pass 2**: a final LLM call synthesizes those summaries + the README into a multi-page wiki (Overview, Architecture with a Mermaid diagram, and one page per significant module).
5. The result is cached in `localStorage` keyed by `owner/repo/branch`. Revisiting a repo loads instantly; "Regenerate" re-runs the pipeline.

You need your own LLM API endpoint — configure it via the ⚙️ settings icon.

## Connecting a provider

Since this is a pure-frontend app, every LLM call is a direct browser `fetch()` — which means the provider must allow **CORS** from your origin. Not all providers do (notably, OpenAI's and Anthropic's APIs behave differently here — see below), so a "network error" when generating a wiki is often a CORS rejection, not an actual connectivity problem. Worth checking in DevTools → Network/Console if you hit one.

Confirmed-working settings (verified end-to-end as of October 2026):

| Provider | Base URL | Model | Notes |
|---|---|---|---|
| **Google AI Studio (Gemini)** | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-2.5-flash` | Free tier, no payment method required. CORS allowed. **Gemini 2.0 Flash was shut down June 1, 2026** — if you see a bare 404 with no error body, you're likely on a retired model name; check [ai.google.dev/gemini-api/docs/models](https://ai.google.dev/gemini-api/docs/models) for the current one. |
| **OpenAI** | `https://api.openai.com/v1` | `gpt-4o-mini` | CORS allowed directly. Requires a funded API-platform account (`platform.openai.com/settings/organization/billing`) — a ChatGPT Plus subscription does **not** grant API credits, they're billed separately. |
| **Anthropic** | `https://api.anthropic.com/v1` | `claude-sonnet-5` | Anthropic's OpenAI-compatibility shim (`/chat/completions`) blocks all browser CORS outright. `js/llm/llm-client.js` detects an `anthropic.com` base URL and transparently routes through their native `/v1/messages` endpoint instead (with the `anthropic-dangerous-direct-browser-access` header), so this still works from Settings with no extra config. Requires a funded API-console account — separate from any Claude.ai subscription. |
| **Groq** | `https://api.groq.com/openai/v1` | `llama-3.1-8b-instant` | Free developer tier, CORS allowed. Untested end-to-end in this app but confirmed CORS-compatible. |
| Local (Ollama, LM Studio, vLLM, etc.) | e.g. `http://localhost:11434/v1` | whatever's loaded | Free, no CORS issues if the server allows it (Ollama needs `OLLAMA_ORIGINS` set). |

## Running locally

No install needed. Serve the directory with any static file server and open it — ES modules require `http://`, not `file://`:

```sh
python3 -m http.server 8000
# then open http://localhost:8000/
```

## Project layout

- `js/github/` — GitHub API client + file/module filtering
- `js/llm/` — OpenAI-compatible chat completions client
- `js/pipeline/` — two-pass wiki generation orchestrator, prompts, JSON parsing/validation
- `js/render/` — markdown (marked.js) + Mermaid rendering, sanitized with DOMPurify
- `js/storage/` — localStorage settings + wiki cache
- `js/views/` — landing, progress, wiki, and settings UI
- `js/vendor/` — vendored third-party libraries (marked, mermaid, DOMPurify) — no CDN dependency
