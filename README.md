# xpi-kuma

**English** · [简体中文](./README.zh-CN.md)

**A Pi Coding Agent extension that records real LLM usage and vendor availability, then serves them as a loopback-only browser dashboard.**

**一个记录真实 LLM 用量与供应商可用性,并以仅本机可访问的浏览器面板展示的 Pi Coding Agent 扩展。**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](./LICENSE)

```text
> /xpi-kuma
```

## Why

Pi reports token counts and cost for every assistant message, but nothing keeps the running total,
and nothing tells you whether the gateways you depend on are actually reachable. `xpi-kuma` closes
both gaps: it records each real `message_end` usage into SQLite, probes every configured vendor on
its own schedule, and serves the result as a dashboard on loopback.

That dashboard runs in your own browser on purpose. An earlier revision rendered it in a native
window through Glimpse, which dragged in a platform binary, a stderr-isolation shim, and window
lifecycle handling — all maintenance surface for a read-only panel. A loopback HTTP service plus a
page needs none of it, and it uses the browser you already have.

Every extension in this repository starts from the same four rules:

- **No build step.** Pi loads `./src/index.ts` directly. No `dist/`, no bundler, no committed artifacts.
- **Pi-native UI.** Everything the extension shows in the terminal goes through `ctx.ui.*` (notifications). It never hijacks the terminal or pulls in a competing terminal framework; the dashboard is a loopback web page rather than a terminal render.
- **No heavy runtime dependencies.** Host-provided APIs plus strict types; `typebox` for tool schemas, and nothing else unless it earns its place.
- **Strict gates, no exceptions.** TypeScript strict, Biome, and Vitest must all pass before any commit.

It also stays inside its lane: an extension is a plugin loaded into the Pi main process, not a separate service. If a task needs a process boundary, say so in an ADR before adding one.

## Tech stack

- [Node.js](https://nodejs.org/) + [pnpm](https://pnpm.io/), versions pinned in [`mise.toml`](./mise.toml)
- [Pi Coding Agent](https://github.com/earendil-works/pi) — the host, its extension API, and `@earendil-works/pi-tui`
- TypeScript strict (`target: ES2024`, `module: NodeNext`)
- [Biome](https://biomejs.dev/) for lint and format
- [Vitest](https://vitest.dev/) as the test runner

## Install

Requires a working Pi installation. The package is loaded straight from source, so there is nothing to build first.

```bash
pi install git:github.com/<owner>/xpi-kuma@<ref>
```

| Where | Command |
| --- | --- |
| Global (user settings) | `pi install git:github.com/<owner>/xpi-kuma@<ref>` |
| This project only (`.pi/settings.json`) | `pi install -l git:github.com/<owner>/xpi-kuma@<ref>` |

`pi install` writes to `~/.pi/agent/settings.json`; `-l` writes to the project settings, which Pi installs automatically once the project is trusted. A pinned git ref is not moved by `pi update`.

```bash
pi list                              # installed packages
pi update --extensions               # update packages and reconcile pinned refs
pi remove git:github.com/<owner>/xpi-kuma
```

Package-level debugging uses npm or git remote sources on purpose: a local-path install only records a reference to your working copy and leaves a stale entry in settings the moment you forget to `pi remove` it.

## Usage

| Command | Description |
| --- | --- |
| `/xpi-kuma` / `/xpi-kuma on` | Start (or restart) the local dashboard service and open it in your browser — run it again to reopen a page you closed (vendor status, usage stats, cost/token trend) |
| `/xpi-kuma off` | Shut the service down and release its port; probing and usage collection stop until the next `on` |

### Configuration

The extension reads the global `~/.pi/agent/data/xpi-kuma/config.yaml` (next to `usage.db`). The file
is created from the shipped template on first session start; edit it to list the vendors you want to
monitor. Configuration is global by design — it is not per-project.

The extension never creates a `.pi/xpi-kuma/` directory inside your projects — the only config it
writes lives under `~/.pi/agent/data/xpi-kuma/`.

`dashboard.port` sets the listening port (default `5180`). When that port is busy the service falls
back to a random one and tells you which port it actually used.

A legacy config at `<project root>/.pi/xpi-kuma/config.yaml` is only reported once at startup and
never moved. Migrate it yourself from the project root:

```bash
cp ./.pi/xpi-kuma/config.yaml ~/.pi/agent/data/xpi-kuma/config.yaml
```

```yaml
dashboard:
  port: 5180                      # falls back to a random port when busy

vendors:
  - name: "OpenAI"
    endpoint: "https://api.openai.com/v1"
    models: ["gpt-4o-mini", "gpt-4o"]   # one probe per model; cards are per model
    api_key: "${OPENAI_API_KEY}"   # resolved from the environment, never stored
    probe:
      enabled: true
      interval: "5m"              # 5m / 30s / 1h
      timeout: 30000              # milliseconds

  - name: "commandcode"         # command-code upstream API reachability sample
    endpoint: "https://api.commandcode.ai/provider/v1"
    models: ["<your-commandcode-model>"]   # placeholder; fill in your subscribed models
    api_key: "${COMMANDCODE_API_KEY}"
    probe:
      enabled: true
      interval: "5m"
      timeout: 30000

retention:
  raw_records: 7                  # days of raw records to keep
```

- `api_key` supports `${ENV_VAR}` placeholders and is expanded only in memory.
  An unset variable is left as-is so you notice it instead of silently probing with no key.
- Probes send a fixed `"hi"` prompt with `max_tokens: 1`, so each one costs a few tokens.
  A stream that carries data but no visible text (some models emit only empty deltas at this token
  limit) still counts as reachable: the vendor reads `up` and TTFT shows unknown instead of a false
  `down`.
  Set `probe.enabled: false` for vendors you do not want probed (rate-limited gateways).

Data written by the extension:

| Table | Written on | Contents |
| --- | --- | --- |
| `usage_records` | every assistant message (`message_end`) | real token counts, cost, and tool-call counts, as reported by the provider |
| `probe_records` | each scheduled or manual probe | status, TTFT, total response time |

Session-level tokens and cost come from Pi's built-in footer stats line, which already carries the token
breakdown, the cache hit rate, and `$cost`. This extension writes nothing to the footer; period
aggregates live in the dashboard.

### Monitoring dashboard

`/xpi-kuma` starts a web service bound to `127.0.0.1` on port `5180` (see `dashboard.port`), then
opens the dashboard in your default browser. The service lives for the whole Pi process, not for one
session; the same command reuses the running service instead of starting a second one.

- **Local only.** The service never listens on a non-loopback interface, so nothing on your LAN
  can reach it. Access is protected by a 256-bit credential that is persisted for reuse.
- **The credential lives in the URL fragment** (`http://127.0.0.1:<port>/#<token>`). Fragments are
  never sent in HTTP requests, written to access logs, or leaked through the `Referer` header of
  third-party resources. The page clears it from the address bar as soon as it loads and keeps a copy
  in this tab's `sessionStorage`, so reloading the page keeps working (the copy is gone once the tab closes).
- **The credential is persisted** in `~/.pi/agent/data/xpi-kuma/dashboard.json` with `0600` permissions,
  so bookmarks and a pinned page keep working after a restart. Delete that file to rotate it.
- **Browser did not open?** The service stays up and Pi shows a notification with the same URL, ready to copy.
- **Auto refresh.** A visible page polls every 5 seconds; a hidden tab pauses polling and refreshes
  immediately when you come back. Requests never overlap, and a failed refresh keeps the last rendered data.
  Reloading the tab (`F5`) is safe too: the tab keeps its own copy of the credential.
- **Zero external resources.** The panel loads no CDN scripts or stylesheets: the trend chart is inline
  SVG, and every color, size and radius comes from the theme tokens in this repository. It works fully offline.
- **Closed the page by mistake?** The service stays up for the whole Pi process, so run `/xpi-kuma` again to reopen the same dashboard with the same credential. No second service is started.
- **Process-scoped, not session-scoped.** Quitting, reloading, starting, resuming, or forking a session
  leaves the service running; only `/xpi-kuma off` (or exiting Pi) shuts it down. `/xpi-kuma on` starts
  it again on the same port with the same credential.

### Dashboard pages

Four pages are served by the same loopback service. Entry points live on the main panel, and every
in-page link carries the credential forward in its URL fragment, so a page opened from another page
stays authenticated.

| Page | Path | What it shows |
| --- | --- | --- |
| Main panel | `/` | Four tabs: usage overview, usage stats, trend, vendor overview |
| Accounts | `/accounts` | Balance per vendor, where that number came from, and the action needed to refresh it |
| Config checkup | `/settings` | Read-only report on `config.yaml`: five checks per vendor, plus global and storage facts |
| Getting started | `/empty` | Guidance when no vendor is configured, or none has recorded usage yet |

**Vendors are edited from the panel itself.** The main panel's vendor tab groups cards by vendor: the
group header carries the name, endpoint, "probe all", "edit" and "delete", and each configured model
gets its own card with its TTFT, response time and last-probe time. Saving a form writes back to
`~/.pi/agent/data/xpi-kuma/config.yaml` — with a `config.yaml.bak-<timestamp>` backup, `0600` on the
temporary file, an atomic `rename`, and your comments and unknown fields preserved — then hot-reloads
in the same process: the API and the probe timers pick up the new models immediately, with no panel
restart. Invalid input returns `400` and leaves the file byte-for-byte unchanged. The `api_key` field is
always blank when you open an existing vendor: leaving it empty keeps the stored key, and the panel never
echoes a secret back.

The main panel's four sections are tabs — one visible at a time. The header's theme family is a
dropdown (default / atlas) with a separate light-dark button; with no stored preference the default
look is **atlas · light**, kept under `kuma.family` and `kuma.theme` and applied before the first paint.

The same header's actions row carries the time-range buttons (1h / 24h / 7d / 30d). They are a
page-level filter: picking one refreshes overview, stats, trend and the vendor tab together, so the
selected period is global instead of belonging to a single tab.
The page header carries a language toggle (`#kuma-lang`) for English and Simplified Chinese. The choice
is stored in `localStorage` under `kuma.lang` and applied before the first paint.

The same header carries a font-size control — `A−` / `A+` / reset — on all four pages. Five steps are
available (85% to 130%); the choice is stored under `kuma.font` and applied before the first paint.
Counts, costs and durations use thousands separators, and totals switch to `M` (millions) or `亿`
(100 millions) so long numbers stay readable at a glance.

The usage stats table on the main panel has twelve column groups — **vendor / model / requests / input, output, cache-read and
cache-write tokens with their cost / tool calls / cost per request / cache hit rate / token share / cost share** — with shares
computed against the whole period and cost per request defined as cost ÷ requests. The first screen shows at most 8 rows;
the remaining combinations collapse into a single "N more combinations" row (values summed, shares and cost per request
recomputed from the totals). Body width is capped at `1280px`, and wider tables scroll horizontally inside the body
instead of breaking the layout.

The usage overview tab leads with five metrics (spend, total tokens, requests, projects covered, cache hit rate), followed
by **read-only suggestions**, **provider/model and project spend rankings**, and an **efficiency ranking**. The cache hit
rate is `cacheRead / (input + cacheRead)`; when the denominator is zero it reads "unknown" instead of a fabricated `0%`.

**Suggestions are an explanation layer, not a decision layer.** Each one states its target, evidence, sample size, time
range and confidence; the panel never switches models, rewrites your vendor config, or fires a probe because of one.

**The efficiency ranking uses only real call timings.** Request start, first response token and completion are taken from
direct observation of the Pi event chain; a provider/model combination needs at least 10 successful records with complete
timings to enter the ranking (the threshold is fixed at 10, not configurable in this version). Combinations below it are
marked "not enough samples", and history without reliable timings shows "no real call latency yet" — never substituted with
neighbouring records, probe data or estimates. If suggestions or efficiency fail to compute, the base overview and stats
still render and only that block is marked "suggestions unavailable".

**Balances fall back through three tiers**, per vendor and in order. A tier that fails only adds a reason;
it never aborts the row.

1. **Balance API** — `balance.api_path` is requested relative to `endpoint`. No path is ever guessed.
2. **OAuth** — requires `oauth.authorize_url`, `token_url`, `client_id`, and `scopes`; a missing field means
   the tier is simply unconfigured. Start it from the accounts page. Tokens are stored in
   `~/.pi/agent/data/xpi-kuma/oauth.json` with `0600` permissions and never include a client secret.
   Expired tokens (with a 30-second margin) are excluded from queries and the row is marked
   "authorization expired".
3. **Manual entry** — written from the accounts page into `~/.pi/agent/data/xpi-kuma/config.yaml` in place,
   after saving a `config.yaml.bak-<timestamp>` backup. Comments and unknown fields survive the rewrite.

When all three tiers fail, the page shows "unknown" rather than `0`. A previously fetched value is kept
and marked stale instead of being dropped.

**The config checkup page is strictly read-only.** It never creates the config template, never repairs a
broken file, and never displays an API key — only the `${ENV_VAR}` placeholder name and whether that
variable is currently set. A file that fails to parse hides the vendor cards and the global section
entirely, showing the error, its line number, and the path instead of half the data.

Vendors without a usable balance endpoint are the expected case, not a bug: none of the four samples in
`config.example.yaml` expose a public balance API today. See
[`docs/probe-balance-and-oauth.md`](./docs/probe-balance-and-oauth.md) for the probe results.

### Boundaries

`/xpi-kuma` is the only command this extension registers. It:

- **Reads** the global `~/.pi/agent/data/xpi-kuma/config.yaml` and the `usage_records` / `probe_records` tables.
- **Starts** a loopback HTTP service owned by the Pi process (`on` / `off`, default `on`), then opens it in your default browser.
- **Writes** only when you ask it to: a probe sends one minimal request per vendor, costing a few tokens;
  a balance sync queries the vendor; manual entry rewrites the global config after taking a backup.
- **Refuses** to listen on a non-loopback interface, to hand vendor API keys to the browser, to edit the
  config file outside the balance fields, or to keep serving after `/xpi-kuma off`.

## Development

```bash
mise install                         # pinned Node.js and pnpm
pnpm install
```

| Gate | Command |
| --- | --- |
| Types | `pnpm typecheck` — `tsc --noEmit` |
| Lint and format | `pnpm -w run lint` — Biome across the repository |
| Tests | `pnpm test` — Vitest (`vitest run --passWithNoTests`) |

All three must pass before committing. Run `pnpm -w run lint` explicitly at the workspace root; the wrapper occasionally misreads a bare `pnpm run lint` as an unknown recursive command.

Two ways to run the extension while working on it:

```bash
pi -e ./src/index.ts                 # smoke test: load once, current run only
```

```bash
ln -s "$(pwd)" ~/.pi/agent/extensions/xpi-kuma   # live loop: /reload inside Pi
```

`pi -e` writes nothing to settings; the symlink is picked up from the extensions directory and is removed with `rm`.

## Directory structure

```text
.
├── mise.toml / package.json / biome.jsonc / tsconfig.json / pnpm-workspace.yaml
├── AGENTS.md / CONTEXT.md / DESIGN.md / THEMES.md
├── README.md / README.zh-CN.md / LICENSE
├── docs/                      # Git workflow, repository guardrails, reference material
└── src/
    ├── index.ts               # Extension entrypoint (register function)
    ├── config.ts              # global config.yaml loading and ${ENV_VAR} expansion
    ├── types.ts               # Shared domain types
    ├── insights.ts            # Read-only cost / efficiency / cache insights (pure, no DB reads, no config writes)
    ├── collectors/            # Usage persistence and aggregate queries
    ├── monitors/              # Scheduled vendor probes
    ├── storage/               # SQLite persistence
    ├── lib/                   # Logger, browser launch
    └── ui/                    # Dashboard HTTP service, page rendering, theme
```

## Design baseline

This project adopts the [Google Labs DESIGN.md format](https://github.com/google-labs-code/design.md) tailored for terminal TUI interfaces. See [`DESIGN.md`](./DESIGN.md) for the design tokens (colors, monospace typography, spacing, and component definitions).

## Conventions & constraints

- **Glossary** — [`CONTEXT.md`](./CONTEXT.md) defines the repository's unified terminology; terms must not drift in code, docs, or commits.
- **Git discipline** — read [`docs/GIT-WORKFLOW.md`](./docs/GIT-WORKFLOW.md) and [`docs/GITHUB-GUARD.md`](./docs/GITHUB-GUARD.md) before committing or pushing. `docs/GIT-WORKFLOW.md` is the single source of truth: commit and push directly on `main` in small, granular Conventional Commits. Branches and pull requests enter the flow only when you ask for them.
- **Token safety** — credentials and secret tokens are never written into code, logs, examples, or documentation.
- **Agent contract** — [`AGENTS.md`](./AGENTS.md) is the single source of truth for this repository. When an oral agreement, older code, or this README disagrees with it, `AGENTS.md` wins.

## Credits

- [Pi Coding Agent](https://github.com/earendil-works/pi) by [earendil-works](https://github.com/earendil-works) — the host this extension plugs into. The extension API, the `ctx.ui` contract, and the package manifest format are theirs.

## License

MIT
