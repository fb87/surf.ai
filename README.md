# surf.ai

A DeepWiki-style wiki generator for public Git repositories — pure frontend (vanilla JS + CSS), no backend, no build step. State (settings and generated wikis) is cached entirely in your browser's `localStorage`.

## How it works

1. Paste a public repo URL — GitHub, GitHub Enterprise, GitLab (.com or self-hosted), Bitbucket Cloud, Bitbucket Server/Data Center, or Gitee. The app fetches its file tree and README directly from that host's REST API (unauthenticated — see [Supported Git hosts](#supported-git-hosts)).
2. It filters out noise (binaries, lockfiles, `node_modules`, etc.) and groups the remaining files into modules by top-level directory.
3. **Pass 1**: an LLM call per module produces a short structured summary.
4. **Pass 2**: a final LLM call synthesizes those summaries + the README into a multi-page wiki (Overview, Architecture with a Mermaid diagram, and one page per significant module).
5. The result is cached in `localStorage` keyed by `host/owner/repo/branch`. Revisiting a repo loads instantly.
6. The **Ask** panel lets you ask follow-up questions grounded in the generated wiki, with the LLM able to call `search_files`/`fetch_file` tools to pull in live source when the wiki doesn't cover enough detail (OpenAI-compatible providers only — see the provider table below).
7. **↻ Update** re-checks the repo and only re-reads/re-summarizes modules whose files actually changed since last time (compared by each file's content hash — GitHub/GitLab/Gitee — or size where no hash is available — Bitbucket Cloud; Bitbucket Server's file listing exposes neither, so it can only detect added/removed files there, not in-place edits). If nothing changed at all, it's a single cheap API call with zero LLM calls. **Full Rebuild** discards the cached summaries and regenerates everything from scratch.

You need your own LLM API endpoint — configure it via the ⚙️ settings icon.

## Supported Git hosts

Works unauthenticated for public repos, with an optional personal access token per host (Settings → Git Host Access Tokens) to raise the rate limit and enable private/enterprise access. A pasted URL's host is auto-detected for the four public clouds; anything else (a custom domain) prompts you to pick which of the three "custom domain" providers it is.

| Provider | Host(s) | API | Notes |
|---|---|---|---|
| **GitHub** | `github.com` | REST + Contents API | Single-call recursive tree fetch. Raw file content via `raw.githubusercontent.com`. |
| **GitHub Enterprise** | any custom domain (picked explicitly) | same API under `/api/v3` | Same adapter as github.com, just a different base URL. No separate raw CDN, so file content goes through the Contents API with a raw Accept header instead. |
| **GitLab** | `gitlab.com`, or any custom domain (self-hosted) | REST API v4 | Paginated tree fetch (GitLab doesn't offer a single-call recursive tree like GitHub). Only top-level `owner/repo` projects are supported — nested subgroups (`group/subgroup/project`) aren't handled. |
| **Bitbucket Cloud** | `bitbucket.org` | REST API 2.0 | No single-call recursive tree — walks directories one API call at a time, capped at 60 calls. More rate-limit-prone than the others as a result. |
| **Bitbucket Server / Data Center** | any custom domain (picked explicitly) | REST API 1.0 | Structurally unrelated to Bitbucket Cloud's API. **Untested against a real instance** (none available) — implemented per Atlassian's published docs. Most self-hosted instances require auth even for nominally public repos — a token (below) covers this. CORS is still admin/version-dependent regardless, so this may simply not work on a given deployment — errors surface clearly rather than hanging. |
| **Gitee** | `gitee.com` | REST API v5 | Modeled closely on GitHub's API. File content comes back base64-encoded via the contents endpoint. |

### Git host access tokens

Settings → **Git Host Access Tokens** lets you add an optional personal access token per host (just needs repo read scope). This isn't required for public repos, but raises the otherwise-low unauthenticated rate limits substantially (GitHub: 60/hour → 5000/hour) and is required for GitHub Enterprise / self-hosted GitLab / Bitbucket Server instances that don't allow anonymous API access, which is most of them. Sent as `Authorization: Bearer` (GitHub, Bitbucket Cloud/Server), `PRIVATE-TOKEN` (GitLab), or `Authorization: token` (Gitee). Tokens are looked up fresh by host at request time and never stored inside a cached wiki.

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

Settings' Base URL and Model fields are editable dropdowns (type your own, or pick a suggestion) — Base URL is pre-populated with the providers above, and Model has a static list of common model names plus a **🔄 Fetch Models** button that queries the endpoint's `/models` (or Anthropic's native `/v1/models`) using the current Base URL + API key and replaces the suggestions with whatever the provider actually has available.

## Running locally

No install needed. Serve the directory with any static file server and open it — ES modules require `http://`, not `file://`:

```sh
python3 -m http.server 8000
# then open http://localhost:8000/
```

## Building a single-file distributable

`shell.nix` + `build.js` bundle the whole app — JS, CSS, vendored libraries, and the Alegreya font — into one minified, self-contained `dist/surf.ai.html` with zero external dependencies. It works straight off disk via `file://`, since unlike the dev version it isn't ES modules.

```sh
nix-shell --run 'node build.js'
# output: dist/surf.ai.html
```

This is dev tooling only — the app's actual source stays plain, buildless ES modules/CSS; nothing about running or deploying the normal way requires Nix or a build step.

## Project layout

- `js/providers/` — one adapter per Git host (`github.js`, `gitlab.js`, `bitbucket-cloud.js`, `bitbucket-server.js`, `gitee.js`), a shared error class and readme-probing helper (`common.js`), host detection/registry (`detect.js`), and provider-agnostic file/module filtering (`repo-filter.js`)
- `js/llm/` — chat completions client (OpenAI-compatible wire format, with a native-endpoint adapter for Anthropic)
- `js/pipeline/` — two-pass wiki generation orchestrator, prompts, JSON parsing/validation, and the Ask Q&A tool-calling loop (`qa.js`)
- `js/render/` — markdown (marked.js) + Mermaid rendering, sanitized with DOMPurify
- `js/storage/` — localStorage settings + wiki cache
- `js/views/` — landing, progress, wiki, settings, and provider-picker UI
- `js/vendor/` — vendored third-party libraries (marked, mermaid, DOMPurify) — no CDN dependency
